// three.js scene: renderer, camera, lights, the table, and picking.

import * as THREE from 'three';
import type { Frame, Shape } from './layout';
import { Tweens } from './tween';

/** The landscape table (world units). Portrait gets a narrower, deeper one. */
const WIDE_TABLE = { w: 19, d: 12.6, cz: 0 };

export class TableScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  readonly tweens = new Tweens();
  /** The key light: it drifts slowly, so every shadow on the table drifts with it. */
  readonly keyLight = new THREE.DirectionalLight('#ffe7c2', 2.1);
  private readonly keyBase = new THREE.Vector3(-5, 14, 7);
  readonly maxAnisotropy: number;
  private readonly raycaster = new THREE.Raycaster();
  private readonly frameHooks = new Set<(now: number) => void>();
  private readonly table = new THREE.Group();
  private felt: THREE.CanvasTexture | null = null;
  private tableKey = '';
  private shape: Shape = 'wide';
  private frame: Frame | null = null;
  private disposed = false;

  constructor(private readonly container: HTMLElement) {
    // Phones and tablets: a smaller shadow map is cheaper on the GPU and battery.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('table-canvas');

    this.scene.background = new THREE.Color('#15110d');
    this.scene.fog = new THREE.Fog('#15110d', 24, 42);

    this.buildLights(coarse ? 1024 : 2048);
    this.scene.add(this.table);
    this.buildTable(WIDE_TABLE);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: '#0f0b08', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3;
    this.scene.add(floor);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();

    const loop = (now: number) => {
      if (this.disposed) return;
      this.tweens.tick(now);
      this.driftLight(now);
      for (const f of this.frameHooks) f(now);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** A candle-lit sway: the key light wanders a little around its seat (still, if the player prefers less motion). */
  private driftLight(now: number): void {
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = still ? 0 : now / 1000;
    this.keyLight.position.set(this.keyBase.x + Math.sin(t * 0.21) * 3.2, this.keyBase.y, this.keyBase.z + Math.cos(t * 0.17) * 1.8);
  }

  onFrame(fn: (now: number) => void): () => void {
    this.frameHooks.add(fn);
    return () => this.frameHooks.delete(fn);
  }

  private buildLights(shadowSize: number): void {
    this.scene.add(new THREE.HemisphereLight('#fff4e0', '#2a1c10', 0.9));
    const key = this.keyLight;
    key.position.copy(this.keyBase);
    key.castShadow = true;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    const sc = key.shadow.camera;
    sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12; sc.near = 1; sc.far = 40;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 3;
    this.scene.add(key);
    const warm = new THREE.PointLight('#ffb466', 30, 30, 1.6);
    warm.position.set(0, 6, 1);
    this.scene.add(warm);
  }

  private feltTexture(): THREE.CanvasTexture {
    if (this.felt) return this.felt;
    // Felt surface: procedural noise so it isn't a flat colour.
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = '#23483e';
    g.fillRect(0, 0, 512, 512);
    const img = g.getImageData(0, 0, 512, 512);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 18;
      img.data[i] = Math.max(0, img.data[i]! + n);
      img.data[i + 1] = Math.max(0, img.data[i + 1]! + n);
      img.data[i + 2] = Math.max(0, img.data[i + 2]! + n);
    }
    g.putImageData(img, 0, 0);
    const felt = new THREE.CanvasTexture(c);
    felt.colorSpace = THREE.SRGBColorSpace;
    felt.wrapS = felt.wrapT = THREE.RepeatWrapping;
    felt.repeat.set(6, 4);
    felt.anisotropy = this.maxAnisotropy;
    this.felt = felt;
    return felt;
  }

  /** (Re)build the felt and rim at `w` x `d`, centred on z = `cz`. */
  private buildTable({ w, d, cz }: { w: number; d: number; cz: number }): void {
    const key = `${w.toFixed(2)}:${d.toFixed(2)}:${cz.toFixed(2)}`;
    if (key === this.tableKey) return;
    this.tableKey = key;
    for (const o of [...this.table.children]) {
      const m = o as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this.table.remove(o);
    }
    this.table.position.z = cz;
    const felt = this.feltTexture();

    const r = 2.8;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -d / 2);
    shape.lineTo(w / 2 - r, -d / 2);
    shape.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
    shape.lineTo(w / 2, d / 2 - r);
    shape.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
    shape.lineTo(-w / 2 + r, d / 2);
    shape.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
    shape.lineTo(-w / 2, -d / 2 + r);
    shape.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);

    const top = new THREE.Mesh(
      new THREE.ShapeGeometry(shape, 24),
      new THREE.MeshStandardMaterial({ map: felt, roughness: 0.95, metalness: 0 }),
    );
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    this.table.add(top);

    // Wooden rim.
    const rimShape = shape.clone();
    const inner = new THREE.Path(shape.getPoints(48).map((p) => p.clone().multiplyScalar(0.965)).reverse());
    rimShape.holes.push(inner);
    const rim = new THREE.Mesh(
      new THREE.ExtrudeGeometry(rimShape, { depth: 0.35, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 3, curveSegments: 24 }),
      new THREE.MeshStandardMaterial({ color: '#5b3a1f', roughness: 0.55, metalness: 0.05 }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = -0.02;
    rim.castShadow = true;
    rim.receiveShadow = true;
    this.table.add(rim);
  }

  /** Switch to a screen shape and the table area it should show. */
  setView(shape: Shape, frame: Frame): void {
    if (shape === this.shape && JSON.stringify(frame) === JSON.stringify(this.frame)) return;
    this.shape = shape;
    this.frame = frame;
    this.buildTable(shape === 'tall'
      ? { w: frame.maxX - frame.minX + 1.2, d: frame.maxZ - frame.minZ + 1.2, cz: (frame.minZ + frame.maxZ) / 2 }
      : WIDE_TABLE);
    this.resize();
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.clearViewOffset();
    let dist: number;
    if (this.shape === 'wide' || !this.frame) {
      // Frame the play area (about 16 x 11 units): back off on narrow screens.
      dist = Math.max(12.8, 21.5 / Math.max(0.55, this.camera.aspect));
      const angle = THREE.MathUtils.degToRad(56);
      this.camera.position.set(0, Math.sin(angle) * dist, Math.cos(angle) * dist + 0.6);
      // Aim low so the play area sits above the HTML dock at the bottom of the screen.
      this.camera.lookAt(0, 0, 1.25);
      this.camera.updateProjectionMatrix();
    } else {
      dist = this.fit(this.frame, w, h);
    }
    // Keep the fog behind the table however far back the camera sits.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = dist + 11;
    fog.far = dist + 29;
  }

  /**
   * Compact screens: the HTML dock sits beside the canvas rather than over it,
   * so fit `frame` to the whole canvas. Pull back until it fits, then shift the
   * view so it is centred. Returns the camera distance.
   */
  private fit(frame: Frame, w: number, h: number): number {
    const cam = this.camera;
    cam.updateProjectionMatrix();
    // Portrait has height to spare: look down more steeply so the far seats aren't shrunk.
    const elev = THREE.MathUtils.degToRad(this.shape === 'tall' ? 70 : 56);
    const cx = (frame.minX + frame.maxX) / 2;
    const cz = (frame.minZ + frame.maxZ) / 2;
    const corners = [[frame.minX, frame.minZ], [frame.maxX, frame.minZ], [frame.minX, frame.maxZ], [frame.maxX, frame.maxZ]]
      .map(([x, z]) => new THREE.Vector3(x, 0, z));
    const v = new THREE.Vector3();
    const place = (dist: number) => {
      cam.position.set(cx, Math.sin(elev) * dist, cz + Math.cos(elev) * dist);
      cam.lookAt(cx, 0, cz);
      cam.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        v.copy(c).project(cam);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      // NDC -> canvas pixels (y down).
      return { left: ((x0 + 1) / 2) * w, right: ((x1 + 1) / 2) * w, top: ((1 - y1) / 2) * h, bottom: ((1 - y0) / 2) * h };
    };
    const pad = 6;
    let lo = 4, hi = 300;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      const b = place(mid);
      if (b.right - b.left <= w - 2 * pad && b.bottom - b.top <= h - 2 * pad) hi = mid;
      else lo = mid;
    }
    const b = place(hi);
    cam.setViewOffset(w, h, (b.left + b.right) / 2 - w / 2, (b.top + b.bottom) / 2 - h / 2, w, h);
    return hi;
  }

  /** First intersected object among `objects` under a client-space point. */
  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObjects(objects, false)[0] ?? null;
  }

  /** The point on the table (height `y`) under a screen position. */
  screenToTable(clientX: number, clientY: number, y = 0.3): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  /** World point -> CSS pixels in the viewport. */
  project(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  dispose(): void {
    this.disposed = true;
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
