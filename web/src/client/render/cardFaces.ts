// Draws card faces and backs onto canvases from the card data + art.
// One canvas per card definition, cached; the 3D textures and the HTML hand
// both draw from it.

import { getDef, type CardDef, type DeckName, type Stat } from '../../engine';
import { isPainting, loadArt } from '../art';

export const CARD_W = 512;
export const CARD_H = 716;

const SERIF = 'Georgia, "Palatino Linotype", "Book Antiqua", "Times New Roman", serif';

export const KIND_COLORS: Record<CardDef['kind'], { frame: string; dark: string; label: string }> = {
  hero: { frame: '#b8862b', dark: '#3b2a0e', label: 'Hero' },
  companion: { frame: '#3d7d78', dark: '#12302e', label: 'Companion' },
  location: { frame: '#557d3a', dark: '#1d2e12', label: 'Location' },
  encounter: { frame: '#94302f', dark: '#2e0f0f', label: 'Encounter' },
  resource: { frame: '#4e548f', dark: '#191b36', label: 'Resource' },
};

export const STAT_COLORS: Record<Stat, string> = { P: '#b3372f', M: '#2f5fb3', G: '#2f8a4c' };

const DECK_KIND: Record<DeckName, CardDef['kind']> = {
  hero: 'hero', companion: 'companion', location: 'location', encounter: 'encounter', resource: 'resource',
};

type Face = { canvas: HTMLCanvasElement; version: number; listeners: Set<() => void> };
const faces = new Map<string, Face>();
const backs = new Map<DeckName, HTMLCanvasElement>();
/** Font size (face pixels) each card's rules text was drawn at: long text is shrunk to fit. */
const rulesSizes = new Map<string, number>();

/**
 * The font size a card's rules text is printed at, in face pixels (CARD_W wide).
 * Infinity for cards with no rules text. Scale by displayed width / CARD_W for
 * the on-screen size.
 */
export function rulesTextSize(defId: string): number {
  if (!rulesSizes.has(defId)) cardFace(defId);
  return rulesSizes.get(defId) ?? Infinity;
}

/** Get (and lazily draw) the face canvas for a card definition. `onUpdate` fires when art finishes loading. */
/** What each card's rules text says and where it sits, so the same letters can be drawn again as a glow. */
const ruleText = new Map<string, { blocks: TextBlock[]; x: number; y: number; w: number; h: number }>();
/** The same, for the emphasised face (ability sentence in bold) shown when an ability is used. */
const ruleTextBold = new Map<string, { blocks: TextBlock[]; x: number; y: number; w: number; h: number }>();
/** While true, drawFace prints the ability sentence in bold. */
let emphasis = false;
const boldFaces = new Map<string, Face>();

/**
 * A transparent layer the size of a card face holding only the halo of the rules text: the same
 * words laid out identically, a few pixels off, glowing, with the letters themselves cut out so
 * the printed text shows through untouched. It reads as light cast from behind the letters.
 */
export function ruleGlowCanvas(defId: string): HTMLCanvasElement | null {
  cardFaceEmphasis(defId); // make sure the bold face (and so its layout) exists
  const r = ruleTextBold.get(defId);
  if (!r) return null;
  const c = document.createElement('canvas');
  c.width = CARD_W;
  c.height = CARD_H;
  const g = c.getContext('2d')!;
  g.textAlign = 'left';
  // 1. The glowing copy, nudged down and to the right.
  g.shadowColor = 'rgba(255, 205, 40, 1)';
  g.shadowBlur = 6;
  // Everything is laid out (so the glow lines up); only the ability sentence is lit, the rest is invisible here.
  const lit = r.blocks.map((b) => ({ ...b, color: b.glow ? '#ffd23f' : 'rgba(0,0,0,0)' }));
  for (let i = 0; i < 2; i++) drawTextBlocks(g, lit, r.x + 2, r.y + 2, r.w, r.h, 24, 12);
  // 2. Cut out exactly where the real letters are (a hair thicker), leaving only the halo around them.
  g.shadowBlur = 0;
  g.shadowColor = 'transparent';
  g.globalCompositeOperation = 'destination-out';
  const cut = r.blocks.map((b) => ({ ...b, color: '#000' }));
  for (const [dx, dy] of [[0, 0], [0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]] as const) drawTextBlocks(g, cut, r.x + dx, r.y + dy, r.w, r.h, 24, 12);
  return c;
}

