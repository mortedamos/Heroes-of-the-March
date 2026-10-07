// The thing the playing surface is the top of: a tavern table, a ship's deck, a stone altar, a vault, an anvil.
// Every body is built under the table's outline, so it follows the table when the screen changes shape. Most
// of them are "lofts": a side profile (how far in, how far down) swept around the outline.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mixHex, surfaceMaterial, type SurfaceSpec } from './surfaces';
import type { ThemeScene } from './props';
import type { TableKind, TableSpec } from './themes';

/** Radius of the table's rounded corners. */
export const TABLE_CORNER = 2.8;

/** The body's top sits this far under the playing surface, so the two never fight over the same pixels. */
const LIFT = 0.012;

/** The playing surface: a rounded rectangle `w` x `d`, centred on x = 0 and z = `cz`. */
export interface Outline { w: number; d: number; cz: number; r: number }
export interface RingPoint { x: number; z: number; nx: number; nz: number }
/** One step of a side profile: how far the wall is pulled in from the outline (negative: pushed out), and how high. */
export interface Level { inset: number; y: number }

const CORNERS: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];

/**
 * The outline pulled in by `inset`, as points in order round it (with outward normals). Every inset has the same
 * number of points, so two rings line up point for point and can be joined into a wall.
 */
export function ring(o: Outline, inset: number, seg = 6): RingPoint[] {
  const hw = Math.max(0.3, o.w / 2 - inset);
  const hd = Math.max(0.3, o.d / 2 - inset);
  const rr = Math.min(Math.max(o.r - inset, 0.03), hw, hd);
  const pts: RingPoint[] = [];
  CORNERS.forEach(([sx, sz], k) => {
    const cx = sx * (hw - rr);
    const cz = o.cz + sz * (hd - rr);
    for (let i = 0; i <= seg; i++) {
      const a = ((k + i / seg) * Math.PI) / 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      pts.push({ x: cx + nx * rr, z: cz + nz * rr, nx, nz });
    }
  });
  return pts;
}

/**
 * Sweep a side profile around the outline. The profile runs top to bottom along the outside of the body, so the
 * solid is on its inner/lower side. `cap` closes the bottom (needed so the body throws a proper shadow).
 * UVs are in world units (u along the wall, v down the profile): a material's own repeat sets the texture size.
 */
