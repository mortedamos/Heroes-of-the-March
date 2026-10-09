// The 3D scenery of one theme: the body of the table (see tables.ts), weather,
// shafts of light, mist and a skyline. A ThemeScene is built once, positioned
// from the table's size, and faded in and out as a whole.

import * as THREE from 'three';
import { beamTexture, dotTexture, mixHex, paintSkyline, ringTexture, streakTexture } from './surfaces';
import { buildTable } from './tables';
import type { FxKind, FxSpec, Theme } from './themes';

export type Side = 'back' | 'left' | 'right' | 'front';

interface Anchor { obj: THREE.Object3D; side: Side; s: number; out: number; base: THREE.Vector3 }

export interface SceneCtx { key: THREE.Light; aniso: number }

const UP = new THREE.Vector3(0, 1, 0);
const FLOOR_Y = -0.9;

export class ThemeScene {
  readonly group = new THREE.Group();
  fade = 0;
  private readonly mats: { m: THREE.Material; base: number }[] = [];
  private readonly ticks: ((t: number, dt: number) => void)[] = [];
  private readonly anchors: Anchor[] = [];
  private readonly layouts: ((w: number, d: number, cz: number) => void)[] = [];
  private readonly matCache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();
  private seed = 1;
  /** Height of the ground this scene stands on (the table's top is at 0). */
  ground = FLOOR_Y;

  reseed(n: number): void { this.seed = (Math.imul(n, 2654435761) + 1) >>> 0; }

  constructor(readonly ctx: SceneCtx) {
    this.group.visible = false;
  }

  rnd = (): number => {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };
  between = (a: number, b: number): number => a + (b - a) * this.rnd();

  register<T extends THREE.Material>(m: T, base = 1): T {
    m.transparent = true;
    this.mats.push({ m, base });
    return m;
  }

  mat(color: string, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    const key = color + JSON.stringify(o);
    let m = this.matCache.get(key);
    if (!m) this.matCache.set(key, (m = this.register(new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...o }))));
    return m;
  }

  geo<G extends THREE.BufferGeometry>(key: string, make: () => G): G {
    let g = this.geoCache.get(key);
    if (!g) this.geoCache.set(key, (g = make()));
    return g as G;
  }

  /** Stand `obj` beside the table: `s` runs 0..1 along `side`, `out` is the distance beyond the rim. */
  place<T extends THREE.Object3D>(obj: T, side: Side, s: number, out: number, y = 0, shadow = true): T {
    obj.position.y = y;
    this.group.add(obj);
    this.anchors.push({ obj, side, s, out, base: new THREE.Vector3() });
    if (shadow) obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    return obj;
  }

  anchorOf(obj: THREE.Object3D): Anchor | undefined { return this.anchors.find((a) => a.obj === obj); }

  onLayout(fn: (w: number, d: number, cz: number) => void): void { this.layouts.push(fn); }
  onTick(fn: (t: number, dt: number) => void): void { this.ticks.push(fn); }

  layout(w: number, d: number, cz: number): void {
    for (const a of this.anchors) {
      const along = a.s - 0.5;
      switch (a.side) {
        case 'back': a.base.set(along * w, 0, cz - d / 2 - a.out); break;
        case 'front': a.base.set(along * w, 0, cz + d / 2 + a.out); break;
        case 'left': a.base.set(-w / 2 - a.out, 0, cz + along * d); break;
        case 'right': a.base.set(w / 2 + a.out, 0, cz + along * d); break;
      }
      a.obj.position.x = a.base.x;
      a.obj.position.z = a.base.z;
    }
    for (const fn of this.layouts) fn(w, d, cz);
  }

  setFade(f: number): void {
    this.fade = f;
    this.group.visible = f > 0.002;
    for (const { m, base } of this.mats) m.opacity = base * f;
  }

  tick(t: number, dt: number): void { for (const fn of this.ticks) fn(t, dt); }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(o as THREE.Points).isPoints) return;
      mesh.geometry?.dispose();
    });
    for (const { m } of this.mats) {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      (m as THREE.MeshBasicMaterial).alphaMap?.dispose();
      m.dispose();
    }
  }
}

// -- Weather ------------------------------------------------------------------

/** The colours a kind of particle takes when its spec names no tint range of its own. */
const DEFAULT_TINT: Partial<Record<FxKind, [string, string]>> = {
  leaves: ['#6f9a3a', '#d9a63a'],
  petals: ['#f6b9cf', '#ffffff'],
  ash: ['#5f5a56', '#a39d95'],
  butterflies: ['#ffe27a', '#f4f6ff'],
};

/** How high each kind of particle reaches (the default is 9). */
const POINT_TOP: Partial<Record<FxKind, number>> = { wisps: 5, sparks: 5, motes: 7, lanterns: 12 };

