import { describe, expect, it } from 'vitest';
import { partyLabel, placeSlotCount } from './ui/partySlots';

describe('the places shown when a drawn hero is placed', () => {
  it('shows the party size while there is room', () => {
    expect(placeSlotCount(3, 2, false)).toBe(3);
    expect(placeSlotCount(3, 0, false)).toBe(3);
  });

  it('a full party that must replace shows no extra place', () => {
    expect(placeSlotCount(3, 3, true)).toBe(3);
  });

  it('a full party and a hero that rides free (Gimlet beside Goldie) shows an extra place for them', () => {
    expect(placeSlotCount(3, 3, false)).toBe(4);
  });

  it('companions already riding free are counted, and another that rides free gets its own place', () => {
    expect(placeSlotCount(3, 4, true)).toBe(4); // four held, one rides free; the new hero would have to replace someone
    expect(placeSlotCount(3, 4, false)).toBe(5);
  });

  it('the label shows heroes over places, and a plain note when companions ride free', () => {
    expect(partyLabel(2, 3)).toBe('Your party (2/3)');
    expect(partyLabel(3, 3)).toBe('Your party (3/3)');
    expect(partyLabel(4, 3)).toMatch(/4 heroes; 3 places/);
  });
});