export function loft(o: Outline, levels: Level[], cap = false, seg = 6): THREE.BufferGeometry {
  const base = ring(o, 0, seg);
  const n = base.length;
  const u: number[] = [0];
  for (let j = 1; j <= n; j++) {
    const a = base[j - 1]!;
    const b = base[j % n]!;
    u.push(u[j - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const m = n + 1;
  let v = 0;

  for (let k = 0; k + 1 < levels.length; k++) {
    const A = levels[k]!;
    const B = levels[k + 1]!;
    const dr = -(B.inset - A.inset);
    const dy = B.y - A.y;
    const len = Math.hypot(dr, dy);
    if (len < 1e-6) continue;
    // The wall's outward direction in the (out, up) plane: the profile's direction turned a quarter.
    const nr = -dy / len;
    const ny = dr / len;
    const first = pos.length / 3;
    for (const [pts, lv, vv] of [[ring(o, A.inset, seg), A, v], [ring(o, B.inset, seg), B, v + len]] as const) {
      for (let j = 0; j <= n; j++) {
        const p = pts[j % n]!;
        pos.push(p.x, lv.y, p.z);
        nor.push(p.nx * nr, ny, p.nz * nr);
        uv.push(u[j]!, vv);
      }
    }
    v += len;

    // Wind the triangles so they face the way the normals do (decided for the whole band at once).
    let agree = 0;
    for (let j = 0; j < n; j++) {
      const i0 = (first + j) * 3;
      const i1 = (first + j + 1) * 3;
      const i2 = (first + m + j) * 3;
      const e1 = [pos[i1]! - pos[i0]!, pos[i1 + 1]! - pos[i0 + 1]!, pos[i1 + 2]! - pos[i0 + 2]!];
      const e2 = [pos[i2]! - pos[i0]!, pos[i2 + 1]! - pos[i0 + 1]!, pos[i2 + 2]! - pos[i0 + 2]!];
      const fx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
      const fy = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
      const fz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
      agree += fx * nor[i0]! + fy * nor[i0 + 1]! + fz * nor[i0 + 2]!;
    }
    for (let j = 0; j < n; j++) {
      const a0 = first + j;
      const a1 = a0 + 1;
      const b0 = first + m + j;
      const b1 = b0 + 1;
      if (agree >= 0) idx.push(a0, a1, b0, a1, b1, b0);
      else idx.push(a0, b0, a1, a1, b0, b1);
    }
  }

  if (cap) {
    const last = levels[levels.length - 1]!;
    const pts = ring(o, last.inset, seg);
    const first = pos.length / 3;
    pos.push(0, last.y, o.cz);
    nor.push(0, -1, 0);
    uv.push(0, 0);
    for (let j = 0; j < n; j++) {
      pos.push(pts[j]!.x, last.y, pts[j]!.z);
      nor.push(0, -1, 0);
      uv.push(pts[j]!.x, pts[j]!.z - o.cz);
    }
    for (let j = 0; j < n; j++) idx.push(first, first + 1 + j, first + 1 + ((j + 1) % n));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

// -- Building blocks ----------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Std = THREE.MeshStandardMaterial;
type Mats = Record<string, THREE.Material>;

interface MatCtx { ts: ThemeScene; spec: TableSpec; top: SurfaceSpec; aniso: number }

interface Build {
  o: Outline;
  spec: TableSpec;
  m: Mats;
  rnd: () => number;
  /** Add a mesh to what this layout builds. Casts shadows unless told not to. */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, shadow?: boolean): THREE.Mesh;
  /** Add instances of `geo`: `place(i, matrix, colour)` positions each one. */
  scatter(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, place: (i: number, at: THREE.Matrix4, tint: THREE.Color) => void, shadow?: boolean): void;
}

interface Kind {
  mats(c: MatCtx): Mats;
  build(b: Build): void;
}

/** A painted, textured material that fades with its scene. `vertical` turns the grain to run up and down (legs, posts). */
function textured(c: MatCtx, spec: SurfaceSpec, vertical = false): Std {
  const m = c.ts.register(surfaceMaterial(spec, 1 / spec.tile, c.aniso));
  if (vertical && m.map) {
    m.map.center.set(0.5, 0.5);
    m.map.rotation = Math.PI / 2;
  }
  return m;
}

const plain = (c: MatCtx, color: string, o: THREE.MeshStandardMaterialParameters = {}): Std =>
  c.ts.mat(color, { flatShading: false, ...o });

/** Planks from the playing surface's own colours (darkened by `dark`), a few boards high. */
function boards(c: MatCtx, rows: number, dark = 0, vertical = false): Std {
  const t = c.top;
  return textured(c, { ...t, kind: 'planks', a: mixHex(t.a, '#000000', dark), b: mixHex(t.b, '#000000', dark), tile: 4, opts: { rows } }, vertical);
}

/** Masonry from the playing surface's own stone. */
function masonry(c: MatCtx): Std {
  return textured(c, { ...c.top, kind: 'slab', tile: 6, opts: { ...c.top.opts, rows: 3 } });
}

/** A box whose texture runs in world units (so a tall pilaster is not one stretched stone). */
function worldBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, p.getZ(i), p.getY(i));
    else if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, p.getX(i), p.getZ(i));
    else uv.setXY(i, p.getX(i), p.getY(i));
  }
  return g;
}