function addParticles(ts: ThemeScene, spec: FxSpec, coarse: boolean): void {
  const n = coarse ? Math.ceil(spec.n * 0.6) : spec.n;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const tints = new Float32Array(n * 3);
  const ph = new Float32Array(n);
  const spd = new Float32Array(n);
  const base = new THREE.Color(spec.color);
  const range = spec.tint ?? DEFAULT_TINT[spec.kind];
  const top = POINT_TOP[spec.kind] ?? 9;
  const gy = ts.ground;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = ts.between(-13, 13);
    pos[i * 3 + 1] = ts.between(gy, top);
    pos[i * 3 + 2] = ts.between(-10, 10);
    ph[i] = ts.rnd() * 100;
    spd[i] = 0.5 + ts.rnd();
    const tint = range ? new THREE.Color(mixHex(range[0], range[1], ts.rnd())) : base;
    tints[i * 3] = col[i * 3] = tint.r; tints[i * 3 + 1] = col[i * 3 + 1] = tint.g; tints[i * 3 + 2] = col[i * 3 + 2] = tint.b;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = ts.register(new THREE.PointsMaterial({
    size: spec.size, map: dotTexture(), vertexColors: true, depthWrite: false, fog: false,
    blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  const pts = new THREE.Points(geom, mat);
  pts.frustumCulled = false;
  ts.group.add(pts);

  const colAttr = geom.getAttribute('color') as THREE.BufferAttribute;
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
  // Glowing things flicker, and a butterfly's wings open and close, so their colour changes every frame.
  const animated = spec.additive || spec.kind === 'butterflies';
  const fromTop = (): [number, number] => [ts.between(-13, 13), ts.between(-10, 10)];
  ts.onTick((t, dt) => {
    for (let i = 0; i < n; i++) {
      let x = pos[i * 3]!;
      let y = pos[i * 3 + 1]!;
      let z = pos[i * 3 + 2]!;
      const p = ph[i]!;
      const s = spd[i]!;
      let b = 1;
      switch (spec.kind) {
        case 'embers': case 'sparks': {
          const fast = spec.kind === 'sparks' ? 2.4 : 1;
          y += s * 0.9 * fast * dt;
          x += (Math.sin(t * 0.9 + p) * 0.5 + 0.25) * dt;
          if (y > top) { y = gy + ts.between(-0.5, 0.5); [x, z] = fromTop(); }
          b = 0.5 + 0.5 * Math.sin(t * 7 + p) * Math.sin(t * 3.1 + p * 2);
          break;
        }
        case 'snow':
          y -= s * 1.1 * dt;
          x += (Math.sin(t * 0.7 + p) * 0.5 + 0.35) * dt;
          z += Math.cos(t * 0.5 + p) * 0.25 * dt;
          if (y < gy) { y = top; [x, z] = fromTop(); }
          break;
        case 'leaves':
          y -= s * 0.4 * dt;
          x += Math.sin(t * 0.9 + p) * 0.9 * dt;
          z += Math.cos(t * 0.6 + p) * 0.5 * dt;
          if (y < gy) { y = top; [x, z] = fromTop(); }
          break;
        case 'petals':
          // Lighter than leaves: they hang in the air and sway.
          y -= s * 0.22 * dt;
          x += Math.sin(t * 0.8 + p) * 0.8 * dt;
          z += Math.cos(t * 0.55 + p) * 0.5 * dt;
          if (y < gy) { y = top; [x, z] = fromTop(); }
          break;
        case 'ash':
          y -= s * 0.3 * dt;
          x += (Math.sin(t * 0.6 + p) * 0.5 + 0.2) * dt;
          z += Math.cos(t * 0.45 + p) * 0.3 * dt;
          if (y < gy) { y = top; [x, z] = fromTop(); }
          break;
        case 'lanterns':
          y += s * 0.2 * dt;
          x += Math.sin(t * 0.3 + p) * 0.5 * dt;
          z += Math.cos(t * 0.25 + p) * 0.35 * dt;
          if (y > top) { y = gy + ts.between(-0.5, 0.5); [x, z] = fromTop(); }
          // They glow softly, and come up out of the dark over the water.
          b = (0.75 + 0.25 * Math.sin(t * 2.3 + p * 3)) * Math.min(1, Math.max(0, (y - gy) / 2));
          break;
        case 'fireflies':
          x += Math.sin(t * 0.5 + p) * 0.6 * dt;
          y += Math.sin(t * 0.37 + p * 1.3) * 0.25 * dt;
          z += Math.cos(t * 0.45 + p) * 0.6 * dt;
          y = Math.min(gy + 4, Math.max(gy + 0.4, y));
          b = Math.max(0, Math.sin(t * 1.3 * s + p * 3)) ** 3;
          break;
        case 'butterflies':
          x += (Math.sin(t * 0.9 + p) * 1.1 + Math.sin(t * 2.3 + p * 2) * 0.5) * dt;
          y += Math.sin(t * 1.3 + p * 1.7) * 0.5 * dt;
          z += Math.cos(t * 0.8 + p) * 1.1 * dt;
          // Over the grass, never over the cards.
          y = Math.min(Math.min(gy + 4.2, -0.8), Math.max(gy + 0.6, y));
          if (x > 13) x = -13; else if (x < -13) x = 13;
          if (z > 10) z = -10; else if (z < -10) z = 10;
          b = 0.4 + 0.6 * Math.abs(Math.sin(t * 9 + p * 4));
          break;
        case 'motes':
          x += (0.12 + Math.sin(t * 0.3 + p) * 0.1) * dt;
          y += Math.sin(t * 0.25 + p) * 0.12 * dt;
          if (x > 13) x = -13;
          b = 0.35 + 0.65 * Math.sin(t * 0.8 + p) ** 2;
          break;
        case 'wisps':
          y += 0.25 * s * dt;
          x += Math.sin(t * 0.4 + p) * 0.4 * dt;
          if (y > top) { y = gy; [x, z] = fromTop(); }
          b = Math.sin((Math.PI * (y - gy)) / (top - gy));
          break;
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      if (animated) colAttr.setXYZ(i, tints[i * 3]! * b, tints[i * 3 + 1]! * b, tints[i * 3 + 2]! * b);
    }
    posAttr.needsUpdate = true;
    if (animated) colAttr.needsUpdate = true;
  });
}

/** Rings spreading on the ground, one after another: drips in a cave, fish rising, a breath on still water. */
function addRipples(ts: ThemeScene, spec: FxSpec, coarse: boolean): void {
  const n = coarse ? Math.ceil(spec.n * 0.6) : spec.n;
  const geo = ts.geo('ripple', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const tex = ringTexture();
  const y = ts.ground + 0.04;
  const rings = Array.from({ length: n }, () => {
    const mat = ts.register(new THREE.MeshBasicMaterial({
      map: tex, color: spec.color, transparent: true, depthWrite: false,
      blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    ts.group.add(mesh);
    return { mesh, mat, phase: ts.rnd() * 30, life: ts.between(3.2, 5.6), reach: ts.between(1.2, 3.2), u: 0 };
  });
  // Anywhere on the water the camera can see, in front of the table as well as behind it. (Not the scene's seeded generator: it is too even for scattering a few rings.)
  const place = (m: THREE.Mesh): void => { m.position.set(-16 + Math.random() * 32, y, -12 + Math.random() * 26); };
  for (const r of rings) place(r.mesh);
  ts.onTick((t) => {
    for (const r of rings) {
      const u = ((t + r.phase) % r.life) / r.life;
      if (u < r.u) place(r.mesh);
      r.u = u;
      const size = Math.max(0.05, u * r.reach * 2);
      r.mesh.scale.set(size, 1, size);
      r.mat.opacity = ts.fade * (1 - u) ** 1.6 * Math.min(1, u * 10) * 0.7;
    }
  });
}

/** Now and then a streak across the sky behind the table. */
function addShootingStars(ts: ThemeScene, spec: FxSpec): void {
  const mat = ts.register(new THREE.MeshBasicMaterial({
    map: streakTexture(), color: spec.color, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }), 0);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.visible = false;
  ts.group.add(mesh);
  let next = ts.between(1.5, 4);
  let t0 = -1;
  const from = new THREE.Vector2();
  const way = new THREE.Vector2();
  const DUR = 1.1;
  const SPEED = 46;
  ts.onTick((t) => {
    if (t0 < 0) {
      if (t < next) return;
      t0 = t;
      const dir = ts.rnd() < 0.5 ? 1 : -1;
      from.set(ts.between(-40, 10) * (dir > 0 ? 1 : -1) - dir * 4, ts.between(12, 32));
      way.set(dir, -0.38).normalize();
      mesh.rotation.z = Math.atan2(way.y, way.x);
      mesh.scale.set(ts.between(9, 14), 0.9, 1);
    }
    const k = (t - t0) / DUR;
    if (k >= 1) { t0 = -1; next = t + ts.between(3, 8); mesh.visible = false; return; }
    mesh.visible = true;
    mesh.position.set(from.x + way.x * SPEED * (t - t0), from.y + way.y * SPEED * (t - t0), -62);
    mat.opacity = ts.fade * Math.sin(Math.PI * k) ** 0.7;
  });
}

/** One loose sheet of paper that stirs on the floor by itself, lifts, turns over and settles. */
function addPage(ts: ThemeScene, spec: FxSpec): void {
  const mat = ts.register(new THREE.MeshStandardMaterial({ color: spec.color, emissive: spec.color, emissiveIntensity: 0.4, roughness: 0.9, side: THREE.DoubleSide }), 0);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.84), mat);
  mesh.visible = false;
  ts.group.add(mesh);
  const floor = ts.ground + 0.05;
  let next = ts.between(2, 6);
  let t0 = -1;
  let x0 = 0;
  let z0 = 0;
  const DUR = 5.5;
  ts.onTick((t) => {
    if (t0 < 0) {
      if (t < next) return;
      t0 = t;
      x0 = ts.between(-9, 9);
      z0 = ts.between(7.5, 13);
    }
    const k = (t - t0) / DUR;
    if (k >= 1) { t0 = -1; next = t + ts.between(8, 16); mesh.visible = false; return; }
    mesh.visible = true;
    mesh.position.set(x0 + 2.4 * k, floor + 2.6 * Math.sin(Math.PI * k) ** 1.5, z0 + 0.9 * Math.sin(k * 5));
    mesh.rotation.set(-Math.PI / 2 + 0.9 * Math.sin(k * 9), 5 * k, 0.5 * Math.sin(k * 7));
    mat.opacity = ts.fade * Math.min(1, k * 8) * Math.min(1, (1 - k) * 8);
  });
}

// -- Light, mist, flags -------------------------------------------------------

function addBeams(ts: ThemeScene, color: string, n: number, strength: number): void {
  const tint = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    const w = ts.between(1.4, 2.8);
    const mat = ts.register(new THREE.MeshBasicMaterial({
      map: beamTexture(), color: tint, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }), strength);
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(ts.geo(`beam${w.toFixed(2)}`, () => new THREE.PlaneGeometry(w, 20).translate(0, 10, 0)), mat);
      m.rotation.y = (k * Math.PI) / 2;
      g.add(m);
    }
    const side: Side = i % 3 === 0 ? 'left' : i % 3 === 1 ? 'back' : 'right';
    ts.place(g, side, ts.between(0.15, 0.85), ts.between(-1, 3), 0, false);
    const ph = ts.rnd() * 20;
    const lum = ts.between(0.7, 1);
    ts.onTick((t) => {
      g.quaternion.setFromUnitVectors(UP, ts.ctx.key.position.clone().normalize());
      mat.color.copy(tint).multiplyScalar(lum * (0.75 + 0.25 * Math.sin(t * 0.4 + ph)));
    });
  }
}

function addMist(ts: ThemeScene, color: string, n: number, strength: number): void {
  for (let i = 0; i < n; i++) {
    const mat = ts.register(new THREE.SpriteMaterial({ map: dotTexture(), color, depthWrite: false, fog: false }), strength);
    const sp = new THREE.Sprite(mat);
    sp.scale.set(ts.between(8, 13), ts.between(2.6, 4), 1);
    const side: Side = (['back', 'left', 'right', 'back'] as const)[i % 4]!;
    ts.place(sp, side, ts.between(0.05, 0.95), ts.between(-2.5, 3.5), ts.ground + ts.between(0.5, 1.4), false);
    const a = ts.anchorOf(sp)!;
    const ph = ts.rnd() * 20;
    const sp0 = ts.between(0.05, 0.12);
    const amp = ts.between(1, 2.4);
    ts.onTick((t) => { sp.position.x = a.base.x + Math.sin(t * sp0 + ph) * amp; });
  }
}


// -- A whole theme --------------------------------------------------------------

export function buildThemeScene(theme: Theme, ctx: SceneCtx, coarse: boolean, seed: number, skipSkyline = false): ThemeScene {
  const ts = new ThemeScene(ctx);
  ts.reseed(seed);
  ts.ground = -theme.table.height;
  buildTable(ts, theme.table, theme.top, ctx.aniso);
  if (theme.beams.n) addBeams(ts, theme.beams.color, coarse ? Math.ceil(theme.beams.n / 2) : theme.beams.n, theme.beams.strength);
  if (theme.mist) addMist(ts, theme.mist.color, coarse ? Math.ceil(theme.mist.n / 2) : theme.mist.n, theme.mist.strength);
  for (const fx of theme.fx) {
    if (fx.kind === 'ripples') addRipples(ts, fx, coarse);
    else if (fx.kind === 'shootingstar') addShootingStars(ts, fx);
    else if (fx.kind === 'page') addPage(ts, fx);
    else addParticles(ts, fx, coarse);
  }
  if (theme.skyline && !skipSkyline) {
    const rings: [string, number, number, number][] = [[theme.skyline.far, 78, 40, 1], [theme.skyline.near, 52, 30, 2]];
    for (const [color, r, h, k] of rings) {
      const tex = new THREE.CanvasTexture(paintSkyline(theme.skyline.kind, color, k + seed));
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = ts.register(new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 64, 1, true), m);
      ring.position.y = ts.ground + h / 2 - 1;
      ring.renderOrder = -1;
      ts.group.add(ring);
    }
  }
  return ts;
}
