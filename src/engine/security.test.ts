// Security properties of the engine boundary: validation, authorization,
// atomicity and information hiding.

import { describe, expect, it } from 'vitest';
import { applyCommand, parseCommand } from './commands';
import { createGame, sanitizeName } from './setup';
import { seats, seed, simulate } from './testUtils';
import type { GameState } from './types';
import { redactEvents, viewFor } from './view';
import { botDecide } from '../bots/heuristic';

/** A new game, advanced (with "no thanks" answers) to the first companion offer. */
function newGame(n = 3, s = 1): GameState {
  let state = createGame({ players: seats(n), seed: seed(s) }).state;
  while (state.pending && state.pending.kind !== 'companion.offer') {
    const d = state.pending;
    const cmd = d.kind === 'activate' ? { type: 'ability.done', decision: d.id }
      : d.kind === 'choose' ? { type: 'choose', decision: d.id, picks: d.options.slice(0, d.min).map((o) => o.value) }
      : null;
    if (!cmd) break;
    const r = applyCommand(state, d.player, cmd);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
  }
  return state;
}

/** Advance with bots until `pred` holds (or give up). */
function playUntil(state: GameState, pred: (s: GameState) => boolean, max = 500): GameState {
  for (let i = 0; i < max && !pred(state); i++) {
    const d = state.pending!;
    const res = applyCommand(state, d.player, botDecide(viewFor(state, d.player), 'hard'));
    if (!res.ok) throw new Error(res.error);
    state = res.state;
  }
  if (!pred(state)) throw new Error('condition never reached');
  return state;
}

