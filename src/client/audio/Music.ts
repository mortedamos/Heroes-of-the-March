import { inFocus, onFocusChange } from './focus';
// Background music: a random neutral track first. When a location is revealed, its own track plays if there is one
// (public/music/locations/<location-id>.mp3, listed in public/music/manifest.json); otherwise the next neutral track plays.
// A track loops until the next location.
// Browsers only allow audio after a user gesture, so playback starts on the
// first click, tap or key press. Volume and mute are remembered per browser.

/** Files in public/music/. Add a name here when you add a track. */
const TRACKS = ['neutral_music_1.mp3', 'neutral_music_2.mp3', 'neutral_music_3.mp3'];
/** Plays on the title screen. */
const TITLE_TRACK = 'title.mp3';
/** Plays on the hero draft and the opening companion draft. */
const OPENING_TRACK = 'hero_selection.mp3';

/** 'title' and 'opening' loop their own track; 'rounds' loops one playlist track per round. */
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
  /** Location tracks that exist, by location id (from public/music/manifest.json). */
  private locationFiles: Record<string, string> = {};
  /** The location now on the table, and the file it is playing (null: a neutral track is playing). */
  private location: string | null = null;
  private locationFile: string | null = null;
  private started = false;
  /** What is playing: the title track, the hero-selection track, or the playlist of the normal rounds. */
  private mode: MusicMode = 'title';
  volume: number;
  muted: boolean;
  /** 0..1 multiplier used to fade tracks out and in. */
  private fadeLevel = 1;
  /** 0..1 multiplier while the camera is lifted away from the board (the place's own sounds come forward). */
  private duck = 1;
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
    this.audio.loop = true; // every track loops until the game moves on (a new round for the playlist)
    this.applyVolume();
    this.audio.addEventListener('ended', () => this.next(1, true));
    void this.loadManifest();
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

  private async loadManifest(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}music/manifest.json`);
      if (res.ok) this.locationFiles = ((await res.json()) as { locations?: Record<string, string> }).locations ?? {};
    } catch { /* no manifest: neutral music only */ }
  }

  private get file(): string {
    if (this.mode !== 'rounds') return FIXED_TRACK[this.mode];
    return this.locationFile ?? TRACKS[this.index]!;
  }
  get track(): string { return this.file.replace(/^.*\//, '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]/g, ' '); }
  /** Position in the neutral playlist, or null for the title, hero-selection and location tracks. */
  get trackNumber(): [number, number] | null { return this.mode === 'rounds' && !this.locationFile ? [this.index + 1, TRACKS.length] : null; }

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
      if (mode === 'rounds') {
        this.index = Math.floor(Math.random() * TRACKS.length);
        this.locationFile = this.location ? this.locationFiles[this.location] ?? null : null;
      }
      this.audio.loop = true;
      this.load();
      if (this.started) this.play();
      this.emit();
    };
    if (!this.started || this.audio.paused) { this.changeId++; this.fadeLevel = 1; this.applyVolume(); change(); return; }
    void this.fadeChange(change);
  }

  /**
   * A location was revealed. Its own track plays if it has one; otherwise a neutral track does
   * (`advance`: move on to the next neutral track even if one is already playing, as each new round does).
   */
  locationRevealed(def: string, advance: boolean): void {
    this.location = def;
    if (this.mode !== 'rounds') return; // applied when the rounds begin
    const own = this.locationFiles[def] ?? null;
    if (own && own === this.locationFile) return;
    if (!own && !this.locationFile && !advance) return;
    const change = (): void => {
      this.locationFile = own;
      if (!own) this.index = (this.index + 1) % TRACKS.length;
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
    this.audio.src = `${import.meta.env.BASE_URL}music/${this.file.split('/').map(encodeURIComponent).join('/')}`;
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
    if (this.mode !== 'rounds') this.mode = 'rounds';
    this.locationFile = null; // skipping goes to the neutral playlist
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

  /** Turn the music down (or back up) without touching the player's volume setting: 1 = as set. */
  setDuck(level: number): void {
    const d = Math.min(1, Math.max(0, level));
    if (Math.abs(d - this.duck) < 0.002) return;
    this.duck = d;
    this.applyVolume();
  }

  private applyVolume(): void {
    this.audio.volume = this.muted ? 0 : this.volume * this.fadeLevel * this.duck;
  }
  private save(): void {
    try { localStorage.setItem(STORE, JSON.stringify({ volume: this.volume, muted: this.muted })); } catch { /* private mode */ }
  }
}

export const music = new MusicPlayer();
