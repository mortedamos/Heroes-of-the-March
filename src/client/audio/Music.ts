import { inFocus, onFocusChange } from './focus';
// Background music: a random track first, then the playlist in order, looping.
// Browsers only allow audio after a user gesture, so playback starts on the
// first click, tap or key press. Volume and mute are remembered per browser.

/** Files in public/music/. Add a name here when you add a track. */
const TRACKS = ['neutral_music_1.mp3', 'neutral_music_2.mp3', 'neutral_music_3.mp3'];
/** Plays on the title screen. */
const TITLE_TRACK = 'title.mp3';
/** Plays on the hero draft and the opening companion draft. */
const OPENING_TRACK = 'hero_selection.mp3';

/** 'title' and 'opening' loop their own track; 'rounds' plays the playlist. */
export type MusicMode = 'title' | 'opening' | 'rounds';
const FIXED_TRACK: Record<'title' | 'opening', string> = { title: TITLE_TRACK, opening: OPENING_TRACK };
/** How long the hero-selection music takes to fade out, and the next track to fade in (ms). */
const FADE_MS = 1800;
/** Music plays at half volume by default. */
const DEFAULT_VOLUME = 0.5;
const STORE = 'hotm.music';

type Listener = () => void;

function loadPrefs(): { volume: number; muted: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as { volume?: unknown; muted?: unknown };
    const v = typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : DEFAULT_VOLUME;
    return { volume: v, muted: raw.muted === true };
  } catch { return { volume: DEFAULT_VOLUME, muted: false }; }
}

class MusicPlayer {
  private readonly audio = new Audio();
  private readonly listeners = new Set<Listener>();
  private index = Math.floor(Math.random() * TRACKS.length);
  private started = false;
  /** What is playing: the title track, the hero-selection track, or the playlist of the normal rounds. */
  private mode: MusicMode = 'title';
  volume: number;
  muted: boolean;
  /** 0..1 multiplier used to fade tracks out and in. */
  private fadeLevel = 1;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  /** Bumped by every track change so an older fade can tell it was superseded. */
  private changeId = 0;
  playing = false;
  /** Music was playing when the page lost focus, so it restarts when focus returns. */
  private resumeOnFocus = false;

  constructor() {
    const p = loadPrefs();
    this.volume = p.volume;
    this.muted = p.muted;
    this.audio.preload = 'auto';
    this.audio.loop = true; // the title and opening tracks loop; the playlist turns this off
    this.applyVolume();
    this.audio.addEventListener('ended', () => this.next(1, true));
    this.audio.addEventListener('play', () => this.set({ playing: true }));
    this.audio.addEventListener('pause', () => this.set({ playing: false }));
    // Silence the music while the page is in the background, and pick it up again on return.
    onFocusChange((focused) => {
      if (!focused) {
        if (this.playing) { this.resumeOnFocus = true; this.pause(); }
      } else if (this.resumeOnFocus) {
        this.resumeOnFocus = false;
        this.play();
      }
    });
  }

  private get file(): string { return this.mode === 'rounds' ? TRACKS[this.index]! : FIXED_TRACK[this.mode]; }
  get track(): string { return this.file.replace(/\.mp3$/, '').replace(/_/g, ' '); }
  /** Position in the playlist, or null during the title and hero-selection tracks. */
  get trackNumber(): [number, number] | null { return this.mode === 'rounds' ? [this.index + 1, TRACKS.length] : null; }

  /**
   * The title screen plays the title track; the hero draft and opening companion
   * draft play the hero-selection track; when the normal rounds begin, the playlist
   * starts on a random track.
   */
  setOpening(on: boolean): void { this.setMode(on ? 'opening' : 'rounds'); }

  setMode(mode: MusicMode): void {
    if (mode === this.mode) return;
    const change = (): void => {
      this.mode = mode;
      if (mode === 'rounds') this.index = Math.floor(Math.random() * TRACKS.length);
      this.audio.loop = mode !== 'rounds';
      this.load();
      if (this.started) this.play();
      this.emit();
    };
    if (!this.started || this.audio.paused) { this.changeId++; this.fadeLevel = 1; this.applyVolume(); change(); return; }
    void this.fadeChange(change);
  }

  /** Fade the current track out, switch, and fade the new one in. */
  private async fadeChange(change: () => void): Promise<void> {
    const id = ++this.changeId;
    await this.ramp(0, FADE_MS);
    if (id !== this.changeId) return; // another change took over
    change();
    await this.ramp(1, FADE_MS);
  }

  /** Move the fade multiplier to `target` over `ms`. */
  private ramp(target: number, ms: number): Promise<void> {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    const from = this.fadeLevel;
    const t0 = performance.now();
    return new Promise((resolve) => {
      this.fadeTimer = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        this.fadeLevel = from + (target - from) * k;
        this.applyVolume();
        if (k >= 1) { clearInterval(this.fadeTimer!); this.fadeTimer = null; resolve(); }
      }, 50);
    });
  }

  onChange(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(): void { for (const fn of this.listeners) fn(); }
  private set(patch: { playing: boolean }): void { this.playing = patch.playing; this.emit(); }

  /** Call once; starts on the first user gesture. */
  autoStart(): void {
    const go = (): void => {
      window.removeEventListener('pointerdown', go, true);
      window.removeEventListener('keydown', go, true);
      if (!this.started) this.play();
    };
    window.addEventListener('pointerdown', go, true);
    window.addEventListener('keydown', go, true);
  }

  private load(): void {
    this.audio.src = `${import.meta.env.BASE_URL}music/${encodeURIComponent(this.file)}`;
  }

  play(): void {
    this.started = true;
    if (!this.audio.src) this.load();
    if (!inFocus()) { this.resumeOnFocus = true; return; } // starts once the page is back in front
    void this.audio.play().catch(() => { this.started = false; });
  }
  pause(): void { this.audio.pause(); }
  toggle(): void { if (this.playing) this.pause(); else this.play(); }

  next(step = 1, gentle = false): void {
    this.changeId++;
    if (this.mode !== 'rounds') { this.mode = 'rounds'; this.audio.loop = false; }
    this.index = (this.index + step + TRACKS.length) % TRACKS.length;
    this.load();
    if (gentle) { this.fadeLevel = 0; this.applyVolume(); }
    this.play();
    this.emit();
    if (gentle) void this.ramp(1, FADE_MS);
    else { if (this.fadeTimer) clearInterval(this.fadeTimer); this.fadeTimer = null; this.fadeLevel = 1; this.applyVolume(); }
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.volume > 0) this.muted = false;
    this.applyVolume();
    this.save();
    this.emit();
  }
  setMuted(m: boolean): void { this.muted = m; this.applyVolume(); this.save(); this.emit(); }

  private applyVolume(): void {
    this.audio.volume = this.muted ? 0 : this.volume * this.fadeLevel;
  }
  private save(): void {
    try { localStorage.setItem(STORE, JSON.stringify({ volume: this.volume, muted: this.muted })); } catch { /* private mode */ }
  }
}

export const music = new MusicPlayer();
