// 3D models from public/models: loaded once, cached, and stood in a scene as many copies as it wants.
//
// A model is stood on y = 0 and made one unit tall when it loads, so a place only has to say how tall each copy should be.
// The .glb files in public/models are the slim ones made by `npm run models` (see scripts/models.ts); an .fbx is used as it is.

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ThemeScene } from './props';

const cache = new Map<string, Promise<THREE.Object3D>>();

/**
 * A glTF loader that reads the pictures packed inside a model with an image element. The loader's own way (fetching a blob
 * address) is refused by the page's Content Security Policy (connect-src 'self'), which stays as strict as it is; images
 * from blob: addresses are allowed (img-src).
 */
function gltfLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.register((parser) => {
    parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
    return { name: 'HOTM_texture_loader' };
  });
  return loader;
}

/**
 * The pine is a trunk and four crossed cards, with their picture (needles, bark and all on one sheet) left out of the file. So the
 * sheet is painted here, in the places the model's texture coordinates point to: the pine on the left half of the sheet, the bark
 * on the strip to the right of it, nothing anywhere else. Where the paint is clear the card is cut away.
 */
function pineTexture(): THREE.CanvasTexture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  let seed = 11;
  const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  g.clearRect(0, 0, S, S);
  // The card: u 0.05 to 0.53, v 0.04 to 0.91 (the sheet's top is v = 1).
  const x0 = 0.05 * S, x1 = 0.53 * S, top = (1 - 0.91) * S, bottom = (1 - 0.04) * S;
  const mid = (x0 + x1) / 2;
  const tiers = 9;
  const tierH = (bottom - top) / tiers;
  const shade = ['#18331f', '#1f4026', '#27502d', '#2f5f35'];
  for (let t = 0; t < tiers; t++) {
    const yTop = top + t * tierH * 0.86;
    const yBase = yTop + tierH * 1.9;
    const half = ((x1 - x0) / 2) * Math.min(1, (0.16 + (t + 1) / tiers) ** 0.95);
    // The bough: a drooping skirt with a scalloped hem, darker low down in the tree.
    g.fillStyle = shade[Math.min(3, Math.floor((t / tiers) * 4 + rnd() * 0.5))]!;
    g.beginPath();
    g.moveTo(mid, yTop);
    g.lineTo(mid + half, yBase);
    for (let k = 1; k <= 7; k++) g.quadraticCurveTo(mid + half - (k - 0.5) * (half * 2 / 7), yBase + tierH * 0.32, mid + half - k * (half * 2 / 7), yBase);
    g.closePath();
    g.fill();
    // Needles: short strokes along the hem and through the bough, paler at the tips.
    for (let i = 0; i < 520; i++) {
      const yy = yTop + rnd() * (yBase - yTop);
      const reach = ((yy - yTop) / (yBase - yTop)) * half;
      const xx = mid + (rnd() * 2 - 1) * reach;
      const a = Math.PI / 2 + (rnd() - 0.5) * 1.5;
      const l = 7 + rnd() * 12;
      g.strokeStyle = ['#2f6a3a', '#3d7a44', '#4f8a50', '#1d3f26'][Math.floor(rnd() * 4)]!;
      g.globalAlpha = 0.85;
      g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx + Math.cos(a) * l, yy + Math.sin(a) * l); g.stroke();
    }
    g.globalAlpha = 1;
  }
  // The bark: the strip the trunk's texture coordinates run over.
  const bx0 = 0.66 * S, bx1 = 0.9 * S, by0 = (1 - 0.88) * S, by1 = (1 - 0.03) * S;
  g.fillStyle = '#4a3322';
  g.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
  for (let i = 0; i < 260; i++) {
    const xx = bx0 + rnd() * (bx1 - bx0);
    g.strokeStyle = rnd() < 0.5 ? '#2c1d12' : '#6a4a30';
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath(); g.moveTo(xx, by0 + rnd() * 100); g.lineTo(xx + (rnd() - 0.5) * 8, by1 - rnd() * 100); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Fix up the models that need it when they load. */
function dress(file: string, obj: THREE.Object3D): void {
  if (file !== 'Pine_Tree.fbx') return;
  const material = new THREE.MeshStandardMaterial({ map: pineTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = material; });
}

/** Wrap `obj` so it stands on y = 0, centred over x and z, and one unit tall. */
export function normalise(obj: THREE.Object3D): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.add(obj);
  obj.position.set(obj.position.x - mid.x, obj.position.y - box.min.y, obj.position.z - mid.z);
  const outer = new THREE.Group();
  outer.add(inner);
  outer.scale.setScalar(size.y > 0 ? 1 / size.y : 1);
  return outer;
}

/** A model by file name (relative to public/models), one unit tall and standing on the origin. Loaded the first time it is asked for. */
export function loadModel(file: string): Promise<THREE.Object3D> {
  let p = cache.get(file);
  if (!p) {
    const url = `${import.meta.env.BASE_URL}models/${file}`;
    const raw = file.endsWith('.fbx') ? new FBXLoader().loadAsync(url) : gltfLoader().loadAsync(url).then((g) => g.scene);
    p = raw.then((obj) => { dress(file, obj); return normalise(obj); });
    // A model that will not load is not asked for again this session.
    cache.set(file, p);
  }
  return p;
}

/** How much of its own colour the farthest tree keeps: the fog takes this share of it at most, so a far tree stays a shape against the sky. */
const FOG_CAP = 0.62;

/** Where to stand one copy of a model: its foot, how tall it is, and which way it faces. */
export interface Stand { x: number; y: number; z: number; height: number; yaw: number }

/**
 * Stand copies of a model in a scene as soon as it has loaded (a scene that has gone by then gets nothing). The copies share
 * the model's geometry and pictures; each material is the scene's own copy, so the copies fade in and out with the place.
 * `tint` multiplies the model's colours (a dim place darkens its trees); `at` is the scene's own offset (the table's z).
 */
export async function standModel(ts: ThemeScene, file: string, stands: Stand[], tint?: string): Promise<THREE.Group | null> {
  let proto: THREE.Object3D;
  try { proto = await loadModel(file); } catch { return null; }
  if (ts.disposed) return null;
  const group = new THREE.Group();
  const mats = new Map<THREE.Material, THREE.Material>();
  const own = (m: THREE.Material): THREE.Material => {
    let c = mats.get(m);
    if (!c) {
      const blended = m.transparent;
      c = ts.register(m.clone());
      c.opacity = ts.fade;
      // Leaf cards made to blend are cut out instead, so a canopy does not need sorting.
      if (blended) c.alphaTest = Math.max(c.alphaTest, 0.4);
      c.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
          #ifdef USE_FOG
            gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, smoothstep( fogNear, fogFar, vFogDepth ) * ${FOG_CAP.toFixed(2)} );
          #endif`);
      };
      c.customProgramCacheKey = () => 'model-fogcap';
      if (tint && (c as THREE.MeshStandardMaterial).color) (c as THREE.MeshStandardMaterial).color.multiply(new THREE.Color(tint));
      mats.set(m, c);
    }
    return c;
  };
  for (const s of stands) {
    const copy = proto.clone(true);
    copy.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    });
    copy.position.set(s.x, s.y, s.z);
    copy.rotation.y = s.yaw;
    copy.scale.multiplyScalar(s.height);
    group.add(copy);
  }
  ts.group.add(group);
  // Placed relative to the table's middle, which may stand a little off the middle of the scene.
  ts.onLayout((_w, _d, cz) => { group.position.z = cz; });
  return group;
}
