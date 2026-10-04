// The place the table sits in. A theme (see themes.ts) gives the surface, the
// light, the weather and the scenery for a location; this class builds it as
// real 3D around the table and blends from one theme to the next.

import * as THREE from 'three';
import { surfaceMaterial, type SurfaceSpec } from './surfaces';
import { buildThemeScene, type ThemeScene } from './props';
import { THEMES, themeFor, type Look, type ThemeId } from './themes';

const FLOOR_Y = -0.9;
const FADE_S = 1.8;
const FLOOR_SIZE = 160;

export interface EnvLights { hemi: THREE.HemisphereLight; key: THREE.DirectionalLight; warm: THREE.PointLight }

const NUMS = ['fogNear', 'fogFar', 'hemi', 'keyI', 'warmI', 'exposure', 'rimRough', 'rimMetal', 'ai0', 'ai1', 'af0', 'af1'] as const;
type Num = (typeof NUMS)[number];

/** Everything about the light that blends between two themes. */
class LookState {
  readonly sky = new THREE.Color();
  readonly skyTop = new THREE.Color();
  readonly hemiSky = new THREE.Color();
  readonly hemiGround = new THREE.Color();
  readonly key = new THREE.Color();
  readonly warm = new THREE.Color();
  readonly rim = new THREE.Color();
  readonly warmPos = new THREE.Vector3();
  readonly ac = [new THREE.Color(), new THREE.Color()] as const;
  readonly ap = [new THREE.Vector3(), new THREE.Vector3()] as const;
  readonly n = Object.fromEntries(NUMS.map((k) => [k, 0])) as Record<Num, number>;

  set(l: Look): this {
    this.sky.set(l.sky); this.skyTop.set(l.skyTop); this.hemiSky.set(l.hemiSky); this.hemiGround.set(l.hemiGround);
    this.key.set(l.key); this.warm.set(l.warm); this.rim.set(l.rim);
    this.warmPos.set(...l.warmPos);
    l.accents.forEach((a, i) => { this.ac[i]!.set(a.color); this.ap[i]!.set(...a.pos); });
    Object.assign(this.n, {
      fogNear: l.fogNear, fogFar: l.fogFar, hemi: l.hemi, keyI: l.keyI, warmI: l.warmI, exposure: l.exposure,
      rimRough: l.rimRough, rimMetal: l.rimMetal,
      ai0: l.accents[0].i, ai1: l.accents[1].i, af0: l.accents[0].flicker, af1: l.accents[1].flicker,
    });
    return this;
  }

  copy(o: LookState): this {
    for (const k of ['sky', 'skyTop', 'hemiSky', 'hemiGround', 'key', 'warm', 'rim'] as const) this[k].copy(o[k]);
    this.warmPos.copy(o.warmPos);
    for (let i = 0; i < 2; i++) { this.ac[i]!.copy(o.ac[i]!); this.ap[i]!.copy(o.ap[i]!); }
    Object.assign(this.n, o.n);
    return this;
  }

  lerp(a: LookState, b: LookState, t: number): this {
    for (const k of ['sky', 'skyTop', 'hemiSky', 'hemiGround', 'key', 'warm', 'rim'] as const) this[k].lerpColors(a[k], b[k], t);
    this.warmPos.lerpVectors(a.warmPos, b.warmPos, t);
    for (let i = 0; i < 2; i++) { this.ac[i]!.lerpColors(a.ac[i]!, b.ac[i]!, t); this.ap[i]!.lerpVectors(a.ap[i]!, b.ap[i]!, t); }
    for (const k of NUMS) this.n[k] = a.n[k] + (b.n[k] - a.n[k]) * t;
    return this;
  }
}

/** A surface that can crossfade: the settled mesh and a second one fading in above it. */
interface Layer { base: THREE.Mesh; fade: THREE.Mesh; t: number; active: boolean }

