import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addFogBanks } from './fog';
import { addGrass } from './grass';
import { HILL_RISE, MARSH_SPAN, marshMap, terrainY, WATER_Y } from './marsh';
import { addParticles, ThemeScene } from './props';
import { THEMES } from './themes';

const spec = THEMES.gorewatch.grass!;
const fogSpec = THEMES.gorewatch.fog!;

// The soft dot the fog and the fireflies are drawn with is painted on a canvas; there is none here, so give it one that takes the strokes.
beforeAll(() => {
  const g = { createRadialGradient: () => ({ addColorStop: () => undefined }), fillRect: () => undefined, fillStyle: '' };
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => g }) });
});
afterAll(() => { vi.unstubAllGlobals(); });

const plant = (seed: number, coarse = false): { ts: ThemeScene; mesh: THREE.Mesh } => {
  const ts = new ThemeScene({ key: new THREE.DirectionalLight(), aniso: 1 });
  ts.reseed(seed);
  ts.ground = -5;
  addGrass(ts, spec, coarse);
  addFogBanks(ts, fogSpec, coarse);
  return { ts, mesh: ts.group.children[0] as THREE.Mesh };
};

describe('the hammock map', () => {
  it('has the table standing on a hammock in the middle and open water out at the edges', () => {
    const map = marshMap();
    expect(map.at(0, 0)).toBeGreaterThan(0.95);
    expect(map.at(8, 5)).toBeGreaterThan(0.95);
    for (const e of [-1, 1]) {
      expect(map.at(e * (MARSH_SPAN / 2 - 1), 0)).toBe(0);
      expect(map.at(0, e * (MARSH_SPAN / 2 - 1))).toBe(0);
      expect(map.at(e * MARSH_SPAN, e * MARSH_SPAN)).toBe(0);
    }
  });

  it('is dotted with islands: land and water both, with the land a good third or less of the ground', () => {
    const map = marshMap();
    let land = 0;
    let n = 0;
    for (let x = -50; x <= 50; x += 1) for (let z = -50; z <= 50; z += 1) { n++; if (map.at(x, z) > 0.5) land++; }
    expect(land / n).toBeGreaterThan(0.12);
    expect(land / n).toBeLessThan(0.45);
  });

  it('is one map, the same every time, held in a texture the ground can read', () => {
    expect(marshMap()).toBe(marshMap());
    const tex = marshMap().texture;
    expect(tex.image.width).toBe(tex.image.height);
    expect(tex.magFilter).toBe(THREE.LinearFilter);
  });

  it('puts the ground at the waterline over open water and lifts it, smoothly, over land', () => {
    expect(terrainY(0)).toBeCloseTo(WATER_Y, 6);
    expect(terrainY(1)).toBeCloseTo(WATER_Y + HILL_RISE, 6);
    let last = terrainY(0);
    for (let h = 0.05; h <= 1.0001; h += 0.05) { expect(terrainY(h)).toBeGreaterThanOrEqual(last); last = terrainY(h); }
  });
});

describe('the marsh grass', () => {
  it('is one mesh of finite blades, none of them absurdly tall', () => {
    const { ts, mesh } = plant(3);
    expect(ts.group.children.filter((o) => (o as THREE.Mesh).isMesh)).toHaveLength(1);
    const pos = mesh.geometry.getAttribute('position');
    expect(pos.count).toBeGreaterThan(10000);
    let top = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
      top = Math.max(top, pos.getY(i));
    }
    expect(top - ts.ground).toBeLessThan(12);
    expect(mesh.geometry.getAttribute('aSway').count).toBe(pos.count);
  });

  it('stands on the ground: no stalk starts below the water', () => {
    const { ts, mesh } = plant(5);
    const pos = mesh.geometry.getAttribute('position');
    const sway = mesh.geometry.getAttribute('aSway');
    for (let i = 0; i < pos.count; i++) if (sway.getX(i) === 0) expect(pos.getY(i)).toBeGreaterThanOrEqual(ts.ground + WATER_Y - 0.1);
  });

  it('leaves the table and the camera side clear: the feet of the stalks stay off the table and out of the front', () => {
    const { mesh } = plant(9);
    const pos = mesh.geometry.getAttribute('position');
    const sway = mesh.geometry.getAttribute('aSway');
    for (let i = 0; i < pos.count; i++) {
      if (sway.getX(i) !== 0) continue; // only the feet; the tips lean
      const x = pos.getX(i);
      const z = pos.getZ(i);
      expect(z).toBeLessThan(6.6);
      expect(Math.hypot(Math.max(Math.abs(x) - 13, 0), Math.max(Math.abs(z) - 9, 0))).toBeGreaterThan(4.4);
    }
  });

  it('is planted the same way from the same seed, and thinner for a coarse screen', () => {
    const a = plant(11).mesh.geometry.getAttribute('position');
    const b = plant(11).mesh.geometry.getAttribute('position');
    expect(Array.from(a.array)).toEqual(Array.from(b.array));
    expect(plant(11, true).mesh.geometry.getAttribute('position').count).toBeLessThan(a.count * 0.8);
  });

  it('fades with the rest of the place', () => {
    const { ts, mesh } = plant(2);
    ts.setFade(0.5);
    expect((mesh.material as THREE.Material).opacity).toBeCloseTo(0.5, 6);
    ts.setFade(0);
    expect(ts.group.visible).toBe(false);
  });
});

