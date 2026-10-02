import { describe, expect, it } from 'vitest';
import { applyCommand } from './commands';
import { createGame } from './setup';
import { botDecide } from '../bots/heuristic';
import { checkInvariants, seats, seed, simulate } from './testUtils';
import { viewFor } from './view';

describe('full bot games', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    it(`${n} players: finishes with a winner and conserves every card`, () => {
      for (let g = 0; g < 8; g++) {
        const { state } = simulate(n, seed(n * 100 + g));
        expect(state.winner).not.toBeNull();
        expect(state.turn.step).toBe('gameOver');
        const w = state.players.find((p) => p.id === state.winner)!;
        expect(w.renown).toBe(Math.max(...state.players.map((p) => p.renown)));
      }
    });
  }

  it('games with the opening companion draft finish and conserve every card', () => {
    for (let g = 0; g < 6; g++) {
      const { state } = simulate(4, seed(3000 + g), 'normal', { rules: {} });
      expect(state.winner).not.toBeNull();
    }
  });

  it('every bot level completes games', () => {
    for (const level of ['easy', 'normal', 'hard'] as const) {
      for (let g = 0; g < 5; g++) {
        const { state } = simulate(4, seed(9000 + g), level);
        expect(state.winner).not.toBeNull();
      }
    }
  });

  it('is deterministic for a given seed and command sequence', () => {
    const a = simulate(4, seed(42), 'normal', { check: false });
    const b = simulate(4, seed(42), 'normal', { check: false });
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });

  it('games reach 20 renown in a sensible number of turns', () => {
    const turns: number[] = [];
    for (let g = 0; g < 20; g++) turns.push(simulate(3, seed(500 + g), 'normal', { check: false }).state.turn.number);
    const avg = turns.reduce((a, b) => a + b, 0) / turns.length;
    // Design target: ~5 rounds for 3 players = ~15 turns. Loose bounds.
    expect(avg).toBeGreaterThan(5);
    expect(avg).toBeLessThan(60);
  });
});

describe('setup', () => {
  it('deals heroes and draw-size resources, then opens the companion draft (five on offer, two to keep)', () => {
    const { state } = createGame({ players: seats(4), seed: seed(1), rules: { heroDraft: 1 } });
    checkInvariants(state);
    for (const p of state.players) {
      expect(p.companions).toHaveLength(0);
      expect(state.cards[p.hero]).toBeDefined();
    }
    // The first player has drawn up to draw size; everyone else was dealt 4.
    for (const p of state.players) expect(p.hand.length).toBeGreaterThanOrEqual(4);
    const d = state.pending;
    expect(d?.kind === 'choose' && d.purpose).toBe('companionDraft');
    expect(d?.kind === 'choose' && [d.options.length, d.min, d.max]).toEqual([5, 2, 2]);
  });

  it('rejects bad player counts and seat ids', () => {
    expect(() => createGame({ players: seats(1) })).toThrow();
    expect(() => createGame({ players: seats(7) })).toThrow();
    expect(() => createGame({ players: [{ id: 'p0', name: 'a' }, { id: 'p0', name: 'b' }] })).toThrow();
    expect(() => createGame({ players: [{ id: '../x', name: 'a' }, { id: 'p1', name: 'b' }] })).toThrow();
  });

  it('uses a fresh CSPRNG seed when none is given', () => {
    const a = createGame({ players: seats(3) }).state;
    const b = createGame({ players: seats(3) }).state;
    expect(a.rng).not.toEqual(b.rng);
  });
});

describe('bots only need their own view', () => {
  it('produces a legal command for every decision in a game', () => {
    let { state } = createGame({ players: seats(3), seed: seed(7) });
    for (let i = 0; i < 300 && !state.winner; i++) {
      const d = state.pending!;
      const cmd = botDecide(viewFor(state, d.player), 'hard');
      const res = applyCommand(state, d.player, cmd);
      expect(res.ok).toBe(true);
      if (res.ok) state = res.state;
    }
  });
});