interface ArtEntry {
  top?: string;
  floor?: string;
  tile?: number;
  /** An equirectangular (2:1) panorama for the sky dome. */
  sky?: string;
  /** Horizon colour for the fog and ground, to match the panorama's horizon. */
  fog?: string;
  /** Keep the procedural skyline ring in front of the panorama (default: the panorama replaces it). */
  keepSkyline?: boolean;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

function disposeMaterial(m: THREE.Material): void {
  const s = m as THREE.MeshStandardMaterial;
  s.map?.dispose();
  s.emissiveMap?.dispose();
  m.dispose();
}

export class Environment {
  private readonly group = new THREE.Group();
  private readonly table = new THREE.Group();
  private readonly fog: THREE.Fog;
  private readonly bg: THREE.Color;
  private readonly dome: THREE.Mesh;
  private readonly blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  private readonly domeUniforms = {
    top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() },
    skyFrom: { value: this.blank as THREE.Texture }, skyTo: { value: this.blank as THREE.Texture },
    wFrom: { value: 0 }, wTo: { value: 0 },
  };
  private readonly skies = new Map<ThemeId, THREE.Texture>();
  private skyFrom: ThemeId | null = null;
  private skyTo: ThemeId | null = null;
  private artReady: Promise<void> = Promise.resolve();
  private readonly accents: THREE.PointLight[];
  private readonly rimMat = new THREE.MeshStandardMaterial();
  private readonly plinthMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  private readonly topLayer: Layer;
  private readonly floorLayer: Layer;
  private readonly scenes = new Map<ThemeId, ThemeScene>();
  private readonly from = new LookState();
  private readonly to = new LookState();
  private readonly shown = new LookState();
  private readonly motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  private art: Record<string, ArtEntry> = {};
  private look = 0;
  private time = 0;
  private last = 0;
  private camDist = 21;
  private tableKey = '';
  private dims = { w: 19, d: 12.6, cz: 0 };
  private theme: ThemeId = 'felt';
  /** Called when the look changes to a new place (not for the first, instant, setup). */
  onThemeChange: ((id: ThemeId) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly lights: EnvLights,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly aniso: number,
    private readonly coarse: boolean,
  ) {
    this.fog = new THREE.Fog('#15110d', 24, 42);
    this.bg = new THREE.Color('#15110d');
    scene.fog = this.fog;
    scene.background = this.bg;
    scene.add(this.group, this.table);

    this.accents = [0, 1].map(() => {
      const l = new THREE.PointLight('#000000', 0, 28, 1.6);
      scene.add(l);
      return l;
    });

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(100, 24, 12),
      new THREE.ShaderMaterial({
        uniforms: this.domeUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: 'varying vec3 vP; varying vec2 vUv; void main(){ vP = normalize(position); vUv = vec2(1.0 - uv.x, uv.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform sampler2D skyFrom; uniform sampler2D skyTo; uniform float wFrom; uniform float wTo; varying vec3 vP; varying vec2 vUv;\nvoid main(){ float h = pow(clamp(vP.y, 0.0, 1.0), 0.55); vec3 c = mix(bottom, top, h);\nc = mix(c, texture2D(skyFrom, vUv).rgb, wFrom); c = mix(c, texture2D(skyTo, vUv).rgb, wTo); gl_FragColor = vec4(c, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
      }),
    );
    this.dome.renderOrder = -2;
    this.group.add(this.dome);

