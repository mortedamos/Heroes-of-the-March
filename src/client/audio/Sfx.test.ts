import { describe, expect, it } from 'vitest';
import { pitchFactor } from './Sfx';

describe('pitchFactor', () => {
  it('stays within ±10%', () => {
    expect(pitchFactor(() => 0)).toBeCloseTo(0.9);
    expect(pitchFactor(() => 0.5)).toBeCloseTo(1.0);
    expect(pitchFactor(() => 0.999999)).toBeLessThan(1.1);
    for (let i = 0; i < 1000; i++) { const f = pitchFactor(); expect(f).toBeGreaterThanOrEqual(0.9); expect(f).toBeLessThan(1.1); }
  });
});
