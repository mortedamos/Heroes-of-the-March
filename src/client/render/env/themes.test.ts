import { describe, expect, it } from 'vitest';
import cards from '../../../data/cards.json';
import { THEMES, themeFor } from './themes';

describe('location themes', () => {
  it('gives every location a look of its own', () => {
    const plain = cards.locations.filter((l) => themeFor(l.id) === 'felt').map((l) => l.id);
    expect(plain).toEqual([]);
  });

  it('falls back to the plain felt for no location or an unknown one', () => {
    expect(themeFor(null)).toBe('felt');
    expect(themeFor('no-such-place')).toBe('felt');
  });

  it('has a complete definition for every theme', () => {
    for (const [id, t] of Object.entries(THEMES)) {
      expect(t.look.fogFar, id).toBeGreaterThan(t.look.fogNear);
      expect(t.top.tile, id).toBeGreaterThan(0);
      expect(t.look.accents).toHaveLength(2);
    }
  });
});
