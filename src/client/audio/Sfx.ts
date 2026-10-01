// Sound effects from public/sounds/.
//
// Only files listed in public/sounds/manifest.json are ever requested, so a sound you have
// not added yet causes no request and no 404. `npm run sfx` writes the manifest (and the
// tracker, docs/SFX-TRACKER.md) from what is in the folder. A sound may have up to three
// variants (name_1, name_2, name_3); one is picked at random each time so repeats do not
// sound mechanical. Effects have their own volume, separate from the music.

const MAX_VARIANTS = 3;
const STORE = 'hotm.sfx';
const DEFAULT_VOLUME = 0.7;
/** Only plain file names are accepted from the manifest. */
const SAFE_FILE = /^[A-Za-z0-9._-]+\.(mp3|ogg|wav|webm)$/;

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
  /** sound name -> file names, from the manifest (empty until it has loaded). */
  private manifest: Record<string, string[]> = {};

  constructor() {
    const p = load();
    this.volume = p.volume;
    this.muted = p.muted;
    void this.loadManifest();
  }

  private async loadManifest(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sounds/manifest.json`);
      if (!res.ok) return;
      const raw: unknown = await res.json();
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return;
      for (const [name, files] of Object.entries(raw)) {
        if (!Array.isArray(files)) continue;
        const ok = files.filter((f): f is string => typeof f === 'string' && SAFE_FILE.test(f)).slice(0, MAX_VARIANTS);
        if (ok.length) this.manifest[name] = ok;
      }
    } catch { /* no manifest: no sounds */ }
  }

  private save(): void {
    try { localStorage.setItem(STORE, JSON.stringify({ volume: this.volume, muted: this.muted })); } catch { /* private mode */ }
  }
  setVolume(v: number): void { this.volume = Math.min(1, Math.max(0, v)); if (this.volume > 0) this.muted = false; this.save(); }
  setMuted(m: boolean): void { this.muted = m; this.save(); }

  /** Play a sound if the manifest lists it; otherwise do nothing. */
  play(name: SfxName): void {
    if (this.muted || this.volume === 0) return;
    const files = this.manifest[name];
    if (!files?.length) return;
    const file = files[Math.floor(Math.random() * files.length)]!;
    const a = new Audio(`${import.meta.env.BASE_URL}sounds/${file}`);
    a.volume = this.volume;
    void a.play().catch(() => { /* blocked until the first click */ });
  }
}

export const sfx = new Sfx();
