// Deterministic, serializable PRNG (sfc32). The state lives inside GameState so
// a game can be replayed from its seed and command log.
//
// SECURITY: the seed and state are secret. Anyone who learns them can predict
// every shuffle and die roll, so they never go into a PlayerView. Seeds come
// from the platform CSPRNG unless a test supplies one.

export type RngState = [number, number, number, number];

export function randomSeed(): RngState {
  const a = new Uint32Array(4);
  globalThis.crypto.getRandomValues(a);
  return [a[0]!, a[1]!, a[2]!, a[3]!];
}

/** Advance the state in place and return a float in [0, 1). */
export function nextFloat(s: RngState): number {
  let [a, b, c, d] = s;
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  s[0] = a >>> 0; s[1] = b >>> 0; s[2] = c >>> 0; s[3] = d >>> 0;
  return (t >>> 0) / 4294967296;
}

export function nextInt(s: RngState, maxExclusive: number): number {
  return Math.floor(nextFloat(s) * maxExclusive);
}


export function shuffleInPlace<T>(s: RngState, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(s, i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/** Mix a seed a few rounds so low-entropy test seeds still behave. */
export function warmUp(s: RngState): RngState {
  const out: RngState = [s[0] >>> 0, s[1] >>> 0, s[2] >>> 0, s[3] >>> 0];
  for (let i = 0; i < 16; i++) nextFloat(out);
  return out;
}

/** Random opaque id from the game RNG (deterministic for replays, unguessable to clients). */
export function nextId(s: RngState): string {
  let id = '';
  for (let i = 0; i < 2; i++) id += Math.floor(nextFloat(s) * 0x100000000).toString(36).padStart(7, '0');
  return id;
}
