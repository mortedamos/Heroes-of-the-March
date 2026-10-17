// The rest of the tavern: other tables and chairs standing in the distance, between the painted room and the game table, each
// with a few mugs and a lantern on it. The lanterns flicker (a glow that wavers, in time with nothing else).
//
// Everything of one sort is one instanced mesh (all the tables, all the chairs, all the tankards, and so on), so a whole room of
// furniture costs a few draw calls. The lanterns' light is a soft glow, not a real light: a real light more would make every material in the scene
// compile again each time the place changes.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { dotTexture, mixHex } from './surfaces';
import { chairGeometry } from './tables';
import type { ThemeScene } from './props';

export interface TavernwareSpec {
  /** How many tables stand about in the distance. */
  tables: number;
  /** The colour of their wood. */
  wood: string;
  /** The colour of the lantern light (a warm gold). */
  lantern?: string;
}

const TOP_W = 8.4;
const TOP_D = 4.8;
const TOP_Y = 4.1;
const SEAT_H = 2.05;

/** A table: a thick top on four legs, standing on y = 0, its top at TOP_Y. */
function tableGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(TOP_W, 0.42, TOP_D).translate(0, TOP_Y - 0.21, 0)];
  const lx = TOP_W / 2 - 0.55;
  const lz = TOP_D / 2 - 0.5;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(new THREE.BoxGeometry(0.55, TOP_Y - 0.4, 0.55).translate(sx * lx, (TOP_Y - 0.4) / 2, sz * lz));
  for (const sz of [-1, 1]) parts.push(new THREE.BoxGeometry(TOP_W - 1.6, 0.3, 0.3).translate(0, 1.1, sz * lz));
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

const merged = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
};
const lathe = (profile: [number, number][]): THREE.BufferGeometry => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 12);
/** A handle on the side of a vessel (a half ring, on the +x side), at height `y`, `r` across, standing out from a body of radius `out`. */
const handle = (out: number, y: number, r: number): THREE.BufferGeometry => new THREE.TorusGeometry(r, 0.045, 5, 10, Math.PI).rotateZ(-Math.PI / 2).translate(out, y, 0);

/** What stands on the tables: each kind of vessel, with the colours it may be and how often it comes up. Every one stands on y = 0. */
interface Vessel { name: string; geo: THREE.BufferGeometry; colors: string[]; weight: number }

function vessels(): Vessel[] {
  return [
    // A tall pewter or wooden tankard, a little tapered.
    { name: 'tankard', weight: 3, colors: ['#a8a49a', '#8e8a80', '#bdb7a8', '#6a4a2e'], geo: merged([new THREE.CylinderGeometry(0.3, 0.26, 0.78, 10).translate(0, 0.39, 0), handle(0.28, 0.42, 0.2)]) },
    // A squat clay mug.
    { name: 'mug', weight: 3, colors: ['#8a5a3a', '#a06a40', '#6e4630', '#c8b08a'], geo: merged([new THREE.CylinderGeometry(0.33, 0.29, 0.5, 10).translate(0, 0.25, 0), handle(0.31, 0.27, 0.17)]) },
    // A stein: a fat tankard with a hinged lid and a thumb lever.
    { name: 'stein', weight: 1.5, colors: ['#9a968c', '#7e7a70', '#b0a890', '#7a6a58'], geo: merged([
      new THREE.CylinderGeometry(0.34, 0.31, 0.7, 10).translate(0, 0.35, 0), new THREE.CylinderGeometry(0.33, 0.33, 0.06, 10).translate(0, 0.73, 0),
      new THREE.BoxGeometry(0.2, 0.06, 0.1).translate(0.38, 0.76, 0), handle(0.33, 0.38, 0.22)]) },
    // A goblet on a stem.
    { name: 'goblet', weight: 1, colors: ['#c8b060', '#b0a890', '#a0a0a8', '#8a6a3a'], geo: lathe([[0, 0], [0.22, 0], [0.24, 0.04], [0.08, 0.1], [0.06, 0.4], [0.2, 0.52], [0.3, 0.86], [0.27, 0.9], [0, 0.9]]) },
    // A jug: a round belly, a narrow neck, a handle.
    { name: 'jug', weight: 1.5, colors: ['#d8c8a0', '#a07850', '#7a5a3a', '#b8a888'], geo: merged([lathe([[0, 0], [0.3, 0], [0.4, 0.2], [0.42, 0.4], [0.3, 0.62], [0.17, 0.76], [0.2, 0.92], [0.24, 0.98], [0, 0.98]]), handle(0.4, 0.5, 0.24)]) },
    // A bottle of dark glass.
    { name: 'bottle', weight: 1, colors: ['#2a4a2a', '#3a2a1a', '#1a2a3a', '#4a2a1a'], geo: lathe([[0, 0], [0.22, 0], [0.24, 0.05], [0.24, 0.5], [0.1, 0.75], [0.08, 1.05], [0.1, 1.08], [0, 1.08]]) },
  ];
}