/** A beam, `w` x `h` x `d`, centred on (x, y, z). */
function beam(b: Build, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material): THREE.Mesh {
  const mesh = b.add(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Four legs at the corners, `size` thick, pulled in `inset` from the table's edge. */
function legs(b: Build, size: number, inset: number, top: number, bottom: number, mat: THREE.Material): [number, number][] {
  const out: [number, number][] = [];
  const x = b.o.w / 2 - inset - size / 2;
  const z = b.o.d / 2 - inset - size / 2;
  for (const [sx, sz] of CORNERS) {
    beam(b, size, top - bottom, size, sx * x, (top + bottom) / 2, b.o.cz + sz * z, mat);
    out.push([sx * x, b.o.cz + sz * z]);
  }
  return out;
}

/** Rails between the four legs, `h` tall and `t` thick, at height `y`. */
function rails(b: Build, size: number, inset: number, y: number, h: number, t: number, mat: THREE.Material): void {
  const x = b.o.w / 2 - inset - size / 2;
  const z = b.o.d / 2 - inset - size / 2;
  for (const s of [-1, 1]) {
    beam(b, 2 * x - size, h, t, 0, y, b.o.cz + s * z, mat);
    beam(b, t, h, 2 * z - size, s * x, y, b.o.cz, mat);
  }
}

/** A random spot on the ring `inset` in from the edge (picked by length, so long sides get their share). */
function spots(o: Outline, inset: number): (rnd: () => number) => RingPoint {
  const pts = ring(o, inset);
  const n = pts.length;
  const cum: number[] = [0];
  for (let j = 0; j < n; j++) {
    const a = pts[j]!;
    const c = pts[(j + 1) % n]!;
    cum.push(cum[j]! + Math.hypot(c.x - a.x, c.z - a.z));
  }
  const total = cum[n]!;
  return (rnd) => {
    const at = rnd() * total;
    let j = 0;
    while (j < n - 1 && cum[j + 1]! < at) j++;
    const a = pts[j]!;
    const c = pts[(j + 1) % n]!;
    const t = (at - cum[j]!) / Math.max(1e-6, cum[j + 1]! - cum[j]!);
    const nx = a.nx + (c.nx - a.nx) * t;
    const nz = a.nz + (c.nz - a.nz) * t;
    const l = Math.hypot(nx, nz) || 1;
    return { x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t, nx: nx / l, nz: nz / l };
  };
}

// -- The shadow on the ground ---------------------------------------------------------

/** A soft dark pool, black at the middle and clear at the edge, to lay on the ground round the table. */
function poolMaterial(c: MatCtx, strength: number): THREE.Material {
  const cv = document.createElement('canvas');
  cv.width = 4;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  for (let y = 0; y < 128; y++) {
    const v = Math.round(Math.pow(1 - y / 127, 2.2) * 255);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(0, y, 4, 1);
  }
  return c.ts.register(new THREE.MeshBasicMaterial({
    color: '#05040a', alphaMap: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), strength);
}

/**
 * Lay the pool on the ground: solid under the table out to `edge` beyond its outline, then fading away over `reach`.
 * It is what makes a table (or a block of stone) stand on the floor instead of lying on it.
 */
function pool(b: Build, edge: number, reach: number): void {
  const y = -b.spec.height + 0.04;
  const A = 6;
  const geo = loft(b.o, [{ inset: A, y }, { inset: -edge, y }, { inset: -edge - reach, y }]);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, Math.min(1, Math.max(0, (uv.getY(i) - (A + edge)) / reach)));
  const mesh = b.add(geo, b.m.pool!, false);
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
}

// -- Chairs -----------------------------------------------------------------------------

interface ChairStyle {
  w: number;
  d: number;
  legT: number;
  seatT: number;
  /** How far the back rises above the seat. */
  backH: number;
  back: 'rails' | 'panel';
  /** A cushion on the seat and against the back. */
  pad?: boolean;
}

/** One chair, standing on y = 0 and facing +z, as a wood geometry and (if cushioned) a cushion geometry. */
function chairGeometry(st: ChairStyle, seatH: number): { wood: THREE.BufferGeometry; pad: THREE.BufferGeometry | null } {
  const { w, d, legT: t, seatT } = st;
  const wood: THREE.BufferGeometry[] = [];
  const box = (into: THREE.BufferGeometry[], bw: number, bh: number, bd: number, x: number, y: number, z: number): void => {
    into.push(new THREE.BoxGeometry(bw, bh, bd).translate(x, y, z));
  };
  const hx = w / 2 - t / 2;
  const hz = d / 2 - t / 2;
  const under = seatH - seatT;
  const top = seatH + st.backH;
  box(wood, w, seatT, d, 0, seatH - seatT / 2, 0);                              // the seat
  for (const sx of [-1, 1]) box(wood, t, under, t, sx * hx, under / 2, hz);       // the front legs
  for (const sx of [-1, 1]) box(wood, t, top, t, sx * hx, top / 2, -hz);          // the back legs, running up into the back
  box(wood, w - 2 * t, 0.16, 0.16, 0, under * 0.34, hz);                         // rungs
  box(wood, w - 2 * t, 0.16, 0.16, 0, under * 0.34, -hz);
  for (const sx of [-1, 1]) box(wood, 0.16, 0.16, d - 2 * t, sx * hx, under * 0.46, 0);
  if (st.back === 'panel') {
    box(wood, w - 0.1, st.backH * 0.82, t * 0.8, 0, seatH + st.backH * 0.52, -hz);
  } else {
    box(wood, w - 2 * t, 0.34, t * 0.7, 0, top - 0.17, -hz);                      // a top rail and two lower ones
    box(wood, w - 2 * t, 0.2, t * 0.5, 0, seatH + st.backH * 0.52, -hz);
    box(wood, w - 2 * t, 0.2, t * 0.5, 0, seatH + st.backH * 0.2, -hz);
  }
  let pad: THREE.BufferGeometry | null = null;
  if (st.pad) {
    const parts: THREE.BufferGeometry[] = [];
    box(parts, w - 0.3, 0.3, d - 0.3, 0, seatH + 0.15, 0.05);
    box(parts, w - 2 * t - 0.3, st.backH * 0.42, 0.22, 0, seatH + st.backH * 0.5, -hz + t * 0.4 + 0.12);
    pad = mergeGeometries(parts)!;
    parts.forEach((g) => g.dispose());
  }
  const merged = mergeGeometries(wood)!;
  wood.forEach((g) => g.dispose());
  return { wood: merged, pad };
}

/** Chairs on the far side and the two ends, pushed a little under the table's edge and turned to face it. The near side is the player's own seat (the camera), so it is left clear. */
function chairs(b: Build, st: ChairStyle, seatH: number, wood: THREE.Material, pad?: THREE.Material): void {
  const { o, rnd } = b;
  const H = b.spec.height;
  const geo = chairGeometry(st, seatH);
  const off = st.d / 2 - 0.5;
  const at: [number, number, number][] = [];                    // x, z, which way it faces
  for (const f of [-0.28, 0, 0.28]) at.push([f * o.w, o.cz - o.d / 2 - off, 0]);
  for (const f of [-0.22, 0.22]) {
    at.push([-(o.w / 2 + off), o.cz + f * o.d, Math.PI / 2]);
    at.push([o.w / 2 + off, o.cz + f * o.d, -Math.PI / 2]);
  }
  const jitter = at.map(() => [(rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.14] as const);
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const place = (i: number, mat: THREE.Matrix4, tint: THREE.Color): void => {
    const [x, z, yaw] = at[i]!;
    const [pull, turn] = jitter[i]!;
    // Pulled out a little (never further in), and turned a touch.
    const dx = Math.sin(yaw) * -Math.max(0, pull);
    const dz = Math.cos(yaw) * -Math.max(0, pull);
    mat.compose(p.set(x + dx, -H, z + dz), q.setFromAxisAngle(up, yaw + turn), one);
    tint.set('#ffffff');
  };
  b.scatter(geo.wood, wood, at.length, place, true);
  if (geo.pad && pad) b.scatter(geo.pad, pad, at.length, place, true);
}

// -- Wooden tables --------------------------------------------------------------------

const tavern: Kind = {
  mats: (c) => ({
    side: boards(c, 2, 0.1), leg: boards(c, 2, 0.15, true), pool: poolMaterial(c, 0.5),
    chair: plain(c, mixHex(c.top.a, c.top.b, 0.4), { roughness: 0.85 }),
  }),
  build(b) {
    const H = b.spec.height;
    const T = 0.62;
    b.add(loft(b.o, [{ inset: 0, y: -LIFT }, { inset: 0, y: -T }], true), b.m.side!);
    legs(b, 1.15, 1.5, -T, -H - 0.2, b.m.leg!);
    rails(b, 1.15, 1.5, -(H - 1.3), 0.46, 0.46, b.m.leg!);
    chairs(b, { w: 2.5, d: 2.5, legT: 0.3, seatT: 0.26, backH: 2.9, back: 'rails' }, H * 0.5, b.m.chair!);
    pool(b, 0, 6);
  },
};

const hall: Kind = {
  mats: (c) => ({
    side: boards(c, 2, 0.1), leg: boards(c, 2, 0.15, true), iron: plain(c, '#26262b', { metalness: 0.5, roughness: 0.5 }),
    pool: poolMaterial(c, 0.55), chair: plain(c, mixHex(c.top.a, '#000000', 0.1), { roughness: 0.8 }),
  }),
  build(b) {
    const H = b.spec.height;
    const T = 0.85;
    b.add(loft(b.o, [{ inset: 0, y: -LIFT }, { inset: 0, y: -T }], true), b.m.side!);
    // An iron band round the edge of the top.
    b.add(loft(b.o, [{ inset: -0.04, y: -0.04 }, { inset: -0.04, y: -0.3 }]), b.m.iron!);
    b.add(loft(b.o, [{ inset: 1.1, y: -T + 0.01 }, { inset: 1.1, y: -T - 0.85 }], true), b.m.side!);
    const size = 1.7;
    for (const [x, z] of legs(b, size, 1.1, -T, -H - 0.2, b.m.leg!)) {
      for (const y of [-T - 1.5, -(H - 1)]) beam(b, size + 0.18, 0.24, size + 0.18, x, y, z, b.m.iron!);
    }
    rails(b, size, 1.1, -(H - 1.8), 0.55, 0.55, b.m.leg!);
    chairs(b, { w: 3, d: 2.9, legT: 0.42, seatT: 0.34, backH: 3.5, back: 'panel' }, H * 0.5, b.m.chair!);
    pool(b, 0, 6.5);
  },
};

/** A turned leg: a lathe profile, `len` tall, standing on y = 0. */
function turnedLeg(len: number): THREE.BufferGeometry {
  const prof: [number, number][] = [[0.6, 0], [0.66, 0.03], [0.5, 0.14], [0.58, 0.23], [0.38, 0.32], [0.4, 0.46], [0.74, 0.56], [0.5, 0.66], [0.56, 0.78], [0.7, 0.92], [0.7, 1]];
  return new THREE.LatheGeometry(prof.map(([r, f]) => new THREE.Vector2(r, f * len)), 16);
}

const study: Kind = {
  mats: (c) => ({
    side: boards(c, 3, 0.05), leg: boards(c, 2, 0.1, true),
    brass: plain(c, '#b58f3e', { metalness: 0.5, roughness: 0.32 }),
    pool: poolMaterial(c, 0.55), chair: plain(c, mixHex(c.top.a, '#000000', 0.05), { roughness: 0.6 }),
    pad: plain(c, '#5c1f30', { roughness: 0.85 }),
  }),
  build(b) {
    const H = b.spec.height;
    const T = 0.5;
    const A = 0.75;
    b.add(loft(b.o, [{ inset: 0, y: -LIFT }, { inset: 0, y: -T }], true), b.m.side!);
    b.add(loft(b.o, [{ inset: -0.03, y: -0.1 }, { inset: -0.03, y: -0.26 }]), b.m.brass!);
    b.add(loft(b.o, [{ inset: 0.9, y: -T + 0.01 }, { inset: 0.9, y: -T - A }], true), b.m.side!);
    const len = H - T - A + 0.2;
    const x = b.o.w / 2 - 1.15;
    const z = b.o.d / 2 - 1.15;
    for (const [sx, sz] of CORNERS) {
      const leg = b.add(turnedLeg(len), b.m.leg!);
      leg.position.set(sx * x, -H - 0.2, b.o.cz + sz * z);
      const foot = b.add(new THREE.CylinderGeometry(0.62, 0.66, 0.2, 14), b.m.brass!);
      foot.position.set(sx * x, -H + 0.1, b.o.cz + sz * z);
    }
    rails(b, 1.3, 0.9, -(H - 1.4), 0.34, 0.34, b.m.leg!);
    chairs(b, { w: 2.5, d: 2.4, legT: 0.26, seatT: 0.24, backH: 3, back: 'rails', pad: true }, H * 0.5, b.m.chair!, b.m.pad!);
    pool(b, 0, 6);
  },
};

// -- Stone ------------------------------------------------------------------------------

/** How far the stone block under an altar reaches beyond the slab the cards lie on. */
const BLOCK = 2;

interface Dressing {
  /** The block's top face: its height, and how far out its edge is (an inset, so negative). */
  ledgeY: number;
  edge: number;
  /** Ledges lower down, where snow and moss collect. */
  tiers: { inset: number; y: number }[];
  /** Wall faces that lichen grows on. */
  walls: { inset: number; top: number; bottom: number }[];
}

/** What settles on a stone's edges: lumps of moss or drifts of snow, lichen on the walls, icicles and a glaze of ice. */
function dress(b: Build, d: Dressing): void {
  const cover = b.spec.cover;
  if (!cover) return;
  const { o, rnd } = b;
  const blobGeo = new THREE.SphereGeometry(1, 12, 8);
  const m = b.m;

  const snow = cover === 'snow';
  const palette = (snow ? ['#ffffff', '#f2f7ff', '#e4eefb'] : ['#264a1f', '#2f5726', '#386330', '#43713a', '#1f3f1a']).map((c) => new THREE.Color(c));
  const at = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tinted = (i: number, tint: THREE.Color): void => {
    tint.copy(palette[i % palette.length]!).lerp(palette[Math.floor(rnd() * palette.length)]!, 0.5);
  };

  // Along the lip of the slab: lumps hug the raised lip, a few slumping over the edge.
  const lip = spots(o, 0);
  b.scatter(blobGeo, m.lump!, Math.round((o.w + o.d) * (snow ? 5 : 5.5)), (i, mat, tint) => {
    const p = lip(rnd);
    const over = rnd() < 0.25;
    const off = over ? -0.05 : 0.08 + rnd() * 0.4;
    at.set(p.x - p.nx * off, over ? -0.02 + rnd() * 0.1 : (snow ? 0.16 : 0.1) + rnd() * 0.14, p.z - p.nz * off);
    rot.setFromAxisAngle(up, Math.atan2(p.nx, p.nz) + (rnd() - 0.5) * 0.5);
    // Radii along the edge, up, and across the edge.
    if (snow) sc.set(0.5 + rnd() * 0.9, 0.13 + rnd() * 0.14, 0.26 + rnd() * 0.26);
    else sc.set(0.3 + rnd() * 0.6, 0.09 + rnd() * 0.1, 0.2 + rnd() * 0.22);
    mat.compose(at, rot, sc);
    tinted(i, tint);
  });

  // Across the top of the block, between the slab and its edge, and slumping over that edge.
  const across = [-0.55, -1.0, -1.45].map((inset) => spots(o, inset));
  const rim = spots(o, d.edge + 0.12);
  b.scatter(blobGeo, m.lump!, Math.round((o.w + o.d) * 3.4), (i, mat, tint) => {
    const edgeLump = i % 3 === 0;
    const p = (edgeLump ? rim : across[Math.floor(rnd() * across.length)]!)(rnd);
    at.set(p.x, d.ledgeY + (edgeLump ? -0.02 : 0.02), p.z);
    rot.setFromAxisAngle(up, Math.atan2(p.nx, p.nz) + (rnd() - 0.5) * 0.6);
    if (snow) sc.set(0.5 + rnd() * 1.0, 0.1 + rnd() * 0.16, 0.25 + rnd() * 0.3);
    else sc.set(0.3 + rnd() * 0.7, 0.08 + rnd() * 0.12, 0.2 + rnd() * 0.25);
    mat.compose(at, rot, sc);
    tinted(i, tint);
  });

  // The ledges lower down collect it too.
  for (const tier of d.tiers) {
    const spot = spots(o, tier.inset);
    b.scatter(blobGeo, m.lump!, Math.round((o.w + o.d) * 1.8), (i, mat, tint) => {
      const p = spot(rnd);
      at.set(p.x, tier.y + 0.02, p.z);
      rot.setFromAxisAngle(up, Math.atan2(p.nx, p.nz) + (rnd() - 0.5) * 0.5);
      if (snow) sc.set(0.45 + rnd() * 0.9, 0.1 + rnd() * 0.12, 0.2 + rnd() * 0.16);
      else sc.set(0.3 + rnd() * 0.6, 0.08 + rnd() * 0.1, 0.15 + rnd() * 0.15);
      mat.compose(at, rot, sc);
      tinted(i, tint);
    });
  }

  if (!snow) {
    // Lichen: pale, crusty patches pasted onto the walls, each a loose cluster of small discs.
    const hues = ['#a3ad7c', '#b7b88b', '#8f9f86', '#c2b97f', '#a9aa92'].map((c) => new THREE.Color(c));
    const disc = new THREE.CircleGeometry(1, 10);
    const onWall = d.walls.map((w) => spots(o, w.inset));
    const PER = 5;
    const patch = { x: 0, y: 0, z: 0, nx: 0, nz: 0, hue: 0 };
    b.scatter(disc, m.lichen!, Math.round((o.w + o.d) * 2) * PER, (i, mat, tint) => {
      if (i % PER === 0) {
        const k = (i / PER) % d.walls.length;
        const w = d.walls[k]!;
        const p = onWall[k]!(rnd);
        Object.assign(patch, { x: p.x, z: p.z, nx: p.nx, nz: p.nz, y: w.top - (w.top - w.bottom) * (0.12 + rnd() * 0.76), hue: Math.floor(rnd() * hues.length) });
      }
      // Along the wall (tangent) and up, from the patch's middle.
      const along = (rnd() - 0.5) * 0.3;
      at.set(patch.x - patch.nz * along + patch.nx * 0.012, patch.y + (rnd() - 0.5) * 0.14, patch.z + patch.nx * along + patch.nz * 0.012);
      rot.setFromAxisAngle(up, Math.atan2(patch.nx, patch.nz));
      const r = 0.04 + rnd() * 0.09;
      sc.set(r * (0.8 + rnd() * 0.7), r * (0.6 + rnd() * 0.6), 1);
      mat.compose(at, rot, sc);
      tint.copy(hues[(patch.hue + (rnd() < 0.2 ? 1 : 0)) % hues.length]!).multiplyScalar(0.85 + rnd() * 0.3);
    });
    // Moss running down from the edge of the block in short tongues, pressed flat against the stone.
    const tongue = spots(o, d.edge + 0.03);
    b.scatter(blobGeo, m.lump!, Math.round((o.w + o.d) * 1.3), (i, mat, tint) => {
      const p = tongue(rnd);
      const h = 0.2 + rnd() * 0.5;
      at.set(p.x + p.nx * 0.005, d.ledgeY - 0.1 - h * 0.5, p.z + p.nz * 0.005);
      rot.setFromAxisAngle(up, Math.atan2(p.nx, p.nz));
      sc.set(0.1 + rnd() * 0.18, h * 0.5, 0.035 + rnd() * 0.03);
      mat.compose(at, rot, sc);
      tint.copy(palette[i % palette.length]!);
    });
  } else {
    // Icicles hang from the edge of the block's top; a glaze of ice coats the edge itself.
    b.add(loft(o, [{ inset: d.edge - 0.035, y: d.ledgeY - 0.05 }, { inset: d.edge - 0.035, y: d.ledgeY - 0.5 }]), m.ice!, false);
    const hang = spots(o, d.edge + 0.04);
    const cone = new THREE.ConeGeometry(1, 1, 6).rotateX(Math.PI).translate(0, -0.5, 0);
    b.scatter(cone, m.ice!, Math.round((o.w + o.d) * 2.2), (i, mat, tint) => {
      const p = hang(rnd);
      const len = 0.25 + Math.pow(rnd(), 1.8) * 1.3;
      at.set(p.x, d.ledgeY - 0.5, p.z);
      rot.identity();
      sc.set(0.07 + rnd() * 0.1, len, 0.07 + rnd() * 0.1);
      mat.compose(at, rot, sc);
      tint.set('#ffffff');
    });
  }
}

const altar: Kind = {
  mats: (c) => {
    const snow = c.spec.cover === 'snow';
    return {
      stone: masonry(c),
      lump: c.ts.register(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: snow ? 0.9 : 1, flatShading: false })),
      lichen: c.ts.register(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide })),
      ice: c.ts.register(new THREE.MeshStandardMaterial({ color: '#c4e6ff', roughness: 0.12, emissive: '#3a6a9a', emissiveIntensity: 0.3, flatShading: false }), 0.8),
      pool: poolMaterial(c, 0.6),
    };
  },
  build(b) {
    // The slab the cards lie on is only a thin slab: it rests on top of a great stone block that reaches well beyond
    // it, built of rough courses, each a little wider than the one above.
    const H = b.spec.height;
    const M = BLOCK;
    const ledgeY = -0.45;
    const c1 = -0.45 * H;
    const c2 = -0.78 * H;
    b.add(loft(b.o, [
      { inset: 0, y: -LIFT }, { inset: 0, y: ledgeY },                // the slab's edge
      { inset: -M, y: ledgeY },                                       // the block's top
      { inset: -M, y: -0.95 }, { inset: -M - 0.15, y: -1.1 },         // its edge
      { inset: -M - 0.15, y: c1 },                                    // a first course
      { inset: -M - 0.45, y: c1 }, { inset: -M - 0.45, y: c2 },       // a second, set out
      { inset: -M - 0.8, y: c2 }, { inset: -M - 0.8, y: -H - 0.8 },   // and a third, down into the ground
    ], true), b.m.stone!);
    dress(b, {
      ledgeY, edge: -M,
      tiers: [{ inset: -M - 0.3, y: c1 }, { inset: -M - 0.62, y: c2 }],
      walls: [
        { inset: -M, top: -0.5, bottom: -0.95 }, { inset: -M - 0.15, top: -1.1, bottom: c1 },
        { inset: -M - 0.45, top: c1, bottom: c2 }, { inset: -M - 0.8, top: c2, bottom: -H },
      ],
    });
    pool(b, M + 0.8, 4.5);
  },
};

