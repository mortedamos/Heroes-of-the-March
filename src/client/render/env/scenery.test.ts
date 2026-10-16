import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { normalise } from './models';
import { addDrips, ThemeScene } from './props';
import { addTavernware } from './tavernware';
import { THEMES } from './themes';
import { treeStands } from './trees';

// The soft dot the lights and the fog are drawn with is painted on a canvas; there is none here, so give it one that takes the strokes.
beforeAll(() => {
  const g = { createRadialGradient: () => ({ addColorStop: () => undefined }), fillRect: () => undefined, fillStyle: '' };
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => g }) });
});
afterAll(() => { vi.unstubAllGlobals(); });

const scene = (seed: number): ThemeScene => {
  const ts = new ThemeScene({ key: new THREE.DirectionalLight(), aniso: 1 });
  ts.reseed(seed);
  ts.ground = -5;
  return ts;
};

describe('models', () => {
  it('stands a model on y = 0, one unit tall and centred over x and z, whatever its size and where it began', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 3));
    mesh.position.set(40, -12, 7);
    const wrapped = normalise(mesh);
    const box = new THREE.Box3().setFromObject(wrapped);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(1, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 5);
  });
});

describe('trees', () => {
  const spec = THEMES['the-storybook-glade'].trees!;
  const all = (ts: ThemeScene, coarse = false): { file: string; x: number; z: number; height: number }[] =>
    [...treeStands(ts, spec, coarse)].flatMap(([file, stands]) => stands.map((s) => ({ file, ...s })));

  it('stands the number asked for, only of the models asked for, at the heights asked for', () => {
    const trees = all(scene(1));
    expect(trees).toHaveLength(spec.count);
    for (const t of trees) {
      expect(spec.kinds.map((k) => k.file)).toContain(t.file);
      expect(t.height).toBeGreaterThanOrEqual(spec.height[0]);
      expect(t.height).toBeLessThanOrEqual(spec.height[1]);
    }
  });

  it('keeps them behind and beside the table, clear of it and of the camera in front, and apart from each other', () => {
    const trees = all(scene(2));
    for (const t of trees) {
      expect(t.z).toBeLessThanOrEqual(2);
      expect(Math.hypot(Math.max(Math.abs(t.x) - 13, 0), Math.max(Math.abs(t.z) - 9, 0))).toBeGreaterThanOrEqual(8);
    }
    for (let i = 0; i < trees.length; i++) for (let j = i + 1; j < trees.length; j++) expect(Math.hypot(trees[i]!.x - trees[j]!.x, trees[i]!.z - trees[j]!.z)).toBeGreaterThanOrEqual(5);
    // Mostly behind the table.
    expect(trees.filter((t) => t.z < -8).length).toBeGreaterThan(trees.length / 2);
  });

  it('puts them in the same places every time from the same seed, and fewer on a coarse screen', () => {
    expect(all(scene(3))).toEqual(all(scene(3)));
    expect(all(scene(3), true).length).toBeLessThan(all(scene(3)).length);
  });
});