/** A lantern's iron frame, standing on y = 0, 0.95 tall; the glass is a separate piece. */
function lanternFrame(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(0.62, 0.1, 0.62).translate(0, 0.05, 0), new THREE.BoxGeometry(0.66, 0.08, 0.66).translate(0, 0.86, 0)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(new THREE.BoxGeometry(0.06, 0.74, 0.06).translate(sx * 0.27, 0.47, sz * 0.27));
  parts.push(new THREE.ConeGeometry(0.4, 0.3, 4).rotateY(Math.PI / 4).translate(0, 1.05, 0));
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

const lanternGlass = (): THREE.BufferGeometry => new THREE.BoxGeometry(0.5, 0.72, 0.5).translate(0, 0.47, 0);

interface Placed { x: number; z: number; yaw: number }

/** Where the tables stand: scattered behind and beside the game table, well clear of it and of the camera in front of it. */
function tableSpots(ts: ThemeScene, count: number): Placed[] {
  const out: Placed[] = [];
  for (let tries = 0; out.length < count && tries < count * 60; tries++) {
    const x = ts.between(-48, 48);
    const z = ts.between(-42, 2);
    // Not near the game table (and its own chairs), and not so near the camera's side of it.
    if (Math.abs(x) < 22 && z > -22) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 13)) continue;
    out.push({ x, z, yaw: (ts.rnd() - 0.5) * 1.1 + (ts.rnd() < 0.25 ? Math.PI / 2 : 0) });
  }
  return out;
}

