// The parts of the sky-painting generator (scripts/skies.ts) that need no network, so they can be tested.

export interface SkyBrief {
  id: string;
  kind: 'indoor' | 'outdoor';
  /** What the picture shows, as written in art/SKYBOX-BRIEF-LOCATIONS.md. */
  scene: string;
}

/**
 * The paintings to make, read from the tables of art/SKYBOX-BRIEF-LOCATIONS.md: a section headed "Indoors" or "Outdoors",
 * and in it rows like | `the-umbral-deep_sky.webp` | a black cavern... |.
 */
export function parseBrief(md: string): SkyBrief[] {
  const out: SkyBrief[] = [];
  let kind: SkyBrief['kind'] | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const h = /^##\s+(Indoors|Outdoors)\b/i.exec(raw);
    if (h) { kind = h[1]!.toLowerCase() === 'indoors' ? 'indoor' : 'outdoor'; continue; }
    if (/^##\s/.test(raw)) { kind = null; continue; }
    const row = /^\|\s*`([a-z0-9-]+)_sky\.[a-z]+`\s*\|\s*(.+?)\s*\|\s*$/.exec(raw);
    if (row && kind) out.push({ id: row[1]!, kind, scene: row[2]! });
  }
  return out;
}

const COMMON = 'An ultra-wide painterly fantasy illustration for a card game\'s backdrop, soft atmospheric lighting, in the manner of illustrated fantasy card art but darker, calmer and softer so playing cards in front of it stay the brightest thing. No characters, no creatures, no text, no letters, no logos, no user interface, no frame or border, no table, no cards.';

const OUTDOOR = 'It is a panoramic view at eye level going all the way across the picture. A straight horizon runs across the whole width about 10% up from the bottom edge; the ground or water below it is plain, dark and calm. All the interest lies in a wide band just above the horizon, between 10% and 55% of the picture height measured up from the bottom edge, with the main subject in the middle of the picture and the left and right sides continuing the scene more quietly. The sky above that is calm and simple. No bright sun disc.';

const INDOOR = 'It is the inside of a room seen at eye level, going all the way across the picture. The line where the walls meet the floor runs straight across about 10% up from the bottom edge, and the floor below it is plain and dark. All the interest lies in a wide band of wall just above that, between 10% and 55% of the picture height measured up from the bottom edge, with the main subject in the middle of the picture and the sides continuing the room more quietly. The ceiling above is dim and simple.';

/** The whole prompt for one painting. */
export function buildPrompt(b: SkyBrief): string {
  return `${COMMON} ${b.kind === 'indoor' ? INDOOR : OUTDOOR} ${b.kind === 'indoor' ? 'The room' : 'The scene'}: ${b.scene.replace(/\.$/, '')}.`;
}

/**
 * The image in an API reply, whatever shape the reply has: the largest long base64 string in it, with the mime type
 * named beside it (mime_type or mimeType) if there is one.
 */
export function findImage(json: unknown): { data: string; mime: string } | null {
  let best: { data: string; mime: string } | null = null;
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (v === null || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    for (const [k, x] of Object.entries(o)) {
      if (typeof x === 'string' && x.length > 2000 && /^[A-Za-z0-9+/=_-]+$/.test(x) && (!best || x.length > best.data.length)) {
        const m = o.mime_type ?? o.mimeType;
        best = { data: x, mime: typeof m === 'string' && m.startsWith('image/') ? m : 'image/jpeg' };
        void k;
      } else walk(x);
    }
  };
  walk(json);
  return best;
}

/** Width, height and type of a JPEG or PNG, read from its header (null for anything else). */
export function imageInfo(buf: Uint8Array): { width: number; height: number; type: 'jpeg' | 'png' } | null {
  const b = buf;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20), type: 'png' };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      // The start-of-frame markers carry the size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]!, type: 'jpeg' };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** The ways to ask for a picture, widest and sharpest first; the generator falls back down the list when the API refuses one. */
export const RATIOS = ['4:1', '21:9'] as const;
export const SIZES = ['4K', '2K', '1K'] as const;