describe('the tavern in the distance', () => {
  const spec = THEMES['the-goose-and-kettle'].tavernware!;
  const build = (seed: number, coarse = false): ThemeScene => {
    const ts = scene(seed);
    addTavernware(ts, spec, coarse);
    ts.layout(19, 12.6, 0);
    return ts;
  };
  const meshes = (ts: ThemeScene): THREE.InstancedMesh[] => (ts.group.children[0] as THREE.Group).children.filter((o): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh);
  const lights = (ts: ThemeScene): THREE.Sprite[] => (ts.group.children[0] as THREE.Group).children.filter((o): o is THREE.Sprite => (o as THREE.Sprite).isSprite);

  it('stands tables, with chairs, mugs and a lantern on each (the lantern glass and the frame as one each)', () => {
    const ts = build(4);
    const [tables, chairs, mugs, frames, glass] = meshes(ts) as [THREE.InstancedMesh, THREE.InstancedMesh, THREE.InstancedMesh, THREE.InstancedMesh, THREE.InstancedMesh];
    expect(tables.count).toBeGreaterThanOrEqual(5);
    expect(tables.count).toBeLessThanOrEqual(spec.tables);
    expect(chairs.count).toBeGreaterThan(tables.count);
    expect(mugs.count).toBeGreaterThanOrEqual(tables.count * 3);
    expect(frames.count).toBe(tables.count);
    expect(glass.count).toBe(tables.count);
    expect(lights(ts)).toHaveLength(tables.count);
  });

  it('keeps the tables well clear of the game table and the camera in front of it', () => {
    const ts = build(5);
    const tables = meshes(ts)[0]!;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < tables.count; i++) {
      tables.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(p.z).toBeLessThanOrEqual(2);
      expect(Math.abs(p.x) < 22 && p.z > -22).toBe(false);
      expect(p.y).toBeCloseTo(-5, 5);
    }
  });

  it('flickers the lanterns: the glow wavers from moment to moment, and goes with the place when it fades', () => {
    const ts = build(6);
    ts.setFade(1);
    const glows = lights(ts);
    const at = (t: number): number[] => { ts.tick(t, 0.016); return glows.map((g) => g.material.opacity); };
    const a = at(1);
    const b = at(1.13);
    expect(a.some((v, i) => Math.abs(v - b[i]!) > 0.01)).toBe(true);
    for (const v of [...a, ...b]) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(1); }
    ts.setFade(0);
    expect(at(2).every((v) => v === 0)).toBe(true);
  });

  it('is built the same way every time, and with fewer tables on a coarse screen', () => {
    const count = (ts: ThemeScene): number => meshes(ts)[0]!.count;
    expect(Array.from(meshes(build(7))[0]!.instanceMatrix.array)).toEqual(Array.from(meshes(build(7))[0]!.instanceMatrix.array));
    expect(count(build(7, true))).toBeLessThan(count(build(7)));
  });
});

describe('drips', () => {
  const spec = THEMES['the-umbral-deep'].fx.find((f) => f.kind === 'drips')!;

  it('fall now and then out of the dark above, and ring the floor where they land, never over the top of the table', () => {
    const ts = scene(8);
    ts.setFade(1);
    addDrips(ts, spec, false);
    const drops = ts.group.children.filter((o): o is THREE.Sprite => (o as THREE.Sprite).isSprite);
    const rings = ts.group.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh);
    expect(drops).toHaveLength(spec.n);
    expect(rings).toHaveLength(spec.n);
    let falling = 0;
    let ringing = 0;
    for (let t = 0; t < 60; t += 0.1) {
      ts.tick(t, 0.1);
      for (const d of drops) if (d.visible) { falling++; expect(d.position.y).toBeGreaterThan(ts.ground); expect(d.position.y).toBeLessThan(ts.ground + 15); }
      for (const r of rings) if (r.visible) {
        ringing++;
        expect(r.position.y).toBeCloseTo(ts.ground + 0.04, 5);
        expect(Math.abs(r.position.x) > 11.5 || Math.abs(r.position.z) > 8).toBe(true);
      }
    }
    // Each lands only now and then: over a minute some are falling and some ringing, but nothing near always.
    expect(falling).toBeGreaterThan(0);
    expect(ringing).toBeGreaterThan(falling);
    expect(falling).toBeLessThan(drops.length * 600 * 0.5);
  });

  it('is gone with the place', () => {
    const ts = scene(9);
    ts.setFade(0);
    addDrips(ts, spec, false);
    for (let t = 0; t < 12; t += 0.1) ts.tick(t, 0.1);
    for (const o of ts.group.children) {
      const m = (o as THREE.Sprite).material as THREE.Material | undefined;
      if (m) expect(m.opacity).toBe(0);
    }
  });
});
