// Helpers for engine tests and simulations. Not imported by the client.

import { botDecide, type BotLevel } from '../bots/heuristic';
import { applyCommand } from './commands';
import { createGame } from './setup';
import type { RngState } from './rng';
import type { HouseRules } from './rules';
import type { CardId, GameEvent, GameState } from './types';
import { viewFor } from './view';

export function seats(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i + 1}` }));
}

export function seed(n: number): RngState {
  return [n, n * 7 + 1, n * 13 + 2, n * 31 + 3];
}

/** Every card instance must be in exactly one place. */
export function locateAll(s: GameState): Map<CardId, string[]> {
  const where = new Map<CardId, string[]>();
  const put = (c: CardId, place: string) => where.set(c, [...(where.get(c) ?? []), place]);
  for (const [k, pile] of Object.entries(s.decks)) for (const c of pile) put(c, `deck:${k}`);
  for (const [k, pile] of Object.entries(s.discards)) for (const c of pile) put(c, `discard:${k}`);
  for (const p of s.players) {
    if (p.hero) put(p.hero, `${p.id}:hero`);
    for (const c of p.companions) put(c, `${p.id}:companion`);
    for (const c of p.inactiveCompanions) put(c, `${p.id}:inactive`);
    for (const c of p.resting) put(c, `${p.id}:resting`);
    for (const c of p.hand) put(c, `${p.id}:hand`);
    for (const c of p.claimed) put(c, `${p.id}:claimed`);
    for (const b of p.bids) put(b.card, `${p.id}:bid`);
    for (const c of p.councilHeroes) put(c, `${p.id}:council`);
  }
  const t = s.turn;
  if (t.location) put(t.location, 'location');
  for (const c of t.extraLocations) put(c, 'extraLocation');
  if (t.encounter) put(t.encounter, 'encounter');
  for (const c of t.minions) put(c, 'minion');
  for (const c of t.companionMinions) put(c, 'companionMinion');
  for (const c of t.setAside) put(c, 'setAside');
  if (t.chosenEncounter) put(t.chosenEncounter, 'chosenEncounter');
  if (s.pending?.kind === 'companion.place') put(s.pending.drawn, 'pendingDrawn');
  return where;
}

export function checkInvariants(s: GameState): void {
  const where = locateAll(s);
  const total = Object.keys(s.cards).length;
  if (where.size !== total) throw new Error(`card conservation: ${where.size} located of ${total}`);
  for (const [c, places] of where) if (places.length !== 1) throw new Error(`card ${c} in ${places.join(', ')}`);
  for (const p of s.players) {
    if (p.renown < 0) throw new Error('negative renown');
    if (p.claimed.some((c) => !s.cards[c]?.length)) throw new Error('bad claimed card');
  }
  if (s.pending && !s.players.some((p) => p.id === s.pending!.player)) throw new Error('pending for unknown player');
}

export interface SimResult { state: GameState; events: GameEvent[]; steps: number }

/** Play a whole game with bots through the public API only. */
export function simulate(n: number, rngSeed: RngState, level: BotLevel = 'normal', opts: { check?: boolean; maxSteps?: number; rules?: Partial<HouseRules> } = {}): SimResult {
  let { state, events } = createGame({ players: seats(n), seed: rngSeed, ...(opts.rules ? { rules: opts.rules } : {}) });
  const all = [...events];
  let steps = 0;
  let r = 0x9e3779b9 ^ rngSeed[0];
  const rand = () => { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; return ((r >>> 0) % 10_000) / 10_000; };
  while (!state.winner && state.turn.step !== 'gameOver') {
    if (++steps > (opts.maxSteps ?? 20_000)) throw new Error('simulation did not finish');
    const d = state.pending;
    if (!d) throw new Error(`no pending decision at step ${state.turn.step}`);
    const view = viewFor(state, d.player);
    const cmd = botDecide(view, level, rand);
    if (!cmd) throw new Error(`bot had no answer for ${d.kind}`);
    const res = applyCommand(state, d.player, cmd);
    if (!res.ok) throw new Error(`bot command rejected: ${res.error} (${JSON.stringify(cmd)})`);
    state = res.state;
    all.push(...res.events);
    if (opts.check !== false) checkInvariants(state);
  }
  return { state, events: all, steps };
}
