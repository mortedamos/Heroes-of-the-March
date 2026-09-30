// Card art: bundled from ../_build/art at build time (same-origin, CSP-safe).

const urls = import.meta.glob('@art/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const byStem = new Map<string, string>();
for (const [path, url] of Object.entries(urls)) {
  const stem = path.split('/').pop()!.replace(/\.webp$/, '');
  byStem.set(stem, url);
}

const cache = new Map<string, Promise<HTMLImageElement | null>>();

export function loadArt(stem: string | null): Promise<HTMLImageElement | null> {
  if (!stem) return Promise.resolve(null);
  const url = byStem.get(stem);
  if (!url) return Promise.resolve(null);
  let p = cache.get(stem);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    cache.set(stem, p);
  }
  return p;
}

/** Portraits are painted scenes (cover-crop); everything else is an object on a plain ground (contain). */
export function isPainting(stem: string): boolean {
  return stem.startsWith('portraits__');
}