export function cardFace(defId: string, onUpdate?: () => void): HTMLCanvasElement {
  let f = faces.get(defId);
  if (!f) {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    f = { canvas, version: 0, listeners: new Set() };
    faces.set(defId, f);
    const def = getDef(defId);
    drawFace(canvas.getContext('2d')!, def, null);
    const face = f;
    void loadArt(def.art).then((img) => {
      if (!img) return;
      drawFace(canvas.getContext('2d')!, def, img);
      face.version++;
      for (const l of face.listeners) l();
      face.listeners.clear();
    });
  }
  if (onUpdate && f.version === 0 && getDef(defId).art) f.listeners.add(onUpdate);
  return f.canvas;
}

/** A card's face with its ability sentence in bold: what is shown large when that ability is used. */
export function cardFaceEmphasis(defId: string, onUpdate?: () => void): HTMLCanvasElement {
  let f = boldFaces.get(defId);
  if (!f) {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    f = { canvas, version: 0, listeners: new Set() };
    boldFaces.set(defId, f);
    const def = getDef(defId);
    const draw = (img: HTMLImageElement | null): void => {
      emphasis = true;
      try { drawFace(canvas.getContext('2d')!, def, img); } finally { emphasis = false; }
    };
    draw(null);
    const face = f;
    void loadArt(def.art).then((img) => {
      if (!img) return;
      draw(img);
      face.version++;
      for (const l of face.listeners) l();
      face.listeners.clear();
    });
  }
  if (onUpdate && f.version === 0 && getDef(defId).art) f.listeners.add(onUpdate);
  return f.canvas;
}

export function cardBack(deck: DeckName): HTMLCanvasElement {
  let c = backs.get(deck);
  if (!c) {
    c = document.createElement('canvas');
    c.width = CARD_W;
    c.height = CARD_H;
    drawBack(c.getContext('2d')!, deck);
    backs.set(deck, c);
  }
  return c;
}

// --- drawing helpers ----------------------------------------------------------

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function fitFont(g: CanvasRenderingContext2D, text: string, maxW: number, start: number, min: number, weight = 'bold', style = ''): number {
  let size = start;
  for (; size > min; size--) {
    g.font = `${style} ${weight} ${size}px ${SERIF}`;
    if (g.measureText(text).width <= maxW) break;
  }
  return size;
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > maxW && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    if (line) lines.push(line);
  }
  return lines;
}

interface TextBlock { text: string; weight?: string; style?: string; color?: string; gapBefore?: number; /** The ability sentence itself (what glows when the card is shown). */ glow?: boolean }

function textHeight(g: CanvasRenderingContext2D, blocks: TextBlock[], w: number, size: number): number {
  const lh = Math.round(size * 1.22);
  let total = 0;
  blocks.forEach((b, i) => {
    g.font = `${b.style ?? ''} ${b.weight ?? 'normal'} ${size}px ${SERIF}`;
    total += wrap(g, b.text, w).length * lh + (i ? (b.gapBefore ?? 8) : 0);
  });
  return total;
}

/** Largest font size in [min, start] at which the blocks fit, or null. */
function fitSize(g: CanvasRenderingContext2D, blocks: TextBlock[], w: number, h: number, start: number, min: number): number | null {
  for (let size = start; size >= min; size--) if (textHeight(g, blocks, w, size) <= h) return size;
  return null;
}

