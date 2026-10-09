// The place the table sits in. A theme (see themes.ts) gives the surface, the
// light, the weather and the scenery for a location; this class builds it as
// real 3D around the table and blends from one theme to the next.

import * as THREE from 'three';
import { surfaceMaterial, type SurfaceSpec } from './surfaces';
import { buildThemeScene, type ThemeScene } from './props';
import { groundMaterial, type GroundUniforms } from './ground';
import { TABLE_CORNER } from './tables';
import { sharesFamilySky, THEMES, themeFor, type Look, type ThemeId } from './themes';

const FADE_S = 1.8;
/** How thick the fog and the horizon haze are before the player changes them (1 = the full amount each place was designed with). */
export const FOG_DEFAULT = 0.5;
export const HAZE_DEFAULT = 0.5;
/**
 * The sky oval: semi-axes in world units (along the table, up, behind the table), and how far its middle is sunk below the
 * ground. Sunk, the panorama's own horizon is hidden behind the ground, so the far edge of the ground meets the sky a little
 * above it, in the part of the picture that fades into the ground's fog colour (see horizonColor). It moves with the ground.
 */
const DOME = { long: 125, tall: 125, short: 80, below: 3.1 };

/** The ground reaches past the sky oval on every side, so no lower half of the panorama shows beyond its edge. */
const FLOOR_SIZE = DOME.long * 2 + 40;
/** The floor is cut into this many squares a side, so the swell of waves and clouds has vertices to move. */
const FLOOR_CELLS = 160;

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

