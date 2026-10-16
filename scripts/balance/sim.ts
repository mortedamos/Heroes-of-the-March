// Balance harness: plays seeded bot games and collects per-card statistics.
// Bundled with rolldown and run with node (see cli.ts); not part of the game build.

import { botDecide, type BotLevel } from '../../src/bots/heuristic';
import { ABILITIES, type Ability } from '../../src/engine/abilities';
import { allDefs, stripNamedAbilitiesOf } from '../../src/engine/cards';
import { applyCommand } from '../../src/engine/commands';
import { createGame } from '../../src/engine/setup';
import { viewFor } from '../../src/engine/view';
import type { Command, GameEvent, GameState } from '../../src/engine/types';

export type Rand = () => number;

/** Small seeded PRNG (mulberry32) for harness choices; the engine has its own seeded RNG. */
export function mulberry(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix integers into one 32-bit seed. */
export function mix(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) { h ^= x >>> 0; h = Math.imul(h, 0x01000193); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; }
  return h >>> 0;
}

// --- per-card aggregates --------------------------------------------------------

export interface CardAgg {
  /** Player-games in which the card was held for at least one turn start. */
  pg: number; turns: number; wins: number; exp: number; varSum: number;
  /** Player-games where the card was in the final roster. */
  finalPg: number; finalWins: number; finalExp: number; finalVar: number;
  /** Trigger hooks: invocations, and invocations that visibly did something. Activations: offered / used. */
  calls: number; produced: number; offered: number; used: number;
  /** Held 3+ turns with zero produced and zero used effects. */
  eligible: number; zero: number;
  /** Summed effect counts (produced+used) and held turns, split by outcome. */
  winEff: number; winTurns: number; loseEff: number; loseTurns: number;
  /** Games in which a non-roster card (location, encounter, resource) appeared. */
  appear: number;
}

export const newAgg = (): CardAgg => ({
  pg: 0, turns: 0, wins: 0, exp: 0, varSum: 0, finalPg: 0, finalWins: 0, finalExp: 0, finalVar: 0,
  calls: 0, produced: 0, offered: 0, used: 0, eligible: 0, zero: 0, winEff: 0, winTurns: 0, loseEff: 0, loseTurns: 0, appear: 0,
});

export type AggMap = Record<string, CardAgg>;
export const aggOf = (m: AggMap, def: string): CardAgg => (m[def] ??= newAgg());

export function mergeAgg(into: AggMap, from: AggMap): void {
  for (const [def, a] of Object.entries(from)) {
    const t = aggOf(into, def) as unknown as Record<string, number>;
    for (const [k, v] of Object.entries(a)) t[k] = (t[k] ?? 0) + v;
  }
}

// --- instrumentation --------------------------------------------------------------

interface Live { calls: Map<string, { calls: number; produced: number }>; }
const live: Live = { calls: new Map() };
let installed = false;
const original: Record<string, Ability> = {};

/** Wrap every trigger hook so each invocation (and whether it did anything) is counted. */
export function installCounters(): void {
  if (installed) return;
  installed = true;
  const note = (owner: string | null, def: string, did: boolean) => {
    for (const key of [`${owner ?? '-'}|${def}`]) {
      const e = live.calls.get(key) ?? { calls: 0, produced: 0 };
      e.calls++; if (did) e.produced++;
      live.calls.set(key, e);
    }
  };
  for (const [def, ab] of Object.entries(ABILITIES)) {
    original[def] = ab;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrap = (fn: (...a: any[]) => void) => (ctx: any, self: any, ...rest: any[]) => {
      const ev = ctx.events.length, tasks = ctx.s.tasks.length, pend = ctx.s.pending, ren = ctx.s.players.map((p: { renown: number }) => p.renown).join();
      fn(ctx, self, ...rest);
      const did = ctx.events.length > ev || ctx.s.tasks.length > tasks || ctx.s.pending !== pend || ctx.s.players.map((p: { renown: number }) => p.renown).join() !== ren;
      note(self?.owner ?? null, def, did);
    };
    if (ab.on) for (const k of Object.keys(ab.on) as (keyof NonNullable<Ability['on']>)[]) { const f = ab.on[k]; if (f) (ab.on as Record<string, unknown>)[k] = wrap(f as never); }
    if (ab.onEnter) ab.onEnter = wrap(ab.onEnter as never) as never;
    if (ab.onReveal) ab.onReveal = wrap(ab.onReveal as never) as never;
  }
}

