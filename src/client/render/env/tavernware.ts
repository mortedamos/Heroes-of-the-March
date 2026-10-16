// The rest of the tavern: other tables and chairs standing in the distance, between the painted room and the game table, each
// with a few mugs and a lantern on it. The lanterns flicker (a glow that wavers, in time with nothing else).
//
// Everything of one sort is one instanced mesh (all the tables, all the chairs, all the mugs), so a whole room of furniture costs a
// few draw calls. The lanterns' light is a soft glow, not a real light: a real light more would make every material in the scene
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

/** A mug: a tankard with a handle, standing on y = 0. */
function mugGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.3, 0.26, 0.62, 10).translate(0, 0.31, 0);
  const handle = new THREE.TorusGeometry(0.17, 0.045, 5, 10, Math.PI).rotateZ(-Math.PI / 2).translate(0.28, 0.32, 0);
  const g = mergeGeometries([body, handle])!;
  body.dispose(); handle.dispose();
  return g;
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
  const ware = ts.mat('#cdb68a', { flatShading: false, roughness: 0.55 });
  const iron = ts.mat('#241e1a', { flatShading: false, roughness: 0.6, metalness: 0.3 });
  const glassMat = ts.register(new THREE.MeshBasicMaterial({ color: spec.lantern ?? '#ffcf88', fog: false }));

  const tables = new THREE.InstancedMesh(tableGeometry(), wood, spots.length);
  const chairGeo = chairGeometry({ w: 2.2, d: 2.2, legT: 0.27, seatT: 0.24, backH: 2.5, back: 'rails' }, SEAT_H).wood;
  const seats: THREE.Matrix4[] = [];
  const mugs: THREE.Matrix4[] = [];
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
    // A few mugs scattered over the top, and a lantern near the middle.
    for (let k = 0, n = 3 + Math.floor(ts.rnd() * 3); k < n; k++) {
      const [x, z] = at((ts.rnd() - 0.5) * (TOP_W - 1.6), (ts.rnd() - 0.5) * (TOP_D - 1.2));
      mugs.push(new THREE.Matrix4().compose(new THREE.Vector3(x, gy + TOP_Y, z), new THREE.Quaternion().setFromAxisAngle(up, ts.rnd() * 6.28), one));
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
  group.add(tables, instanced(chairGeo, chairWood, seats), instanced(mugGeometry(), ware, mugs), instanced(lanternFrame(), iron, lamps), instanced(lanternGlass(), glassMat, lamps));

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
