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
      expect(t.table.height, id).toBeGreaterThan(0);
    }
  });

  it('puts the table on every place that is not the plain felt', () => {
    const kinds = Object.fromEntries(Object.entries(THEMES).map(([id, t]) => [id, t.table.kind]));
    expect(kinds).toEqual({
      felt: 'plain', tavern: 'tavern', harbor: 'ship', snow: 'altar', crypt: 'vault', forge: 'anvil',
      forest: 'altar', fortress: 'hall', archive: 'study', plains: 'altar', sky: 'skyship',
    });
  });

  it('dresses altars with what grows in their place', () => {
    expect(THEMES.snow.table.cover).toBe('snow');
    expect(THEMES.forest.table.cover).toBe('moss');
    expect(THEMES.plains.table.cover).toBe('moss');
  });

  it('moves the ground and slides the sky only where there is water or cloud to pass by', () => {
    expect(THEMES.harbor.floorMotion).toBe('waves');
    expect(THEMES.sky.floorMotion).toBe('clouds');
    expect(Object.entries(THEMES).filter(([, t]) => t.floorMotion).map(([id]) => id).sort()).toEqual(['harbor', 'sky']);
    expect(Object.entries(THEMES).filter(([, t]) => t.skyScroll).map(([id]) => id).sort()).toEqual(['harbor', 'sky']);
  });
});