    const first = THEMES.felt;
    this.topLayer = this.makeLayer(first.top, 1 / first.top.tile, 0.004);
    this.floorLayer = this.makeLayer(first.floor, FLOOR_SIZE / first.floor.tile, 0.01);
    this.floorLayer.base.geometry = this.floorLayer.fade.geometry = new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE);
    for (const m of [this.floorLayer.base, this.floorLayer.fade]) { m.rotation.x = -Math.PI / 2; m.position.y = FLOOR_Y; }
    this.floorLayer.fade.position.y += 0.01;
    this.group.add(this.floorLayer.base, this.floorLayer.fade);
    this.table.add(this.topLayer.base, this.topLayer.fade);

    this.shown.set(first.look);
    this.from.copy(this.shown);
    this.to.copy(this.shown);
    this.look = 1;
    this.apply(0);
    this.setTable(this.dims.w, this.dims.d, this.dims.cz);
    this.blank.needsUpdate = true;
    this.artReady = this.loadArt();
  }

  private makeLayer(spec: SurfaceSpec, repeat: number, lift: number): Layer {
    const base = new THREE.Mesh(undefined, surfaceMaterial(spec, repeat, this.aniso));
    const fade = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial());
    base.receiveShadow = fade.receiveShadow = true;
    base.rotation.x = fade.rotation.x = -Math.PI / 2;
    fade.position.y = lift;
    fade.visible = false;
    return { base, fade, t: 0, active: false };
  }

  /** Optional hand-made art: public/locations/manifest.json maps a theme to image files. */
  private async loadArt(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}locations/manifest.json`);
      if (res.ok) this.art = (await res.json()) as Record<string, ArtEntry>;
    } catch { /* no art: the procedural look is the default */ }
  }

  /** Start loading a theme's panorama (once); the dome picks it up when it arrives. */
  private loadSky(id: ThemeId): void {
    const file = this.art[id]?.sky;
    if (!file || this.skies.has(id)) return;
    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}locations/${file}`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.aniso;
      this.skies.set(id, tex);
      this.bindSkies();
    });
  }

  private bindSkies(): void {
    const u = this.domeUniforms;
    u.skyFrom.value = (this.skyFrom && this.skies.get(this.skyFrom)) || this.blank;
    u.skyTo.value = (this.skyTo && this.skies.get(this.skyTo)) || this.blank;
  }

  private surface(theme: ThemeId, which: 'top' | 'floor'): THREE.MeshStandardMaterial {
    const spec = THEMES[theme][which];
    const repeat = which === 'top' ? 1 / spec.tile : FLOOR_SIZE / spec.tile;
    const mat = surfaceMaterial(spec, repeat, this.aniso);
    const file = this.art[theme]?.[which];
    if (file) {
      const tile = this.art[theme]?.tile ?? spec.tile;
      new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}locations/${file}`, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = this.aniso;
        const r = which === 'top' ? 1 / tile : FLOOR_SIZE / tile;
        tex.repeat.set(r, r);
        mat.map?.dispose();
        mat.map = tex;
        mat.needsUpdate = true;
      });
    }
    return mat;
  }

  get current(): ThemeId { return this.theme; }

  /** Follow the location on the table: null keeps whatever is showing. */
  setLocation(def: string | null | undefined): void {
    if (def) this.setTheme(themeFor(def));
  }

  setTheme(id: ThemeId, instant = false): void {
    if (id === this.theme && !instant) return;
    // Wait for the art list before the first themed location, so a panorama is not missed.
    void this.artReady.then(() => this.applySky(id, instant));
    this.theme = id;
    const th = THEMES[id];
    this.begin(this.topLayer, this.surface(id, 'top'), instant);
    this.begin(this.floorLayer, this.surface(id, 'floor'), instant);
    this.from.copy(this.shown);
    this.to.set(th.look);
    const fog = this.art[id]?.fog;
    if (fog) this.to.sky.set(fog);
    this.look = instant ? 1 : 0;
    if (instant) this.shown.copy(this.to);
    this.ensureScene(id);
    if (instant) this.scenes.get(id)?.setFade(1);
    else if (id !== 'felt') this.onThemeChange?.(id);
  }

  /** Point the sky dome's two slots at the old and new panoramas. */
  private applySky(id: ThemeId, instant: boolean): void {
    this.skyFrom = instant ? null : this.skyTo;
    this.skyTo = id;
    this.loadSky(id);
    this.bindSkies();
  }

  private ensureScene(id: ThemeId): ThemeScene | undefined {
    let ts = this.scenes.get(id);
    if (ts) return ts;
    const th = THEMES[id];
    if (th.props === 'none' && !th.fx.length && !th.skyline && !th.beams.n && !th.mist) return undefined;
    const art = this.art[id];
    ts = buildThemeScene(th, { key: this.lights.key }, this.coarse, Object.keys(THEMES).indexOf(id) + 1, !!art?.sky && !art.keepSkyline);
    ts.layout(this.dims.w, this.dims.d, this.dims.cz);
    this.group.add(ts.group);
    this.scenes.set(id, ts);
    return ts;
  }

  private begin(layer: Layer, mat: THREE.MeshStandardMaterial, instant: boolean): void {
    if (layer.active) this.finish(layer);
    if (instant) {
      disposeMaterial(layer.base.material as THREE.Material);
      layer.base.material = mat;
      return;
    }
    mat.transparent = true;
    mat.opacity = 0;
    layer.fade.material = mat;
    layer.fade.visible = true;
    layer.t = 0;
    layer.active = true;
  }

  private finish(layer: Layer): void {
    const mat = layer.fade.material as THREE.MeshStandardMaterial;
    disposeMaterial(layer.base.material as THREE.Material);
    mat.opacity = 1;
    mat.transparent = false;
    layer.base.material = mat;
    layer.fade.visible = false;
    layer.fade.material = new THREE.MeshBasicMaterial();
    layer.active = false;
  }

  /** The distance from the camera to the table, so the fog stays behind it. */
  setCameraDistance(dist: number): void {
    this.camDist = dist;
    this.fog.near = dist + this.shown.n.fogNear;
    this.fog.far = dist + this.shown.n.fogFar;
  }

  /** (Re)build the slab the cards lie on: top, rim and plinth, `w` x `d` and centred on z = `cz`. */
  setTable(w: number, d: number, cz: number): void {
    const key = `${w.toFixed(2)}:${d.toFixed(2)}:${cz.toFixed(2)}`;
    if (key === this.tableKey) return;
    this.tableKey = key;
    this.dims = { w, d, cz };
    for (const o of [...this.table.children]) {
      if (o === this.topLayer.base || o === this.topLayer.fade) continue;
      (o as THREE.Mesh).geometry.dispose();
      this.table.remove(o);
    }
    this.table.position.z = cz;

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

    const top = new THREE.ShapeGeometry(shape, 24);
    for (const m of [this.topLayer.base, this.topLayer.fade]) {
      if (m.geometry !== top) m.geometry?.dispose();
      m.geometry = top;
    }

    const rimShape = shape.clone();
    rimShape.holes.push(new THREE.Path(shape.getPoints(48).map((p) => p.clone().multiplyScalar(0.965)).reverse()));
    const rim = new THREE.Mesh(
      new THREE.ExtrudeGeometry(rimShape, { depth: 0.35, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 3, curveSegments: 24 }),
      this.rimMat,
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = -0.02;
    rim.castShadow = rim.receiveShadow = true;
    this.table.add(rim);

    // The slab the table top sits on, so it stands in the place instead of floating over it.
    const plinthGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false, curveSegments: 24 });
    plinthGeo.scale(0.985, 0.985, 1);
    const plinth = new THREE.Mesh(plinthGeo, this.plinthMat);
    plinth.rotation.x = -Math.PI / 2;
    plinth.position.y = FLOOR_Y - 0.04;
    plinth.castShadow = plinth.receiveShadow = true;
    this.table.add(plinth);

    for (const ts of this.scenes.values()) ts.layout(w, d, cz);
  }

  /** Per frame: blend the look, fade scenery in and out, run the weather. */
  update(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const motion = this.motionQuery?.matches ? 0.25 : 1;
    this.time += dt * motion;

    if (this.look < 1) {
      this.look = Math.min(1, this.look + dt / FADE_S);
      this.shown.lerp(this.from, this.to, smooth(this.look));
    }
    for (const layer of [this.topLayer, this.floorLayer]) {
      if (!layer.active) continue;
      layer.t = Math.min(1, layer.t + dt / FADE_S);
      (layer.fade.material as THREE.MeshStandardMaterial).opacity = smooth(layer.t);
      if (layer.t >= 1) this.finish(layer);
    }
    for (const [id, ts] of this.scenes) {
      const target = id === this.theme ? 1 : 0;
      if (ts.fade !== target) ts.setFade(target > ts.fade ? Math.min(1, ts.fade + dt / FADE_S) : Math.max(0, ts.fade - dt / FADE_S));
      if (ts.fade > 0.002) ts.tick(this.time, dt * motion);
      else if (id !== this.theme) { // gone for now: free it
        this.group.remove(ts.group);
        ts.dispose();
        this.scenes.delete(id);
      }
    }
    const e = smooth(this.look);
    this.domeUniforms.wTo.value = this.skyTo && this.skies.has(this.skyTo) ? e : 0;
    this.domeUniforms.wFrom.value = this.skyFrom && this.skies.has(this.skyFrom) ? 1 - e : 0;
    this.pulseGlow();
    this.apply(this.time);
  }

  /** Lava cracks breathe. */
  private pulseGlow(): void {
    const k = 0.75 + 0.25 * Math.sin(this.time * 1.4);
    const set = (m: THREE.Material | THREE.Material[], scale: number) => {
      const s = m as THREE.MeshStandardMaterial;
      if (s.emissiveMap) s.emissiveIntensity = k * scale;
    };
    set(this.topLayer.base.material, 0.5);
    set(this.topLayer.fade.material, 0.5);
    set(this.floorLayer.base.material, 0.25);
    set(this.floorLayer.fade.material, 0.25);
  }

  /** Push the blended look onto the scene's lights, fog and sky. */
  private apply(t: number): void {
    const s = this.shown;
    const n = s.n;
    this.bg.copy(s.sky);
    this.fog.color.copy(s.sky);
    this.fog.near = this.camDist + n.fogNear;
    this.fog.far = this.camDist + n.fogFar;
    this.domeUniforms.top.value.copy(s.skyTop);
    this.domeUniforms.bottom.value.copy(s.sky);
    this.renderer.toneMappingExposure = n.exposure;
    const { hemi, key, warm } = this.lights;
    hemi.color.copy(s.hemiSky); hemi.groundColor.copy(s.hemiGround); hemi.intensity = n.hemi;
    key.color.copy(s.key); key.intensity = n.keyI;
    warm.color.copy(s.warm); warm.intensity = n.warmI; warm.position.copy(s.warmPos);
    this.accents.forEach((l, i) => {
      const flick = (i ? n.af1 : n.af0) * (Math.sin(t * 9 + i * 2) * 0.15 + Math.sin(t * 14.3 + i) * 0.1);
      l.color.copy(s.ac[i]!);
      l.intensity = (i ? n.ai1 : n.ai0) * (1 + flick);
      l.position.copy(s.ap[i]!);
    });
    this.rimMat.color.copy(s.rim);
    this.rimMat.roughness = n.rimRough;
    this.rimMat.metalness = n.rimMetal;
    this.plinthMat.color.copy(s.rim).multiplyScalar(0.7);
  }

  dispose(): void {
    for (const ts of this.scenes.values()) ts.dispose();
    this.scenes.clear();
    for (const layer of [this.topLayer, this.floorLayer]) {
      disposeMaterial(layer.base.material as THREE.Material);
      disposeMaterial(layer.fade.material as THREE.Material);
    }
    for (const t of this.skies.values()) t.dispose();
    this.blank.dispose();
    this.rimMat.dispose();
    this.plinthMat.dispose();
  }
}