/** What public/locations/manifest.json says about one look: a location id, or a family (the fallback for its places). */
interface ArtEntry {
  top?: string;
  floor?: string;
  tile?: number;
  /** An equirectangular (2:1) panorama for the sky dome; `null` says this place has none, whatever its family has. */
  sky?: string | null;
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
  private readonly fogRgb = { r: 0, g: 0, b: 0 };
  /** Debug: 1 = the fog each place was designed with, 0 = none, higher = thicker. */
  private fogLevel = FOG_DEFAULT;
  /** Debug: a place held fixed whatever the game reveals. */
  private pinnedTheme: ThemeId | null = null;
  private readonly dome: THREE.Mesh;
  private readonly blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  private readonly domeUniforms = {
    top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() },
    skyFrom: { value: this.blank as THREE.Texture }, skyTo: { value: this.blank as THREE.Texture },
    wFrom: { value: 0 }, wTo: { value: 0 },
    /** How far each panorama has slid round the sky (a fraction of a turn). */
    offFrom: { value: 0 }, offTo: { value: 0 },
    /** The fog colour as it is shown on screen (output colour space), for the sky to meet the ground. */
    fogOut: { value: new THREE.Vector3() },
    /** Scales how high the horizon haze reaches (1 = as designed; the debug panel changes it). */
    haze: { value: HAZE_DEFAULT },
  };
  /** The panoramas loaded so far, by file name (places of one family share a file). */
  private readonly skies = new Map<string, THREE.Texture>();
  private readonly skyLoading = new Set<string>();
  /** Horizon colour read from each loaded panorama, so the ground fades into the sky without a seam. */
  private readonly autoFog = new Map<string, THREE.Color>();
  /** The look whose panorama fades out and the one whose fades in (a look decides how far its sky slides round), and their files. */
  private skyFrom: ThemeId | null = null;
  private skyTo: ThemeId | null = null;
  private fileFrom: string | null = null;
  private fileTo: string | null = null;
  private artReady: Promise<void> = Promise.resolve();
  private readonly accents: THREE.PointLight[];
  private readonly rimMat = new THREE.MeshStandardMaterial();
  private readonly plinthMat = new THREE.MeshStandardMaterial({ roughness: 0.9, transparent: true });
  private plinth: THREE.Mesh | null = null;
  /** What every moving, broken or mirroring ground shares: the clock, the table's footprint, and the sky (which water reflects). */
  private readonly groundU: GroundUniforms = {
    time: { value: 0 },
    table: { value: new THREE.Vector4(9.5, 6.3, 0, 0) },
    sky: this.domeUniforms,
    dome: { value: new THREE.Vector4(DOME.long, DOME.tall, DOME.short, 0) },
  };
  /** The sea, the sky and the ground turned together, so the whole backdrop can rock round the table. */
  private readonly backdrop = new THREE.Group();
  /** How far the backdrop rocks now (peak degrees), and the amounts it is easing between. */
  private sway = 0;
  private swayFrom = 0;
  private swayTo = 0;
  /** The ground's height now, and the heights it is moving between (the table stands higher over some grounds than others). */
  private ground = 0;
  private groundFrom = 0;
  private groundTo = 0;
  /** How much of the plain felt slab (rim and plinth) is still showing: 1 for the felt, 0 for any place with a table of its own. */
  private plain = 1;
  private plainFrom = 1;
  private plainTo = 1;
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
      // A unit sphere with plenty of facets (a coarse one bends straight lines in the panorama into a "box"), stretched below.
      new THREE.SphereGeometry(1, 96, 48),
      new THREE.ShaderMaterial({
        uniforms: this.domeUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: 'varying vec3 vP; varying vec2 vUv; void main(){ vP = normalize(position); vUv = vec2(1.0 - uv.x, uv.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform vec3 fogOut; uniform float haze; uniform sampler2D skyFrom; uniform sampler2D skyTo; uniform float wFrom; uniform float wTo; uniform float offFrom; uniform float offTo; varying vec3 vP; varying vec2 vUv;\nvoid main(){ float h = pow(clamp(vP.y, 0.0, 1.0), mix(0.55, 1.4, max(wFrom, wTo))); vec3 c = mix(bottom, top, h);\nfloat vis = smoothstep(0.07 * haze, 0.32 * haze + 0.001, vP.y); c = mix(c, texture2D(skyFrom, vec2(vUv.x + offFrom, vUv.y)).rgb, wFrom * vis); c = mix(c, texture2D(skyTo, vec2(vUv.x + offTo, vUv.y)).rgb, wTo * vis); gl_FragColor = vec4(c, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n// The ground fades into the fog colour, which is not tone mapped: so the sky meets it as exactly that colour, with no line.\ngl_FragColor.rgb = mix(gl_FragColor.rgb, fogOut, 1.0 - smoothstep(0.08 * haze, 0.3 * haze + 0.001, vP.y));\n}',
      }),
    );
    // An oval, not a ball: long across the table (x) and shallow behind it (z). The camera looks along the short axis,
    // so what it sees is the long, gently curved side of the oval: a wide backdrop, not the inside of a box. The
    // height matches the length so the panorama keeps its proportions where it is seen.
    this.dome.scale.set(DOME.long, DOME.tall, DOME.short);
    this.dome.renderOrder = -2;
    this.backdrop.add(this.dome);
    this.group.add(this.backdrop);

    const first = THEMES.felt;
    this.ground = this.groundFrom = this.groundTo = -first.table.height;
    this.plain = this.plainFrom = this.plainTo = first.table.kind === 'plain' ? 1 : 0;
    this.sway = this.swayFrom = this.swayTo = first.sway ?? 0;
    this.topLayer = this.makeLayer(first.top, 1 / first.top.tile, 0.004);
    this.floorLayer = this.makeLayer(first.floor, FLOOR_SIZE / first.floor.tile, 0.01);
    this.floorLayer.base.geometry = this.floorLayer.fade.geometry = new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE, FLOOR_CELLS, FLOOR_CELLS);
    for (const m of [this.floorLayer.base, this.floorLayer.fade]) m.rotation.x = -Math.PI / 2;
    this.backdrop.add(this.floorLayer.base, this.floorLayer.fade);
    this.table.add(this.topLayer.base, this.topLayer.fade);
    this.placeGround();

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

  /**
   * What the manifest holds for a look: its own entry over its family's. A family lends its sky and fog colour only to
   * places with the same enclosure (indoors or out), so a tomb never gets an outdoor sky; it shows the plain gradient
   * until it has a painting of its own.
   */
  private artOf(id: ThemeId): ArtEntry {
    const th = THEMES[id];
    const own = this.art[id];
    const fam = th.family === id ? undefined : this.art[th.family];
    if (!fam) return own ?? {};
    return { ...fam, ...(sharesFamilySky(id) ? {} : { sky: undefined, fog: undefined, keepSkyline: undefined }), ...own };
  }

  /** Start loading a panorama (once); the dome picks it up when it arrives. */
  private loadSky(file: string): void {
    if (this.skies.has(file) || this.skyLoading.has(file)) return;
    this.skyLoading.add(file);
    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}locations/${file}`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.aniso;
      // So a panorama that slides round the sky wraps past its own edge.
      tex.wrapS = THREE.RepeatWrapping;
      this.skies.set(file, tex);
      this.skyLoading.delete(file);
      this.bindSkies();
      const fog = this.horizonColor(tex);
      if (fog) {
        this.autoFog.set(file, fog);
        if (this.fileTo === file) {
          this.to.sky.copy(fog);
          if (this.look >= 1) this.shown.sky.copy(fog);
        }
      }
    });
  }

  /** The average colour of the band of the panorama where the far edge of the ground meets it (just above its horizon), a touch darker. */
  private horizonColor(tex: THREE.Texture): THREE.Color | null {
    try {
      const img = tex.image as CanvasImageSource;
      const c = document.createElement('canvas');
      c.width = 64; c.height = 32;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0, 64, 32);
      const d = g.getImageData(0, 13, 64, 2).data;
      let r = 0, gr = 0, b = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { r += d[i]!; gr += d[i + 1]!; b += d[i + 2]!; }
      return new THREE.Color().setRGB((r / n / 255) * 0.92, (gr / n / 255) * 0.92, (b / n / 255) * 0.92, THREE.SRGBColorSpace);
    } catch {
      return null;
    }
  }

  private bindSkies(): void {
    const u = this.domeUniforms;
    u.skyFrom.value = (this.fileFrom && this.skies.get(this.fileFrom)) || this.blank;
    u.skyTo.value = (this.fileTo && this.skies.get(this.fileTo)) || this.blank;
  }

  private surface(theme: ThemeId, which: 'top' | 'floor'): THREE.MeshStandardMaterial {
    const spec = THEMES[theme][which];
    const repeat = which === 'top' ? 1 / spec.tile : FLOOR_SIZE / spec.tile;
    const mat = surfaceMaterial(spec, repeat, this.aniso);
    const shape = THEMES[theme].floorShape;
    if (which === 'floor' && shape) groundMaterial(mat, shape, this.groundU);
    const art = this.artOf(theme);
    const file = art[which];
    if (file) {
      const tile = art.tile ?? spec.tile;
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
    if (def && !this.pinnedTheme) this.setTheme(themeFor(def));
  }

  // --- debug controls ---------------------------------------------------------------

  /** Every look the table can have. */
  get themeIds(): ThemeId[] { return Object.keys(THEMES) as ThemeId[]; }
  get pinned(): ThemeId | null { return this.pinnedTheme; }
  /** Hold one look fixed (null: follow the game's locations again). */
  pin(id: ThemeId | null): void {
    this.pinnedTheme = id;
    if (id) this.setTheme(id);
  }
  get fogAmount(): number { return this.fogLevel; }
  /** 0 = no fog, 1 = as designed, higher = the fog starts nearer. */
  setFogLevel(level: number): void {
    this.fogLevel = Math.max(0, level);
    this.setCameraDistance(this.camDist);
  }
  get hazeAmount(): number { return this.domeUniforms.haze.value; }
  setHaze(level: number): void { this.domeUniforms.haze.value = Math.max(0, level); }

  /** Where the fog starts and ends, from the look's own numbers and the debug fog level. */
  private fogRange(n: { fogNear: number; fogFar: number }): { near: number; far: number } {
    if (this.fogLevel <= 0.001) return { near: 1e5, far: 2e5 };
    return { near: this.camDist + n.fogNear / this.fogLevel, far: this.camDist + n.fogFar / this.fogLevel };
  }

  setTheme(id: ThemeId, instant = false): void {
    if (id === this.theme && !instant) return;
    // Wait for the art list before the first themed location, so a panorama is not missed.
    void this.artReady.then(() => this.applySky(id, instant));
    this.theme = id;
    const th = THEMES[id];
    this.begin(this.topLayer, this.surface(id, 'top'), instant);
    this.begin(this.floorLayer, this.surface(id, 'floor'), instant);
    // The ground and the felt slab ease to their new state along with the light.
    this.groundFrom = this.ground;
    this.groundTo = -th.table.height;
    this.plainFrom = this.plain;
    this.plainTo = th.table.kind === 'plain' ? 1 : 0;
    this.swayFrom = this.sway;
    this.swayTo = th.sway ?? 0;
    this.from.copy(this.shown);
    this.to.set(th.look);
    const art = this.artOf(id);
    const auto = art.sky ? this.autoFog.get(art.sky) : undefined;
    if (auto) this.to.sky.copy(auto);
    else if (art.sky && art.fog) this.to.sky.set(art.fog);
    this.look = instant ? 1 : 0;
    if (instant) {
      this.shown.copy(this.to);
      this.ground = this.groundTo;
      this.plain = this.plainTo;
      this.sway = this.swayTo;
      this.placeGround();
    }
    this.ensureScene(id);
    if (instant) this.scenes.get(id)?.setFade(1);
  }

  /** Point the sky dome's two slots at the old and new panoramas. */
  private applySky(id: ThemeId, instant: boolean): void {
    this.skyFrom = instant ? null : this.skyTo;
    this.fileFrom = instant ? null : this.fileTo;
    this.skyTo = id;
    this.fileTo = this.artOf(id).sky ?? null;
    if (this.fileTo) this.loadSky(this.fileTo);
    this.bindSkies();
  }

  private ensureScene(id: ThemeId): ThemeScene | undefined {
    let ts = this.scenes.get(id);
    if (ts) return ts;
    const th = THEMES[id];
    if (th.table.kind === 'plain' && !th.fx.length && !th.skyline && !th.beams.n && !th.mist) return undefined;
    const art = this.artOf(id);
    ts = buildThemeScene(th, { key: this.lights.key, aniso: this.aniso }, this.coarse, Object.keys(THEMES).indexOf(id) + 1, !!art.sky && !art.keepSkyline);
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
    const r = this.fogRange(this.shown.n);
    this.fog.near = r.near;
    this.fog.far = r.far;
  }

  /** (Re)build the slab the cards lie on: top, rim and plinth, `w` x `d` and centred on z = `cz`. */
  setTable(w: number, d: number, cz: number): void {
    const key = `${w.toFixed(2)}:${d.toFixed(2)}:${cz.toFixed(2)}`;
    if (key === this.tableKey) return;
    this.tableKey = key;
    this.dims = { w, d, cz };
    this.groundU.table.value.set(w / 2, d / 2, cz, 0);
    for (const o of [...this.table.children]) {
      if (o === this.topLayer.base || o === this.topLayer.fade) continue;
      (o as THREE.Mesh).geometry.dispose();
      this.table.remove(o);
    }
    this.table.position.z = cz;

    const r = TABLE_CORNER;
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

    // The slab the plain felt top sits on, so it stands in the place instead of floating over it. (Every other
    // table has a body of its own: see tables.ts.)
    const plinthGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false, curveSegments: 24 });
    plinthGeo.scale(0.985, 0.985, 1);
    const plinth = new THREE.Mesh(plinthGeo, this.plinthMat);
    plinth.rotation.x = -Math.PI / 2;
    plinth.position.y = -THEMES.felt.table.height - 0.04;
    plinth.castShadow = plinth.receiveShadow = true;
    plinth.visible = this.plain > 0.002;
    this.table.add(plinth);
    this.plinth = plinth;

    for (const ts of this.scenes.values()) ts.layout(w, d, cz);
  }

  /** Per frame: blend the look, fade scenery in and out, run the weather. */
  update(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const motion = this.motionQuery?.matches ? 0.25 : 1;
    this.time += dt * motion;
    this.groundU.time.value = this.time;

    if (this.look < 1) {
      this.look = Math.min(1, this.look + dt / FADE_S);
      const k = smooth(this.look);
      this.shown.lerp(this.from, this.to, k);
      this.ground = this.groundFrom + (this.groundTo - this.groundFrom) * k;
      this.plain = this.plainFrom + (this.plainTo - this.plainFrom) * k;
      this.sway = this.swayFrom + (this.swayTo - this.swayFrom) * k;
      this.placeGround();
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
    this.domeUniforms.wTo.value = this.fileTo && this.skies.has(this.fileTo) ? e : 0;
    this.domeUniforms.wFrom.value = this.fileFrom && this.skies.has(this.fileFrom) ? 1 - e : 0;
    // Some panoramas slide slowly round the sky, so the ships (or the clouds) in them pass by.
    this.domeUniforms.offTo.value = this.skyTo ? (this.time * (THEMES[this.skyTo].skyScroll ?? 0)) % 1 : 0;
    this.domeUniforms.offFrom.value = this.skyFrom ? (this.time * (THEMES[this.skyFrom].skyScroll ?? 0)) % 1 : 0;
    this.pulseGlow();
    this.rock(this.time);
    this.apply(this.time);
  }

  /** Rock the sea and the sky about the table, slowly and unevenly, as if it were bobbing on the water. */
  private rock(t: number): void {
    const a = (this.sway * Math.PI) / 180;
    this.backdrop.rotation.z = a * (Math.sin(t * 0.9) * 0.7 + Math.sin(t * 0.47 + 1.3) * 0.3);
    this.backdrop.rotation.x = a * 0.6 * (Math.sin(t * 0.71 + 0.8) * 0.7 + Math.sin(t * 1.23) * 0.3);
  }

  /** Put the ground, and the sky that is sunk below it, at the current ground height. */
  private placeGround(): void {
    this.floorLayer.base.position.y = this.ground;
    this.floorLayer.fade.position.y = this.ground + 0.01;
    this.dome.position.y = this.ground - DOME.below;
    this.groundU.dome.value.w = this.dome.position.y;
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
    set(this.floorLayer.base.material, 0.8);
    set(this.floorLayer.fade.material, 0.8);
  }

  /** Push the blended look onto the scene's lights, fog and sky. */
  private apply(t: number): void {
    const s = this.shown;
    const n = s.n;
    this.bg.copy(s.sky);
    this.fog.color.copy(s.sky);
    const r = this.fogRange(n);
    this.fog.near = r.near;
    this.fog.far = r.far;
    this.domeUniforms.top.value.copy(s.skyTop);
    this.domeUniforms.bottom.value.copy(s.sky);
    this.fog.color.getRGB(this.fogRgb, this.renderer.outputColorSpace);
    this.domeUniforms.fogOut.value.set(this.fogRgb.r, this.fogRgb.g, this.fogRgb.b);
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
    this.plinthMat.opacity = this.plain;
    if (this.plinth) this.plinth.visible = this.plain > 0.002;
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