const vault: Kind = {
  mats: (c) => ({ stone: masonry(c), pool: poolMaterial(c, 0.7) }),
  build(b) {
    // A mausoleum: the playing surface is its roof slab, over a heavy cornice, pilastered walls and a stepped base.
    const H = b.spec.height;
    const { o } = b;
    const wallTop = -1.25;
    const wallBottom = -(H - 0.9);
    b.add(loft(o, [
      { inset: 0, y: -LIFT }, { inset: 0, y: -0.5 },                  // the roof slab's edge
      { inset: -0.9, y: -0.5 },                                       // the top of the cornice
      { inset: -0.9, y: -0.85 }, { inset: -0.6, y: -1.05 }, { inset: -0.6, y: wallTop },
      { inset: -0.2, y: wallTop },                                    // under it
      { inset: -0.2, y: wallBottom },                                 // the wall
      { inset: -0.75, y: wallBottom }, { inset: -0.75, y: -(H - 0.4) },    // the base, in two steps
      { inset: -1.3, y: -(H - 0.4) }, { inset: -1.3, y: -H - 0.8 },
    ], true), b.m.stone!);

    // Pilasters up the walls: four to a long side, two to a short side, one at each corner.
    const wallH = wallTop - wallBottom;
    const spots2: { x: number; z: number; nx: number; nz: number }[] = [];
    const flat = o.w / 2 - TABLE_CORNER - 0.6;
    for (const x of [-flat, -2.1, 2.1, flat]) {
      spots2.push({ x, z: o.cz - o.d / 2 + 0.2, nx: 0, nz: -1 }, { x, z: o.cz + o.d / 2 - 0.2, nx: 0, nz: 1 });
    }
    for (const dz of [-2.2, 2.2]) {
      spots2.push({ x: -o.w / 2 + 0.2, z: o.cz + dz, nx: -1, nz: 0 }, { x: o.w / 2 - 0.2, z: o.cz + dz, nx: 1, nz: 0 });
    }
    const arcs = ring(o, -0.2, 6);
    for (let k = 0; k < 4; k++) {
      const p = arcs[k * 7 + 3]!;
      spots2.push({ x: p.x, z: p.z, nx: p.nx, nz: p.nz });
    }
    for (const p of spots2) {
      const yaw = Math.atan2(p.nx, p.nz);
      const cx = p.x + p.nx * 0.3;
      const cz = p.z + p.nz * 0.3;
      const post = b.add(worldBox(1.1, wallH, 0.6), b.m.stone!);
      post.position.set(cx, (wallTop + wallBottom) / 2, cz);
      post.rotation.y = yaw;
      for (const [y, h, w, dd] of [[wallTop - 0.14, 0.28, 1.4, 0.85], [wallBottom + 0.16, 0.32, 1.4, 0.85]] as const) {
        const cap = b.add(worldBox(w, h, dd), b.m.stone!);
        cap.position.set(p.x + p.nx * 0.38, y, p.z + p.nz * 0.38);
        cap.rotation.y = yaw;
      }
    }
    pool(b, 1.3, 4.2);
  },
};

