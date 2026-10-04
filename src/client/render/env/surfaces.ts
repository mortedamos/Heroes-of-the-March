// Procedural textures for the location environments: table and ground surfaces,
// skyline silhouettes and the few soft sprites the weather uses. Everything is
// painted on a canvas with a seeded generator, so a surface looks the same every time.

import * as THREE from 'three';

export type SurfaceKind = 'felt' | 'planks' | 'flagstone' | 'soft' | 'moss' | 'dirt' | 'lava' | 'leather';

export interface SurfaceSpec {
  kind: SurfaceKind;
  a: string;
  b: string;
  /** World units covered by one repeat of the texture. */
  tile: number;
  rough?: number;
  metal?: number;
  /** Lava: the colour of the glowing cracks (also the emissive tint). */
  glow?: string;
  opts?: { moss?: boolean; sparkle?: boolean; rows?: number; blobs?: number; r?: [number, number] };
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
        g.fillRect(rnd() * SIZE, r * h, 2, h);
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

    case 'lava': {
      // Dark crust plates; the seams between them glow.
      const rows = o.rows ?? 5;
      const h = SIZE / rows;
      let gg: CanvasRenderingContext2D;
      [glow, gg] = canvas(SIZE, SIZE);
      gg.fillStyle = spec.glow ?? '#ff6a1e';
      gg.fillRect(0, 0, SIZE, SIZE);
      g.fillStyle = '#050302';
      g.fillRect(0, 0, SIZE, SIZE);
      for (let r = 0; r < rows; r++) {
        const cuts = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => rnd()).sort();
        const xs = [0, ...cuts.map((c) => c * SIZE), SIZE];
        for (let i = 0; i < xs.length - 1; i++) {
          const x0 = xs[i]!;
          const x1 = xs[i + 1]!;
          if (x1 - x0 < 14) continue;
          // Each plate sits a little differently, so the seams wander instead of forming a grid.
          const top = r * h + 3 + rnd() * 5;
          const bottom = (r + 1) * h - 3 - rnd() * 5;
          g.fillStyle = mixHex(spec.a, spec.b, rnd());
          g.fillRect(x0 + 3, top, x1 - x0 - 6, bottom - top);
          gg.fillStyle = '#000000';
          gg.fillRect(x0 + 6, top + 3, x1 - x0 - 12, bottom - top - 6);
          // A few plates run hotter, with a crack across them.
          if (rnd() < 0.3) {
            g.strokeStyle = rgba('#050302', 0.8);
            gg.strokeStyle = spec.glow ?? '#ff6a1e';
            g.lineWidth = 3; gg.lineWidth = 1.6;
            const pts = [[x0 + 10 + rnd() * (x1 - x0 - 20), top + 4], [x0 + 10 + rnd() * (x1 - x0 - 20), (top + bottom) / 2], [x0 + 10 + rnd() * (x1 - x0 - 20), bottom - 4]] as [number, number][];
            g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
            gg.beginPath(); pts.forEach(([x, y], k) => (k ? gg.lineTo(x, y) : gg.moveTo(x, y))); gg.stroke();
          }
        }
      }
      speckle(g, 12, rnd);
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
let flame: THREE.CanvasTexture | null = null;
let books: THREE.CanvasTexture | null = null;

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

/** A teardrop flame for braziers and candles. */
export function flameTexture(): THREE.CanvasTexture {
  if (flame) return flame;
  const [c, g] = canvas(64, 128);
  const gr = g.createRadialGradient(32, 84, 2, 32, 76, 46);
  gr.addColorStop(0, 'rgba(255,248,200,1)');
  gr.addColorStop(0.3, 'rgba(255,180,70,0.9)');
  gr.addColorStop(0.7, 'rgba(255,90,20,0.35)');
  gr.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(32, 4);
  g.bezierCurveTo(54, 50, 62, 70, 32, 124);
  g.bezierCurveTo(2, 70, 10, 50, 32, 4);
  g.fill();
  return (flame = new THREE.CanvasTexture(c));
}

/** Rows of book spines, for the shelves. */
export function bookTexture(): THREE.CanvasTexture {
  if (books) return books;
  const [c, g] = canvas(256, 256);
  const rnd = rngOf(77);
  g.fillStyle = '#1a100a';
  g.fillRect(0, 0, 256, 256);
  const cols = ['#6b1d1d', '#1d3a6b', '#2f5a2a', '#7a5a1d', '#4a1d5a', '#1d5a5a', '#8a4a1d', '#3a3a3a'];
  for (let row = 0; row < 4; row++) {
    let x = 4;
    while (x < 250) {
      const w = 6 + rnd() * 9;
      const h = 40 + rnd() * 20;
      g.fillStyle = cols[Math.floor(rnd() * cols.length)]!;
      g.fillRect(x, row * 64 + 60 - h, w, h);
      g.fillStyle = rgba('#d9b96a', 0.5);
      g.fillRect(x + 1, row * 64 + 60 - h + 6, w - 2, 2);
      x += w + 1;
    }
    g.fillStyle = '#3a2412';
    g.fillRect(0, row * 64 + 60, 256, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (books = t);
}
