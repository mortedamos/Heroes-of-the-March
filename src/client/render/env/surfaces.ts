// Procedural textures for the location environments: table and ground surfaces,
// skyline silhouettes and the few soft sprites the weather uses. Everything is
// painted on a canvas with a seeded generator, so a surface looks the same every time.

import * as THREE from 'three';

export type SurfaceKind = 'felt' | 'planks' | 'flagstone' | 'slab' | 'steel' | 'soft' | 'moss' | 'dirt' | 'magma' | 'leather' | 'channels' | 'cobbles';

/** Marks that glow in the stone: runes along a seam, a sigil circle, or the spirals pecked into a megalith. */
export type GlyphStyle = 'runes' | 'sigils' | 'spirals';

export interface SurfaceSpec {
  kind: SurfaceKind;
  a: string;
  b: string;
  /** World units covered by one repeat of the texture. */
  tile: number;
  rough?: number;
  metal?: number;
  /** The colour of whatever glows: the cracks in magma, the molten metal in channels, the glyphs (also the emissive tint). */
  glow?: string;
  opts?: { moss?: boolean; lichen?: boolean; sparkle?: boolean; nails?: boolean; rows?: number; blobs?: number; r?: [number, number]; glyphs?: GlyphStyle };
}

export type SkylineKind = 'castle' | 'pines' | 'peaks' | 'graves' | 'town' | 'stacks' | 'hills' | 'arches' | 'clouds';

const SIZE = 512;

