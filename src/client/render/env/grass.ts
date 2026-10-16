// Tall grass that sways in the wind: the marsh reeds of Gorewatch, the meadow grass of a green field, the wild grass of a wood.
//
// Clumps of blades (and, where a place has them, bulrushes) stand in a ring round the table, thin and low near it, thick and tall
// far out, where the ground fades into the fog and meets the painted sky: the tall far belt hides the line between them. It is one
// mesh, so it costs one draw call. The blades sway in a wind that gusts, and the fireflies of a place gather over them
// (see ThemeScene.spots).

import * as THREE from 'three';
import { marshMap, terrainY } from './marsh';
import type { ThemeScene } from './props';

/** How much of its own colour the farthest grass keeps: the fog takes this share of it at most. */
const FOG_CAP = 0.7;

export interface GrassSpec {
  /** The foot of a blade, and its tip when green. */
  foot: string;
  tip: string;
  /** The straw colour a clump may fade to. */
  straw: string;
  /** The seed heads of bulrushes, which stand above the grass; leave them out for grass alone. */
  head?: string;
  /** How many clumps to plant (about a dozen blades each). */
  clumps: number;
  /** Grows only along the banks of the swamp's hammocks (see marsh.ts) instead of all over the ground. */
  swamp?: boolean;
  /** How tall it grows, as a multiple of the Gorewatch reeds (1). */
  tall?: number;
  /** How near the table it starts and how far it runs, in world units from the table's middle (15 and 66). */
  reach?: [number, number];
  /** The share of the clumps that are dry straw (0.3). */
  dry?: number;
  /** The chance that a clump has a bulrush (0.3; only where there is a head). */
  rushes?: number;
}

interface Buf { pos: number[]; nor: number[]; col: number[]; sway: number[]; idx: number[] }

interface Blade {
  x: number; y: number; z: number;
  height: number;
  /** The way the ribbon faces, and the way the stalk leans (radians about the vertical), and how far its tip is off the vertical. */
  face: number; leanDir: number; lean: number;
  width: number;
  foot: THREE.Color; tip: THREE.Color;
  /** How many quads the ribbon is cut into (a far blade is too small to show a curve). */
  segs: number;
  /** A bulrush: a thin stalk with a thick brown head near the top. */
  head?: THREE.Color;
}

