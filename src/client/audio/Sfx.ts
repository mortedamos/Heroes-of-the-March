// Sound effects from public/sounds/. A file that isn't there is simply silent (and
// not asked for again). Some sounds have variants (name-1, name-2, name-3) that are
// picked at random so repeats don't sound mechanical; a plain name.mp3 also works.
// Effects have their own volume, separate from the music.

const VARIANTS = 3;
const STORE = 'hotm.sfx';
const DEFAULT_VOLUME = 0.7;

export type SfxName = 'effect-negative' | 'effect-positive';

function load(): { volume: number; muted: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as { volume?: unknown; muted?: unknown };
    const v = typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : DEFAULT_VOLUME;
    return { volume: v, muted: raw.muted === true };
  } catch { return { volume: DEFAULT_VOLUME, muted: false }; }
}

class Sfx {
  volume: number;
  muted: boolean;
  private readonly missing = new Set<string>();

  constructor() {
    const p = load();
    this.volume = p.volume;
    this.muted = p.muted;
  }

  private save(): void {
    try { localStorage.setItem(STORE, JSON.stringify({ volume: this.volume, muted: this.muted })); } catch { /* private mode */ }
  }
  setVolume(v: number): void { this.volume = Math.min(1, Math.max(0, v)); if (this.volume > 0) this.muted = false; this.save(); }
  setMuted(m: boolean): void { this.muted = m; this.save(); }

  /** Play a sound if its file exists; otherwise do nothing. */
  play(name: SfxName): void {
    if (this.muted || this.volume === 0) return;
    const n = 1 + Math.floor(Math.random() * VARIANTS);
    for (const file of [`${name}-${n}.mp3`, `${name}.mp3`]) {
      if (this.missing.has(file)) continue;
      const a = new Audio(`${import.meta.env.BASE_URL}sounds/${file}`);
      a.volume = this.volume;
      a.addEventListener('error', () => this.missing.add(file), { once: true });
      void a.play().catch(() => { /* blocked or missing */ });
      return;
    }
  }
}

export const sfx = new Sfx();