describe('command validation (untrusted input)', () => {
  const bad: unknown[] = [
    null, undefined, 42, 'bid.pass', [], [{ type: 'bid.pass', decision: 1 }],
    {}, { type: 'nope', decision: 1 }, { type: 'bid.pass' },
    { type: 'bid.pass', decision: '1' }, { type: 'bid.pass', decision: 1.5 }, { type: 'bid.pass', decision: -1 },
    { type: 'bid.pass', decision: Number.MAX_SAFE_INTEGER + 2 },
    { type: 'bid.pass', decision: 1, extra: true },
    { type: 'bid.play', decision: 1, card: 'X'.repeat(33) },
    { type: 'bid.play', decision: 1, card: '../../etc' },
    { type: 'bid.play', decision: 1, card: { toString: () => 'abc' } },
    { type: 'choose', decision: 1, picks: 'abc' },
    { type: 'choose', decision: 1, picks: ['a', 'a'] },
    { type: 'choose', decision: 1, picks: Array.from({ length: 50 }, (_, i) => `c${i}`) },
    { type: 'companion.keep', decision: 1 },
    { type: 'bid.play', decision: 1, card: 'abc', faceDown: 'yes' },
    { type: 'ability.use', decision: 1, source: 'abc' },
    { type: 'ability.use', decision: 1, source: 'abc', ability: 'x'.repeat(40) },
    { type: 'ability.use', decision: 1, source: 'abc', ability: '__proto__' },
    { type: 'ability.use', decision: 1, source: 'abc', ability: 'force', extra: 1 },
    { type: 'ability.done', decision: 1, source: 'abc' },
    { type: 'choose', decision: 1, picks: ['p0:1', '<script>'] },
    JSON.parse('{"type":"bid.pass","decision":1,"__proto__":{"polluted":true}}'),
    JSON.parse('{"type":"bid.pass","decision":1,"constructor":{"prototype":{"polluted":true}}}'),
    Object.create({ type: 'bid.pass', decision: 1 }),
    new (class { type = 'bid.pass'; decision = 1; })(),
  ];
  for (const [i, raw] of bad.entries()) {
    it(`rejects malformed command #${i}`, () => {
      expect(() => parseCommand(raw)).toThrow('bad_command');
      const s = newGame();
      expect(applyCommand(s, s.pending!.player, raw)).toEqual({ ok: false, error: 'bad_command' });
    });
  }

  it('does not pollute Object.prototype', () => {
    const s = newGame();
    applyCommand(s, s.pending!.player, JSON.parse('{"__proto__":{"polluted":1},"type":"bid.pass","decision":1}'));
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('strips unknown data: the parsed command is a fresh object', () => {
    const raw = { type: 'bid.play', decision: 3, card: 'abc123' };
    const cmd = parseCommand(raw);
    expect(cmd).toEqual(raw);
    expect(cmd).not.toBe(raw);
  });
});

describe('authorization and atomicity', () => {
  it('only the deciding seat may act, and the seat comes from the caller', () => {
    const s = newGame(3);
    const d = s.pending!;
    const other = s.players.find((p) => p.id !== d.player)!.id;
    const res = applyCommand(s, other, { type: 'companion.skip', decision: d.id });
    expect(res).toEqual({ ok: false, error: 'not_your_decision' });
  });

  it('rejects stale or replayed decision ids', () => {
    const s = newGame(3);
    const d = s.pending!;
    const first = applyCommand(s, d.player, { type: 'companion.skip', decision: d.id });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const replay = applyCommand(first.state, d.player, { type: 'companion.skip', decision: d.id });
    expect(replay.ok).toBe(false);
  });

  it('rejects commands of the wrong kind for the pending decision', () => {
    const s = newGame(3);
    const d = s.pending!;
    expect(applyCommand(s, d.player, { type: 'bid.pass', decision: d.id })).toEqual({ ok: false, error: 'wrong_command_for_decision' });
  });

  it('cannot bid a card from someone else\'s hand, and a rejection leaves state untouched', () => {
    let s = playUntil(newGame(3, 5), (x) => x.pending?.kind === 'bid');
    const d = s.pending!;
    const thief = s.players.find((p) => p.id === d.player)!;
    const victim = s.players.find((p) => p.id !== d.player && p.hand.length > 0)!;
    const before = structuredClone(s);
    const res = applyCommand(s, thief.id, { type: 'bid.play', decision: d.id, card: victim.hand[0]! });
    expect(res).toEqual({ ok: false, error: 'card_not_in_hand' });
    expect(s).toEqual(before);
    s = before;
  });

  it('cannot keep a companion by "replacing" another player\'s companion', () => {
    let s = newGame(3, 9);
    const d = s.pending!;
    const r = applyCommand(s, d.player, { type: 'companion.draw', decision: d.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const place = s.pending!;
    expect(place.kind).toBe('companion.place');
    const other = s.players.find((p) => p.id !== place.player)!;
    const res = applyCommand(s, place.player, { type: 'companion.keep', decision: place.id, replace: other.companions[0]! });
    expect(res).toEqual({ ok: false, error: 'not_your_companion' });
  });

  it('no commands after the game is over', () => {
    const { state } = simulate(2, seed(3), 'normal', { check: false });
    expect(applyCommand(state, 'p0', { type: 'bid.pass', decision: state.decisionSeq })).toEqual({ ok: false, error: 'game_over' });
  });
});

describe('information hiding', () => {
  function hiddenIdsFor(s: GameState, viewer: string): string[] {
    const ids: string[] = [];
    for (const p of s.players) {
      if (p.id === viewer) continue;
      ids.push(...p.hand);
      ids.push(...p.bids.filter((b) => !b.visible).map((b) => b.card));
    }
    for (const pile of Object.values(s.decks)) ids.push(...pile);
    ids.push(...s.turn.extraLocations);
    if (s.pending?.kind === 'companion.place' && s.pending.player !== viewer) ids.push(s.pending.drawn);
    return ids;
  }

  it('views never contain hidden card ids, the RNG state or the card map', () => {
    for (let g = 0; g < 4; g++) {
      let s = newGame(4, 100 + g);
      for (let i = 0; i < 400 && !s.winner; i++) {
        for (const viewer of [...s.players.map((p) => p.id), null]) {
          const json = JSON.stringify(viewFor(s, viewer));
          for (const id of hiddenIdsFor(s, viewer ?? '')) expect(json).not.toContain(`"${id}"`);
          expect(json).not.toContain('"rng"');
          expect(json).not.toContain('"cards"');
          expect(json).not.toContain(String(s.rng[0]));
        }
        const d = s.pending!;
        const res = applyCommand(s, d.player, botDecide(viewFor(s, d.player), 'normal'));
        if (!res.ok) throw new Error(res.error);
        s = res.state;
      }
    }
  }, 30_000); // deliberately exhaustive: every seat's view after every move of four games

  it('events: other players see draw counts and face-down bids without card identities', () => {
    let s = newGame(3, 11);
    for (let i = 0; i < 300 && !s.winner; i++) {
      const d = s.pending!;
      const res = applyCommand(s, d.player, botDecide(viewFor(s, d.player), 'hard'));
      if (!res.ok) throw new Error(res.error);
      for (const viewer of s.players.map((p) => p.id)) {
        for (const e of redactEvents(res.events, viewer)) {
          if (e.type === 'drew' && e.player !== viewer) expect(e.cards).toBeUndefined();
          if (e.type === 'bid' && !e.faceUp && e.player !== viewer) expect(e.card).toBeUndefined();
        }
      }
      s = res.state;
    }
  });

  it('an opponent\'s face-down Null-Rune Seal does not leak through my wand values', () => {
    // Rig: p1 holds a wand, p0 bids a face-down Null-Rune Seal.
    let s = playUntil(newGame(2, 21), (x) => x.pending?.kind === 'bid');
    const byDef = (def: string) => Object.entries(s.cards).find(([, d]) => d === def)![0];
    const seal = byDef('null-rune-seal');
    const wand = byDef('starwood-wand');
    const [a, b] = s.players as [typeof s.players[0], typeof s.players[0]];
    // Move the cards into hands (test-only surgery), keeping conservation.
    for (const pile of [...Object.values(s.decks), ...Object.values(s.discards), ...s.players.map((p) => p.hand)]) {
      for (const c of [seal, wand]) { const i = pile.indexOf(c); if (i >= 0) pile.splice(i, 1); }
    }
    a.hand.push(seal);
    b.hand.push(wand);
    // Give `a` a face-down bid: its first bid is face up, so add a dummy first.
    a.bids.push({ card: a.hand.shift()!, visible: true, resolved: true, playedFaceUp: true });
    a.hand.splice(a.hand.indexOf(seal), 1);
    a.bids.push({ card: seal, visible: false, resolved: false, playedFaceUp: false });
    const bView = viewFor(s, b.id);
    expect(bView.hand.find((h) => h.card.id === wand)!.value).toBe(6);
    expect(bView.turn.wandsDisabled).toBe(false);
    s = structuredClone(s);
  });

  it('pending decision details are only shown to the deciding player', () => {
    const s = newGame(3, 2);
    const d = s.pending!;
    for (const p of s.players) {
      const v = viewFor(s, p.id);
      expect(v.pending!.id).toBe(d.id);
      if (p.id === d.player) expect(v.pending!.detail).toBeDefined();
      else expect(v.pending!.detail).toBeUndefined();
    }
  });
});

describe('player names', () => {
  it('strips control and bidi-override characters and caps length', () => {
    expect(sanitizeName('  Alice‮gnp.exe  ', 'x')).toBe('Alicegnp.exe');
    expect(sanitizeName('a\u0000b\u0007c', 'x')).toBe('abc');
    expect(sanitizeName('<img src=x onerror=alert(1)>', 'x')).toBe('<img src=x onerror=alert');
    expect([...sanitizeName('é'.repeat(100), 'x')]).toHaveLength(24);
    expect(sanitizeName('   ', 'Fallback')).toBe('Fallback');
    expect(sanitizeName(42, 'Fallback')).toBe('Fallback');
  });
});
