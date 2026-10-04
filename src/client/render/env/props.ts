// The 3D scenery of one theme: props standing around the table, weather,
// shafts of light, mist, fluttering flags and a skyline. A ThemeScene is built
// once, positioned from the table's size, and faded in and out as a whole.

import * as THREE from 'three';
import { beamTexture, bookTexture, dotTexture, flameTexture, mixHex, paintSkyline } from './surfaces';
import type { FxSpec, PropSet, Theme } from './themes';

export type Side = 'back' | 'left' | 'right' | 'front';

interface Anchor { obj: THREE.Object3D; side: Side; s: number; out: number; base: THREE.Vector3 }

export interface SceneCtx { key: THREE.Light }

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
  for (let i = 0; i < n; i++) {
    pos[i * 3] = ts.between(-13, 13);
    pos[i * 3 + 1] = ts.between(0, top);
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
          if (y > top) { y = ts.between(-0.5, 0.5); x = ts.between(-13, 13); z = ts.between(-10, 10); }
          b = 0.5 + 0.5 * Math.sin(t * 7 + p) * Math.sin(t * 3.1 + p * 2);
          break;
        }
        case 'snow':
          y -= s * 1.1 * dt;
          x += (Math.sin(t * 0.7 + p) * 0.5 + 0.35) * dt;
          z += Math.cos(t * 0.5 + p) * 0.25 * dt;
          if (y < 0) { y = top; x = ts.between(-13, 13); z = ts.between(-10, 10); }
          break;
        case 'leaves':
          y -= s * 0.4 * dt;
          x += Math.sin(t * 0.9 + p) * 0.9 * dt;
          z += Math.cos(t * 0.6 + p) * 0.5 * dt;
          if (y < 0) { y = top; x = ts.between(-13, 13); z = ts.between(-10, 10); }
          break;
        case 'fireflies':
          x += Math.sin(t * 0.5 + p) * 0.6 * dt;
          y += Math.sin(t * 0.37 + p * 1.3) * 0.25 * dt;
          z += Math.cos(t * 0.45 + p) * 0.6 * dt;
          y = Math.min(3, Math.max(0.4, y));
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
          if (y > top) { y = 0; x = ts.between(-13, 13); z = ts.between(-10, 10); }
          b = Math.sin((Math.PI * y) / top);
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
    ts.place(sp, side, ts.between(0.05, 0.95), ts.between(-2.5, 3.5), ts.between(0.5, 1.4), false);
    const a = ts.anchorOf(sp)!;
    const ph = ts.rnd() * 20;
    const sp0 = ts.between(0.05, 0.12);
    const amp = ts.between(1, 2.4);
    ts.onTick((t) => { sp.position.x = a.base.x + Math.sin(t * sp0 + ph) * amp; });
  }
}

/** A flag on a pole: the cloth ripples in the wind. Returns the group, standing at the pole's foot. */
function flag(ts: ThemeScene, h: number, color: string, w = 1.4, ch = 0.8): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(ts.geo('pole', () => new THREE.CylinderGeometry(0.04, 0.05, 1, 6).translate(0, 0.5, 0)), ts.mat('#3a2a1a'));
  pole.scale.y = h;
  g.add(pole);
  const geom = new THREE.PlaneGeometry(w, ch, 10, 4);
  geom.translate(w / 2, 0, 0);
  const orig = Float32Array.from(geom.getAttribute('position').array);
  const cloth = new THREE.Mesh(geom, ts.register(new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })));
  cloth.position.set(0.04, h - ch / 2 - 0.05, 0);
  cloth.castShadow = true;
  g.add(cloth);
  const p = ts.rnd() * 10;
  const posA = geom.getAttribute('position') as THREE.BufferAttribute;
  ts.onTick((t) => {
    const gust = 0.85 + 0.3 * Math.sin(t * 0.5 + p);
    for (let i = 0; i < posA.count; i++) {
      const x0 = orig[i * 3]! / w;
      posA.setZ(i, Math.sin(x0 * 7 - t * 4.5 + p) * 0.13 * x0 * gust);
      posA.setY(i, orig[i * 3 + 1]! + Math.sin(x0 * 5 - t * 3 + p) * 0.04 * x0);
    }
    posA.needsUpdate = true;
    geom.computeVertexNormals();
  });
  return g;
}

