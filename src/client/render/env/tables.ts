// The thing the playing surface is the top of: a tavern table, a ship's deck, a stone altar, a vault, an anvil.
// Every body is built under the table's outline, so it follows the table when the screen changes shape. Most
// of them are "lofts": a side profile (how far in, how far down) swept around the outline.

import * as THREE from 'three';
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
type Mats = Record<string, Std>;

interface MatCtx { ts: ThemeScene; spec: TableSpec; top: SurfaceSpec; aniso: number }

interface Build {
  o: Outline;
  spec: TableSpec;
  m: Mats;
  rnd: () => number;
  /** Add a mesh to what this layout builds. Casts shadows unless told not to. */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, shadow?: boolean): THREE.Mesh;
  /** Add instances of `geo`: `place(i, matrix, colour)` positions each one. */
  scatter(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, place: (i: number, at: THREE.Matrix4, tint: THREE.Color) => void): void;
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

/** A beam, `w` x `h` x `d`, centred on (x, y, z). */
function beam(b: Build, w: number, h: number, d: number, x: number, y: number, z: number, mat: Std): THREE.Mesh {
  const mesh = b.add(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Four legs at the corners, `size` thick, pulled in `inset` from the table's edge. */
function legs(b: Build, size: number, inset: number, top: number, bottom: number, mat: Std): [number, number][] {
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
function rails(b: Build, size: number, inset: number, y: number, h: number, t: number, mat: Std): void {
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

// -- Wooden tables --------------------------------------------------------------------

const tavern: Kind = {
  mats: (c) => ({ side: boards(c, 2, 0.1), leg: boards(c, 2, 0.15, true) }),
  build(b) {
    const H = b.spec.height;
    const T = 0.62;
    b.add(loft(b.o, [{ inset: 0, y: -LIFT }, { inset: 0, y: -T }], true), b.m.side!);
    legs(b, 1.05, 1.5, -T, -H - 0.2, b.m.leg!);
    rails(b, 1.05, 1.5, -(H - 1), 0.42, 0.42, b.m.leg!);
  },
};

const hall: Kind = {
  mats: (c) => ({ side: boards(c, 2, 0.1), leg: boards(c, 2, 0.15, true), iron: plain(c, '#26262b', { metalness: 0.5, roughness: 0.5 }) }),
  build(b) {
    const H = b.spec.height;
    const T = 0.85;
    b.add(loft(b.o, [{ inset: 0, y: -LIFT }, { inset: 0, y: -T }], true), b.m.side!);
    // An iron band round the edge of the top.
    b.add(loft(b.o, [{ inset: -0.04, y: -0.04 }, { inset: -0.04, y: -0.3 }]), b.m.iron!);
    b.add(loft(b.o, [{ inset: 1.1, y: -T + 0.01 }, { inset: 1.1, y: -T - 0.85 }], true), b.m.side!);
    const size = 1.5;
    for (const [x, z] of legs(b, size, 1.1, -T, -H - 0.2, b.m.leg!)) {
      for (const y of [-T - 1.3, -(H - 0.9)]) beam(b, size + 0.16, 0.22, size + 0.16, x, y, z, b.m.iron!);
    }
    rails(b, size, 1.1, -(H - 1.6), 0.5, 0.5, b.m.leg!);
  },
};

/** A turned leg: a lathe profile, `len` tall, standing on y = `bottom`. */
function turnedLeg(len: number): THREE.BufferGeometry {
  const prof: [number, number][] = [[0.52, 0], [0.58, 0.03], [0.44, 0.16], [0.5, 0.26], [0.34, 0.36], [0.36, 0.5], [0.66, 0.6], [0.46, 0.7], [0.5, 0.82], [0.62, 0.94], [0.62, 1]];
  const g = new THREE.LatheGeometry(prof.map(([r, f]) => new THREE.Vector2(r, f * len)), 16);
  return g;
}

const study: Kind = {
  mats: (c) => ({
    side: boards(c, 3, 0.05), leg: boards(c, 2, 0.1, true),
    brass: plain(c, '#b58f3e', { metalness: 0.5, roughness: 0.32 }),
  }),
  build(b) {
    const H = b.spec.height;
    const T = 0.5;
    const A = 0.75;
    b.add(loft(b.o, [{ inset: 0, y: -LIFT }, { inset: 0, y: -T }], true), b.m.side!);
    b.add(loft(b.o, [{ inset: -0.03, y: -0.1 }, { inset: -0.03, y: -0.26 }]), b.m.brass!);
    b.add(loft(b.o, [{ inset: 0.9, y: -T + 0.01 }, { inset: 0.9, y: -T - A }], true), b.m.side!);
    const len = H - T - A + 0.2;
    const x = b.o.w / 2 - 1.05;
    const z = b.o.d / 2 - 1.05;
    for (const [sx, sz] of CORNERS) {
      const leg = b.add(turnedLeg(len), b.m.leg!);
      leg.position.set(sx * x, -H - 0.2, b.o.cz + sz * z);
      const foot = b.add(new THREE.CylinderGeometry(0.56, 0.6, 0.2, 14), b.m.brass!);
      foot.position.set(sx * x, -H + 0.1, b.o.cz + sz * z);
    }
    rails(b, 1.2, 0.9, -(H - 1.2), 0.3, 0.3, b.m.leg!);
  },
};

// -- Stone ------------------------------------------------------------------------------

/** What settles on a stone's edges: lumps of moss or drifts of snow, lichen on the walls, icicles and a glaze of ice. */
function dress(b: Build, tiers: { inset: number; y: number }[], walls: { inset: number; top: number; bottom: number }[]): void {
  const cover = b.spec.cover;
  if (!cover) return;
  const { o, rnd } = b;
  const blobGeo = new THREE.SphereGeometry(1, 12, 8);
  const m = b.m;

  // Lumps along the lip of the top: they hug the raised lip, a few slumping over the edge.
  const snow = cover === 'snow';
  const edge = spots(o, 0);
  const count = Math.round((o.w + o.d) * (snow ? 5 : 5.5));
  const palette = (snow ? ['#ffffff', '#f2f7ff', '#e4eefb'] : ['#264a1f', '#2f5726', '#386330', '#43713a', '#1f3f1a']).map((c) => new THREE.Color(c));
  const at = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tinted = (i: number, tint: THREE.Color): void => {
    tint.copy(palette[i % palette.length]!).lerp(palette[Math.floor(rnd() * palette.length)]!, 0.5);
  };
  b.scatter(blobGeo, m.lump!, count, (i, mat, tint) => {
    const p = edge(rnd);
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

  // Ledges lower down collect it too.
  for (const tier of tiers) {
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

  if (cover === 'moss') {
    // Lichen: pale, crusty patches pasted onto the walls, each a loose cluster of small discs.
    const hues = ['#a3ad7c', '#b7b88b', '#8f9f86', '#c2b97f', '#a9aa92'].map((c) => new THREE.Color(c));
    const disc = new THREE.CircleGeometry(1, 10);
    const onWall = walls.map((w) => spots(o, w.inset));
    const PER = 5;
    const patch = { x: 0, y: 0, z: 0, nx: 0, nz: 0, hue: 0 };
    b.scatter(disc, m.lichen!, Math.round((o.w + o.d) * 1.5) * PER, (i, mat, tint) => {
      if (i % PER === 0) {
        const k = (i / PER) % walls.length;
        const w = walls[k]!;
        const p = onWall[k]!(rnd);
        Object.assign(patch, { x: p.x, z: p.z, nx: p.nx, nz: p.nz, y: w.top - (w.top - w.bottom) * (0.12 + rnd() * 0.76), hue: Math.floor(rnd() * hues.length) });
      }
      // Along the wall (tangent) and up, from the patch's middle.
      const along = (rnd() - 0.5) * 0.3;
      at.set(patch.x - patch.nz * along + patch.nx * 0.012, patch.y + (rnd() - 0.5) * 0.14, patch.z + patch.nx * along + patch.nz * 0.012);
      rot.setFromAxisAngle(up, Math.atan2(patch.nx, patch.nz));
      const r = 0.035 + rnd() * 0.08;
      sc.set(r * (0.8 + rnd() * 0.7), r * (0.6 + rnd() * 0.6), 1);
      mat.compose(at, rot, sc);
      tint.copy(hues[(patch.hue + (rnd() < 0.2 ? 1 : 0)) % hues.length]!).multiplyScalar(0.85 + rnd() * 0.3);
    });
    // Moss running down the walls in short tongues, pressed flat against the stone.
    const tongue = spots(o, 0.03);
    b.scatter(blobGeo, m.lump!, Math.round((o.w + o.d) * 1.1), (i, mat, tint) => {
      const p = tongue(rnd);
      const h = 0.2 + rnd() * 0.45;
      at.set(p.x + p.nx * 0.005, -0.12 - h * 0.5, p.z + p.nz * 0.005);
      rot.setFromAxisAngle(up, Math.atan2(p.nx, p.nz));
      sc.set(0.1 + rnd() * 0.18, h * 0.5, 0.035 + rnd() * 0.03);
      mat.compose(at, rot, sc);
      tint.copy(palette[i % palette.length]!);
    });
  } else {
    // Icicles hang from the underside of the slab; a glaze of ice coats its edge.
    b.add(loft(o, [{ inset: -0.035, y: -0.1 }, { inset: -0.035, y: -0.52 }]), m.ice!, false);
    const hang = spots(o, 0.04);
    const cone = new THREE.ConeGeometry(1, 1, 6).rotateX(Math.PI).translate(0, -0.5, 0);
    b.scatter(cone, m.ice!, Math.round((o.w + o.d) * 2.2), (i, mat, tint) => {
      const p = hang(rnd);
      const len = 0.25 + Math.pow(rnd(), 1.8) * 1.3;
      at.set(p.x, -0.66, p.z);
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
    };
  },
  build(b) {
    const H = b.spec.height;
    const levels: Level[] = [
      { inset: 0, y: -LIFT }, { inset: 0, y: -0.55 },              // the slab's edge
      { inset: 0.12, y: -0.7 }, { inset: 0.7, y: -1.1 },            // a cove under it
      { inset: 0.7, y: -(H - 1.3) },                                // the shaft
      { inset: 0.25, y: -(H - 1.3) }, { inset: 0.25, y: -(H - 0.6) },    // a first step
      { inset: -0.45, y: -(H - 0.6) }, { inset: -0.45, y: -H - 0.8 },    // a second, down into the ground
    ];
    b.add(loft(b.o, levels, true), b.m.stone!);
    dress(b,
      [{ inset: 0.48, y: -(H - 1.3) }, { inset: -0.1, y: -(H - 0.6) }],
      [{ inset: 0, top: -0.05, bottom: -0.5 }, { inset: 0.7, top: -1.15, bottom: -(H - 1.35) }, { inset: 0.25, top: -(H - 1.3), bottom: -(H - 0.65) }, { inset: -0.45, top: -(H - 0.6), bottom: -H }]);
  },
};

const vault: Kind = {
  mats: (c) => ({ stone: masonry(c) }),
  build(b) {
    const H = b.spec.height;
    b.add(loft(b.o, [
      { inset: 0, y: -LIFT }, { inset: 0, y: -0.6 },                // the lid's edge
      { inset: 0.1, y: -0.72 }, { inset: 0.38, y: -0.72 },
      { inset: 0.38, y: -1.15 },                                    // the box
      { inset: 0.2, y: -1.15 }, { inset: 0.2, y: -1.4 }, { inset: 0.38, y: -1.4 },   // a moulding round it
      { inset: 0.38, y: -(H - 0.7) },
      { inset: -0.2, y: -(H - 0.7) }, { inset: -0.2, y: -H - 0.8 },    // a plinth
    ], true), b.m.stone!);
  },
};

// -- Anvil ------------------------------------------------------------------------------

const anvil: Kind = {
  mats: (c) => ({
    steel: textured(c, { ...c.top, tile: 5 }),
    horn: plain(c, '#555963', { metalness: 0.25, roughness: 0.42 }),
    dark: plain(c, '#0e0d0e', { roughness: 0.9 }),
  }),
  build(b) {
    const H = b.spec.height;
    const { o } = b;
    b.add(loft(o, [
      { inset: 0, y: -LIFT }, { inset: 0, y: -0.75 },               // the face's plate
      { inset: 0.25, y: -1.0 }, { inset: 1.6, y: -1.55 }, { inset: 2.6, y: -2.1 },   // sweeping in under it
      { inset: 3.2, y: -2.9 }, { inset: 3.3, y: -3.5 },             // the waist
      { inset: 2.8, y: -4.1 }, { inset: 1.8, y: -4.6 },             // and out again
      { inset: 1.2, y: -H }, { inset: 1.2, y: -H - 0.8 },           // to the foot
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
    const heel = beam(b, hw, H - 0.9, hd, -o.w / 2 - hw / 2 + 0.7, -0.9 - (H - 0.9) / 2, o.cz, b.m.steel!);
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
      scatter(geo, mat, count, place) {
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
        mesh.receiveShadow = true;
        group.add(mesh);
      },
    };
    kind.build(b);
  });
}
