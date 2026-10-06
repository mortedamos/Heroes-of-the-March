import { inFocus } from './focus';
import { sfx } from './Sfx';
// Place sounds: while the camera is lifted away from the board, the odd sound of the place drifts in (a smithy far off,
// birdsong, wind in the trees). Files live in public/ambience/ as `<look>_<anything>.mp3` (look = tavern, harbor, forest...)
// and `any_<anything>.mp3` for every look; `npm run sfx` (the sound tracker, which lists every place sound still to find) writes public/ambience/manifest.json from what is there, so a
// missing sound is never requested. They follow the Effects volume and mute.

/** Only plain file names are accepted from the manifest. */
const SAFE_FILE = /^[A-Za-z0-9._-]+\.(mp3|ogg|wav|webm)$/;
/** How far out the camera must be (0 = the play camera, 1 = looking across the table) before the place is heard. */
const OUT_AT = 0.5;
/** Seconds before the first sound after zooming out, and between one sound ending and the next. */
const FIRST_S: [number, number] = [1.5, 4];
const GAP_S: [number, number] = [7, 20];
/** Ambience is a little under the effects volume. */
const LEVEL = 0.85;

const between = ([lo, hi]: [number, number]): number => lo + Math.random() * (hi - lo);

class Ambience {
  /** look -> files, from the manifest (empty until it has loaded). */
  private manifest: Record<string, string[]> = {};
  private theme = 'felt';
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private current: HTMLAudioElement | null = null;
  private lastFile = '';

  constructor() { void this.load(); }

  private async load(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}ambience/manifest.json`);
      if (!res.ok) return;
      const raw: unknown = await res.json();
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return;
      for (const [look, files] of Object.entries(raw)) {
        if (!Array.isArray(files)) continue;
        const ok = files.filter((f): f is string => typeof f === 'string' && SAFE_FILE.test(f)).slice(0, 24);
        if (ok.length) this.manifest[look] = ok;
      }
    } catch { /* no manifest: no ambience */ }
  }

  /** Call every frame with how far out the camera is (0..1) and the look on the table. */
  update(out: number, theme: string): void {
    this.theme = theme;
    const on = out >= OUT_AT;
    if (on === this.active) return;
    this.active = on;
    if (on) this.schedule(between(FIRST_S));
    else this.stop();
  }

  /** The sounds that fit this look (plus the ones for every look). */
  private pool(): string[] {
    return [...(this.manifest[this.theme] ?? []), ...(this.manifest['any'] ?? [])];
  }

  private schedule(seconds: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; if (this.active) this.playOne(); }, seconds * 1000);
  }

  /** Play one now (also what the debug panel's button does). Returns whether anything was played. */
  playNow(): boolean {
    return this.playOne(true);
  }

  private playOne(force = false): boolean {
    const files = this.pool();
    // Nothing to play (yet, or for this look): look again in a while.
    if (!files.length || (!force && (sfx.muted || sfx.volume === 0 || !inFocus()))) {
      if (this.active && !force) this.schedule(files.length ? between(GAP_S) : 5);
      return false;
    }
    const choices = files.length > 1 ? files.filter((f) => f !== this.lastFile) : files;
    const file = choices[Math.floor(Math.random() * choices.length)]!;
    this.lastFile = file;
    this.fadeOut();
    const a = new Audio(`${import.meta.env.BASE_URL}ambience/${file}`);
    a.volume = Math.min(1, sfx.volume * LEVEL * (0.65 + Math.random() * 0.35));
    this.current = a;
    a.addEventListener('ended', () => { if (this.current === a) this.current = null; if (this.active) this.schedule(between(GAP_S)); });
    a.addEventListener('error', () => { if (this.current === a) this.current = null; if (this.active) this.schedule(between(GAP_S)); });
    void a.play().catch(() => { if (this.active) this.schedule(between(GAP_S)); });
    return true;
  }

  /** The camera is back on the board: no more sounds, and the one playing fades away. */
  stop(): void {
    this.active = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.fadeOut();
  }

  private fadeOut(): void {
    const a = this.current;
    if (!a) return;
    this.current = null;
    const start = a.volume;
    let step = 0;
    const id = setInterval(() => {
      step += 1;
      a.volume = Math.max(0, start * (1 - step / 12));
      if (step >= 12) { clearInterval(id); a.pause(); }
    }, 50);
  }
}

export const ambience = new Ambience();
