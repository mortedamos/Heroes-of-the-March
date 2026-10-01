// Moving atmosphere for the title screen's painting: slow fog drifting through the valley, and
// embers and golden motes rising (from the split Marchstone and up from the dark ground).
// Fog is CSS; the particles are one small canvas. Everything stops when the screen is closed.

/** Where the glowing seam of the stone is in each painting, as a share of its width and height. */
const SEAM_WIDE = { x: 990 / 1376, y: 410 / 768, w: 1376, h: 768 };
const SEAM_TALL = { x: 262 / 768, y: 610 / 1376, w: 768, h: 1376 };

interface Particle {
  x: number; y: number; vx: number; vy: number; size: number; age: number; life: number; sway: number; phase: number;
  seam: boolean;
}

export function startTitleEffects(host: HTMLElement): () => void {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const fog = document.createElement('div');
  fog.className = 'title-fog title-fx';
  for (const c of ['a', 'b']) {
    const bank = document.createElement('div');
    bank.className = `fog-bank ${c}`;
    fog.appendChild(bank);
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'title-embers title-fx';
  host.prepend(canvas);
  host.prepend(fog);
  if (reduce) return () => { fog.remove(); canvas.remove(); };

  const g = canvas.getContext('2d')!;
  let W = 0, H = 0, dpr = 1;
  const resize = (): void => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  };
  resize();
  window.addEventListener('resize', resize);

  /** Where the stone's seam is on screen (the painting is drawn "cover", from the top centre). */
  const seamPoint = (): { x: number; y: number } => {
    const tall = window.matchMedia('(max-aspect-ratio: 5/4)').matches;
    const s = tall ? SEAM_TALL : SEAM_WIDE;
    const scale = Math.max(W / s.w, H / s.h);
    return { x: (W - s.w * scale) / 2 + s.x * s.w * scale, y: s.y * s.h * scale };
  };

  const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
  const spawn = (seam: boolean): Particle => {
    if (seam) {
      const p = seamPoint();
      return { x: p.x + rnd(-14, 14), y: p.y + rnd(-30, 50), vx: rnd(-6, 6), vy: -rnd(14, 36), size: rnd(1, 2.6), age: 0, life: rnd(2.6, 5.2), sway: rnd(6, 16), phase: rnd(0, 6.3), seam: true };
    }
    // Embers lift off the dark ground along the bottom and drift up and a little sideways.
    return { x: rnd(0, W), y: H + 8, vx: rnd(4, 22), vy: -rnd(26, 66), size: rnd(1, 3), age: 0, life: rnd(4, 9), sway: rnd(8, 26), phase: rnd(0, 6.3), seam: false };
  };

  const particles: Particle[] = [];
  const target = (): number => Math.round(Math.min(95, Math.max(40, (W * H) / 18000)));
  let last = performance.now();
  let raf = 0;
  let stopped = false;

  const frame = (now: number): void => {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Keep the numbers steady: about a third from the stone, the rest ambient.
    const want = target();
    while (particles.length < want) {
      const p = spawn(Math.random() < 0.38);
      // Spread them out at the start: begin part-way through their life, and part-way up their path.
      p.age = Math.random() * p.life * 0.8;
      p.x += p.vx * p.age;
      p.y += p.vy * p.age;
      particles.push(p);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.age += dt;
      if (p.age >= p.life || p.y < -20) { particles[i] = spawn(p.seam); continue; }
      p.phase += dt * 1.4;
      p.x += (p.vx + Math.sin(p.phase) * p.sway) * dt;
      p.y += p.vy * dt;
      const k = p.age / p.life;
      const alpha = Math.sin(Math.PI * k) * (p.seam ? 0.9 : 0.75); // fade in, then out
      const r = p.size * (p.seam ? 4.4 : 4);
      const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      if (p.seam) { grad.addColorStop(0, `rgba(255, 246, 205, ${alpha})`); grad.addColorStop(0.4, `rgba(255, 214, 120, ${alpha * 0.45})`); }
      else { grad.addColorStop(0, `rgba(255, 190, 90, ${alpha})`); grad.addColorStop(0.4, `rgba(255, 110, 30, ${alpha * 0.4})`); }
      grad.addColorStop(1, 'rgba(255, 120, 30, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.fill();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    fog.remove();
    canvas.remove();
  };
}