/** A flame sprite that flickers; add it where something burns. */
function flame(ts: ThemeScene, size: number): THREE.Sprite {
  const mat = ts.register(new THREE.SpriteMaterial({ map: flameTexture(), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const s = new THREE.Sprite(mat);
  const p = ts.rnd() * 10;
  ts.onTick((t) => {
    const f = 1 + Math.sin(t * 11 + p) * 0.1 + Math.sin(t * 17 + p * 2) * 0.07;
    s.scale.set(size * 0.6 * f, size * f, 1);
  });
  return s;
}

function glowSprite(ts: ThemeScene, color: string, size: number, opacity: number): THREE.Sprite {
  const s = new THREE.Sprite(ts.register(new THREE.SpriteMaterial({ map: dotTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), opacity));
  s.scale.set(size, size, 1);
  return s;
}

// -- Props --------------------------------------------------------------------

type Mk = (ts: ThemeScene) => THREE.Group;

const box = (ts: ThemeScene, w: number, h: number, d: number, color: string, o?: THREE.MeshStandardMaterialParameters): THREE.Mesh =>
  new THREE.Mesh(ts.geo(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), ts.mat(color, o));
const cyl = (ts: ThemeScene, rt: number, rb: number, h: number, color: string, seg = 8, o?: THREE.MeshStandardMaterialParameters): THREE.Mesh =>
  new THREE.Mesh(ts.geo(`cyl${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), ts.mat(color, o));
const cone = (ts: ThemeScene, r: number, h: number, color: string, seg = 7): THREE.Mesh =>
  new THREE.Mesh(ts.geo(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)), ts.mat(color));
const ico = (ts: ThemeScene, r: number, color: string, o?: THREE.MeshStandardMaterialParameters): THREE.Mesh =>
  new THREE.Mesh(ts.geo(`ico${r}`, () => new THREE.IcosahedronGeometry(r, 0)), ts.mat(color, o));
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T => { o.position.set(x, y, z); return o; };

const pine: (snowy?: boolean) => Mk = (snowy) => (ts) => {
  const h = ts.between(3, 5.2);
  const g = new THREE.Group();
  g.add(at(cyl(ts, 0.1, 0.17, h * 0.25, '#4a3220', 6), 0, h * 0.125, 0));
  const cols = snowy ? ['#27493c', '#b9d0d8', '#f0f6fa'] : ['#1f4a30', '#2a5a38', '#356a40'];
  for (let i = 0; i < 3; i++) g.add(at(cone(ts, h * (0.3 - i * 0.07), h * 0.42, cols[i]!), 0, h * (0.3 + i * 0.2), 0));
  return g;
};

const roundTree: Mk = (ts) => {
  const h = ts.between(3, 4.6);
  const g = new THREE.Group();
  g.add(at(cyl(ts, 0.14, 0.24, h * 0.5, '#5a3d24', 6), 0, h * 0.25, 0));
  const greens = ['#2f6a34', '#3b7a3a', '#4a8a3e'];
  for (let i = 0; i < 3; i++) {
    const b = at(ico(ts, h * 0.3, greens[i]!), ts.between(-0.4, 0.4), h * (0.62 + i * 0.13), ts.between(-0.4, 0.4));
    b.scale.set(1, 0.85, 1);
    g.add(b);
  }
  return g;
};

const deadTree: Mk = (ts) => {
  const h = ts.between(3, 4.6);
  const g = new THREE.Group();
  g.add(at(cyl(ts, 0.05, 0.16, h, '#2a2420', 5), 0, h / 2, 0));
  for (let i = 0; i < 5; i++) {
    const len = ts.between(0.9, 1.7);
    const br = cyl(ts, 0.02, 0.06, len, '#2a2420', 4);
    const dir = i % 2 ? 1 : -1;
    br.position.set(dir * len * 0.35, h * (0.45 + i * 0.1), ts.between(-0.2, 0.2));
    br.rotation.z = -dir * ts.between(0.7, 1.1);
    g.add(br);
  }
  return g;
};

const rock = (color = '#6b6a66', s = 1): Mk => (ts) => {
  const g = new THREE.Group();
  const r = at(ico(ts, ts.between(0.5, 0.9) * s, color), 0, 0.25 * s, 0);
  r.scale.set(1.2, 0.7, 1);
  r.rotation.y = ts.rnd() * 3;
  g.add(r);
  return g;
};

const tower = (h: number, r: number, flagColor: string): Mk => (ts) => {
  const g = new THREE.Group();
  g.add(at(cyl(ts, r * 0.9, r, h, '#7b7a76', 10), 0, h / 2, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(at(box(ts, r * 0.5, 0.35, r * 0.5, '#6d6c68'), Math.cos(a) * r * 0.9, h + 0.15, Math.sin(a) * r * 0.9));
  }
  g.add(at(cone(ts, r * 1.15, r * 1.5, '#8a3b32', 10), 0, h + r * 0.75 + 0.1, 0));
  g.add(at(box(ts, 0.18, 0.5, 0.05, '#1a120c'), r * 0.2, h * 0.6, r * 0.92));
  const f = flag(ts, 1.8, flagColor, 1.2, 0.7);
  f.position.y = h + r * 1.5;
  g.add(f);
  return g;
};

const wall = (len: number, h: number): Mk => (ts) => {
  const g = new THREE.Group();
  g.add(at(box(ts, len, h, 0.9, '#77766f'), 0, h / 2, 0));
  for (let x = -len / 2 + 0.4; x < len / 2 - 0.2; x += 0.9) g.add(at(box(ts, 0.5, 0.4, 0.9, '#6a6963'), x, h + 0.2, 0));
  return g;
};

const brazier: Mk = (ts) => {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = at(cyl(ts, 0.04, 0.05, 1, '#2a2622', 5), Math.cos(a) * 0.22, 0.5, Math.sin(a) * 0.22);
    leg.rotation.z = Math.cos(a) * 0.12;
    leg.rotation.x = -Math.sin(a) * 0.12;
    g.add(leg);
  }
  g.add(at(cyl(ts, 0.42, 0.26, 0.3, '#2f2a26', 8, { metalness: 0.4 }), 0, 1.05, 0));
  g.add(at(cyl(ts, 0.36, 0.36, 0.04, '#ff6a2a', 8, { emissive: '#ff5a1e', emissiveIntensity: 1 }), 0, 1.18, 0));
  const f = flame(ts, 1.5);
  f.position.set(0, 1.85, 0);
  g.add(f);
  g.add(at(glowSprite(ts, '#ff8a3a', 3.2, 0.35), 0, 1.6, 0));
  return g;
};

const barrel: Mk = (ts) => {
  const g = new THREE.Group();
  g.add(at(cyl(ts, 0.36, 0.32, 0.8, '#6a4526', 10), 0, 0.4, 0));
  for (const y of [0.18, 0.62]) {
    const hoop = new THREE.Mesh(ts.geo('hoop', () => new THREE.TorusGeometry(0.36, 0.025, 4, 12)), ts.mat('#2a2118', { metalness: 0.4 }));
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y;
    g.add(hoop);
  }
  return g;
};

const crate = (s: number): Mk => (ts) => {
  const g = new THREE.Group();
  const b = at(box(ts, s, s, s, '#8a6a3c'), 0, s / 2, 0);
  b.rotation.y = ts.rnd();
  g.add(b);
  const lid = at(box(ts, s * 1.04, 0.08, s * 1.04, '#6e5230'), 0, s, 0);
  lid.rotation.y = b.rotation.y;
  g.add(lid);
  return g;
};

const lanternPost: Mk = (ts) => {
  const g = new THREE.Group();
  g.add(at(cyl(ts, 0.05, 0.07, 2.4, '#2a2118', 6), 0, 1.2, 0));
  g.add(at(box(ts, 0.34, 0.44, 0.34, '#ffd28a', { emissive: '#ffb050', emissiveIntensity: 1.2, flatShading: false }), 0, 2.5, 0));
  g.add(at(glowSprite(ts, '#ffb050', 3.4, 0.4), 0, 2.5, 0));
  return g;
};

const gravestone: Mk = (ts) => {
  const g = new THREE.Group();
  g.add(at(box(ts, 0.7, 1, 0.18, '#59605c'), 0, 0.5, 0));
  const top = cyl(ts, 0.35, 0.35, 0.18, '#59605c', 10);
  top.rotation.x = Math.PI / 2;
  top.position.y = 1;
  g.add(top);
  g.rotation.z = ts.between(-0.12, 0.12);
  g.rotation.y = ts.between(-0.4, 0.4);
  return g;
};

const column: Mk = (ts) => {
  const h = ts.between(2, 3.6);
  const g = new THREE.Group();
  g.add(at(cyl(ts, 0.34, 0.4, h, '#6a706b', 10), 0, h / 2, 0));
  const fallen = at(cyl(ts, 0.34, 0.34, 1.4, '#6a706b', 10), 1, 0.34, 0.4);
  fallen.rotation.z = Math.PI / 2;
  fallen.rotation.y = 0.6;
  g.add(fallen);
  return g;
};

const crystal: Mk = (ts) => {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(ts.geo('crystal', () => new THREE.OctahedronGeometry(0.4)), ts.mat('#8fd8ff', { emissive: '#4fb8ff', emissiveIntensity: 0.7, roughness: 0.2 }));
    const s = ts.between(1.2, 2.6);
    c.scale.set(0.6, s, 0.6);
    c.position.set(ts.between(-0.5, 0.5), 0.4 * s, ts.between(-0.4, 0.4));
    c.rotation.z = ts.between(-0.3, 0.3);
    g.add(c);
  }
  g.add(at(glowSprite(ts, '#6fc8ff', 3, 0.28), 0, 0.9, 0));
  return g;
};

const drift: Mk = (ts) => {
  const g = new THREE.Group();
  const d = new THREE.Mesh(ts.geo('drift', () => new THREE.SphereGeometry(1, 10, 6)), ts.mat('#eef4fa', { flatShading: false }));
  d.scale.set(ts.between(1.4, 2.4), 0.4, ts.between(0.9, 1.4));
  d.position.y = FLOOR_Y + 0.05;
  g.add(d);
  return g;
};

const mushroom: Mk = (ts) => {
  const g = new THREE.Group();
  const n = 2 + Math.floor(ts.rnd() * 3);
  for (let i = 0; i < n; i++) {
    const s = ts.between(0.5, 1.2);
    const x = ts.between(-0.6, 0.6);
    const z = ts.between(-0.6, 0.6);
    g.add(at(cyl(ts, 0.07 * s, 0.1 * s, 0.4 * s, '#e8dcc0', 6), x, 0.2 * s, z));
    const cap = new THREE.Mesh(ts.geo('cap', () => new THREE.SphereGeometry(0.28, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2)), ts.mat(ts.rnd() < 0.5 ? '#7bd8ff' : '#c58bff', { emissive: '#4a8aff', emissiveIntensity: 0.55, flatShading: false }));
    cap.scale.setScalar(s * 1.2);
    cap.position.set(x, 0.4 * s, z);
    g.add(cap);
  }
  g.add(at(glowSprite(ts, '#7ab8ff', 2, 0.22), 0, 0.5, 0));
  return g;
};

const shelf = (w: number, h: number): Mk => (ts) => {
  const g = new THREE.Group();
  g.add(at(box(ts, w, h, 0.6, '#2a1a10'), 0, h / 2, 0));
  const tex = bookTexture().clone();
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / 2.4, h / 2.4);
  const front = new THREE.Mesh(ts.geo(`shelf${w},${h}`, () => new THREE.PlaneGeometry(w - 0.2, h - 0.2)), ts.register(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })));
  front.position.set(0, h / 2, 0.31);
  g.add(front);
  return g;
};

const candle: Mk = (ts) => {
  const g = new THREE.Group();
  g.add(at(cyl(ts, 0.05, 0.05, 0.34, '#efe6cc', 6, { emissive: '#554a30', emissiveIntensity: 0.4 }), 0, 0, 0));
  const f = flame(ts, 0.7);
  f.position.set(0, 0.4, 0);
  g.add(f);
  g.add(at(glowSprite(ts, '#ffc070', 1.8, 0.35), 0, 0.35, 0));
  const y0 = ts.between(2.2, 4.2);
  const p = ts.rnd() * 10;
  ts.onTick((t) => { g.position.y = y0 + Math.sin(t * 0.8 + p) * 0.18; });
  return g;
};

const mast = (h: number, flagColor: string): Mk => (ts) => {
  const g = new THREE.Group();
  g.add(at(cyl(ts, 0.1, 0.16, h, '#4a3322', 6), 0, h / 2, 0));
  const yard = at(cyl(ts, 0.05, 0.05, 2.6, '#4a3322', 5), 0, h * 0.78, 0);
  yard.rotation.z = Math.PI / 2;
  g.add(yard);
  const sail = at(box(ts, 2.3, h * 0.3, 0.06, '#e8e0cc', { flatShading: false }), 0, h * 0.78 - h * 0.15, 0.05);
  sail.rotation.y = 0.12;
  g.add(sail);
  const f = flag(ts, 0.9, flagColor, 1.5, 0.8);
  f.position.y = h;
  g.add(f);
  return g;
};

const piling: Mk = (ts) => {
  const g = new THREE.Group();
  g.add(at(cyl(ts, 0.2, 0.26, ts.between(1.4, 2.2), '#3a2f24', 7), 0, 0.3, 0));
  return g;
};

const rope: Mk = (ts) => {
  const g = new THREE.Group();
  const t = new THREE.Mesh(ts.geo('rope', () => new THREE.TorusGeometry(0.34, 0.08, 5, 12)), ts.mat('#b89a62'));
  t.rotation.x = Math.PI / 2;
  t.position.y = 0.1;
  g.add(t);
  return g;
};

const railing = (len: number): Mk => (ts) => {
  const g = new THREE.Group();
  g.add(at(box(ts, len, 0.1, 0.1, '#7a5a34'), 0, 0.95, 0));
  g.add(at(box(ts, len, 0.08, 0.08, '#7a5a34'), 0, 0.5, 0));
  for (let x = -len / 2; x <= len / 2 + 0.01; x += 1.25) g.add(at(box(ts, 0.14, 1.05, 0.14, '#6a4a2a'), x, 0.52, 0));
  return g;
};

const lavaPool: Mk = (ts) => {
  const g = new THREE.Group();
  const m = ts.register(new THREE.MeshBasicMaterial({ color: '#ff6a1e', fog: false }));
  const disc = new THREE.Mesh(ts.geo('lava', () => new THREE.CircleGeometry(1, 20)), m);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = FLOOR_Y + 0.02;
  disc.scale.setScalar(ts.between(0.9, 1.5));
  g.add(disc);
  g.add(at(glowSprite(ts, '#ff6a1e', 4.5, 0.35), 0, 0.2, 0));
  const p = ts.rnd() * 10;
  ts.onTick((t) => { m.color.setRGB(1, 0.32 + 0.12 * Math.sin(t * 1.3 + p), 0.08); });
  return g;
};

const anvil: Mk = (ts) => {
  const g = new THREE.Group();
  g.add(at(box(ts, 0.9, 0.3, 0.55, '#2a2a2e', { metalness: 0.5, roughness: 0.5 }), 0, 0.15, 0));
  g.add(at(box(ts, 0.45, 0.5, 0.35, '#2a2a2e', { metalness: 0.5, roughness: 0.5 }), 0, 0.55, 0));
  g.add(at(box(ts, 1.3, 0.28, 0.6, '#35353a', { metalness: 0.5, roughness: 0.5 }), 0, 0.94, 0));
  return g;
};

const chimney: Mk = (ts) => {
  const g = new THREE.Group();
  g.add(at(cyl(ts, 0.7, 0.95, 7, '#2a211d', 8), 0, 3.5, 0));
  g.add(at(glowSprite(ts, '#ff5a1e', 3, 0.35), 0, 7.2, 0));
  return g;
};

const spire: Mk = (ts) => {
  const g = new THREE.Group();
  const h = ts.between(4, 7);
  const r = at(ico(ts, 1.2, '#2e2a28'), 0, h * 0.35, 0);
  r.scale.set(0.8, h * 0.3, 0.7);
  g.add(r);
  return g;
};

const banner = (color: string): Mk => (ts) => flag(ts, 3.2, color, 1.3, 1.1);

const SETS: Record<PropSet, (ts: ThemeScene) => void> = {
  none: () => {},

  fortress: (ts) => {
    const reds = ['#b22a2a', '#2a4fb2', '#d9a82a'];
    ts.place(tower(6, 1.2, reds[0]!)(ts), 'back', 0.0, 2.2);
    ts.place(tower(6, 1.2, reds[1]!)(ts), 'back', 1.0, 2.2);
    ts.place(tower(4.6, 0.9, reds[2]!)(ts), 'back', 0.42, 3.6);
    ts.place(tower(4.6, 0.9, reds[2]!)(ts), 'back', 0.58, 3.6);
    ts.place(wall(3.2, 2.4)(ts), 'back', 0.5, 3.6);
    for (const s of [0.2, 0.8]) ts.place(wall(5, 2.2)(ts), 'back', s, 2.6);
    for (const [side, s] of [['left', 0.3], ['left', 0.7], ['right', 0.3], ['right', 0.7]] as const) {
      const w = ts.place(wall(4, 2)(ts), side, s, 2.2);
      w.rotation.y = Math.PI / 2;
    }
    for (const s of [0.27, 0.73]) ts.place(brazier(ts), 'back', s, 1.2);
    for (const [s, c] of [[0.12, reds[0]!], [0.88, reds[1]!]] as const) ts.place(banner(c)(ts), 'back', s, 1.1);
    ts.place(rock('#77766f', 1.2)(ts), 'front', 0.05, 1.6);
  },

  tavern: (ts) => {
    for (const [side, s, out] of [['back', 0.06, 1.3], ['back', 0.1, 2.2], ['back', 0.92, 1.4], ['left', 0.2, 1.3], ['right', 0.78, 1.3], ['right', 0.2, 1.6], ['left', 0.8, 1.5]] as const) {
      ts.place(barrel(ts), side, s, out).rotation.y = ts.rnd() * 3;
    }
    for (const [side, s, out, sz] of [['back', 0.14, 1.5, 1.0], ['back', 0.88, 2.2, 0.9], ['left', 0.5, 1.4, 0.9], ['right', 0.5, 1.5, 1.1], ['back', 0.5, 2, 1]] as const) ts.place(crate(sz)(ts), side, s, out);
    for (const s of [0.25, 0.75]) ts.place(lanternPost(ts), 'back', s, 1.1);
    for (const s of [0.3, 0.7]) ts.place(lanternPost(ts), 'left', s, 1.0);
  },

  harbor: (ts) => {
    for (const side of ['back', 'left', 'right'] as const) {
      for (let i = 0; i < 6; i++) ts.place(piling(ts), side, 0.04 + i * 0.185, 0.7 + ts.rnd() * 0.3, -0.2);
    }
    ts.place(mast(9, '#c0392b')(ts), 'back', 0.15, 4.5);
    ts.place(mast(8, '#2a6fb2')(ts), 'back', 0.85, 4);
    for (const [side, s] of [['back', 0.4], ['back', 0.62], ['left', 0.45], ['right', 0.6]] as const) ts.place(crate(0.9)(ts), side, s, 1.3);
    for (const [side, s] of [['back', 0.52], ['right', 0.35], ['left', 0.2]] as const) ts.place(barrel(ts), side, s, 1.4);
    for (const s of [0.1, 0.9]) ts.place(lanternPost(ts), 'back', s, 1.0);
    for (const [side, s] of [['back', 0.3], ['left', 0.65]] as const) ts.place(rope(ts), side, s, 1.2);
  },

  snow: (ts) => {
    for (const s of [0.03, 0.12, 0.22, 0.34, 0.66, 0.78, 0.88, 0.97]) ts.place(pine(true)(ts), 'back', s, ts.between(2, 4.5));
    for (const side of ['left', 'right'] as const) for (const s of [0.1, 0.3, 0.55, 0.8]) ts.place(pine(true)(ts), side, s, ts.between(1.5, 3.5));
    for (const [side, s] of [['back', 0.08], ['back', 0.93], ['left', 0.4], ['right', 0.6]] as const) ts.place(crystal(ts), side, s, 1.4);
    for (let i = 0; i < 10; i++) ts.place(drift(ts), (['back', 'left', 'right'] as const)[i % 3]!, ts.rnd(), 0.9 + ts.rnd(), 0, false);
    for (const [side, s] of [['back', 0.45], ['left', 0.2], ['right', 0.85]] as const) ts.place(rock('#7d8a96', 1.3)(ts), side, s, 1.8);
  },

  crypt: (ts) => {
    for (let i = 0; i < 12; i++) ts.place(gravestone(ts), (['back', 'left', 'right', 'back'] as const)[i % 4]!, ts.between(0.05, 0.95), ts.between(0.9, 3));
    for (const s of [0.1, 0.5, 0.9]) ts.place(deadTree(ts), 'back', s, ts.between(3, 4.5));
    for (const [side, s] of [['back', 0.3], ['back', 0.7], ['left', 0.5], ['right', 0.5]] as const) ts.place(column(ts), side, s, 1.8);
    for (const [side, s] of [['left', 0.2], ['right', 0.8]] as const) ts.place(deadTree(ts), side, s, 3);
  },

  forge: (ts) => {
    ts.place(spire(ts), 'back', 0.02, 2.4);
    ts.place(spire(ts), 'back', 0.98, 2.4);
    ts.place(spire(ts), 'back', 0.3, 5);
    ts.place(chimney(ts), 'back', 0.55, 5);
    for (const [side, s] of [['left', 0.3], ['right', 0.7], ['left', 0.75], ['back', 0.15], ['back', 0.85]] as const) ts.place(lavaPool(ts), side, s, 1.4, 0, false);
    ts.place(anvil(ts), 'left', 0.5, 1.4);
    for (const s of [0.32, 0.68]) ts.place(brazier(ts), 'back', s, 1.2);
    for (const [side, s] of [['right', 0.2], ['right', 0.5], ['left', 0.15]] as const) ts.place(rock('#2e2a28', 1.3)(ts), side, s, 1.8);
  },

  forest: (ts) => {
    for (let i = 0; i < 9; i++) ts.place((i % 3 === 1 ? pine() : roundTree)(ts), 'back', 0.02 + i * 0.12, ts.between(1.8, 4.5));
    for (const side of ['left', 'right'] as const) for (const s of [0.15, 0.45, 0.75]) ts.place((ts.rnd() < 0.5 ? roundTree : pine())(ts), side, s, ts.between(1.6, 3.5));
    for (const [side, s] of [['back', 0.2], ['back', 0.62], ['left', 0.3], ['right', 0.55], ['left', 0.8], ['right', 0.1]] as const) ts.place(mushroom(ts), side, s, ts.between(0.9, 1.6), 0, false);
    for (const [side, s] of [['back', 0.4], ['left', 0.55], ['right', 0.35]] as const) ts.place(rock('#5a6a55', 1.1)(ts), side, s, 1.5);
  },

  archive: (ts) => {
    for (const s of [0.13, 0.38, 0.62, 0.87]) ts.place(shelf(4.4, 5.4)(ts), 'back', s, 1.8);
    for (const side of ['left', 'right'] as const) for (const s of [0.3, 0.7]) ts.place(shelf(4.4, 5)(ts), side, s, 1.8).rotation.y = side === 'left' ? Math.PI / 2 : -Math.PI / 2;
    for (let i = 0; i < 9; i++) ts.place(candle(ts), (['back', 'left', 'right'] as const)[i % 3]!, ts.between(0.1, 0.9), ts.between(0.2, 1.2), 0, false);
  },

  plains: (ts) => {
    for (let i = 0; i < 6; i++) {
      const f = ts.place(new THREE.Group(), 'back', 0.1 + i * 0.16, 1.4);
      f.add(at(box(ts, 1.7, 0.08, 0.08, '#7a5a34'), 0, 0.85, 0), at(box(ts, 1.7, 0.08, 0.08, '#7a5a34'), 0, 0.5, 0), at(box(ts, 0.14, 1, 0.14, '#6a4a2a'), -0.85, 0.5, 0));
    }
    for (const s of [0.1, 0.5, 0.92]) ts.place(roundTree(ts), 'back', s, ts.between(4, 6));
    for (const [side, s] of [['back', 0.3], ['left', 0.4], ['right', 0.6], ['back', 0.75]] as const) ts.place(rock('#8a8470', 1.2)(ts), side, s, 1.8);
    const stone = box(ts, 0.6, 1.2, 0.35, '#8a8a82');
    ts.place(stone, 'right', 0.8, 1.2, 0.6);
    ts.place(flag(ts, 3.4, '#c0392b'), 'left', 0.15, 1.5);
    ts.place(flag(ts, 3.4, '#d9a82a'), 'back', 0.5, 1.3);
    ts.onLayout((w, d, cz) => grass(ts, w, d, cz));
  },

  sky: (ts) => {
    for (const side of ['back', 'left', 'right'] as const) ts.place(railing(side === 'back' ? 19 : 12.6)(ts), side, 0.5, 0.6).rotation.y = side === 'back' ? 0 : Math.PI / 2;
    ts.place(mast(10, '#c0392b')(ts), 'back', 0.2, 1.6);
    ts.place(mast(9, '#d9a82a')(ts), 'back', 0.8, 1.6);
    for (const [side, s] of [['back', 0.5], ['left', 0.4], ['right', 0.6]] as const) ts.place(barrel(ts), side, s, 1.4);
    for (const s of [0.08, 0.92]) ts.place(lanternPost(ts), 'back', s, 1.0);
  },
};

// Tufts of grass around the table (plains), laid out from the table's size.
function grass(ts: ThemeScene, w: number, d: number, cz: number): void {
  const name = 'grass';
  let inst = ts.group.getObjectByName(name) as THREE.InstancedMesh | undefined;
  if (!inst) {
    inst = new THREE.InstancedMesh(ts.geo('tuft', () => new THREE.ConeGeometry(0.045, 0.4, 4).translate(0, 0.2, 0)), ts.mat('#6f9a3a'), 160);
    inst.name = name;
    inst.frustumCulled = false;
    ts.group.add(inst);
  }
  const m = new THREE.Matrix4();
  for (let i = 0; i < 160; i++) {
    const a = ts.rnd() * Math.PI * 2;
    const x = Math.cos(a) * (w / 2 + 0.6 + ts.rnd() * 5);
    const z = cz + Math.sin(a) * (d / 2 + 0.6 + ts.rnd() * 5);
    const s = ts.between(0.7, 1.8);
    m.compose(new THREE.Vector3(x, FLOOR_Y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(ts.between(-0.2, 0.2), 0, ts.between(-0.2, 0.2))), new THREE.Vector3(s, s, s));
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
}

// -- A whole theme --------------------------------------------------------------

export function buildThemeScene(theme: Theme, ctx: SceneCtx, coarse: boolean, seed: number, skipSkyline = false): ThemeScene {
  const ts = new ThemeScene(ctx);
  ts.reseed(seed);
  SETS[theme.props](ts);
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
      ring.position.y = FLOOR_Y + h / 2 - 1;
      ring.renderOrder = -1;
      ts.group.add(ring);
    }
  }
  return ts;
}
