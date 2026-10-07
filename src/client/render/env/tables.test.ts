import { describe, expect, it } from 'vitest';
import { loft, ring, TABLE_CORNER, type Level, type Outline } from './tables';

const wide: Outline = { w: 19, d: 12.6, cz: 0.5, r: TABLE_CORNER };
const tall: Outline = { w: 7.4, d: 14.8, cz: -1, r: TABLE_CORNER };

describe('table outline', () => {
  it('has the same number of points at every inset, so walls can join two levels', () => {
    for (const o of [wide, tall]) {
      const n = ring(o, 0).length;
      for (const inset of [-1, 0.3, 2, 3.4, 20]) expect(ring(o, inset)).toHaveLength(n);
    }
  });

  it('is the table itself at inset 0, and shrinks and grows with the inset', () => {
    const extent = (inset: number) => {
      const pts = ring(wide, inset);
      const xs = pts.map((p) => p.x);
      const zs = pts.map((p) => p.z);
      return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) };
    };
    expect(extent(0).w).toBeCloseTo(19, 5);
    expect(extent(0).d).toBeCloseTo(12.6, 5);
    expect(extent(1).w).toBeCloseTo(17, 5);
    expect(extent(-0.5).d).toBeCloseTo(13.6, 5);
  });

  it('has unit normals that point away from the middle', () => {
    for (const p of ring(wide, 0.7)) {
      expect(Math.hypot(p.nx, p.nz)).toBeCloseTo(1, 5);
      expect(p.nx * p.x + p.nz * (p.z - wide.cz)).toBeGreaterThan(0);
    }
  });
});

describe('loft', () => {
  const profiles: Record<string, Level[]> = {
    'a plain wall': [{ inset: 0, y: -0.01 }, { inset: 0, y: -2 }],
    'a step out (facing up)': [{ inset: 0.7, y: -1 }, { inset: 0.25, y: -1 }],
    'a step in (facing down)': [{ inset: 0.2, y: -1 }, { inset: 0.7, y: -1 }],
    'a slope': [{ inset: 0.1, y: -0.7 }, { inset: 0.7, y: -1.1 }],
    'a collapsed corner': [{ inset: 0, y: 0 }, { inset: 3.3, y: -3.5 }],
  };

  for (const o of [wide, tall]) {
    for (const [name, levels] of Object.entries(profiles)) {
      it(`faces its triangles the way its normals point: ${name}, ${o.w}x${o.d}`, () => {
        const g = loft(o, levels, true);
        const pos = g.getAttribute('position');
        const nor = g.getAttribute('normal');
        const idx = g.getIndex()!;
        let facing = 0;
        for (let t = 0; t < idx.count; t += 3) {
          const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)] as [number, number, number];
          const e1 = [pos.getX(b) - pos.getX(a), pos.getY(b) - pos.getY(a), pos.getZ(b) - pos.getZ(a)] as const;
          const e2 = [pos.getX(c) - pos.getX(a), pos.getY(c) - pos.getY(a), pos.getZ(c) - pos.getZ(a)] as const;
          const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]] as const;
          const dot = f[0] * (nor.getX(a) + nor.getX(b) + nor.getX(c)) + f[1] * (nor.getY(a) + nor.getY(b) + nor.getY(c)) + f[2] * (nor.getZ(a) + nor.getZ(b) + nor.getZ(c));
          expect(dot).toBeGreaterThanOrEqual(-1e-9);
          if (dot > 1e-9) facing++;
        }
        expect(facing).toBeGreaterThan(idx.count / 3 / 2);
      });
    }
  }

  it('closes the bottom with a cap that faces down', () => {
    const g = loft(wide, [{ inset: 0, y: -0.01 }, { inset: 0, y: -2 }], true);
    const capped = g.getAttribute('normal').count;
    const open = loft(wide, [{ inset: 0, y: -0.01 }, { inset: 0, y: -2 }], false).getAttribute('normal').count;
    expect(capped).toBeGreaterThan(open);
    const nor = g.getAttribute('normal');
    expect(nor.getY(nor.count - 1)).toBe(-1);
  });

  it('measures its UVs in world units: the texture runs the whole way round the table', () => {
    const g = loft(wide, [{ inset: 0, y: 0 }, { inset: 0, y: -2 }]);
    const uv = g.getAttribute('uv');
    let max = 0;
    for (let i = 0; i < uv.count; i++) max = Math.max(max, uv.getX(i));
    // The whole way round: two long sides, two short sides, and four quarter-circle corners (each a short run of straight pieces).
    expect(max).toBeCloseTo(2 * (19 - 2 * TABLE_CORNER) + 2 * (12.6 - 2 * TABLE_CORNER) + 2 * Math.PI * TABLE_CORNER, 0);
  });
});
