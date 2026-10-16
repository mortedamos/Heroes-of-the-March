// Trees from the models, standing in a loose ring round the table, between it and the painted sky.
//
// Where they stand is worked out when the scene is built (the same every time); the models themselves arrive when they have loaded,
// and the trees are stood then (see models.ts). They keep out of the way of the table and of the camera in front of it.

import type { ThemeScene } from './props';
import { standModel, type Stand } from './models';

export interface TreeSpec {
  /** The models to use (files in public/models), each with how often it comes up, and a tint if it should be darker or colder than it is. */
  kinds: { file: string; weight?: number; tint?: string }[];
  /** How many trees in all. */
  count: number;
  /** How tall each is, in world units (the table is about five high). */
  height: [number, number];
  /** How near the table's middle the nearest may stand, and how far the farthest (22 and 56). */
  reach?: [number, number];
  /** Trees do not stand closer than this to each other (5). */
  apart?: number;
}

/** Where each tree of a spec stands, by model file. Nothing here needs a model to be loaded. */
export function treeStands(ts: ThemeScene, spec: TreeSpec, coarse: boolean): Map<string, Stand[]> {
  const want = Math.round(spec.count * (coarse ? 0.6 : 1));
  const [R0, R1] = spec.reach ?? [22, 56];
  const apart = spec.apart ?? 5;
  const total = spec.kinds.reduce((n, k) => n + (k.weight ?? 1), 0);
  const placed: Stand[] = [];
  const by = new Map<string, Stand[]>();
  for (let tries = 0; placed.length < want && tries < want * 40; tries++) {
    const r = R0 + (R1 - R0) * Math.sqrt(ts.rnd());
    // Mostly behind the table, where the painted sky is, and some at the sides.
    const a = Math.PI * (ts.rnd() < 0.8 ? 1 + ts.rnd() : ts.rnd() * 2);
    const x = Math.cos(a) * r * 1.2;
    const z = Math.sin(a) * r * 0.9;
    // Not in front of the table (where the camera is), nor close to its sides.
    if (z > 2 || Math.hypot(Math.max(Math.abs(x) - 13, 0), Math.max(Math.abs(z) - 9, 0)) < 8) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < apart)) continue;
    let pick = ts.rnd() * total;
    const kind = spec.kinds.find((k) => (pick -= k.weight ?? 1) < 0) ?? spec.kinds[0]!;
    const stand: Stand = { x, y: ts.ground - 0.05, z, height: ts.between(spec.height[0], spec.height[1]), yaw: ts.rnd() * Math.PI * 2 };
    placed.push(stand);
    const list = by.get(kind.file);
    if (list) list.push(stand); else by.set(kind.file, [stand]);
  }
  return by;
}

/** Plant the trees of a place. They appear as their models load. */
export function addTrees(ts: ThemeScene, spec: TreeSpec, coarse: boolean): void {
  for (const [file, stands] of treeStands(ts, spec, coarse)) {
    void standModel(ts, file, stands, spec.kinds.find((k) => k.file === file)?.tint);
  }
}