// -- Anvil ------------------------------------------------------------------------------

const anvil: Kind = {
  mats: (c) => {
    // A faint warm glow on the steel: the lava below lights it from underneath.
    const glow = (m: Std): Std => { m.emissive.set('#26100a'); return m; };
    return {
      steel: glow(textured(c, { ...c.top, tile: 5 })),
      horn: glow(plain(c, '#555963', { metalness: 0.25, roughness: 0.42 })),
      dark: plain(c, '#0e0d0e', { roughness: 0.9 }),
    };
  },
  build(b) {
    const H = b.spec.height;
    const { o } = b;
    b.add(loft(o, [
      { inset: 0, y: -LIFT }, { inset: 0, y: -0.75 },               // the face's plate
      { inset: 0.25, y: -1.0 }, { inset: 1.6, y: -1.55 }, { inset: 2.6, y: -2.1 },   // sweeping in under it
      { inset: 3.2, y: -2.9 }, { inset: 3.3, y: -3.5 },             // the waist
      { inset: 2.8, y: -4.1 }, { inset: 1.8, y: -4.6 },             // and out again
      { inset: 1.2, y: -H }, { inset: 1.2, y: -H - 1.2 },           // to the foot, which sits down in the rock
    ], true, 8), b.m.steel!);

    // The horn: a long cone, flush with the face where it leaves it, tapering to a point.
    const R = Math.min(2.6, o.d * 0.2);
    const L = 11;
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      prof.push(new THREE.Vector2(R * Math.pow(1 - t, 1.3) + 0.12, t * L));
    }
    const horn = b.add(new THREE.LatheGeometry(prof, 28), b.m.horn!);
    horn.rotation.z = -Math.PI / 2;
    horn.position.set(o.w / 2 - 1.4, -R - LIFT, o.cz);

    // The heel: a stepped block at the other end, with the square hardy hole in it.
    const hw = 3.1;
    const hd = Math.min(7.5, o.d * 0.6);
    const heel = beam(b, hw, H - 0.9 + 1, hd, -o.w / 2 - hw / 2 + 0.7, -0.9 - (H - 0.9 + 1) / 2, o.cz, b.m.steel!);
    heel.receiveShadow = true;
    const hole = beam(b, 0.9, 0.04, 0.9, -o.w / 2 - hw / 2 + 0.7, -0.88, o.cz, b.m.dark!);
    hole.castShadow = false;
  },
};

