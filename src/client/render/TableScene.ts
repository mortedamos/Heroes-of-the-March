// three.js scene: renderer, camera, lights, the table, and picking.

import * as THREE from 'three';
import type { Frame, Shape } from './layout';
import { Tweens } from './tween';
import { Environment } from './env/Environment';

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
  /** The place the table sits in: surface, ground, scenery, weather and light for the current location. */
  readonly environment: Environment;
  private shape: Shape = 'wide';
  private frame: Frame | null = null;
  private disposed = false;
  /** 0 = the play camera, 1 = the establishing view toward the horizon. */
  private shot = 0;
  private shotId = 0;
  private readonly shotOwner = {};

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

    const lights = this.buildLights(coarse ? 1024 : 2048);
    this.environment = new Environment(this.scene, lights, this.renderer, this.maxAnisotropy, coarse);
    this.environment.setTable(WIDE_TABLE.w, WIDE_TABLE.d, WIDE_TABLE.cz);
    this.environment.onThemeChange = () => this.establish();
    if (import.meta.env.DEV) (window as unknown as { __table: TableScene }).__table = this;

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();

    const loop = (now: number) => {
      if (this.disposed) return;
      this.tweens.tick(now);
      this.driftLight(now);
      this.environment.update(now);
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

  private buildLights(shadowSize: number): { hemi: THREE.HemisphereLight; key: THREE.DirectionalLight; warm: THREE.PointLight } {
    const hemi = new THREE.HemisphereLight('#fff4e0', '#2a1c10', 0.9);
    this.scene.add(hemi);
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
    return { hemi, key, warm };
  }

  /** Switch to a screen shape and the table area it should show. */
  setView(shape: Shape, frame: Frame): void {
    if (shape === this.shape && JSON.stringify(frame) === JSON.stringify(this.frame)) return;
    this.shape = shape;
    this.frame = frame;
    const t = shape === 'tall'
      ? { w: frame.maxX - frame.minX + 1.2, d: frame.maxZ - frame.minZ + 1.2, cz: (frame.minZ + frame.maxZ) / 2 }
      : WIDE_TABLE;
    this.environment.setTable(t.w, t.d, t.cz);
    this.resize();
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.clearViewOffset();
    let dist: number;
    if (this.shape === 'wide' || !this.frame) dist = this.poseWide();
    else dist = this.fit(this.frame, w, h);
    // Keep the fog behind the table however far back the camera sits.
    this.environment.setCameraDistance(dist);
  }

  /** The play camera, lifted by `shot` toward a low look across the table at its surroundings. Returns the camera distance. */
  private poseWide(): number {
    const e = this.shot * this.shot * (3 - 2 * this.shot);
    const L = THREE.MathUtils.lerp;
    // Frame the play area (about 16 x 11 units): back off on narrow screens.
    const dist = Math.max(12.8, 21.5 / Math.max(0.55, this.camera.aspect));
    const angle = THREE.MathUtils.degToRad(56);
    this.camera.position.set(0, L(Math.sin(angle) * dist, 2.4, e), L(Math.cos(angle) * dist + 0.6, dist * 1.2 + 2, e));
    // Aim low so the play area sits above the HTML dock at the bottom of the screen.
    this.camera.lookAt(0, L(0, 3.4, e), L(1.25, -12, e));
    this.camera.fov = L(40, 54, e);
    this.camera.updateProjectionMatrix();
    return L(dist, dist * 1.2 + 8, e);
  }

  /**
   * An establishing shot: when the table moves to a new place the camera swings
   * low to show the surroundings (towers, flags, sky), holds, and settles back.
   */
  establish(): void {
    if (this.shape !== 'wide' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = ++this.shotId;
    document.body.classList.add('establishing');
    const s0 = this.shot;
    const run = async () => {
      await this.tweens.add(1500, (k) => this.setShot(s0 + (1 - s0) * k), { owner: this.shotOwner });
      if (id !== this.shotId) return;
      await this.tweens.add(1500, () => {}, { owner: this.shotOwner });
      if (id !== this.shotId) return;
      await this.tweens.add(1300, (k) => this.setShot(1 - k), { owner: this.shotOwner });
      if (id === this.shotId) document.body.classList.remove('establishing');
    };
    void run();
  }

  private setShot(k: number): void {
    this.shot = k;
    if (this.shape !== 'wide' || !this.frame) return;
    this.environment.setCameraDistance(this.poseWide());
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
    document.body.classList.remove('establishing');
    this.environment.dispose();
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