function rngOf(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (hex: string, a: number): string => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${f(ar, br)}${f(ag, bg)}${f(ab, bb)}`;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function speckle(g: CanvasRenderingContext2D, amt: number, rnd: () => number): void {
  const img = g.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amt;
    d[i] = Math.max(0, Math.min(255, d[i]! + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n));
  }
  g.putImageData(img, 0, 0);
}

/** A soft round blob that wraps around the edges, so the texture tiles. */
function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  for (const dx of [0, -SIZE, SIZE]) for (const dy of [0, -SIZE, SIZE]) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx + r < 0 || cx - r > SIZE || cy + r < 0 || cy - r > SIZE) continue;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, rgba(color, alpha));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
}

function wrapStroke(g: CanvasRenderingContext2D, pts: [number, number][]): void {
  for (const dx of [0, -SIZE, SIZE]) for (const dy of [0, -SIZE, SIZE]) {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy)));
    g.stroke();
  }
}

function crack(rnd: () => number): [number, number][] {
  let x = rnd() * SIZE;
  let y = rnd() * SIZE;
  let a = rnd() * Math.PI * 2;
  const pts: [number, number][] = [[x, y]];
  for (let i = 0, n = 5 + Math.floor(rnd() * 6); i < n; i++) {
    a += (rnd() - 0.5) * 1.3;
    const l = 14 + rnd() * 30;
    x += Math.cos(a) * l;
    y += Math.sin(a) * l;
    pts.push([x, y]);
  }
  return pts;
}

// Angular marks in a 14 x 28 box, strokes joined point to point.
const RUNES: [number, number][][] = [
  [[0, 0], [0, 28], [0, 14], [14, 0]],
  [[0, 0], [14, 14], [0, 28]],
  [[7, 0], [7, 28], [0, 10], [14, 10]],
  [[0, 0], [0, 28], [14, 14], [0, 0]],
  [[0, 28], [7, 0], [14, 28], [2, 16], [12, 16]],
  [[0, 0], [14, 28], [0, 28], [14, 0]],
  [[7, 0], [0, 14], [7, 28], [14, 14], [7, 0]],
];

/** Glowing strokes for one canvas: a soft halo under a bright core, with the same strokes carved dark into the stone. */
function glowStroke(g: CanvasRenderingContext2D, gg: CanvasRenderingContext2D, pts: [number, number][], hot: string, w = 2.6, closed = false): void {
  const trace = (c: CanvasRenderingContext2D): void => {
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    if (closed) c.closePath();
    c.stroke();
  };
  g.strokeStyle = rgba('#000000', 0.55); g.lineWidth = w + 2.4; g.lineJoin = g.lineCap = 'round'; trace(g);
  gg.lineJoin = gg.lineCap = 'round';
  gg.strokeStyle = rgba(hot, 0.28); gg.lineWidth = w * 3.2; trace(gg);
  gg.strokeStyle = hot; gg.lineWidth = w; trace(gg);
}

const arc = (cx: number, cy: number, r: number, from: number, to: number, steps = 40): [number, number][] =>
  Array.from({ length: steps + 1 }, (_, i) => { const a = from + ((to - from) * i) / steps; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number]; });

/** Draw glowing glyphs onto an emissive canvas `gg` (and carve them into the colour canvas `g`). Everything stays clear of the tile's edges. */
function drawGlyphs(g: CanvasRenderingContext2D, gg: CanvasRenderingContext2D, style: GlyphStyle, rnd: () => number, hot: string): void {
  if (style === 'runes') {
    // Two inlaid bands, a line with a row of runes standing on it.
    for (const y of [128, 384]) {
      glowStroke(g, gg, [[0, y], [SIZE, y]], hot, 2.4);
      for (let x = 30; x < SIZE - 20; x += 46) {
        const r = RUNES[Math.floor(rnd() * RUNES.length)]!;
        glowStroke(g, gg, r.map(([px, py]) => [x + px, y - 40 + py] as [number, number]), hot, 2.2);
      }
    }
  } else if (style === 'sigils') {
    const c = SIZE / 2;
    glowStroke(g, gg, arc(c, c, 214, 0, Math.PI * 2, 72), hot, 3, true);
    glowStroke(g, gg, arc(c, c, 190, 0, Math.PI * 2, 72), hot, 2, true);
    glowStroke(g, gg, arc(c, c, 74, 0, Math.PI * 2, 48), hot, 2.6, true);
    for (const rot of [-Math.PI / 2, Math.PI / 2]) glowStroke(g, gg, arc(c, c, 150, rot, rot + Math.PI * 2, 3).slice(0, 3), hot, 2.6, true);
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6;
      glowStroke(g, gg, [[c + Math.cos(a) * 190, c + Math.sin(a) * 190], [c + Math.cos(a) * 214, c + Math.sin(a) * 214]], hot, 2);
      const r = RUNES[k % RUNES.length]!;
      glowStroke(g, gg, r.map(([px, py]) => [c + Math.cos(a) * 168 + (px - 7) * 0.5, c + Math.sin(a) * 168 + (py - 14) * 0.5] as [number, number]), hot, 1.6);
    }
  } else {
    // Spirals, rings and zigzags, as pecked into a standing stone.
    const spiral = (cx: number, cy: number, r: number, turns: number, dir: number): [number, number][] =>
      Array.from({ length: 90 }, (_, i) => { const t = i / 89; const a = dir * t * turns * Math.PI * 2; return [cx + Math.cos(a) * r * t, cy + Math.sin(a) * r * t] as [number, number]; });
    glowStroke(g, gg, spiral(150, 150, 84, 2.6, 1), hot, 3.4);
    glowStroke(g, gg, spiral(370, 190, 70, 2.2, -1), hot, 3.4);
    for (let k = 1; k <= 3; k++) glowStroke(g, gg, arc(250, 392, 22 * k, 0, Math.PI * 2, 40), hot, 3, true);
    glowStroke(g, gg, Array.from({ length: 11 }, (_, i) => [30 + i * 45, 478 + (i % 2 ? -18 : 18)] as [number, number]), hot, 3);
    glowStroke(g, gg, Array.from({ length: 9 }, (_, i) => [60 + i * 50, 38 + (i % 2 ? -14 : 14)] as [number, number]), hot, 3);
  }
}

function paint(spec: SurfaceSpec): { map: HTMLCanvasElement; glow: HTMLCanvasElement | null } {
  const rnd = rngOf(hash(`${spec.kind}${spec.a}${spec.b}`));
  const [map, g] = canvas(SIZE, SIZE);
  let glow: HTMLCanvasElement | null = null;
  const o = spec.opts ?? {};
  g.fillStyle = spec.a;
  g.fillRect(0, 0, SIZE, SIZE);

  switch (spec.kind) {
    case 'felt':
      speckle(g, 18, rnd);
      break;

    case 'planks': {
      const rows = o.rows ?? 8;
      const h = SIZE / rows;
      for (let r = 0; r < rows; r++) {
        g.fillStyle = mixHex(spec.a, spec.b, rnd() * 0.85);
        g.fillRect(0, r * h, SIZE, h);
        for (let k = 0; k < 16; k++) {
          const y = r * h + rnd() * h;
          g.strokeStyle = rgba(rnd() < 0.5 ? '#000000' : '#ffffff', 0.04 + rnd() * 0.07);
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(0, y);
          g.quadraticCurveTo(SIZE / 2, y + (rnd() - 0.5) * 6, SIZE, y);
          g.stroke();
        }
        if (rnd() < 0.4) {
          g.fillStyle = rgba('#000000', 0.22);
          g.beginPath();
          g.ellipse(rnd() * SIZE, r * h + h / 2, 7 + rnd() * 6, 3 + rnd() * 2, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = rgba('#000000', 0.6);
        g.fillRect(0, r * h + h - 2, SIZE, 2);
        const joint = rnd() * SIZE;
        g.fillRect(joint, r * h, 2, h);
        if (o.nails) {
          // A nail near each end of the board, either side of the butt joint.
          for (const x of [joint - 14, joint + 16]) for (const y of [r * h + h * 0.28, r * h + h * 0.72]) {
            g.fillStyle = rgba('#0b0805', 0.7);
            g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill();
            g.fillStyle = rgba('#ffffff', 0.18);
            g.fillRect(x - 1, y - 1.5, 1.5, 1);
          }
        }
      }
      speckle(g, 10, rnd);
      break;
    }

    case 'flagstone': {
      const rows = o.rows ?? 4;
      const h = SIZE / rows;
      g.fillStyle = mixHex(spec.a, '#000000', 0.62);
      g.fillRect(0, 0, SIZE, SIZE);
      for (let r = 0; r < rows; r++) {
        const cuts = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => rnd()).sort();
        const xs = [0, ...cuts.map((c) => c * SIZE), SIZE];
        for (let i = 0; i < xs.length - 1; i++) {
          const x0 = xs[i]!;
          const x1 = xs[i + 1]!;
          if (x1 - x0 < 10) continue;
          g.fillStyle = mixHex(spec.a, spec.b, rnd());
          g.fillRect(x0 + 2, r * h + 2, x1 - x0 - 4, h - 4);
          g.fillStyle = rgba('#ffffff', 0.05);
          g.fillRect(x0 + 2, r * h + 2, x1 - x0 - 4, 3);
        }
      }
      g.strokeStyle = rgba('#000000', 0.4);
      g.lineWidth = 1.5;
      for (let i = 0; i < 5; i++) wrapStroke(g, crack(rnd));
      if (o.moss) for (let i = 0; i < 40; i++) blob(g, rnd() * SIZE, rnd() * SIZE, 12 + rnd() * 26, '#3f6b3a', 0.32);
      speckle(g, 14, rnd);
      break;
    }

    case 'slab': {
      // Big weathered blocks: soft mottling, a few deep joints, hairline cracks, and whatever grows or settles on them.
      for (let i = 0; i < 80; i++) {
        blob(g, rnd() * SIZE, rnd() * SIZE, 30 + rnd() * 70, rnd() < 0.5 ? spec.b : mixHex(spec.a, '#000000', 0.55), 0.1 + rnd() * 0.16);
      }
      const rows = o.rows ?? 2;
      const h = SIZE / rows;
      for (let r = 0; r < rows; r++) {
        g.fillStyle = rgba('#000000', 0.62);
        g.fillRect(0, r * h, SIZE, 3);
        g.fillStyle = rgba('#ffffff', 0.07);
        g.fillRect(0, r * h + 3, SIZE, 1.5);
        const x = rnd() * SIZE;
        g.fillStyle = rgba('#000000', 0.62);
        g.fillRect(x, r * h, 3, h);
        g.fillStyle = rgba('#ffffff', 0.07);
        g.fillRect(x + 3, r * h + 3, 1.5, h - 3);
      }
      g.strokeStyle = rgba('#000000', 0.42);
      g.lineWidth = 1.2;
      for (let i = 0; i < 7; i++) wrapStroke(g, crack(rnd));
      if (o.moss) for (let i = 0; i < 46; i++) blob(g, rnd() * SIZE, rnd() * SIZE, 10 + rnd() * 26, rnd() < 0.7 ? '#3f6b3a' : '#59803a', 0.34);
      if (o.lichen) {
        // Crusty rosettes: a few overlapping dots each.
        const hues = ['#a3ad7c', '#b7b88b', '#8f9f86', '#c2b97f'];
        for (let i = 0; i < 34; i++) {
          const cx = rnd() * SIZE;
          const cy = rnd() * SIZE;
          const col = hues[Math.floor(rnd() * hues.length)]!;
          for (let k = 0; k < 7; k++) {
            g.fillStyle = rgba(col, 0.22 + rnd() * 0.2);
            g.beginPath(); g.arc(cx + (rnd() - 0.5) * 12, cy + (rnd() - 0.5) * 12, 1.2 + rnd() * 3.2, 0, Math.PI * 2); g.fill();
          }
        }
      }
      if (o.sparkle) {
        for (let i = 0; i < 16; i++) blob(g, rnd() * SIZE, rnd() * SIZE, 20 + rnd() * 50, '#f4f9ff', 0.2);
        g.fillStyle = rgba('#ffffff', 0.8);
        for (let i = 0; i < 160; i++) g.fillRect(rnd() * SIZE, rnd() * SIZE, 1 + rnd(), 1 + rnd());
      }
      speckle(g, 16, rnd);
      break;
    }

    case 'steel': {
      // Worn dark steel: brushed along its length, pitted with hammer dents, a few heat stains.
      for (let i = 0; i < 380; i++) {
        const x = rnd() * SIZE;
        const y = rnd() * SIZE;
        g.strokeStyle = rgba(rnd() < 0.5 ? '#ffffff' : '#000000', 0.04 + rnd() * 0.08);
        g.lineWidth = 0.6 + rnd();
        wrapStroke(g, [[x, y], [x + 50 + rnd() * 240, y + (rnd() - 0.5) * 3]]);
      }
      for (let i = 0; i < 9; i++) blob(g, rnd() * SIZE, rnd() * SIZE, 40 + rnd() * 70, rnd() < 0.5 ? '#6a4a30' : '#2a3a52', 0.2);
      for (let i = 0; i < 46; i++) {
        const x = rnd() * SIZE;
        const y = rnd() * SIZE;
        const r = 4 + rnd() * 10;
        blob(g, x, y, r, '#000000', 0.42);
        blob(g, x - r * 0.35, y - r * 0.35, r * 0.6, '#ffffff', 0.12);
      }
      speckle(g, 14, rnd);
      break;
    }

    case 'soft': {
      const [r0, r1] = o.r ?? [20, 60];
      for (let i = 0; i < (o.blobs ?? 80); i++) blob(g, rnd() * SIZE, rnd() * SIZE, r0 + rnd() * (r1 - r0), spec.b, 0.25 + rnd() * 0.3);
      for (let i = 0; i < 40; i++) blob(g, rnd() * SIZE, rnd() * SIZE, r0 + rnd() * (r1 - r0), mixHex(spec.a, '#2a3a50', 0.5), 0.1);
      if (o.sparkle) {
        g.fillStyle = rgba('#ffffff', 0.85);
        for (let i = 0; i < 180; i++) g.fillRect(rnd() * SIZE, rnd() * SIZE, 1 + rnd(), 1 + rnd());
      }
      speckle(g, 5, rnd);
      break;
    }

    case 'moss': {
      for (let i = 0; i < 70; i++) blob(g, rnd() * SIZE, rnd() * SIZE, 18 + rnd() * 34, spec.b, 0.35);
      for (let i = 0; i < 40; i++) blob(g, rnd() * SIZE, rnd() * SIZE, 14 + rnd() * 24, '#0c1c0e', 0.25);
      for (let i = 0; i < 900; i++) {
        const x = rnd() * SIZE;
        const y = rnd() * SIZE;
        const a = -Math.PI / 2 + (rnd() - 0.5) * 1.2;
        const l = 3 + rnd() * 7;
        g.strokeStyle = rgba(mixHex(spec.a, spec.b, rnd()), 0.7);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
      speckle(g, 8, rnd);
      break;
    }

    case 'dirt': {
      for (let i = 0; i < 60; i++) blob(g, rnd() * SIZE, rnd() * SIZE, 20 + rnd() * 40, spec.b, 0.3);
      for (let i = 0; i < 40; i++) blob(g, rnd() * SIZE, rnd() * SIZE, 20 + rnd() * 40, '#2a1d10', 0.14);
      for (let i = 0; i < 150; i++) {
        g.fillStyle = rgba(mixHex(spec.a, rnd() < 0.5 ? '#ffffff' : '#000000', 0.18 + rnd() * 0.2), 0.8);
        g.beginPath();
        g.ellipse(rnd() * SIZE, rnd() * SIZE, 1 + rnd() * 3, 1 + rnd() * 2, rnd() * 3, 0, Math.PI * 2);
        g.fill();
      }
      speckle(g, 16, rnd);
      break;
    }

    case 'magma': {
      // Dark, broken rock. Here and there a crack runs hot.
      let gg: CanvasRenderingContext2D;
      [glow, gg] = canvas(SIZE, SIZE);
      gg.fillStyle = '#000000';
      gg.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 60; i++) blob(g, rnd() * SIZE, rnd() * SIZE, 16 + rnd() * 50, spec.b, 0.28);
      for (let i = 0; i < 50; i++) blob(g, rnd() * SIZE, rnd() * SIZE, 14 + rnd() * 40, '#050403', 0.3);
      g.strokeStyle = rgba('#000000', 0.5);
      g.lineWidth = 1.4;
      for (let i = 0; i < 16; i++) wrapStroke(g, crack(rnd));
      const hot = spec.glow ?? '#ff5a1e';
      for (let i = 0; i < 4; i++) {
        const pts = crack(rnd);
        g.strokeStyle = rgba('#000000', 0.8);
        g.lineWidth = 6;
        wrapStroke(g, pts);
        gg.strokeStyle = rgba(hot, 0.3);
        gg.lineWidth = 12;
        wrapStroke(gg, pts);
        gg.strokeStyle = hot;
        gg.lineWidth = 3.4;
        wrapStroke(gg, pts);
      }
      speckle(g, 16, rnd);
      break;
    }

    case 'leather': {
      speckle(g, 12, rnd);
      g.strokeStyle = rgba(spec.b, 0.24);
      g.lineWidth = 1.5;
      for (let c = 0; c <= SIZE * 2; c += 64) {
        g.beginPath(); g.moveTo(c, 0); g.lineTo(c - SIZE, SIZE); g.stroke();
        g.beginPath(); g.moveTo(c - SIZE, 0); g.lineTo(c, SIZE); g.stroke();
      }
      g.fillStyle = rgba(spec.b, 0.4);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        const x = 32 + i * 64;
        const y = 32 + j * 64;
        g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 4, y); g.lineTo(x, y + 4); g.lineTo(x - 4, y); g.closePath(); g.fill();
      }
      break;
    }

    case 'channels': {
      // Dressed slabs, tight-fitted and worn smooth, with neat channels of molten metal cut across them.
      const n = o.rows ?? 4;
      const cell = SIZE / n;
      g.fillStyle = mixHex(spec.a, '#000000', 0.7);
      g.fillRect(0, 0, SIZE, SIZE);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        g.fillStyle = mixHex(spec.a, spec.b, rnd());
        g.fillRect(c * cell + 1.5, r * cell + 1.5, cell - 3, cell - 3);
        g.fillStyle = rgba('#ffffff', 0.05);
        g.fillRect(c * cell + 1.5, r * cell + 1.5, cell - 3, 2.5);
      }
      for (let i = 0; i < 40; i++) blob(g, rnd() * SIZE, rnd() * SIZE, 20 + rnd() * 40, rnd() < 0.5 ? spec.b : '#000000', 0.06 + rnd() * 0.08);
      g.strokeStyle = rgba('#000000', 0.35);
      g.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) wrapStroke(g, crack(rnd));
      speckle(g, 12, rnd);
      // The channels: along the joint between the first and second row of slabs, and between the first and second column.
      let gg: CanvasRenderingContext2D;
      [glow, gg] = canvas(SIZE, SIZE);
      gg.fillStyle = '#000000';
      gg.fillRect(0, 0, SIZE, SIZE);
      const hot = spec.glow ?? '#ff6a22';
      const cy = cell * Math.min(2, n - 1);
      const cx = cell;
      const cut = (x: number, y: number, w: number, h: number): void => {
        g.fillStyle = rgba('#050403', 0.92); g.fillRect(x, y, w, h);
        g.fillStyle = rgba('#ffffff', 0.14); g.fillRect(x, y - 1.5, w, 1.5); g.fillRect(x, y + h, w, 1.5);
      };
      cut(0, cy - 11, SIZE, 22);
      cut(cx - 11, 0, 22, SIZE);
      gg.fillStyle = rgba(hot, 0.18); gg.fillRect(0, cy - 11, SIZE, 22); gg.fillRect(cx - 11, 0, 22, SIZE);
      gg.fillStyle = mixHex(hot, '#000000', 0.2); gg.fillRect(0, cy - 3.5, SIZE, 7); gg.fillRect(cx - 3.5, 0, 7, SIZE);
      // A basin where they meet.
      g.fillStyle = rgba('#050403', 0.95); g.fillRect(cx - 26, cy - 26, 52, 52);
      gg.fillStyle = rgba(hot, 0.3); gg.fillRect(cx - 26, cy - 26, 52, 52);
      gg.fillStyle = mixHex(hot, '#ffffff', 0.18); gg.fillRect(cx - 17, cy - 17, 34, 34);
      break;
    }

    case 'cobbles': {
      // Rounded setts in staggered rows, set in dark mortar.
      const n = 9;
      const cell = SIZE / n;
      g.fillStyle = mixHex(spec.a, '#000000', 0.72);
      g.fillRect(0, 0, SIZE, SIZE);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const x = (c + 0.5 + (r % 2 ? 0.5 : 0) + (rnd() - 0.5) * 0.18) * cell;
        const y = (r + 0.5 + (rnd() - 0.5) * 0.14) * cell;
        const rx = cell * (0.4 + rnd() * 0.07);
        const ry = cell * (0.36 + rnd() * 0.07);
        const col = mixHex(spec.a, spec.b, rnd());
        const tilt = (rnd() - 0.5) * 0.5;
        for (const dx of [0, -SIZE, SIZE]) {
          g.fillStyle = col;
          g.beginPath(); g.ellipse(x + dx, y, rx, ry, tilt, 0, Math.PI * 2); g.fill();
          g.fillStyle = rgba('#ffffff', 0.07);
          g.beginPath(); g.ellipse(x + dx - rx * 0.12, y - ry * 0.18, rx * 0.7, ry * 0.6, tilt, 0, Math.PI * 2); g.fill();
          g.strokeStyle = rgba('#000000', 0.3); g.lineWidth = 1.5;
          g.beginPath(); g.ellipse(x + dx, y, rx, ry, tilt, 0, Math.PI * 2); g.stroke();
        }
      }
      speckle(g, 16, rnd);
      break;
    }
  }

  // Glyphs glow in the stone whatever the surface is.
  if (o.glyphs) {
    let gg: CanvasRenderingContext2D;
    if (glow) gg = glow.getContext('2d')!;
    else {
      [glow, gg] = canvas(SIZE, SIZE);
      gg.fillStyle = '#000000';
      gg.fillRect(0, 0, SIZE, SIZE);
    }
    drawGlyphs(g, gg, o.glyphs, rnd, spec.glow ?? '#ffe2a0');
  }
  return { map, glow };
}

const canvases = new Map<string, ReturnType<typeof paint>>();

/** A table or ground material for `spec`. `repeat` is how many tiles per UV unit. */
export function surfaceMaterial(spec: SurfaceSpec, repeat: number, aniso: number): THREE.MeshStandardMaterial {
  const key = `${spec.kind}|${spec.a}|${spec.b}|${spec.glow ?? ''}|${JSON.stringify(spec.opts ?? {})}`;
  let art = canvases.get(key);
  if (!art) canvases.set(key, (art = paint(spec)));
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = aniso;
    return t;
  };
  return new THREE.MeshStandardMaterial({
    map: tex(art.map, true),
    roughness: spec.rough ?? 0.9,
    metalness: spec.metal ?? 0,
    ...(art.glow ? { emissive: '#ffffff', emissiveMap: tex(art.glow, true), emissiveIntensity: 0.9 } : {}),
  });
}

// -- Skylines ---------------------------------------------------------------

const SKY_W = 2048;
const SKY_H = 256;

export function paintSkyline(kind: SkylineKind, color: string, seed: number): HTMLCanvasElement {
  const [c, g] = canvas(SKY_W, SKY_H);
  const rnd = rngOf(seed * 7919 + hash(kind));
  g.fillStyle = color;
  g.strokeStyle = color;
  g.fillRect(0, SKY_H - 14, SKY_W, 14);
  const crenels = (x: number, y: number, w: number) => {
    for (let cx = x; cx < x + w - 4; cx += 10) g.fillRect(cx, y - 8, 6, 8);
  };

  switch (kind) {
    case 'castle':
      for (let x = 0; x < SKY_W;) {
        if (rnd() < 0.55) {
          const w = 40 + rnd() * 34;
          const h = 90 + rnd() * 90;
          g.fillRect(x, SKY_H - h, w, h);
          crenels(x - 4, SKY_H - h, w + 8);
          if (rnd() < 0.6) {
            g.beginPath(); g.moveTo(x - 4, SKY_H - h - 8); g.lineTo(x + w / 2, SKY_H - h - 52 - rnd() * 24); g.lineTo(x + w + 4, SKY_H - h - 8); g.fill();
            g.fillRect(x + w / 2 - 1, SKY_H - h - 90, 2, 40);
          }
          x += w + 10 + rnd() * 40;
        } else {
          const w = 90 + rnd() * 120;
          const h = 46 + rnd() * 26;
          g.fillRect(x, SKY_H - h, w, h);
          crenels(x, SKY_H - h, w);
          x += w;
        }
      }
      break;

    case 'pines':
      for (let x = -10; x < SKY_W + 10; x += 10 + rnd() * 18) {
        const h = 60 + rnd() * 100;
        const w = 18 + rnd() * 22;
        for (let t = 0; t < 3; t++) {
          const top = SKY_H - h + t * h * 0.24;
          const ww = w * (0.55 + t * 0.3);
          g.beginPath(); g.moveTo(x, top); g.lineTo(x + ww, top + h * 0.42); g.lineTo(x - ww, top + h * 0.42); g.fill();
        }
        g.fillRect(x - 2, SKY_H - 30, 4, 30);
      }
      break;

    case 'peaks': {
      g.beginPath();
      g.moveTo(0, SKY_H);
      let x = 0;
      let up = true;
      while (x < SKY_W) {
        const step = 30 + rnd() * 80;
        x += step;
        g.lineTo(x, SKY_H - (up ? 90 + rnd() * 120 : 30 + rnd() * 50));
        up = !up;
      }
      g.lineTo(SKY_W, SKY_H);
      g.closePath();
      g.fill();
      break;
    }

    case 'graves':
      for (let x = 0; x < SKY_W; x += 30 + rnd() * 60) {
        const r = rnd();
        if (r < 0.35) { // cross
          const h = 24 + rnd() * 26;
          g.fillRect(x, SKY_H - h, 4, h);
          g.fillRect(x - 7, SKY_H - h + 8, 18, 4);
        } else if (r < 0.65) { // dead tree
          const h = 70 + rnd() * 80;
          g.lineWidth = 5;
          g.beginPath(); g.moveTo(x, SKY_H); g.lineTo(x + 2, SKY_H - h); g.stroke();
          g.lineWidth = 2.5;
          for (let b = 0; b < 5; b++) {
            const by = SKY_H - h * (0.35 + b * 0.14);
            const dir = b % 2 ? 1 : -1;
            g.beginPath(); g.moveTo(x + 1, by); g.lineTo(x + dir * (14 + rnd() * 20), by - 14 - rnd() * 14); g.stroke();
          }
        } else { // broken column
          const h = 50 + rnd() * 70;
          g.beginPath(); g.moveTo(x, SKY_H); g.lineTo(x, SKY_H - h); g.lineTo(x + 8, SKY_H - h + 6); g.lineTo(x + 14, SKY_H - h - 4); g.lineTo(x + 20, SKY_H - h + 8); g.lineTo(x + 20, SKY_H); g.fill();
        }
      }
      break;

    case 'town':
      for (let x = 0; x < SKY_W;) {
        const r = rnd();
        if (r < 0.2) { // mast with yard
          const h = 130 + rnd() * 100;
          g.fillRect(x, SKY_H - h, 3, h);
          g.fillRect(x - 24, SKY_H - h + 30, 52, 3);
          g.fillRect(x - 18, SKY_H - h * 0.6, 40, 3);
          x += 40;
        } else { // house
          const w = 40 + rnd() * 50;
          const h = 40 + rnd() * 50;
          g.fillRect(x, SKY_H - h, w, h);
          g.beginPath(); g.moveTo(x - 4, SKY_H - h); g.lineTo(x + w / 2, SKY_H - h - 24 - rnd() * 16); g.lineTo(x + w + 4, SKY_H - h); g.fill();
          if (rnd() < 0.5) g.fillRect(x + w * 0.7, SKY_H - h - 36, 8, 30);
          x += w + 4 + rnd() * 20;
        }
      }
      break;

    case 'stacks':
      for (let x = 0; x < SKY_W; x += 40 + rnd() * 90) {
        const r = rnd();
        if (r < 0.45) { // smokestack
          const h = 100 + rnd() * 120;
          g.beginPath(); g.moveTo(x, SKY_H); g.lineTo(x + 3, SKY_H - h); g.lineTo(x + 19, SKY_H - h); g.lineTo(x + 22, SKY_H); g.fill();
        } else if (r < 0.8) { // cone
          const h = 70 + rnd() * 90;
          const w = 70 + rnd() * 60;
          g.beginPath(); g.moveTo(x - w / 2, SKY_H); g.lineTo(x - 8, SKY_H - h); g.lineTo(x + 8, SKY_H - h); g.lineTo(x + w / 2, SKY_H); g.fill();
        } else { // gantry
          g.fillRect(x, SKY_H - 120, 6, 120);
          g.fillRect(x, SKY_H - 120, 70, 6);
          g.fillRect(x + 64, SKY_H - 120, 3, 40);
        }
      }
      break;

    case 'hills': {
      g.beginPath();
      g.moveTo(0, SKY_H);
      for (let x = 0; x <= SKY_W; x += 16) {
        g.lineTo(x, SKY_H - 60 - Math.sin(x * 0.0061) * 34 - Math.sin(x * 0.017 + 1) * 16 - Math.sin(x * 0.0023 + 2) * 24);
      }
      g.lineTo(SKY_W, SKY_H);
      g.fill();
      for (let i = 0; i < 2; i++) { // windmills
        const x = 300 + i * 1100 + rnd() * 200;
        g.fillRect(x, SKY_H - 140, 14, 80);
        g.lineWidth = 3;
        for (let b = 0; b < 4; b++) {
          const a = b * (Math.PI / 2) + 0.4;
          g.beginPath(); g.moveTo(x + 7, SKY_H - 132); g.lineTo(x + 7 + Math.cos(a) * 46, SKY_H - 132 + Math.sin(a) * 46); g.stroke();
        }
      }
      break;
    }

    case 'arches':
      g.fillRect(0, 0, SKY_W, SKY_H);
      g.globalCompositeOperation = 'destination-out';
      for (let x = 26; x < SKY_W; x += 150) {
        g.beginPath();
        g.moveTo(x, SKY_H - 20); g.lineTo(x, 120);
        g.quadraticCurveTo(x, 40, x + 44, 14);
        g.quadraticCurveTo(x + 88, 40, x + 88, 120);
        g.lineTo(x + 88, SKY_H - 20);
        g.closePath();
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      break;

    case 'clouds':
      g.globalAlpha = 0.9;
      for (let x = 0; x < SKY_W; x += 40 + rnd() * 80) {
        const r = 30 + rnd() * 50;
        g.beginPath(); g.arc(x, SKY_H - 10 - rnd() * 40, r, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
      break;
  }
  return c;
}

// -- Soft sprites -----------------------------------------------------------

let dot: THREE.CanvasTexture | null = null;
let beam: THREE.CanvasTexture | null = null;

/** A soft round dot (particles, fog banks). */
export function dotTexture(): THREE.CanvasTexture {
  if (dot) return dot;
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return (dot = new THREE.CanvasTexture(c));
}

/** A shaft of light: soft at the sides, brightest at the top. */
export function beamTexture(): THREE.CanvasTexture {
  if (beam) return beam;
  const [c, g] = canvas(64, 256);
  const img = g.createImageData(64, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
    const side = Math.sin((x / 63) * Math.PI);
    const along = (1 - y / 255) ** 0.8 * Math.min(1, (y + 1) / 18);
    const i = (y * 64 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(255 * side * side * along);
  }
  g.putImageData(img, 0, 0);
  return (beam = new THREE.CanvasTexture(c));
}

let ringTex: THREE.CanvasTexture | null = null;
let streakTex: THREE.CanvasTexture | null = null;

/** A thin soft ring on clear ground, for ripples spreading on water. */
export function ringTexture(): THREE.CanvasTexture {
  if (ringTex) return ringTex;
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.72, 'rgba(255,255,255,0)');
  gr.addColorStop(0.84, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.93, 'rgba(255,255,255,0.18)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return (ringTex = new THREE.CanvasTexture(c));
}

/** A streak of light, bright at its head (the right) and fading away behind it, for a shooting star. */
export function streakTexture(): THREE.CanvasTexture {
  if (streakTex) return streakTex;
  const [c, g] = canvas(256, 16);
  const img = g.createImageData(256, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 256; x++) {
    const along = (x / 255) ** 2.2;
    const side = Math.sin(((y + 0.5) / 16) * Math.PI) ** 2;
    const i = (y * 256 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(255 * along * side);
  }
  g.putImageData(img, 0, 0);
  return (streakTex = new THREE.CanvasTexture(c));
}

/** A band of glowing runes (512 x 64, two canvases: the stone, and what glows in it) for a cornice or a frieze. */
export function runeBand(hot: string, base = '#23262b'): { map: HTMLCanvasElement; glow: HTMLCanvasElement } {
  const [map, g] = canvas(512, 64);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 64);
  const [glow, gg] = canvas(512, 64);
  gg.fillStyle = '#000000';
  gg.fillRect(0, 0, 512, 64);
  const rnd = rngOf(hash(`band${hot}`));
  for (let x = 20; x < 500; x += 40) {
    const r = RUNES[Math.floor(rnd() * RUNES.length)]!;
    glowStroke(g, gg, r.map(([px, py]) => [x + px * 0.85, 14 + py * 0.85] as [number, number]), hot, 2.4);
  }
  speckle2(g, 10, rnd);
  return { map, glow };
}

function speckle2(g: CanvasRenderingContext2D, amt: number, rnd: () => number): void {
  const w = g.canvas.width;
  const h = g.canvas.height;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amt;
    d[i] = Math.max(0, Math.min(255, d[i]! + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n));
  }
  g.putImageData(img, 0, 0);
}