// -- Decks ------------------------------------------------------------------------------

function deck(sky: boolean): Kind {
  return {
    mats: (c) => ({
      hull: sky
        ? textured(c, { ...c.top, kind: 'planks', a: '#cfc3a8', b: '#e9dfc8', tile: 4, rough: 0.7, opts: { rows: 5 } })
        : boards(c, 5, 0.4),
      wale: sky ? plain(c, '#c9a24a', { metalness: 0.4, roughness: 0.4 }) : plain(c, '#241c15', { roughness: 0.85 }),
      stripe: plain(c, '#2f5f9a', { roughness: 0.7 }),
    }),
    build(b) {
      // The hull swells out under the deck, then curves in toward the keel (the keel is under the water, or the cloud).
      const belly = sky ? 1.5 : 1.35;
      b.add(loft(b.o, [
        { inset: 0, y: -LIFT }, { inset: 0, y: -0.5 },              // the covering board
        { inset: -0.1, y: -0.95 }, { inset: -0.13, y: -belly },
        { inset: 0.3, y: -(belly + 0.6) }, { inset: 1, y: -(belly + 1.4) },
        { inset: 2.2, y: -(belly + 2.3) }, { inset: 3.2, y: -(belly + 3.3) },
      ], true), b.m.hull!);
      b.add(loft(b.o, [{ inset: -0.17, y: -0.5 }, { inset: -0.17, y: -0.85 }]), b.m.wale!);
      if (sky) b.add(loft(b.o, [{ inset: -0.15, y: -1.15 }, { inset: -0.15, y: -1.45 }]), b.m.stripe!);
    },
  };
}