/** Lay out several text blocks in a box, shrinking the font until everything fits. Returns the size used. */
function drawTextBlocks(g: CanvasRenderingContext2D, blocks: TextBlock[], x: number, y: number, w: number, h: number, start = 24, min = 13): number {
  const best = fitSize(g, blocks, w, h, start, min);
  if (best !== null) start = best;
  for (let size = start; size >= min; size--) {
    const lh = Math.round(size * 1.22);
    let total = 0;
    const laid: { lines: string[]; b: TextBlock }[] = [];
    for (const b of blocks) {
      g.font = `${b.style ?? ''} ${b.weight ?? 'normal'} ${size}px ${SERIF}`;
      const lines = wrap(g, b.text, w);
      total += lines.length * lh + (laid.length ? (b.gapBefore ?? 8) : 0);
      laid.push({ lines, b });
    }
    if (total <= h || size === min) {
      let cy = y;
      for (const [i, { lines, b }] of laid.entries()) {
        if (i) cy += b.gapBefore ?? 8;
        g.font = `${b.style ?? ''} ${b.weight ?? 'normal'} ${size}px ${SERIF}`;
        g.fillStyle = b.color ?? '#2a2118';
        for (const line of lines) {
          if (cy + lh > y + h + 2) return size;
          g.fillText(line, x, cy + size);
          cy += lh;
        }
      }
      return size;
    }
  }
  return min;
}

function splitName(name: string): [string, string | null] {
  const i = name.indexOf(', ');
  return i > 0 ? [name.slice(0, i), name.slice(i + 2)] : [name, null];
}

function emblem(g: CanvasRenderingContext2D, kind: CardDef['kind'], cx: number, cy: number, r: number, color: string): void {
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = r * 0.08;
  g.globalAlpha = 0.55;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  switch (kind) {
    case 'hero': // crown
      g.moveTo(-r * 0.6, r * 0.35); g.lineTo(-r * 0.6, -r * 0.25); g.lineTo(-r * 0.3, r * 0.05); g.lineTo(0, -r * 0.45);
      g.lineTo(r * 0.3, r * 0.05); g.lineTo(r * 0.6, -r * 0.25); g.lineTo(r * 0.6, r * 0.35); g.closePath(); g.fill();
      break;
    case 'companion': // two circles (allies)
      g.arc(-r * 0.25, -r * 0.15, r * 0.22, 0, Math.PI * 2); g.fill(); g.beginPath();
      g.arc(r * 0.25, -r * 0.15, r * 0.22, 0, Math.PI * 2); g.fill(); g.beginPath();
      g.ellipse(-r * 0.25, r * 0.35, r * 0.32, r * 0.2, 0, Math.PI, 0); g.fill(); g.beginPath();
      g.ellipse(r * 0.25, r * 0.35, r * 0.32, r * 0.2, 0, Math.PI, 0); g.fill();
      break;
    case 'location': // tower
      g.rect(-r * 0.25, -r * 0.3, r * 0.5, r * 0.75); g.fill(); g.beginPath();
      for (let i = 0; i < 3; i++) g.rect(-r * 0.3 + i * r * 0.22, -r * 0.48, r * 0.16, r * 0.2);
      g.fill();
      break;
    case 'encounter': // crossed blades
      g.lineWidth = r * 0.12;
      g.moveTo(-r * 0.55, -r * 0.55); g.lineTo(r * 0.55, r * 0.55);
      g.moveTo(r * 0.55, -r * 0.55); g.lineTo(-r * 0.55, r * 0.55); g.stroke();
      break;
    case 'resource': // four-point star
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 - Math.PI / 2;
        const rr = i % 2 ? r * 0.18 : r * 0.62;
        if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath(); g.fill();
      break;
  }
  g.restore();
}

