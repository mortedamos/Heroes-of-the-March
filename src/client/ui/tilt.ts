// A large card leans a few degrees toward the mouse (or the finger on a touch screen), as if
// it were hinged on a pin through its middle. One set of window listeners serves every card
// registered; a card that has left the page is dropped.

const MAX_DEG = 5;
const PERSPECTIVE = 900;

const tracked = new Set<HTMLElement>();
let pointer: { x: number; y: number } | null = null;
let listening = false;

function lean(el: HTMLElement): void {
  el.dataset['seen'] = '1';
  const max = Number(el.dataset['tilt'] ?? MAX_DEG);
  if (!pointer) { el.style.transform = ''; return; }
  const r = el.getBoundingClientRect();
  // How far the pointer is from the card's centre, as a share of half the window (so the full lean is at the window's edge).
  const nx = Math.max(-1, Math.min(1, (pointer.x - (r.left + r.width / 2)) / (window.innerWidth / 2)));
  const ny = Math.max(-1, Math.min(1, (pointer.y - (r.top + r.height / 2)) / (window.innerHeight / 2)));
  el.style.transform = `perspective(${PERSPECTIVE}px) rotateX(${(-ny * max).toFixed(2)}deg) rotateY(${(nx * max).toFixed(2)}deg)`;
}

function update(): void {
  for (const el of tracked) {
    if (el.isConnected) lean(el);
    else if (el.dataset['seen']) tracked.delete(el); // it was on the page and has gone; one not yet added is kept
  }
}

function listen(): void {
  if (listening) return;
  listening = true;
  const move = (e: PointerEvent): void => { pointer = { x: e.clientX, y: e.clientY }; update(); };
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerdown', move, { passive: true });
  // The mouse leaves the window, or the finger lifts: the card settles back flat.
  document.addEventListener('mouseleave', () => { pointer = null; update(); });
  window.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') { pointer = null; update(); } }, { passive: true });
  window.addEventListener('blur', () => { pointer = null; update(); });
}

/**
 * Make `el` lean toward the pointer, by at most `maxDeg` degrees in any direction. It should be
 * an element of its own (nothing else animating its `transform`), such as a wrapper around the card face.
 */
export function tiltOnPointer(el: HTMLElement, maxDeg = MAX_DEG): void {
  el.dataset['tilt'] = String(maxDeg);
  el.classList.add('tilt');
  tracked.add(el);
  listen();
  if (el.isConnected) lean(el);
}
