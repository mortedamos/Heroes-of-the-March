// Board: owns every card mesh and reconciles them against successive
// layouts with animation. Also draws deck/discard stacks.

import * as THREE from 'three';
import { getDef, type DeckName, type GameView } from '../../engine';
import { DECKS } from '../../engine/types';
import { cardBack, cardFace } from './cardFaces';
import { computeLayout, type Layout, type Placement, type Shape } from './layout';
import type { TableScene } from './TableScene';
import { easeOut } from './tween';
import { PALETTE, type Theme } from '../ui/themes';

const CARD_GEOM = new THREE.BoxGeometry(1, 0.012, 1.4);
const EDGE_MAT = new THREE.MeshStandardMaterial({ color: '#d9ccb0', roughness: 0.8 });
const MOVE_MS = 520;
/** An ability flash: the card glows gold and pulses twice. */
const FLASH_MS = 1400;
const FLASH_COLOR = new THREE.Color('#ffc451');

interface CardObj {
  mesh: THREE.Mesh;
  key: string;
  def: string | null;
  back: DeckName;
  faceUp: boolean;
  base: { x: number; y: number; z: number; rotZ: number; scale: number };
  /** A fixed slight skew (radians about the vertical axis) so the table looks handled, not ruled. */
  yaw: number;
  /** The weak red outline on a card that an ability has been used against. */
  glow: THREE.Group | null;
  /** The pulsing blue outline on a card whose ability can be used now. */
  attn: THREE.Group | null;
  /** Current wiggle (radians about the vertical axis) for an attention card. */
  wiggle: number;
  /** Current shake strength (world units), decaying every frame. */
  shake: number;
  hover: number;
  /** When an ability flash started (performance.now()), or null. */
  flashAt: number | null;
  flash: number;
  removing: boolean;
}

const RING_GEOM = new THREE.RingGeometry(0.55, 0.68, 40).rotateX(-Math.PI / 2);
let glowTex: THREE.CanvasTexture | null = null;
/** A soft round spark, drawn once. */
function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** A flat rectangular frame (lying in the card's plane) around a card of 1 x 1.4. */
function frame(w: number, h: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -h / 2); shape.lineTo(w / 2, -h / 2); shape.lineTo(w / 2, h / 2); shape.lineTo(-w / 2, h / 2); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-0.49, -0.69); hole.lineTo(-0.49, 0.69); hole.lineTo(0.49, 0.69); hole.lineTo(0.49, -0.69); hole.closePath();
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
}
const GLOW_INNER = frame(1.1, 1.5);
const GLOW_OUTER = frame(1.26, 1.66);
const glowMat = (opacity: number) => new THREE.MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
const GLOW_MAT_INNER = glowMat(0.5);
const GLOW_MAT_OUTER = glowMat(0.2);