export function addTavernware(ts: ThemeScene, spec: TavernwareSpec, coarse: boolean): void {
  const count = coarse ? Math.ceil(spec.tables * 0.6) : spec.tables;
  const spots = tableSpots(ts, count);
  const wood = ts.mat(spec.wood, { flatShading: false, roughness: 0.8 });
  const chairWood = ts.mat(mixHex(spec.wood, '#000000', 0.12), { flatShading: false, roughness: 0.85 });
  // One material for every vessel: each takes its own colour from its instance.
  const ware = ts.mat('#ffffff', { flatShading: false, roughness: 0.5, metalness: 0.12 });
  const kinds = vessels();
  const kindWeight = kinds.reduce((n, v) => n + v.weight, 0);
  const iron = ts.mat('#241e1a', { flatShading: false, roughness: 0.6, metalness: 0.3 });
  const glassMat = ts.register(new THREE.MeshBasicMaterial({ color: spec.lantern ?? '#ffcf88', fog: false }));

  const tables = new THREE.InstancedMesh(tableGeometry(), wood, spots.length);
  const chairGeo = chairGeometry({ w: 2.2, d: 2.2, legT: 0.27, seatT: 0.24, backH: 2.5, back: 'rails' }, SEAT_H).wood;
  const seats: THREE.Matrix4[] = [];
  /** Per kind of vessel: where each stands (and how big), and its colour. */
  const standing: { at: THREE.Matrix4; color: THREE.Color }[][] = kinds.map(() => []);
  const lamps: THREE.Matrix4[] = [];
  const glows: { x: number; y: number; z: number }[] = [];

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const gy = ts.ground;
  spots.forEach((s, i) => {
    tables.setMatrixAt(i, m.compose(p.set(s.x, gy, s.z), q.setFromAxisAngle(up, s.yaw), one));
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    // A point on the table's own floor plan, put into the room.
    const at = (lx: number, lz: number): [number, number] => [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c];
    // Chairs along both long sides and sometimes at an end, each turned to face the table, none quite straight.
    const chairs: [number, number][] = [];
    for (const sz of [-1, 1]) for (const lx of [-1.9, 0, 1.9]) if (ts.rnd() < 0.72) chairs.push([lx + (ts.rnd() - 0.5) * 0.5, sz * (TOP_D / 2 + 1.1)]);
    for (const sx of [-1, 1]) if (ts.rnd() < 0.45) chairs.push([sx * (TOP_W / 2 + 1.1), (ts.rnd() - 0.5) * 0.6]);
    for (const [lx, lz] of chairs) {
      const [x, z] = at(lx, lz);
      const face = Math.atan2(-(x - s.x), -(z - s.z)) + (ts.rnd() - 0.5) * 0.35;
      seats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, gy, z), new THREE.Quaternion().setFromAxisAngle(up, face), one));
    }
    // A few vessels scattered over the top, of every sort and size and colour, the odd one knocked over; and a lantern near the middle.
    for (let k = 0, n = 3 + Math.floor(ts.rnd() * 4); k < n; k++) {
      const [x, z] = at((ts.rnd() - 0.5) * (TOP_W - 1.6), (ts.rnd() - 0.5) * (TOP_D - 1.2));
      let pick = ts.rnd() * kindWeight;
      const kind = kinds.findIndex((v) => (pick -= v.weight) < 0);
      const v = kinds[Math.max(0, kind)]!;
      const size = ts.between(0.85, 1.3);
      const fallen = ts.rnd() < 0.08;
      const q2 = new THREE.Quaternion().setFromAxisAngle(up, ts.rnd() * 6.28);
      // A fallen vessel lies on its side, on its rim's height above the wood.
      if (fallen) q2.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
      standing[Math.max(0, kind)]!.push({
        at: new THREE.Matrix4().compose(new THREE.Vector3(x, gy + TOP_Y + (fallen ? 0.3 * size : 0), z), q2, new THREE.Vector3(size, size * ts.between(0.9, 1.15), size)),
        color: new THREE.Color(v.colors[Math.floor(ts.rnd() * v.colors.length)]!),
      });
    }
    const [lx, lz] = at((ts.rnd() - 0.5) * 2.4, (ts.rnd() - 0.5) * 1);
    lamps.push(new THREE.Matrix4().compose(new THREE.Vector3(lx, gy + TOP_Y, lz), new THREE.Quaternion(), one));
    glows.push({ x: lx, y: gy + TOP_Y + 0.55, z: lz });
  });

  const group = new THREE.Group();
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[]): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    list.forEach((mx, i) => mesh.setMatrixAt(i, mx));
    mesh.count = list.length;
    mesh.frustumCulled = false;
    return mesh;
  };
  tables.frustumCulled = false;
  group.add(tables, instanced(chairGeo, chairWood, seats), instanced(lanternFrame(), iron, lamps), instanced(lanternGlass(), glassMat, lamps));
  kinds.forEach((v, i) => {
    const list = standing[i]!;
    const mesh = instanced(v.geo, ware, list.map((s) => s.at));
    list.forEach((s, j) => mesh.setColorAt(j, s.color));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  });

  // The glow round each lantern: one soft sprite apiece, wavering.
  const glowMats = glows.map((g) => {
    const mat = ts.register(new THREE.SpriteMaterial({ map: dotTexture(), color: spec.lantern ?? '#ffb560', depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), 0);
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(g.x, g.y, g.z);
    sprite.scale.setScalar(3.4);
    group.add(sprite);
    return { sprite, mat, ph: ts.rnd() * 60 };
  });
  ts.group.add(group);
  ts.onLayout((_w, _d, cz) => { group.position.z = cz; });
  ts.onTick((t) => {
    for (const g of glowMats) {
      const flicker = 0.72 + 0.16 * Math.sin(t * 9 + g.ph) + 0.12 * Math.sin(t * 23.7 + g.ph * 1.9) * Math.sin(t * 3.1 + g.ph);
      g.mat.opacity = ts.fade * Math.min(1, flicker);
      g.sprite.scale.setScalar(3.2 + flicker * 0.9);
    }
  });
}
