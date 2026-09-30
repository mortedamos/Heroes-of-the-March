// Screen shape and input type. CSS keys off the classes set here
// (shape-wide / shape-tall / shape-short, touch); the table layout and
// camera key off the shape.

import type { Shape } from './render/layout';

export function shapeOf(width: number, height: number): Shape {
  if (width / height < 0.9) return 'tall';
  if (height < 500) return 'short';
  return 'wide';
}

export function currentShape(): Shape {
  return shapeOf(window.innerWidth, window.innerHeight);
}

/** No hover (phones, most tablets): cards are opened by tapping instead. */
export function isTouch(): boolean {
  return window.matchMedia('(hover: none)').matches;
}

/** Keep the <body> classes in step with the viewport. Returns the shape. */
export function syncBodyClasses(): Shape {
  const shape = currentShape();
  const cl = document.body.classList;
  for (const s of ['wide', 'tall', 'short'] as const) cl.toggle(`shape-${s}`, s === shape);
  cl.toggle('touch', isTouch());
  return shape;
}

/**
 * Touch only: holding an element for a moment calls `fn` instead of a tap.
 * The click that ends the hold is swallowed, so holding a card never plays it.
 */
export function onLongPress(el: HTMLElement, fn: () => void, ms = 450): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fired = false;
  let sx = 0;
  let sy = 0;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    fired = false;
    sx = e.clientX;
    sy = e.clientY;
    cancel();
    timer = setTimeout(() => { fired = true; fn(); }, ms);
  });
  el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', (e) => {
    if (!fired) return;
    fired = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true });
  // Android opens a context menu on long press.
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