const sprites = (ts: ThemeScene): THREE.Sprite[] => ts.group.children.filter((o): o is THREE.Sprite => (o as THREE.Sprite).isSprite);

describe('the drifting fog', () => {
  it('is a few soft puffs to each patch, spread behind and beside the table and never in front of it', () => {
    const { ts } = plant(4);
    ts.layout(19, 12.6, 0);
    ts.tick(0, 0.016);
    const puffs = sprites(ts);
    expect(puffs).toHaveLength(fogSpec.patches * 3);
    for (const p of puffs) {
      expect(p.position.z).toBeLessThan(0);
      // Low, at the height of the grass.
      expect(p.position.y).toBeGreaterThan(ts.ground);
      expect(p.position.y).toBeLessThan(ts.ground + 4);
    }
  });

  it('drifts along, comes round again at the far end, and fades with the place', () => {
    const { ts } = plant(6);
    ts.layout(19, 12.6, 0);
    ts.setFade(1);
    ts.tick(0, 0.016);
    const before = sprites(ts).map((p) => p.position.x);
    ts.tick(20, 0.016);
    const after = sprites(ts).map((p) => p.position.x);
    expect(after.some((x, i) => Math.abs(x - before[i]!) > 5)).toBe(true);
    for (const x of [...before, ...after]) expect(Math.abs(x)).toBeLessThanOrEqual(75);
    // Thicker in the middle of its run than at the ends, where it comes and goes.
    for (const p of sprites(ts)) expect(p.material.opacity).toBeLessThanOrEqual(fogSpec.strength);
    ts.setFade(0);
    ts.tick(21, 0.016);
    for (const p of sprites(ts)) expect(p.material.opacity).toBe(0);
  });
});

describe('the fireflies over the marsh', () => {
  const fireflies = THEMES.gorewatch.fx.find((f) => f.kind === 'fireflies')!;

  it('are among the grass of the place, and in the low sky over it, not round the table', () => {
    const { ts } = plant(8);
    expect(ts.spots.length).toBeGreaterThan(500);
    addParticles(ts, fireflies, false);
    const pts = ts.group.children.find((o) => (o as THREE.Points).isPoints) as THREE.Points;
    const pos = pts.geometry.getAttribute('position');
    expect(pos.count).toBe(fireflies.n);
    let low = 0;
    let high = 0;
    for (let i = 0; i < pos.count; i++) {
      // Not inside the box of weather round the table.
      expect(Math.abs(pos.getX(i)) < 13 && Math.abs(pos.getZ(i)) < 9).toBe(false);
      expect(pos.getY(i)).toBeLessThan(ts.ground + 10);
      if (pos.getY(i) < ts.ground + 4) low++; else high++;
    }
    expect(low).toBeGreaterThan(pos.count / 2);
    expect(high).toBeGreaterThan(0);
  });

  it('stay round the table, as before, in a place with no marsh', () => {
    const ts = new ThemeScene({ key: new THREE.DirectionalLight(), aniso: 1 });
    ts.reseed(3);
    ts.ground = -5;
    addParticles(ts, fireflies, false);
    const pts = ts.group.children.find((o) => (o as THREE.Points).isPoints) as THREE.Points;
    const pos = pts.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(Math.abs(pos.getX(i))).toBeLessThanOrEqual(13);
      expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(10);
    }
  });
});
