// A swamp: open black water dotted with hammocks (low islands of peat and sedge), and the tall marsh grass that grows round them.
//
// The hammocks are drawn once, on the CPU, into a small height map: 0 is open water, 1 the middle of an island. The bog ground
// (ground.ts) reads that map to raise the islands and colour them; the grass reads the same map to stand on the shores. Both
// see the same ground because there is only one map.

import * as THREE from 'three';

/** How many world units the map covers across, centred on the table. Past that the ground is open water, which is all the fog leaves visible anyway. */
export const MARSH_SPAN = 170;
const RES = 512;

/** Where the water lies, and how far an island's middle stands above the table's ground. Shared with the ground shader. */
export const WATER_Y = -0.4;
export const HILL_RISE = 0.75;
/** Heights at which the ground turns from water to wet bank to dry island (the shader and the grass both use them). */
export const BANK = [0.15, 0.85] as const;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How high the ground stands (relative to the table's ground) where the map reads `h`. */
export const terrainY = (h: number): number => WATER_Y + HILL_RISE * smooth(BANK[0], BANK[1], h);

function rngOf(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in 0..1, the same every run. */
function vnoise(x: number, y: number, seed: number): number {
  const lat = (i: number, j: number): number => {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = lat(x0, y0) + (lat(x0 + 1, y0) - lat(x0, y0)) * u;
  const b = lat(x0, y0 + 1) + (lat(x0 + 1, y0 + 1) - lat(x0, y0 + 1)) * u;
  return a + (b - a) * v;
}

interface Hammock { x: number; z: number; rx: number; rz: number; rot: number; seed: number }

function layout(rnd: () => number): Hammock[] {
  // The first is the broad rise the table stands on; the rest are scattered, with gaps of open water between them.
  const out: Hammock[] = [{ x: 0, z: 0, rx: 19, rz: 13.5, rot: 0.2, seed: 1 }];
  const cell = 11;
  for (let gx = -77; gx < 77; gx += cell) {
    for (let gz = -77; gz < 77; gz += cell) {
      const x = gx + cell / 2 + (rnd() - 0.5) * cell * 0.7;
      const z = gz + cell / 2 + (rnd() - 0.5) * cell * 0.7;
      if (Math.hypot(x / 1.35, z) < 21 || rnd() < 0.3) continue;
      const r = rnd() < 0.22 ? 5.5 + rnd() * 4.5 : 2.4 + rnd() * 3;
      out.push({ x, z, rx: r * (0.85 + rnd() * 0.6), rz: r * (0.6 + rnd() * 0.5), rot: rnd() * Math.PI, seed: out.length + 1 });
    }
  }
  return out;
}

export interface MarshMap {
  texture: THREE.DataTexture;
  /** The island height (0 water .. 1 island) at a point, in world units from the table's middle. */
  at(x: number, z: number): number;
}

let cached: MarshMap | null = null;

/** The one map of hammocks. Built the first time a swamp is shown. */
export function marshMap(): MarshMap {
  if (cached) return cached;
  const rnd = rngOf(0x5a3f1e);
  const field = new Float32Array(RES * RES);
  const px = MARSH_SPAN / RES;
  for (const h of layout(rnd)) {
    const reach = Math.max(h.rx, h.rz) * 1.5;
    const c = Math.cos(h.rot);
    const s = Math.sin(h.rot);
    const i0 = Math.max(0, Math.floor((h.x - reach) / px + RES / 2));
    const i1 = Math.min(RES - 1, Math.ceil((h.x + reach) / px + RES / 2));
    const j0 = Math.max(0, Math.floor((h.z - reach) / px + RES / 2));
    const j1 = Math.min(RES - 1, Math.ceil((h.z + reach) / px + RES / 2));
    for (let j = j0; j <= j1; j++) {
      const z = (j - RES / 2) * px;
      for (let i = i0; i <= i1; i++) {
        const x = (i - RES / 2) * px;
        const dx = x - h.x;
        const dz = z - h.z;
        const lx = (dx * c + dz * s) / h.rx;
        const lz = (-dx * s + dz * c) / h.rz;
        // A ragged shore: the edge wanders in and out by a third of the island's size.
        const wob = vnoise(x * 0.16, z * 0.16, h.seed) * 0.7 + vnoise(x * 0.5, z * 0.5, h.seed + 50) * 0.3;
        const d = Math.hypot(lx, lz) * (0.72 + wob * 0.56);
        const v = 1 - smooth(0.45, 1, d);
        if (v <= 0) continue;
        const k = j * RES + i;
        field[k] = 1 - (1 - field[k]!) * (1 - v);
      }
    }
  }
  const bytes = new Uint8Array(RES * RES);
  for (let k = 0; k < bytes.length; k++) bytes[k] = Math.round(Math.min(1, field[k]!) * 255);
  const texture = new THREE.DataTexture(bytes, RES, RES, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const at = (x: number, z: number): number => {
    const u = x / px + RES / 2 - 0.5;
    const v = z / px + RES / 2 - 0.5;
    const i = Math.floor(u);
    const j = Math.floor(v);
    if (i < 0 || j < 0 || i >= RES - 1 || j >= RES - 1) return 0;
    const fu = u - i;
    const fv = v - j;
    const g = (a: number, b: number): number => bytes[b * RES + a]! / 255;
    return (g(i, j) * (1 - fu) + g(i + 1, j) * fu) * (1 - fv) + (g(i, j + 1) * (1 - fu) + g(i + 1, j + 1) * fu) * fv;
  };
  return (cached = { texture, at });
}