const KINDS: Record<Exclude<TableKind, 'plain'>, Kind> = {
  tavern, hall, study, altar, vault, anvil, ship: deck(false), skyship: deck(true),
};

/**
 * Build the body of the table for `ts`: it is laid out (and rebuilt) whenever the table's size changes.
 * `top` is the playing surface's own look, so the body matches what it is the top of.
 */
export function buildTable(ts: ThemeScene, spec: TableSpec, top: SurfaceSpec, aniso: number): void {
  if (spec.kind === 'plain') return;
  const kind = KINDS[spec.kind];
  const m = kind.mats({ ts, spec, top, aniso });
  const group = new THREE.Group();
  ts.group.add(group);
  const seed = 1000 + Object.keys(KINDS).indexOf(spec.kind) * 77 + Math.round(spec.height * 10);

  ts.onLayout((w, d, cz) => {
    for (const c of [...group.children]) {
      group.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
      (c as THREE.InstancedMesh).dispose?.();
    }
    const b: Build = {
      o: { w, d, cz, r: TABLE_CORNER },
      spec, m, rnd: rng(seed),
      add(geo, mat, shadow = true) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
      },
      scatter(geo, mat, count, place, shadow = false) {
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        const at = new THREE.Matrix4();
        const tint = new THREE.Color();
        for (let i = 0; i < count; i++) {
          place(i, at, tint);
          mesh.setMatrixAt(i, at);
          mesh.setColorAt(i, tint);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        group.add(mesh);
      },
    };
    kind.build(b);
  });
}