/** "This card can act now": a pulsing sky-blue outline and a short wiggle every couple of seconds. */
const ATTN_COLOR = '#4fb8ff';
const ATTN_PULSE_MS = 1400;
const ATTN_WIGGLE_EVERY_MS = 2600;
const ATTN_WIGGLE_MS = 520;
const ATTN_FADE_MS = 2000;
const attnMat = (opacity: number) => new THREE.MeshBasicMaterial({ color: ATTN_COLOR, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
const ATTN_MAT_INNER = attnMat(0.6);
const ATTN_MAT_OUTER = attnMat(0.3);
const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Between 1° and 5° to either side, never quite straight. */
function randomYaw(): number {
  const deg = 1 + Math.random() * 4;
  return (Math.random() < 0.5 ? -deg : deg) * Math.PI / 180;
}

export class Board {
  private readonly cards = new Map<string, CardObj>();
  private attnDeadline: number | null = null;
  private readonly faceTextures = new Map<string, THREE.CanvasTexture>();
  private readonly backMaterials = new Map<DeckName, THREE.MeshStandardMaterial>();
  private readonly stacks = new Map<string, THREE.Mesh>();
  private hovered: CardObj | null = null;
  layout: Layout | null = null;
  /** Screen position (CSS px) of the hand card with this definition, so a card you bid flies from it. */
  handOrigin: ((def: string | null) => { x: number; y: number } | null) | null = null;
  /** Screen shape the next layout is computed for. */
  shape: Shape = 'wide';

  constructor(private readonly t: TableScene) {
    t.onFrame((now) => this.frame(now));
  }

  // --- textures & materials ----------------------------------------------------

  private faceMaterial(defId: string): THREE.MeshStandardMaterial {
    let tex = this.faceTextures.get(defId);
    if (!tex) {
      const canvas = cardFace(defId, () => { tex!.needsUpdate = true; });
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.t.maxAnisotropy;
      this.faceTextures.set(defId, tex);
    }
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0 });
  }

  private backMaterial(deck: DeckName): THREE.MeshStandardMaterial {
    let m = this.backMaterials.get(deck);
    if (!m) {
      const tex = new THREE.CanvasTexture(cardBack(deck));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.t.maxAnisotropy;
      m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
      this.backMaterials.set(deck, m);
    }
    return m;
  }

  private setMaterials(obj: CardObj): void {
    const front = obj.def ? this.faceMaterial(obj.def) : this.backMaterial(obj.back);
    const back = this.backMaterial(obj.back);
    const old = obj.mesh.material as THREE.Material[];
    // +x, -x, +y (front), -y (back), +z, -z
    obj.mesh.material = [EDGE_MAT, EDGE_MAT, front, back, EDGE_MAT, EDGE_MAT];
    if (Array.isArray(old)) {
      const f = old[2];
      if (f && f !== front && !([...this.backMaterials.values()] as THREE.Material[]).includes(f)) f.dispose();
    }
  }

  // --- reconcile ------------------------------------------------------------------

  /** Animate from the previous layout to the one for `view`. Resolves when motion settles. */
  async update(view: GameView, prev: GameView | null): Promise<void> {
    const layout = computeLayout(view, this.shape);
    this.layout = layout;
    this.rekeyReveals(view, prev);

    const seen = new Set<string>();
    const moves: Promise<void>[] = [];
    let stagger = 0;
    for (const p of layout.cards) {
      seen.add(p.key);
      let obj = this.cards.get(p.key);
      if (!obj) {
        obj = this.spawn(p);
        // A card you just bid flies down from your hand.
        if (p.bid && p.owner === view.you) {
          const from = this.handOrigin?.(p.def);
          const at = from ? this.t.screenToTable(from.x, from.y, 0.8) : null;
          if (at) { obj.base.x = at.x; obj.base.z = at.z; obj.base.y = 0.8; obj.base.scale = 0.9; }
        }
        moves.push(this.moveTo(obj, p, stagger));
        stagger += 60;
      } else {
        if (obj.def !== p.def || obj.back !== p.back) {
          obj.def = p.def;
          obj.back = p.back;
          this.setMaterials(obj);
        }
        moves.push(this.moveTo(obj, p, 0));
      }
    }
    for (const [key, obj] of this.cards) if (!seen.has(key) && !obj.removing) moves.push(this.remove(obj));
    this.updateStacks(layout);
    await Promise.all(moves);
  }

  /** Face-down bids that were just revealed keep their mesh and flip in place. */
  private rekeyReveals(view: GameView, prev: GameView | null): void {
    if (!prev) return;
    for (const p of view.players) {
      const before = prev.players.find((x) => x.id === p.id);
      if (!before) continue;
      p.bids.forEach((b, i) => {
        const was = before.bids[i];
        if (was?.hidden && !b.hidden) {
          const obj = this.cards.get(`hid:${p.id}:${i}`);
          if (obj && !this.cards.has(b.card.id)) {
            this.cards.delete(obj.key);
            obj.key = b.card.id;
            this.cards.set(obj.key, obj);
          }
        }
      });
    }
  }

  private spawn(p: Placement): CardObj {
    const mesh = new THREE.Mesh(CARD_GEOM);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const obj: CardObj = {
      mesh, key: p.key, def: p.def, back: p.back, faceUp: false,
      base: { x: p.spawn.x, y: 0.3, z: p.spawn.z, rotZ: Math.PI, scale: 0.55 },
      yaw: randomYaw(),
      glow: null, attn: null, wiggle: 0,
      shake: 0,
      hover: 0, flashAt: null, flash: 0, removing: false,
    };
    mesh.userData['card'] = obj;
    this.setMaterials(obj);
    this.apply(obj);
    this.t.scene.add(mesh);
    this.cards.set(p.key, obj);
    return obj;
  }

  private moveTo(obj: CardObj, p: Placement, delay: number): Promise<void> {
    const from = { ...obj.base };
    const to = { x: p.x, y: p.y, z: p.z, rotZ: p.faceUp ? 0 : Math.PI, scale: p.scale };
    obj.faceUp = p.faceUp;
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const flipping = Math.abs(to.rotZ - from.rotZ) > 0.01;
    if (dist < 0.001 && !flipping && Math.abs(to.scale - from.scale) < 0.001 && Math.abs(to.y - from.y) < 0.001) return Promise.resolve();
    const lift = Math.min(1.2, 0.25 + dist * 0.12) + (flipping ? 0.5 : 0);
    return this.t.tweens.add(MOVE_MS + Math.min(300, dist * 30), (k) => {
      obj.base.x = from.x + (to.x - from.x) * k;
      obj.base.z = from.z + (to.z - from.z) * k;
      obj.base.y = from.y + (to.y - from.y) * k + Math.sin(Math.PI * k) * lift;
      obj.base.rotZ = from.rotZ + (to.rotZ - from.rotZ) * k;
      obj.base.scale = from.scale + (to.scale - from.scale) * k;
    }, { owner: obj, delay });
  }

  private remove(obj: CardObj): Promise<void> {
    obj.removing = true;
    const from = { ...obj.base };
    return this.t.tweens.add(380, (k) => {
      obj.base.y = from.y + k * 0.6;
      obj.base.scale = from.scale * (1 - 0.6 * k);
      for (const m of obj.mesh.material as THREE.MeshStandardMaterial[]) {
        if (m === EDGE_MAT || [...this.backMaterials.values()].includes(m)) continue;
        m.transparent = true;
        m.opacity = 1 - k;
      }
    }, { owner: obj, ease: easeOut }).then(() => {
      if (this.cards.get(obj.key) === obj) this.cards.delete(obj.key);
      this.t.scene.remove(obj.mesh);
      const front = (obj.mesh.material as THREE.Material[])[2];
      if (front && ![...this.backMaterials.values()].includes(front as THREE.MeshStandardMaterial)) front.dispose();
    });
  }

  // --- stacks & seats ------------------------------------------------------------

  private updateStacks(layout: Layout): void {
    for (const d of DECKS) {
      this.stack(`deck:${d}`, layout.decks[d], d, false);
      this.stack(`discard:${d}`, layout.discards[d], d, true);
    }
  }

  private stack(key: string, at: { x: number; z: number; count: number }, deck: DeckName, discard: boolean): void {
    let m = this.stacks.get(key);
    if (!m) {
      const top = discard
        ? new THREE.MeshStandardMaterial({ color: '#2b241c', roughness: 0.9 })
        : this.backMaterial(deck);
      m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1.4), [EDGE_MAT, EDGE_MAT, top, EDGE_MAT, EDGE_MAT, EDGE_MAT]);
      m.castShadow = true;
      m.receiveShadow = true;
      m.scale.set(0.55, 0.01, 0.55);
      m.userData['stack'] = { deck, discard };
      this.t.scene.add(m);
      this.stacks.set(key, m);
    }
    const h = Math.max(0.004, Math.min(0.6, at.count * 0.006));
    m.visible = at.count > 0 || !discard;
    m.position.set(at.x, h / 2, at.z);
    m.scale.y = h;
  }

  // --- per-frame -------------------------------------------------------------------

  /**
   * A hovered card grows in place (raised just enough to sit over its
   * neighbours). Lifting or tilting it would move its edge out from under
   * the mouse, which un-hovers it and makes it flicker.
   */
  private apply(obj: CardObj): void {
    const b = obj.base;
    const jx = obj.shake > 0.001 ? (Math.random() - 0.5) * obj.shake : 0;
    const jz = obj.shake > 0.001 ? (Math.random() - 0.5) * obj.shake : 0;
    obj.mesh.position.set(b.x + jx, b.y + obj.hover * 0.05 + obj.flash * 0.08, b.z + jz);
    obj.mesh.rotation.set(0, obj.yaw + jx * 0.6 + obj.wiggle, b.rotZ);
    const s = b.scale * (1 + obj.hover * 0.1 + obj.flash * 0.12);
    obj.mesh.scale.set(s, 1, s);
  }

  private frame(now: number): void {
    // One shared pulse for every card that can act now (they breathe together).
    const still = reducedMotion();
    const pulse = still ? 1 : 0.5 + 0.5 * Math.sin((now / ATTN_PULSE_MS) * Math.PI * 2);
    const fade = this.attnDeadline === null ? 1 : Math.max(0, Math.min(1, (this.attnDeadline - now) / ATTN_FADE_MS));
    ATTN_MAT_INNER.opacity = (0.3 + 0.5 * pulse) * (0.25 + 0.75 * fade);
    ATTN_MAT_OUTER.opacity = (0.1 + 0.3 * pulse) * (0.25 + 0.75 * fade);
    const phase = (now % ATTN_WIGGLE_EVERY_MS) / ATTN_WIGGLE_MS;
    const wiggle = still || phase >= 1 ? 0 : Math.sin(phase * Math.PI * 4) * (1 - phase) * (4 * Math.PI / 180);
    for (const obj of this.cards.values()) {
      obj.wiggle = obj.attn ? wiggle : 0;
      const target = obj === this.hovered ? 1 : 0;
      obj.hover += (target - obj.hover) * 0.25;
      if (obj.flashAt !== null) this.stepFlash(obj, now);
      obj.shake *= 0.9;
      this.apply(obj);
    }
  }

  // --- attacks -------------------------------------------------------------------------

  /** The table position of a deck's discard pile. */
  discardPoint(deck: DeckName): { x: number; z: number } | null {
    const d = this.layout?.discards[deck];
    return d ? { x: d.x, z: d.z } : null;
  }

  /** The table position of a deck (its top card). */
  deckPoint(deck: DeckName): { x: number; z: number } | null {
    const d = this.layout?.decks[deck];
    return d ? { x: d.x, z: d.z } : null;
  }

  /** Where a table card is on screen (CSS px), or null. */
  screenPoint(key: string): { x: number; y: number } | null {
    const o = this.cards.get(key);
    if (!o || o.removing) return null;
    return this.t.project(o.base.x, o.base.y, o.base.z);
  }

  /** Hide or show a table card (while it is being shown large above the field). */
  setCardHidden(key: string, hidden: boolean): void {
    const o = this.cards.get(key);
    if (o) o.mesh.visible = !hidden;
  }

  /** A table card's rectangle on screen (CSS px), for flying its picture out of and back into place. */
  screenRect(key: string): { x: number; y: number; w: number; h: number } | null {
    const o = this.cards.get(key);
    if (!o || o.removing) return null;
    const { x, y, z, scale } = o.base;
    const l = this.t.project(x - 0.5 * scale, y, z), r = this.t.project(x + 0.5 * scale, y, z);
    const t = this.t.project(x, y, z - 0.7 * scale), b = this.t.project(x, y, z + 0.7 * scale);
    const w = Math.abs(r.x - l.x);
    const hgt = Math.abs(b.y - t.y);
    return { x: (l.x + r.x) / 2, y: (t.y + b.y) / 2, w: Math.max(30, w), h: Math.max(40, hgt) };
  }

  /** Whether this card is on the table (so a bolt can start or end there). */
  hasCard(key: string): boolean {
    const o = this.cards.get(key);
    return Boolean(o && !o.removing);
  }

  /**
   * An energy discharge from one card into another: a jagged bolt that flickers
   * from the source to the target, an impact ring, and a shake on both cards.
   * Red for something done to someone, green for a boon. Resolves when it is over.
   */
  attack(fromKey: string, target: string | { x: number; z: number }, theme: Theme): Promise<void> {
    const from = this.cards.get(fromKey);
    const to = typeof target === 'string' ? this.cards.get(target) ?? null : null;
    if (!from || from === to || (typeof target === 'string' && !to)) return Promise.resolve();
    const a = from.mesh.position.clone();
    a.y += 0.12;
    const b = to ? new THREE.Vector3(to.base.x, to.base.y + 0.12, to.base.z) : new THREE.Vector3((target as { x: number }).x, 0.4, (target as { z: number }).z);
    const pal = PALETTE[theme];
    const { core, glow } = pal;
    const SEG = 16;
    const side = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3(0, 1, 0)).normalize();
    const mk = (color: string, opacity: number): THREE.Line => {
      const geo = new THREE.BufferGeometry().setFromPoints(new Array(SEG + 1).fill(a));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
      line.frustumCulled = false;
      return line;
    };
    const bolts = [mk(glow, 0.55), mk(pal.accent, 0.55), mk(core, 1)];
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    head.scale.setScalar(0.55);
    const ring = new THREE.Mesh(RING_GEOM, new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    ring.position.copy(b);
    ring.position.y += 0.03;
    this.t.scene.add(...bolts, head, ring);

    const scatter = (line: THREE.Line, reach: number, wobble: number): void => {
      const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const n = Math.max(1, Math.round(reach * SEG));
      for (let i = 0; i <= SEG; i++) {
        const p = Math.min(i, n) / SEG; // points past the head stay at the head
        const along = Math.min(1, p / Math.max(reach, 0.001));
        const base = new THREE.Vector3().lerpVectors(a, b, reach * along);
        const envelope = Math.sin(Math.PI * along); // pinned at both ends
        const j = (Math.random() - 0.5) * wobble * envelope;
        base.addScaledVector(side, j).y += (Math.random() - 0.5) * wobble * 0.5 * envelope;
        if (i > n) base.copy(new THREE.Vector3().lerpVectors(a, b, reach));
        pos.setXYZ(i, base.x, base.y, base.z);
      }
      pos.needsUpdate = true;
    };

    from.shake = Math.max(from.shake, 0.03);
    let hit = false;
    const DRAW = 0.42; // share of the time spent travelling; the rest is the impact
    return this.t.tweens.add(520, (k) => {
      const travel = Math.min(1, k / DRAW);
      bolts.forEach((l, i) => scatter(l, travel, (i === 2 ? 0.14 : 0.26) * pal.wobble));
      head.position.lerpVectors(a, b, travel);
      (head.material as THREE.SpriteMaterial).opacity = k < DRAW ? 1 : Math.max(0, 1 - (k - DRAW) / 0.2);
      if (k >= DRAW) {
        if (!hit) { hit = true; if (to) to.shake = Math.max(to.shake, 0.09); }
        const r = (k - DRAW) / (1 - DRAW);
        const fade = 1 - r;
        bolts.forEach((l, i) => { (l.material as THREE.LineBasicMaterial).opacity = (i === 2 ? 1 : 0.55) * fade; });
        ring.scale.setScalar((0.6 + r * 2.2) * pal.ring);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * fade;
      }
    }, { ease: (k) => k }).then(() => {
      this.t.scene.remove(...bolts, head, ring);
      for (const l of bolts) { l.geometry.dispose(); (l.material as THREE.Material).dispose(); }
      (head.material as THREE.Material).dispose();
      (ring.material as THREE.Material).dispose();
    });
  }

  // --- ability flashes ---------------------------------------------------------------

  /** Flash a card on the table (an ability of it was used). Returns false if it isn't on the table. */
  flash(cardId: string): boolean {
    const obj = this.cards.get(cardId);
    if (!obj || obj.removing) return false;
    obj.flashAt = performance.now();
    return true;
  }

  /** Flash the face-up card with this name (full or first part), for events that only name their source. */
  flashByName(name: string): boolean {
    for (const obj of this.cards.values()) {
      if (!obj.def || !obj.faceUp || obj.removing) continue;
      const full = getDef(obj.def).name;
      if (full === name || full.split(',')[0] === name) return this.flash(obj.key);
    }
    return false;
  }

  /** Two gold pulses: the face glows and the card lifts slightly. */
  private stepFlash(obj: CardObj, now: number): void {
    const k = (now - obj.flashAt!) / FLASH_MS;
    const front = (obj.mesh.material as THREE.MeshStandardMaterial[])[2];
    // Only a card's own face material may glow (card backs share one material per deck).
    const ownFace = obj.def !== null && front && !([...this.backMaterials.values()] as THREE.Material[]).includes(front);
    if (k >= 1 || k < 0) {
      obj.flashAt = null;
      obj.flash = 0;
      if (ownFace) front.emissiveIntensity = 0;
      return;
    }
    obj.flash = Math.sin(Math.PI * k * 2) ** 2;
    if (ownFace) {
      // Glow through the card's own face (gold-tinted), so it brightens without washing out.
      if (front.emissiveMap !== front.map) {
        front.emissiveMap = front.map;
        front.needsUpdate = true;
      }
      front.emissive.copy(FLASH_COLOR);
      front.emissiveIntensity = 0.9 * obj.flash;
    }
  }

  // --- picking -----------------------------------------------------------------

  meshes(): THREE.Object3D[] {
    return [...this.cards.values()].filter((c) => !c.removing).map((c) => c.mesh);
  }

  /** Outline exactly these cards in a weak red glow (others lose theirs). */
  setAfflicted(keys: Set<string>): void {
    for (const obj of this.cards.values()) {
      const want = keys.has(obj.key) && !obj.removing;
      if (want && !obj.glow) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(GLOW_INNER, GLOW_MAT_INNER), new THREE.Mesh(GLOW_OUTER, GLOW_MAT_OUTER));
        obj.mesh.add(g);
        obj.glow = g;
      } else if (!want && obj.glow) {
        obj.mesh.remove(obj.glow);
        obj.glow = null;
      }
    }
  }

  /** Outline exactly these cards in the "can act now" blue (others lose it). */
  /** When the ready glow runs out (performance.now() ms), or null: it dims over the last 2 s. */
  setAttentionDeadline(deadline: number | null): void { this.attnDeadline = deadline; }

  setAttention(keys: Set<string>): void {
    for (const obj of this.cards.values()) {
      const want = keys.has(obj.key) && !obj.removing;
      if (want && !obj.attn) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(GLOW_INNER, ATTN_MAT_INNER), new THREE.Mesh(GLOW_OUTER, ATTN_MAT_OUTER));
        g.position.y = 0.002; // above the red outline if both are shown
        obj.mesh.add(g);
        obj.attn = g;
      } else if (!want && obj.attn) {
        obj.mesh.remove(obj.attn);
        obj.attn = null;
        obj.wiggle = 0;
      }
    }
  }

  /** The deck and discard piles that are showing (an empty discard pile is hidden). */
  stackMeshes(): THREE.Object3D[] {
    return [...this.stacks.values()].filter((m) => m.visible);
  }

  setHovered(mesh: THREE.Object3D | null): { key: string; def: string | null; faceUp: boolean } | null {
    const obj = (mesh?.userData['card'] as CardObj | undefined) ?? null;
    this.hovered = obj;
    return obj ? { key: obj.key, def: obj.faceUp ? obj.def : null, faceUp: obj.faceUp } : null;
  }
}