const REED_SEGMENTS = 9;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Add one ribbon-shaped stalk to the buffers: a strip of quads that narrows to a point (or, for a bulrush, swells into a seed head). */
function pushBlade(b: Buf, bl: Blade): void {
  const segs = bl.head ? REED_SEGMENTS : bl.segs;
  const fx = Math.cos(bl.face);
  const fz = -Math.sin(bl.face);
  const nx = Math.sin(bl.face) * 0.6;
  const nz = Math.cos(bl.face) * 0.6;
  const first = b.pos.length / 3;
  const c = new THREE.Color();
  for (let j = 0; j <= segs; j++) {
    const t = j / segs;
    const bend = bl.lean * t * t;
    const cx = bl.x + Math.sin(bl.leanDir) * bend;
    const cz = bl.z + Math.cos(bl.leanDir) * bend;
    const cy = bl.y + bl.height * t;
    let w: number;
    if (bl.head) {
      const inHead = t > 0.8 && t < 0.95;
      w = inHead ? bl.width * 3.2 * Math.sin(((t - 0.8) / 0.15) * Math.PI) ** 0.5 : bl.width * (t >= 0.95 ? 0.1 : 1);
      c.copy(inHead ? bl.head : bl.foot).lerp(bl.tip, inHead ? 0 : t * 0.7);
    } else {
      w = bl.width * (1 - t) ** 0.85;
      c.copy(bl.foot).lerp(bl.tip, t ** 1.1);
    }
    const hw = Math.max(w, 0.006) / 2;
    for (const side of [-1, 1]) {
      b.pos.push(cx + fx * hw * side, cy, cz + fz * hw * side);
      b.nor.push(nx, 0.8, nz);
      b.col.push(c.r, c.g, c.b);
      b.sway.push(t * bl.height);
    }
  }
  for (let j = 0; j < segs; j++) {
    const a = first + j * 2;
    b.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

/** Plant the grass of a place (see the top of this file). */
export function addGrass(ts: ThemeScene, spec: GrassSpec, coarse: boolean): void {
  const map = spec.swamp ? marshMap() : null;
  const foot = new THREE.Color(spec.foot);
  const tip = new THREE.Color(spec.tip);
  const straw = new THREE.Color(spec.straw);
  const head = spec.head ? new THREE.Color(spec.head) : null;
  const b: Buf = { pos: [], nor: [], col: [], sway: [], idx: [] };
  const want = Math.round(spec.clumps * (coarse ? 0.55 : 1));
  const [R0, R1] = spec.reach ?? [15, 66];
  const height = spec.tall ?? 1;
  const dryShare = spec.dry ?? 0.3;
  const rushes = head ? spec.rushes ?? 0.3 : 0;
  let placed = 0;
  for (let tries = 0; placed < want && tries < want * 40; tries++) {
    const r = Math.sqrt(R0 * R0 + (R1 * R1 - R0 * R0) * ts.rnd());
    const a = ts.rnd() * Math.PI * 2;
    const x = Math.cos(a) * r * 1.25;
    const z = Math.sin(a) * r * 0.9;
    // Clear of the table and the cameras: nothing near the table, and nothing in front of it, where the camera stands.
    if (z > 6 || Math.hypot(Math.max(Math.abs(x) - 13, 0), Math.max(Math.abs(z) - 9, 0)) < Math.min(5, R0 - 10)) continue;
    const far = smooth(16, 50, Math.hypot(x, z));
    const hill = map ? map.at(x, z) : 1;
    // In a swamp: thick on the banks, thin on the dry islands and in the shallows (the far belt grows from the water too).
    if (map) {
      const odds = hill > 0.6 ? 0.3 : hill > 0.18 ? 1 : 0.1 + 0.8 * far * far;
      if (ts.rnd() > odds) continue;
    }
    placed++;
    const base = ts.ground + (map ? terrainY(hill) : 0) - 0.06;
    const tall = (1.5 + 3.8 * far) * height * (0.85 + ts.rnd() * 0.4);
    ts.spots.push({ x, y: base, z, h: tall });
    const dry = ts.rnd() < dryShare ? 0.35 + ts.rnd() * 0.5 : 0;
    const f = foot.clone().lerp(straw, dry * 0.4);
    const t = tip.clone().lerp(straw, dry);
    // A far clump is only a silhouette: fewer, plainer blades.
    const belt = far > 0.6;
    const segs = belt ? 3 : 5;
    const n = belt ? 6 + Math.floor(ts.rnd() * 4) : 8 + Math.floor(ts.rnd() * 8);
    for (let i = 0; i < n; i++) {
      const ang = ts.rnd() * Math.PI * 2;
      const rad = Math.sqrt(ts.rnd()) * 0.55;
      const shade = 0.8 + ts.rnd() * 0.4;
      const h = tall * (0.55 + ts.rnd() * 0.6);
      pushBlade(b, {
        x: x + Math.cos(ang) * rad, y: base, z: z + Math.sin(ang) * rad, height: h,
        face: ts.rnd() * Math.PI, leanDir: ang + (ts.rnd() - 0.5) * 1.2, lean: h * (0.12 + ts.rnd() * 0.42),
        width: (0.1 + ts.rnd() * 0.08) * (belt ? 2.6 : 1 + far), segs, foot: f.clone().multiplyScalar(shade), tip: t.clone().multiplyScalar(shade),
      });
    }
    // A bulrush or two stands well above the grass.
    if (head && ts.rnd() < rushes) {
      for (let i = 0, m = 1 + Math.floor(ts.rnd() * 2); i < m; i++) {
        const h = tall * (1.1 + ts.rnd() * 0.4);
        pushBlade(b, {
          x: x + (ts.rnd() - 0.5) * 0.8, y: base, z: z + (ts.rnd() - 0.5) * 0.8, height: h,
          face: ts.rnd() * Math.PI, leanDir: ts.rnd() * Math.PI * 2, lean: h * (0.04 + ts.rnd() * 0.12),
          width: 0.05 * (belt ? 2.2 : 1 + far * 0.5), segs, foot: f.clone().multiplyScalar(0.9), tip: t.clone().multiplyScalar(0.85), head,
        });
      }
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  geom.setAttribute('aSway', new THREE.Float32BufferAttribute(b.sway, 1));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(b.idx), 1));
  const time = { value: 0 };
  const mat = ts.register(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  // The blades fade with the place but are solid when it is shown: one pass over both faces, not a back pass and a front pass.
  mat.forceSinglePass = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    // The fog never takes the whole of a stalk, so the far grass stays a dark silhouette against the ground's own fog colour.
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
      #ifdef USE_FOG
        gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, smoothstep( fogNear, fogFar, vFogDepth ) * ${FOG_CAP.toFixed(2)} );
      #endif`);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aSway;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // The tips swing most. Each clump keeps its own time off the wind, and a slow gust sweeps across them all.
        vec3 mw = (modelMatrix * vec4(transformed, 1.0)).xyz;
        float sw = aSway * aSway * 0.035;
        float ph = uTime * 1.5 + mw.x * 0.23 + mw.z * 0.19;
        float gust = 0.6 + 0.6 * sin(uTime * 0.4 + mw.x * 0.06 - mw.z * 0.04);
        transformed.x += (sin(ph) + 0.35 * sin(ph * 2.7 + 1.3)) * sw * gust + sw * 0.5;
        transformed.z += (cos(ph * 0.8 + 0.7) * 0.5 + 0.2 * sin(ph * 3.1)) * sw * gust;`);
  };
  mat.customProgramCacheKey = () => 'sway-grass';
  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  ts.group.add(mesh);
  ts.onTick((t) => { time.value = t; });
  // The grass is measured from the table's middle, which may stand a little off the middle of the scene.
  ts.onLayout((_w, _d, cz) => { mesh.position.z = cz; });
}
