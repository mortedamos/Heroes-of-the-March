import { describe, expect, it } from 'vitest';
import { MOMENTS, momentIndex } from './ui/Moments';

describe('turn timeline', () => {
  it('maps every step of a turn to one of the six moments, in order', () => {
    const order = ['turnStart', 'winTurnStart', 'recruit', 'location', 'winAfterLocation', 'encounter', 'challenge', 'winBeforeBidding', 'bidding', 'winBeforeReveal', 'reveal', 'winEndOfBidding', 'resolve', 'turnEnd'];
    const idx = order.map(momentIndex);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(new Set(idx.filter((i) => i < MOMENTS.length)).size).toBe(MOMENTS.length);
    expect(momentIndex('resolve')).toBe(MOMENTS.length); // the turn is over: every dot is filled
  });

  it('shows no timeline while the party is being drafted', () => {
    expect(momentIndex('partyDraft')).toBe(-1);
  });

  it('names the same windows the engine offers abilities in', () => {
    expect(MOMENTS.flatMap((m) => m.windows)).toEqual(['turnStart', 'afterLocation', 'beforeBidding', 'bidding', 'beforeReveal', 'endOfBidding']);
  });
});
