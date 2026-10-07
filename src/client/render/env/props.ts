// The 3D scenery of one theme: the body of the table (see tables.ts), weather,
// shafts of light, mist and a skyline. A ThemeScene is built once, positioned
// from the table's size, and faded in and out as a whole.

import * as THREE from 'three';
import { beamTexture, dotTexture, mixHex, paintSkyline } from './surfaces';
import { buildTable } from './tables';
import type { FxSpec, Theme } from './themes';

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

function addParticles(ts: ThemeScene, spec: FxSpec, coarse: boolean): void {
  const n = coarse ? Math.ceil(spec.n * 0.6) : spec.n;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const ph = new Float32Array(n);
  const spd = new Float32Array(n);
  const base = new THREE.Color(spec.color);
  const top = spec.kind === 'wisps' ? 5 : spec.kind === 'sparks' ? 5 : spec.kind === 'motes' ? 7 : 9;
  const gy = ts.ground;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = ts.between(-13, 13);
    pos[i * 3 + 1] = ts.between(gy, top);
    pos[i * 3 + 2] = ts.between(-10, 10);
    ph[i] = ts.rnd() * 100;
    spd[i] = 0.5 + ts.rnd();
    const tint = spec.kind === 'leaves' ? new THREE.Color(mixHex('#6f9a3a', '#d9a63a', ts.rnd())) : base;
    col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b;
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
          if (y > top) { y = gy + ts.between(-0.5, 0.5); x = ts.between(-13, 13); z = ts.between(-10, 10); }
          b = 0.5 + 0.5 * Math.sin(t * 7 + p) * Math.sin(t * 3.1 + p * 2);
          break;
        }
        case 'snow':
          y -= s * 1.1 * dt;
          x += (Math.sin(t * 0.7 + p) * 0.5 + 0.35) * dt;
          z += Math.cos(t * 0.5 + p) * 0.25 * dt;
          if (y < gy) { y = top; x = ts.between(-13, 13); z = ts.between(-10, 10); }
          break;
        case 'leaves':
          y -= s * 0.4 * dt;
          x += Math.sin(t * 0.9 + p) * 0.9 * dt;
          z += Math.cos(t * 0.6 + p) * 0.5 * dt;
          if (y < gy) { y = top; x = ts.between(-13, 13); z = ts.between(-10, 10); }
          break;
        case 'fireflies':
          x += Math.sin(t * 0.5 + p) * 0.6 * dt;
          y += Math.sin(t * 0.37 + p * 1.3) * 0.25 * dt;
          z += Math.cos(t * 0.45 + p) * 0.6 * dt;
          y = Math.min(gy + 4, Math.max(gy + 0.4, y));
          b = Math.max(0, Math.sin(t * 1.3 * s + p * 3)) ** 3;
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
          if (y > top) { y = gy; x = ts.between(-13, 13); z = ts.between(-10, 10); }
          b = Math.sin((Math.PI * (y - gy)) / (top - gy));
          break;
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      if (spec.additive) {
        const c = spec.kind === 'leaves' ? 1 : b;
        colAttr.setXYZ(i, base.r * c, base.g * c, base.b * c);
      }
    }
    posAttr.needsUpdate = true;
    if (spec.additive) colAttr.needsUpdate = true;
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
  for (const fx of theme.fx) addParticles(ts, fx, coarse);
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