function badge(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, text: string, size = 26): void {
  roundRect(g, x, y, w, h, h / 2);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.stroke();
  g.fillStyle = '#fff';
  g.font = `bold ${size}px ${SERIF}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x + w / 2, y + h / 2 + 1);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
}

// --- faces -------------------------------------------------------------------

function drawFace(g: CanvasRenderingContext2D, def: CardDef, art: HTMLImageElement | null): void {
  const W = CARD_W, H = CARD_H;
  const col = KIND_COLORS[def.kind];
  g.clearRect(0, 0, W, H);

  // Frame
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, col.frame);
  grad.addColorStop(1, col.dark);
  roundRect(g, 0, 0, W, H, 28);
  g.fillStyle = grad;
  g.fill();
  // Parchment
  roundRect(g, 14, 14, W - 28, H - 28, 18);
  const parch = g.createLinearGradient(0, 14, 0, H);
  parch.addColorStop(0, '#f3e8cc');
  parch.addColorStop(1, '#e3d2ab');
  g.fillStyle = parch;
  g.fill();

  // Header
  const [main, title] = splitName(def.name);
  roundRect(g, 24, 24, W - 48, title ? 92 : 70, 12);
  g.fillStyle = col.dark;
  g.fill();
  g.fillStyle = '#f7ecd0';
  g.textAlign = 'center';
  const mainSize = fitFont(g, main, W - 80, 38, 18);
  g.fillText(main, W / 2, 24 + 16 + mainSize * 0.8);
  if (title) {
    fitFont(g, title, W - 80, 22, 13, 'normal', 'italic');
    g.fillStyle = '#e6d3a4';
    g.fillText(title, W / 2, 24 + 84);
  }
  const headerBottom = 24 + (title ? 92 : 70);

  // Kind & groups line
  const groups = def.groups.filter((x) => x !== 'All').join(' · ');
  const kindLine = `${col.label.toUpperCase()}${groups ? ' — ' + groups : def.groups.includes('All') ? ' — All types' : ''}`;
  fitFont(g, kindLine, W - 64, 18, 11);
  g.fillStyle = col.dark;
  g.fillText(kindLine, W / 2, headerBottom + 26);
  g.textAlign = 'left';

  // Art box
  const ax = 30, ay = headerBottom + 38, aw = W - 60, ah = def.kind === 'encounter' ? 214 : 250;
  g.save();
  roundRect(g, ax, ay, aw, ah, 10);
  g.clip();
  const bg = g.createRadialGradient(ax + aw / 2, ay + ah / 2, 10, ax + aw / 2, ay + ah / 2, aw * 0.7);
  bg.addColorStop(0, '#fbf5e4');
  bg.addColorStop(1, '#cdb88a');
  g.fillStyle = bg;
  g.fillRect(ax, ay, aw, ah);
  if (art) {
    const painting = def.art ? isPainting(def.art) : false;
    const s = painting ? Math.max(aw / art.width, ah / art.height) : Math.min(aw / art.width, ah / art.height) * 0.92;
    const dw = art.width * s, dh = art.height * s;
    // Paintings: bias the crop toward the face (upper third).
    const dy = painting ? ay + Math.min(0, (ah - dh) * 0.25) : ay + (ah - dh) / 2;
    g.imageSmoothingQuality = 'high';
    g.drawImage(art, ax + (aw - dw) / 2, dy, dw, dh);
  } else {
    emblem(g, def.kind, ax + aw / 2, ay + ah / 2, Math.min(aw, ah) * 0.32, col.frame);
  }
  g.restore();
  roundRect(g, ax, ay, aw, ah, 10);
  g.lineWidth = 4;
  g.strokeStyle = col.dark;
  g.stroke();

  let y = ay + ah + 14;
  const tx = 36, tw = W - 72;

  // Stats / numbers
  if (def.kind === 'hero' || def.kind === 'companion') {
    const bw = (tw - 24) / 3;
    (['P', 'M', 'G'] as Stat[]).forEach((s, i) => badge(g, tx + i * (bw + 12), y, bw, 46, STAT_COLORS[s], `${s}  ${def.stats[s]}`, 28));
    y += 60;
  } else if (def.kind === 'location') {
    badge(g, tx + tw / 2 - 110, y, 220, 50, col.frame, `Renown ${def.renown}`, 30);
    y += 64;
  } else if (def.kind === 'resource') {
    const tags = [def.wand ? 'Wand' : null, def.council ? 'Council' : null].filter(Boolean) as string[];
    badge(g, tx, y, 150, 50, col.frame, def.value >= 0 ? `+${def.value}` : `${def.value}`, 32);
    tags.forEach((t, i) => badge(g, tx + 170 + i * 150, y + 6, 136, 38, t === 'Wand' ? '#7a4fa0' : '#a0714f', t, 22));
    y += 64;
  } else if (def.kind === 'encounter') {
    const rowH = 46;
    badge(g, tx, y, 190, rowH, STAT_COLORS[def.stat], `${def.stat}  ${def.difficulty}`, 30);
    const mv = def.minionValue;
    badge(g, tx + tw - 150, y + 1, 150, 44, '#4a3a2a', `Minion ${mv >= 0 ? '+' : ''}${mv}`, 22);
    y += rowH + 14;
  }

  // Rules text
  const blocks: TextBlock[] = [];
  if (def.kind === 'hero' || def.kind === 'companion') {
    if (def.abilityName) blocks.push({ text: def.abilityName, weight: 'bold', color: KIND_COLORS[def.kind].dark });
    if (def.abilityText) blocks.push({ text: def.abilityText, gapBefore: 2, glow: true, ...(emphasis ? { weight: 'bold' } : {}) });
    if (def.kind === 'hero' && def.triggerText) blocks.push({ text: `⚡ ${def.triggerText}`, style: 'italic', color: '#5a3d0c', gapBefore: 10 });
  } else if (def.conditionText) {
    blocks.push({ text: def.conditionText, glow: true, ...(emphasis ? { weight: 'bold' } : {}) });
  }
  const boxH = H - 40 - y;
  // Flavour text is optional: include it only if the rules text stays readable.
  if (def.quote) {
    const withQuote = [...blocks, { text: def.quote, style: 'italic', color: '#6b5a40', gapBefore: 10 }];
    if (fitSize(g, withQuote, tw, boxH, 24, 17) !== null) blocks.splice(0, blocks.length, ...withQuote);
  }
  rulesSizes.set(def.id, blocks.length ? drawTextBlocks(g, blocks, tx, y, tw, boxH, 24, 12) : Infinity);
  if (blocks.length) (emphasis ? ruleTextBold : ruleText).set(def.id, { blocks: blocks.map((b) => ({ ...b })), x: tx, y, w: tw, h: boxH });

  // Revised for the web edition (data/balance.json)
  if (def.revision) {
    g.save();
    roundRect(g, W - 128, H - 40, 104, 24, 12);
    g.fillStyle = 'rgba(184, 134, 43, 0.95)';
    g.fill();
    g.fillStyle = '#1b1206';
    g.font = `bold 14px ${SERIF}`;
    g.textAlign = 'center';
    g.fillText('REVISED', W - 76, H - 23);
    g.restore();
  }
}

function drawBack(g: CanvasRenderingContext2D, deck: DeckName): void {
  const W = CARD_W, H = CARD_H;
  const col = KIND_COLORS[DECK_KIND[deck]];
  roundRect(g, 0, 0, W, H, 28);
  g.fillStyle = col.dark;
  g.fill();
  roundRect(g, 16, 16, W - 32, H - 32, 20);
  g.lineWidth = 6;
  g.strokeStyle = col.frame;
  g.stroke();
  // Diamond lattice
  g.save();
  roundRect(g, 26, 26, W - 52, H - 52, 16);
  g.clip();
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 2;
  for (let i = -H; i < W + H; i += 36) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + H, H); g.stroke();
    g.beginPath(); g.moveTo(i, H); g.lineTo(i + H, 0); g.stroke();
  }
  g.restore();
  // Central seal
  g.beginPath();
  g.arc(W / 2, H / 2, 150, 0, Math.PI * 2);
  g.fillStyle = col.frame;
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#f1e2b8';
  g.stroke();
  emblem(g, DECK_KIND[deck], W / 2, H / 2 - 20, 70, '#f7ecd0');
  g.fillStyle = '#f7ecd0';
  g.textAlign = 'center';
  g.font = `bold 30px ${SERIF}`;
  g.fillText('HEROES OF', W / 2, 120);
  g.fillText('THE MARCH', W / 2, 158);
  g.font = `italic bold 30px ${SERIF}`;
  g.fillText(col.label, W / 2, H / 2 + 90);
  g.textAlign = 'left';
}
