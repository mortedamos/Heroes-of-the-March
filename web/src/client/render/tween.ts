// Minimal promise-based tweening driven by the render loop.
//
// Browsers stop animation frames for hidden tabs/panes. Game flow awaits these
// tweens, so each one also has a timer that finishes it if frames stop:
// the game keeps up in the background and simply jumps to the end state.

export type Ease = (t: number) => number;
export const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOut: Ease = (t) => 1 - (1 - t) ** 3;
export const linear: Ease = (t) => t;

interface Tween {
  start: number;
  dur: number;
  ease: Ease;
  update: (k: number) => void;
  resolve: () => void;
  owner: object | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Grace period past a tween's end before the timer finishes it without frames. */
const NO_FRAMES_GRACE_MS = 250;

export class Tweens {
  private list: Tween[] = [];
  private now = 0;

  /** Animate over `ms`. A new tween for the same owner cancels (and finishes) the old one. */
  add(ms: number, update: (k: number) => void, opts: { ease?: Ease; delay?: number; owner?: object } = {}): Promise<void> {
    if (opts.owner) this.cancel(opts.owner);
    return new Promise((resolve) => {
      const t: Tween = {
        start: this.now + (opts.delay ?? 0), dur: Math.max(1, ms), ease: opts.ease ?? easeInOut,
        update, resolve, owner: opts.owner ?? null, timer: null,
      };
      t.timer = setTimeout(() => this.finish(t), (opts.delay ?? 0) + t.dur + NO_FRAMES_GRACE_MS);
      this.list.push(t);
    });
  }

  /** Jump a tween to its end state and resolve it. */
  private finish(t: Tween): void {
    if (!this.list.includes(t)) return;
    this.list = this.list.filter((x) => x !== t);
    if (t.timer) clearTimeout(t.timer);
    t.update(1);
    t.resolve();
  }

  cancel(owner: object): void {
    this.list = this.list.filter((t) => {
      if (t.owner !== owner) return true;
      if (t.timer) clearTimeout(t.timer);
      t.resolve();
      return false;
    });
  }

  tick(now: number): void {
    this.now = now;
    const done: Tween[] = [];
    for (const t of this.list) {
      if (now < t.start) continue;
      const k = Math.min(1, (now - t.start) / t.dur);
      t.update(t.ease(k));
      if (k >= 1) done.push(t);
    }
    if (done.length) {
      this.list = this.list.filter((t) => !done.includes(t));
      for (const t of done) {
        if (t.timer) clearTimeout(t.timer);
        t.resolve();
      }
    }
  }

  get busy(): boolean {
    return this.list.length > 0;
  }
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
