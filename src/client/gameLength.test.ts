import { describe, expect, it } from 'vitest';
import { createGame } from '../engine/setup';
import { seats, seed, simulate } from '../engine/testUtils';
import { DEFAULT_LENGTH, GAME_LENGTHS, lengthRules, lengthTip, parseLength, renownFor } from './ui/gameLength';

describe('game length', () => {
  it('has Short, Normal and Long, worth 10, 20 and 30 Renown, in that order', () => {
    expect(GAME_LENGTHS.map((l) => [l.label, l.renown])).toEqual([['Short', 10], ['Normal', 20], ['Long', 30]]);
  });

  it('is Normal unless chosen otherwise', () => {
    expect(DEFAULT_LENGTH).toBe('normal');
    expect(parseLength(undefined)).toBe('normal');
    expect(parseLength('epic')).toBe('normal');
    expect(parseLength('long')).toBe('long');
  });

  it('the tooltip says how much Renown it takes to win', () => {
    expect(lengthTip('short')).toBe('10 Renown to Win');
    expect(lengthTip('normal')).toBe('20 Renown to Win');
    expect(lengthTip('long')).toBe('30 Renown to Win');
  });

  it('becomes the renownToWin house rule, which the engine accepts', () => {
    for (const l of GAME_LENGTHS) {
      expect(lengthRules(l.id)).toEqual({ renownToWin: l.renown });
      const { state } = createGame({ players: seats(3), seed: seed(1), rules: lengthRules(l.id) });
      expect(state.rules.renownToWin).toBe(renownFor(l.id));
    }
  });

  it('bot games end when someone reaches the Renown for their length, and longer games take more turns', () => {
    const avg: Record<string, number> = {};
    for (const l of GAME_LENGTHS) {
      const turns: number[] = [];
      for (let g = 0; g < 6; g++) {
        const { state } = simulate(3, seed(7000 + g), 'normal', { rules: lengthRules(l.id), check: false });
        const winner = state.players.find((p) => p.id === state.winner)!;
        expect(winner.renown).toBeGreaterThanOrEqual(l.renown);
        turns.push(state.turn.number);
      }
      avg[l.id] = turns.reduce((a, b) => a + b, 0) / turns.length;
    }
    expect(avg['short']!).toBeLessThan(avg['normal']!);
    expect(avg['normal']!).toBeLessThan(avg['long']!);
  });
});
