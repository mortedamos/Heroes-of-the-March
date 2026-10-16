// Slim down 3D models for the game.
//   npm run models                  every .glb in _build/art-work/models/ -> public/models/
//   npm run models -- --only tree_07,trees   just these (a name or part of one)
//   npm run models -- --tris 8000   the triangle budget for each model (default 14000)
//
// The models as they are made (about 100,000 triangles and ten megabytes each) are far too heavy to scatter through a scene:
// the originals stay in _build/art-work/models/ (not in git) and the game loads the slim copies in public/models/. Each slim
// copy keeps the colour picture, shrunk to 512 pixels (JPEG, or PNG where it has cut-outs), and drops the rest of the textures; its triangles are simplified to the
// budget; its base sits at the origin and it is one unit tall (the game scales it to whatever height a place wants).
//
// trees.glb holds ten trees of three kinds laid out in a field: it is split into trees_a, trees_b and trees_c, one of each kind.

import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document, type Node, type Primitive } from '@gltf-transform/core';
import { KHRMaterialsUnlit, KHRTextureTransform } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, flatten, getBounds, prune, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, '_build', 'art-work', 'models');
const OUT = join(root, 'public', 'models');

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const only = flag('only')?.split(',');
const BUDGET = Number(flag('tris') ?? 14000);
const SUFFIX = flag('suffix') ?? '';

const io = new NodeIO().registerExtensions([KHRTextureTransform, KHRMaterialsUnlit]);

function triangles(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3;
  }
  return Math.round(n);
}

/**
 * Cut a primitive down to about `target` triangles. The texture coordinates count in the simplifier's error, so the picture
 * still lands where it should; 'Permissive' lets it collapse across the seams between texture islands, which a model made of
 * many small islands needs before it will simplify at all.
 */
function simplifyPrimitive(prim: Primitive, target: number): void {
  const indices = prim.getIndices()!.getArray()! as Uint32Array;
  const positions = prim.getAttribute('POSITION')!.getArray()! as Float32Array;
  const uv = prim.getAttribute('TEXCOORD_0')?.getArray() as Float32Array | undefined;
  const [out] = uv
    ? MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(indices), new Float32Array(positions), 3, new Float32Array(uv), 2, [1, 1], null, target * 3, 1, ['Permissive'])
    : MeshoptSimplifier.simplify(new Uint32Array(indices), new Float32Array(positions), 3, target * 3, 1, ['Permissive']);
  prim.getIndices()!.setArray(new Uint32Array(out));
  compactPrimitive(prim);
}

/** A small random number generator that gives the same numbers every run, so a model slims the same way each time. */
function rngOf(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The pieces of a mesh that do not share a vertex: each leaf of a leafy tree is one, and so is each stretch of branch. */
function pieces(indices: Uint32Array, vertexCount: number): { starts: number[]; sizes: number[] }[] {
  const parent = new Int32Array(vertexCount).map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
  for (let i = 0; i < indices.length; i += 3) {
    const a = find(indices[i]!);
    parent[find(indices[i + 1]!)] = a;
    parent[find(indices[i + 2]!)] = a;
  }
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < indices.length; i += 3) {
    const r = find(indices[i]!);
    const list = byRoot.get(r);
    if (list) list.push(i); else byRoot.set(r, [i]);
  }
  return [...byRoot.values()].map((starts) => ({ starts, sizes: [starts.length] }));
}

/**
 * Cut a leafy tree down to about `target` triangles without losing its canopy. Simplifying a tree made of tens of thousands of
 * small leaves removes the leaves first (each costs almost nothing to lose) and leaves a bare skeleton. So instead: the branches
 * and trunk (the big pieces) are simplified, and of the leaves a share is kept, each grown to cover what its neighbours did.
 */
function thinFoliage(prim: Primitive, target: number): boolean {
  const indices = prim.getIndices()!.getArray()! as Uint32Array;
  const positions = new Float32Array(prim.getAttribute('POSITION')!.getArray()! as Float32Array);
  const all = pieces(indices, positions.length / 3);
  const LEAF = 60;
  const leaves = all.filter((p) => p.starts.length <= LEAF);
  const wood = all.filter((p) => p.starts.length > LEAF);
  const leafTris = leaves.reduce((n, p) => n + p.starts.length, 0);
  // Only a model that is mostly small pieces is leafy; anything else is left to the plain simplifier.
  if (leaves.length < 500 || leafTris < (indices.length / 3) * 0.5) return false;
  const woodTris = wood.reduce((n, p) => n + p.starts.length, 0);
  const keep = Math.min(1, (target * 0.7) / leafTris);
  const grow = Math.min(3.4, 1 / Math.sqrt(keep));
  const rnd = rngOf(7);
  const out: number[] = [];
  for (const piece of leaves) {
    if (rnd() > keep) continue;
    const verts = new Set<number>();
    for (const t of piece.starts) for (let k = 0; k < 3; k++) verts.add(indices[t + k]!);
    let cx = 0, cy = 0, cz = 0;
    for (const v of verts) { cx += positions[v * 3]!; cy += positions[v * 3 + 1]!; cz += positions[v * 3 + 2]!; }
    cx /= verts.size; cy /= verts.size; cz /= verts.size;
    for (const v of verts) {
      positions[v * 3] = cx + (positions[v * 3]! - cx) * grow;
      positions[v * 3 + 1] = cy + (positions[v * 3 + 1]! - cy) * grow;
      positions[v * 3 + 2] = cz + (positions[v * 3 + 2]! - cz) * grow;
    }
    for (const t of piece.starts) out.push(indices[t]!, indices[t + 1]!, indices[t + 2]!);
  }
  let woody = new Uint32Array(wood.flatMap((p) => p.starts.flatMap((t) => [indices[t]!, indices[t + 1]!, indices[t + 2]!])));
  const woodTarget = Math.max(150, Math.round(target * 0.3));
  if (woodTris > woodTarget) {
    const uv = prim.getAttribute('TEXCOORD_0')?.getArray() as Float32Array | undefined;
    const [simpler] = uv
      ? MeshoptSimplifier.simplifyWithAttributes(woody, positions, 3, new Float32Array(uv), 2, [1, 1], null, woodTarget * 3, 1, ['Permissive'])
      : MeshoptSimplifier.simplify(woody, positions, 3, woodTarget * 3, 1, ['Permissive']);
    woody = new Uint32Array(simpler);
  }
  prim.getAttribute('POSITION')!.setArray(positions);
  prim.getIndices()!.setArray(new Uint32Array([...woody, ...out]));
  compactPrimitive(prim);
  return true;
}