/** Does this card have anything for a player to "use" besides numbers? */
export function describeAbility(def: string): { status: string; hooks: string[]; activations: string[]; statics: string[] } {
  const ab = original[def] ?? ABILITIES[def];
  if (!ab) return { status: 'none', hooks: [], activations: [], statics: [] };
  const hooks = [...Object.keys(ab.on ?? {}), ...(ab.onEnter ? ['onEnter'] : []), ...(ab.onReveal ? ['onReveal'] : [])];
  const activations = (ab.activations ?? []).map((a) => a.id);
  const skip = new Set(['status', 'note', 'on', 'onEnter', 'onReveal', 'activations']);
  const statics = Object.keys(ab).filter((k) => !skip.has(k));
  return { status: ab.status, hooks, activations, statics };
}

/** Strip a card to its printed numbers ("stats only"); returns a restore function. */
export function strip(def: string): () => void {
  const prev = ABILITIES[def];
  ABILITIES[def] = { status: 'full' };
  const undoNamed = stripNamedAbilitiesOf(def);
  return () => { undoNamed(); if (prev) ABILITIES[def] = prev; else delete ABILITIES[def]; };
}

// --- one game ------------------------------------------------------------------------

export interface GameSpec {
  n: number;
  seed: number;
  level?: BotLevel;
  rules?: Record<string, unknown>;
  /** Hero (or several) to force into this seat's opening party (others never take them in the opening draft). */
  force?: { seat: number; def: string | string[] };
  /** Everyone drafts their opening party at random (neutral) instead of by bot preference. */
  randomDraft?: boolean;
  /** A probe: called with every event as it happens (for one-off diagnostics). */
  onEvent?: (e: GameEvent) => void;
}

export interface PlayerRecord {
  seat: number; pos: number; won: boolean; renown: number;
  startParty: string[]; finalParty: string[]; falls: number;
  /** Turn number of this player's first fall, or null if they never fell. */
  firstFall: number | null;
}
export interface GameRecord {
  n: number; turns: number; winner: number; players: PlayerRecord[]; capped: boolean;
  /** Player-turns measured against an encounter, and how many survived. */
  rows: number; surv: number;
  /** The same by challenge stat (P, M, G). */
  statRows: number[]; statSurv: number[];
  /** Bid events, and turns on which at least one hostile effect or interaction happened. */
  bids: number; sabTurns: number;
  /** Winner's final Renown minus the best other player's. */
  gap: number;
  /** Turns on which a location was won, tied for (nobody took it) or lost by everyone (nobody survived). */
  won: number; tied: number; empty: number;
}

/** Effect kinds that hurt another player (old and new engine names). */
const HOSTILE_EFFECTS = new Set([
  'silenceHero', 'forceStat', 'negateBid', 'disableAbilities',
]);
const HOSTILE_EVENTS = new Set(['bidClaimed', 'cursePlaced', 'bidsSwapped', 'cardsTraded', 'abilityCountered']);

const heroIds = () => allDefs().filter((d) => d.kind === 'hero').map((d) => d.id);
export { heroIds };

