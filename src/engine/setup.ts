// Game creation.

import { CARDS } from './cards';
import { Ctx } from './context';
import { advance, dealStartingTeams } from './flow';
import { NO_HERO } from './types';
import { randomSeed, nextInt, warmUp, type RngState } from './rng';
import { DEFAULT_RULES, MAX_PLAYERS, MIN_PLAYERS, type HouseRules } from './rules';
import type { DeckName, GameEvent, GameState, PlayerId } from './types';

export interface SeatSpec { id: PlayerId; name: string }

export interface NewGameOptions {
  players: SeatSpec[];
  rules?: Partial<HouseRules>;
  /** Tests and replays only. Production games take a CSPRNG seed. */
  seed?: RngState;
  /** Simulations only: deal these heroes (def ids by seat) instead of the top of the stack. Needs `heroDraft: 1`; other seats are dealt blind. */
  heroes?: Record<PlayerId, string>;
  /** Pause at presentation checkpoints (the host resumes them). Off for simulations. */
  autoPause?: boolean;
}

const MAX_NAME = 24;
const SEAT_ID = /^[a-z0-9]{1,16}$/;

/**
 * Player names will be user-supplied in multiplayer. Strip control and
 * bidi-override characters (which can visually spoof other text), collapse
 * whitespace and cap the length. The UI still renders names with textContent.
 */
export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...cleaned].slice(0, MAX_NAME).join('') || fallback;
}

function sanitizeRules(r: Partial<HouseRules> | undefined): HouseRules {
  const out: HouseRules = { ...DEFAULT_RULES };
  if (!r) return out;
  const int = (v: unknown, lo: number, hi: number, d: number) =>
    Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : d;
  out.renownToWin = int(r.renownToWin, 5, 100, out.renownToWin);
  out.maxCompanions = int(r.maxCompanions, 0, 5, out.maxCompanions);
  out.startingCompanions = int(r.startingCompanions, 0, out.maxCompanions, Math.min(out.startingCompanions, out.maxCompanions));
  out.drawSize = r.drawSize === 'playerCount' ? 'playerCount' : int(r.drawSize, 1, 10, 0) || out.drawSize;
  out.companionPhase = r.companionPhase === 'activeOnly' ? 'activeOnly' : 'everyone';
  if (typeof r.allPlayersFaceEncounter === 'boolean') out.allPlayersFaceEncounter = r.allPlayersFaceEncounter;
  if (typeof r.minionsTriggerEntersPlay === 'boolean') out.minionsTriggerEntersPlay = r.minionsTriggerEntersPlay;
  out.maxTurns = int(r.maxTurns, 10, 1000, out.maxTurns);
  if (typeof r.fallCost === 'boolean') out.fallCost = r.fallCost;
  out.heroDraft = int(r.heroDraft, 1, 5, out.heroDraft);
  if (typeof r.draftOnReplace === 'boolean') out.draftOnReplace = r.draftOnReplace;
  if (r.handModel === 'refill' || r.handModel === 'steady') out.handModel = r.handModel;
  out.activeDraw = int(r.activeDraw, 0, 5, out.activeDraw);
  out.othersDraw = int(r.othersDraw, 0, 5, out.othersDraw);
  out.handLimit = int(r.handLimit, 1, 15, out.handLimit);
  return out;
}

export function createGame(opts: NewGameOptions): { state: GameState; events: GameEvent[] } {
  const seats = opts.players;
  if (!Array.isArray(seats) || seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
    throw new Error(`need ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  }
  const ids = new Set<string>();
  for (const s of seats) {
    if (!SEAT_ID.test(s.id) || ids.has(s.id)) throw new Error('invalid or duplicate seat id');
    ids.add(s.id);
  }

  const empty = (): Record<DeckName, string[]> => ({ hero: [], companion: [], location: [], encounter: [], resource: [] });
  const state: GameState = {
    schema: 1,
    rules: sanitizeRules(opts.rules),
    players: [],
    decks: empty(),
    discards: empty(),
    cards: Object.create(null) as Record<string, string>,
    turn: {
      number: 0, active: 0, step: 'turnStart', cursor: 0,
      location: null, extraLocations: [], encounter: null, minions: [], companionMinions: [], setAside: [], chosenEncounter: null, openingEntrants: [],
      bidder: 0, passesInARow: 0, revealCursor: 0,
      wandsDisabled: false, noFalls: false, failed: [], result: null, effects: [], effectSeq: 0, used: {},
    },
    tasks: [],
    pending: null,
    decisionSeq: 0,
    version: 0,
    autoPause: opts.autoPause === true,
    hold: null,
    winner: null,
    rng: warmUp(opts.seed ?? randomSeed()),
  };
  const ctx = new Ctx(state);

  const lists: [DeckName, { id: string }[]][] = [
    ['hero', CARDS.heroes], ['companion', CARDS.companions], ['location', CARDS.locations],
    ['encounter', CARDS.encounters], ['resource', CARDS.resources],
  ];
  for (const [deck, defs] of lists) {
    for (const d of defs) state.decks[deck].push(ctx.mint(d.id));
    ctx.shuffle(deck);
  }

  for (const [i, s] of seats.entries()) {
    state.players.push({
      // No hero yet: heroes are drafted (or dealt) below.
      id: s.id, name: sanitizeName(s.name, `Player ${i + 1}`), hero: NO_HERO,
      companions: [], inactiveCompanions: [], resting: [], hand: [], claimed: [], renown: 0,
      bids: [], councilHeroes: [], statOverride: null, used: {}, penalty: 0, penaltyNext: 0,
    });
  }
  ctx.emit({ type: 'gameStarted', players: state.players.map((p) => p.id) });

  state.turn.active = nextInt(state.rng, state.players.length);

  // Heroes first, then companions and hands (dealStartingTeams).
  if (state.rules.heroDraft > 1) {
    state.turn.step = 'draft'; // flow.ts: each player looks at N heroes and keeps one, then teams are dealt
  } else {
    for (const p of state.players) {
      const want = opts.heroes?.[p.id];
      const at = want ? state.decks.hero.findIndex((c) => state.cards[c] === want) : -1;
      p.hero = at >= 0 ? state.decks.hero.splice(at, 1)[0]! : ctx.take('hero')!;
      ctx.emit({ type: 'heroChanged', player: p.id, from: null, to: ctx.ref(p.hero), reason: 'setup' });
    }
    dealStartingTeams(ctx);
    state.turn.step = 'companionDraft';
  }
  advance(ctx);
  return { state, events: ctx.events };
}
