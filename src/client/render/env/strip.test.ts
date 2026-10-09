import { describe, expect, it } from 'vitest';
import { isStrip, PANORAMA_ASPECT, STRIP_BOTTOM_ROW, STRIP_X, stripVisibleBand, stripWindow } from './strip';

describe('strip paintings', () => {
  it('takes a 2:1 picture for a panorama of the whole sky and any other shape for a strip', () => {
    expect(isStrip(PANORAMA_ASPECT)).toBe(false);
    expect(isStrip(3072 / 1536)).toBe(false);
    expect(isStrip(4096 / 2049)).toBe(false);
    for (const aspect of [16 / 9, 21 / 9, 4, 8, 3 / 2]) expect(isStrip(aspect), String(aspect)).toBe(true);
  });

  it('centres the strip on the way the camera looks, with its bottom edge on the horizon', () => {
    for (const aspect of [16 / 9, 21 / 9, 3, 4, 5, 8]) {
      const [x0, x1, bottom, top] = stripWindow(aspect);
      expect((x0 + x1) / 2).toBeCloseTo(0.25, 5);
      expect([x0, x1]).toEqual([...STRIP_X]);
      expect(bottom).toBeCloseTo(1 - STRIP_BOTTOM_ROW, 5);
      expect(top).toBeGreaterThan(bottom);
    }
  });

  it('is shorter on the dome the wider the picture, so it is never stretched', () => {
    const height = (a: number): number => { const w = stripWindow(a); return w[3] - w[2]; };
    expect(height(21 / 9)).toBeGreaterThan(height(3));
    expect(height(3)).toBeGreaterThan(height(4));
    expect(height(4)).toBeGreaterThan(height(4.6) - 1e-9);
  });

  it('covers the part of the sky the camera can show (rows 33% to 47%), to within half a degree, however wide the picture', () => {
    for (const aspect of [1, 16 / 9, 21 / 9, 3, 4, 5, 8, 20]) {
      const w = stripWindow(aspect);
      const topRow = 1 - w[3];
      expect(topRow).toBeLessThanOrEqual(0.335);
      expect(1 - w[2]).toBeCloseTo(STRIP_BOTTOM_ROW, 5);
    }
  });

  it('says how far up the picture the visible part lies', () => {
    for (const aspect of [21 / 9, 4, 8]) {
      const b = stripVisibleBand(aspect);
      expect(b.from).toBeGreaterThan(0);
      expect(b.to).toBeLessThanOrEqual(1);
      expect(b.to).toBeGreaterThan(b.from);
    }
    // A wider picture is shorter on the dome, so the visible part fills more of it.
    expect(stripVisibleBand(4).to - stripVisibleBand(4).from).toBeGreaterThan(stripVisibleBand(21 / 9).to - stripVisibleBand(21 / 9).from);
  });
});