/** One mesh, simplified to `budget` triangles, one colour texture, standing on the origin and one unit tall. */
async function slim(doc: Document, budget: number, format: 'jpeg' | 'png'): Promise<void> {
  await doc.transform(flatten());
  // Only the colour of the surface is kept; everything else a model brings is too much to ship for a tree in the distance.
  for (const m of doc.getRoot().listMaterials()) {
    m.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
    m.setMetallicFactor(0).setRoughnessFactor(0.92).setEmissiveFactor([0, 0, 0]);
  }
  await doc.transform(weld(), dedup());
  const before = triangles(doc);
  if (before > budget) {
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const tris = (prim.getIndices()?.getCount() ?? 0) / 3;
        const share = Math.max(100, Math.round((tris / before) * budget));
        if (!thinFoliage(prim, share)) simplifyPrimitive(prim, share);
      }
    }
  }
  await doc.transform(
    prune(),
    // JPEG for a solid model, PNG where the picture has cut-outs (leaf cards): a browser reads both without help.
    textureCompress({ encoder: sharp, resize: [512, 512], targetFormat: format, quality: 82 }),
    prune(),
  );
  // Stand it on the origin, one unit tall: its base (the lowest point) at y = 0, centred over x and z.
  const scene = doc.getRoot().listScenes()[0]!;
  const { min, max } = getBounds(scene);
  const height = max[1]! - min[1]!;
  const k = 1 / height;
  for (const node of scene.listChildren()) {
    node.setTranslation([-((min[0]! + max[0]!) / 2) * k, -min[1]! * k, -((min[2]! + max[2]!) / 2) * k]);
    node.setScale([k, k, k]);
  }
}

/** Keep one top-level node of a scene (and what it uses) and drop the rest. */
function keepOnly(doc: Document, keep: Node): void {
  const scene = doc.getRoot().listScenes()[0]!;
  for (const n of scene.listChildren()) if (n !== keep) { scene.removeChild(n); n.dispose(); }
  keep.setTranslation([0, 0, 0]);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await MeshoptSimplifier.ready;
  const files = readdirSync(SRC).filter((f) => f.endsWith('.glb') && (!only || only.some((o) => f.includes(o))));
  for (const f of files) {
    const name = f.replace(/\.glb$/, '');
    if (name === 'trees') {
      // The three kinds, by the triangle counts of their meshes: the first tree of each kind.
      const seen = new Set<string>();
      const kinds = 'abc';
      const probe = await io.read(join(SRC, f));
      const picks: number[] = [];
      probe.getRoot().listScenes()[0]!.listChildren().forEach((n, i) => {
        const key = n.listChildren().map((c) => c.getMesh()?.listPrimitives().map((p) => p.getIndices()?.getCount()).join('+')).join('|');
        if (!seen.has(key)) { seen.add(key); picks.push(i); }
      });
      for (let k = 0; k < picks.length; k++) {
        const doc = await io.read(join(SRC, f));
        const node = doc.getRoot().listScenes()[0]!.listChildren()[picks[k]!]!;
        keepOnly(doc, node);
        await doc.transform(prune());
        await slim(doc, BUDGET, 'png');
        const out = join(OUT, `trees_${kinds[k]}.glb`);
        await io.write(out, doc);
        console.log(`trees_${kinds[k]}.glb  ${triangles(doc)} triangles  ${(statSync(out).size / 1e3).toFixed(0)} KB`);
      }
      continue;
    }
    const doc = await io.read(join(SRC, f));
    const from = triangles(doc);
    await slim(doc, BUDGET, 'jpeg');
    const out = join(OUT, f.replace(/.glb$/, `${SUFFIX}.glb`));
    await io.write(out, doc);
    console.log(`${f}  ${from} -> ${triangles(doc)} triangles  ${(statSync(join(SRC, f)).size / 1e6).toFixed(1)} MB -> ${(statSync(out).size / 1e3).toFixed(0)} KB`);
  }
}

await main();