export function playGame(spec: GameSpec, cards: AggMap): GameRecord {
  installCounters();
  live.calls.clear();
  const n = spec.n;
  const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i + 1}` }));
  const { state: s0, events } = createGame({
    players: seats, seed: [spec.seed, spec.seed * 7 + 1, spec.seed * 13 + 2, spec.seed * 31 + 3],
    rules: spec.rules as never,
  });
  let state: GameState = s0;
  const all: GameEvent[] = [...events];
  const rand = mulberry(mix(spec.seed, 0xb07));
  const pickRand = mulberry(mix(spec.seed, 0xd4af7));
  const start = state.turn.active;
  let startParty: string[][] = [];
  const level = spec.level ?? 'normal';

  // per-player-game tallies
  const held: Record<string, Map<string, number>> = {};
  const used = new Map<string, number>();     // `${player}|${def}` -> activations used
  const offered = new Map<string, number>();  // `${player}|${def}` -> times offered
  const seen = { loc: new Map<string, number>(), enc: new Map<string, number>(), res: new Map<string, number>() };
  for (const p of state.players) held[p.id] = new Map();
  let falls = new Map<string, number>();
  const firstFall = new Map<string, number>();
  const statRows = [0, 0, 0], statSurv = [0, 0, 0];
  let rows = 0, surv = 0, bids = 0, sabTurns = 0, turnNo = 0, sabThisTurn = false;
  let won = 0, tied = 0, empty = 0;
  let steps = 0;

  const snapshot = () => {
    for (const p of state.players) {
      const m = held[p.id]!;
      for (const c of p.party) {
        const def = state.cards[c]; if (!def) continue;
        m.set(def, (m.get(def) ?? 0) + 1);
      }
    }
  };
  const scan = (evs: GameEvent[]) => {
    for (const e of evs) {
      spec.onEvent?.(e);
      if (e.type === 'turnStarted') {
        if (!startParty.length) startParty = state.players.map((p) => p.party.map((c) => state.cards[c]!));
        snapshot(); if (sabThisTurn) sabTurns++; sabThisTurn = false; turnNo = e.turn;
      }
      else if (e.type === 'locationRevealed') bump(seen.loc, e.card.def);
      else if (e.type === 'locationReplaced') bump(seen.loc, e.to.def);
      else if (e.type === 'encounterRevealed') bump(seen.enc, e.card.def);
      else if (e.type === 'minionDrawn') bump(seen.enc, e.card.def);
      else if (e.type === 'bid') { bump(seen.res, e.card.def); bids++; }
      else if (e.type === 'heroFalls') { falls.set(e.player, (falls.get(e.player) ?? 0) + 1); if (!firstFall.has(e.player)) firstFall.set(e.player, turnNo); }
      else if (e.type === 'outcome') { if (e.result.winner) won++; else if (e.result.tied?.length) tied++; else empty++; for (const r of e.result.rows) { rows++; const si = 'PMG'.indexOf(r.stat); statRows[si]!++; if (r.survived) { surv++; statSurv[si]!++; } } }
      else if (e.type === 'effect') {
        const k = e.effect.kind as string;
        const hostile = HOSTILE_EFFECTS.has(k) || (k === 'statBonus' && (e.effect.amount ?? 0) < 0);
        if (hostile && e.targetPlayer !== null && e.targetPlayer !== e.effect.owner) sabThisTurn = true;
      }
      else if (HOSTILE_EVENTS.has(e.type)) sabThisTurn = true;
    }
  };
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  scan(events);

  while (!state.winner && state.turn.step !== 'gameOver') {
    if (++steps > 40_000) throw new Error('game did not finish');
    const d = state.pending;
    if (!d) throw new Error(`no pending decision at ${state.turn.step}`);
    // Controlled drafts: patch the offered pool so the measured hero is on the table.
    const forcedDefs = spec.force ? ([] as string[]).concat(spec.force.def) : [];
    if (d.kind === 'choose' && d.purpose === 'partyDraft' && spec.force && d.player === `p${spec.force.seat}`) {
      forcedDefs.forEach((def, i) => {
        const have = d.options.some((o) => o.value === def);
        if (!have && state.decks.hero.some((c) => state.cards[c] === def)) {
          const at = d.options.length - 1 - i;
          const there = d.options[at]!;
          d.options[at] = { ...there, value: def, label: def, card: { def } };
        }
      });
    }
    if ((d.kind === 'bid' || d.kind === 'activate') && d.abilities.length) {
      for (const a of d.abilities) bump(offered, `${d.player}|${state.cards[a.source]}`);
    }
    let cmd: Command | null;
    if (d.kind === 'choose' && d.purpose === 'partyDraft' && (spec.randomDraft || spec.force)) {
      let pool = d.options.map((o) => o.value);
      const forced = spec.force && d.player === `p${spec.force.seat}` ? forcedDefs.filter((def) => pool.includes(def)) : [];
      if (spec.force) pool = pool.filter((v) => !forcedDefs.includes(v));
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(pickRand() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
      const picks = [...forced, ...pool.slice(0, d.max - forced.length)];
      cmd = { type: 'choose', decision: d.id, picks };
    } else {
      cmd = botDecide(viewFor(state, d.player), level, rand);
    }
    if (!cmd) throw new Error(`bot had no answer for ${d.kind}`);
    if (cmd.type === 'ability.use') bump(used, `${d.player}|${state.cards[cmd.source]}`);
    const res = applyCommand(state, d.player, cmd);
    if (!res.ok) throw new Error(`rejected: ${res.error} ${JSON.stringify(cmd)}`);
    state = res.state;
    all.push(...res.events);
    scan(res.events);
  }

  // fold into aggregates
  const winnerId = state.winner;
  const capped = state.turn.number > state.rules.maxTurns;
  const p1 = 1 / n, v1 = p1 * (1 - p1);
  const players: PlayerRecord[] = [];
  state.players.forEach((p, i) => {
    const won = p.id === winnerId;
    const finalRoster = new Set([...p.party, ...p.inactive, ...p.resting].map((c) => state.cards[c]!));
    for (const [def, turns] of held[p.id]!) {
      const a = aggOf(cards, def);
      const hook = live.calls.get(`${p.id}|${def}`) ?? { calls: 0, produced: 0 };
      const u = used.get(`${p.id}|${def}`) ?? 0, off = offered.get(`${p.id}|${def}`) ?? 0;
      a.pg++; a.turns += turns; if (won) a.wins++; a.exp += p1; a.varSum += v1;
      if (finalRoster.has(def)) { a.finalPg++; if (won) a.finalWins++; a.finalExp += p1; a.finalVar += v1; }
      a.calls += hook.calls; a.produced += hook.produced; a.used += u; a.offered += off;
      const eff = hook.produced + u;
      if (turns >= 3) { a.eligible++; if (eff === 0) a.zero++; }
      if (won) { a.winEff += eff; a.winTurns += turns; } else { a.loseEff += eff; a.loseTurns += turns; }
    }
    players.push({ seat: i, pos: (i - start + n) % n, won, renown: p.renown, startParty: startParty[i] ?? [], finalParty: [...p.party, ...p.inactive, ...p.resting].map((c) => state.cards[c]!), falls: falls.get(p.id) ?? 0, firstFall: firstFall.get(p.id) ?? null });
  });
  if (sabThisTurn) sabTurns++;
  const winnerIdx = winnerId ? state.players.findIndex((p) => p.id === winnerId) : -1;
  const others = state.players.filter((_, i) => i !== winnerIdx).map((p) => p.renown);
  const gap = winnerIdx >= 0 ? state.players[winnerIdx]!.renown - Math.max(...others) : 0;
  for (const [m, tag] of [[seen.loc, 'loc'], [seen.enc, 'enc'], [seen.res, 'res']] as const) {
    void tag;
    for (const [def, c] of m) { const a = aggOf(cards, def); a.appear += c; }
  }
  // Hooks of non-roster cards (locations, encounters, resources): owner '-' or other owners not held.
  for (const [key, v] of live.calls) {
    const [owner, def] = key.split('|') as [string, string];
    if (owner === '-' || !held[owner]?.has(def)) { const a = aggOf(cards, def); a.calls += v.calls; a.produced += v.produced; }
  }
  for (const [key, v] of used) { const [owner, def] = key.split('|') as [string, string]; if (!held[owner]?.has(def)) aggOf(cards, def).used += v; }
  return { n, turns: state.turn.number, winner: winnerIdx, players, capped, rows, surv, statRows, statSurv, bids, sabTurns, gap, won, tied, empty };
}

// --- shards: the unit of saved results -----------------------------------------------

export interface Cell {
  games: number; wins: number; turns: number; falls: number; capped: number; posGames: number[]; posWins: number[];
  /** Whole-game health metrics (nat experiment): measured player-turns and survivors, bids, sabotage turns, winning margins, tenure. */
  rows: number; surv: number; bids: number; sabTurns: number; gap: number; close: number;
  statRows: number[]; statSurv: number[];
  /** Player-games, and the summed share of each player's game played before their first fall. */
  pgames: number; tenure: number;
  /** Turns by outcome: a location won, a tie (nobody took it), nobody survived. */
  won: number; tied: number; empty: number;
}
export interface Shard { experiment: string; args: Record<string, string>; cells: Record<string, Cell>; cards: AggMap; games: number }

export const newCell = (): Cell => ({
  games: 0, wins: 0, turns: 0, falls: 0, capped: 0, posGames: Array(6).fill(0), posWins: Array(6).fill(0),
  rows: 0, surv: 0, bids: 0, sabTurns: 0, gap: 0, close: 0, pgames: 0, tenure: 0, statRows: [0, 0, 0], statSurv: [0, 0, 0], won: 0, tied: 0, empty: 0,
});

/** Fold one finished game's whole-game metrics into a cell (all players of the game). */
export function addGameMetrics(c: Cell, rec: GameRecord): void {
  c.rows += rec.rows; c.surv += rec.surv; rec.statRows.forEach((v, i) => { c.statRows[i]! += v; c.statSurv[i]! += rec.statSurv[i]!; }); c.bids += rec.bids; c.sabTurns += rec.sabTurns;
  c.gap += rec.gap; if (rec.gap <= 4) c.close++;
  c.won += rec.won; c.tied += rec.tied; c.empty += rec.empty;
  for (const p of rec.players) { c.pgames++; c.tenure += p.firstFall === null ? 1 : Math.min(1, p.firstFall / Math.max(1, rec.turns)); }
}

export function merge(parts: Shard[]): Shard {
  const out: Shard = { experiment: parts[0]!.experiment, args: parts[0]!.args, cells: {}, cards: {}, games: 0 };
  for (const p of parts) {
    out.games += p.games;
    mergeAgg(out.cards, p.cards);
    for (const [k, c] of Object.entries(p.cells)) {
      const t = (out.cells[k] ??= newCell());
      t.games += c.games; t.wins += c.wins; t.turns += c.turns; t.falls += c.falls; t.capped += c.capped;
      t.rows += c.rows ?? 0; t.surv += c.surv ?? 0; (c.statRows ?? []).forEach((v, i) => { t.statRows[i]! += v; t.statSurv[i]! += c.statSurv[i]!; }); t.bids += c.bids ?? 0; t.sabTurns += c.sabTurns ?? 0;
      t.gap += c.gap ?? 0; t.close += c.close ?? 0; t.pgames += c.pgames ?? 0; t.tenure += c.tenure ?? 0;
      t.won += c.won ?? 0; t.tied += c.tied ?? 0; t.empty += c.empty ?? 0;
      c.posGames.forEach((v, i) => { t.posGames[i]! += v; });
      c.posWins.forEach((v, i) => { t.posWins[i]! += v; });
    }
  }
  return out;
}

