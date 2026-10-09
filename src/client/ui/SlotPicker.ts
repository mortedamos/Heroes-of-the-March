// A "fill the slots" picker for heroes and companions: open slots on one side, the cards on offer on the other.
// Cards can be dragged (mouse, finger or pen) into a slot, between slots, or back out; a tap sends a card to the first
// open slot (or back). Nothing is decided until the player presses the confirm button.

import { h, replace } from './dom';

export interface PickerCard { id: string; def: string }

/** Where the cards are: one entry per slot (a card id or null); every other card is in the pool. */
export interface PickerState {
  decision: number;
  slots: (string | null)[];
  /** A locked card that was pushed out of its slot by another card returns to this slot when that card leaves. */
  home: Record<string, number>;
}

export interface SlotPickerOptions {
  state: PickerState;
  /** Every card that can be in a slot or in the pool. */
  cards: PickerCard[];
  /** Cards that stay where they are unless another card takes their slot (your current companions). */
  locked?: ReadonlySet<string>;
  /** Locked cards that cannot even be replaced (a resting companion). */
  fixed?: ReadonlySet<string>;
  title: string;
  hint: string;
  slotsLabel: string;
  poolLabel: string;
  width: number;
  /** A card button: preview, sound and the tap behaviour are the caller's. */
  makeCard: (card: PickerCard, width: number, tap: () => void) => HTMLButtonElement;
  /** A bare picture of a card, shown under the finger or pointer while dragging. */
  ghost: (card: PickerCard, width: number) => HTMLElement;
  confirm: { label: string; enabled: boolean; run: () => void };
  /** Other buttons next to the confirm button (Let them go, Send them back). */
  extras?: HTMLElement[];
  /** Beside the slots (your hero). */
  aside?: HTMLElement | null;
  /** The state changed: draw the picker again. */
  onChange: () => void;
  onDragStart?: () => void;
}

/** A card dragged or tapped just now swallows the click that ends the gesture. */
let swallowClick = false;

export const newPickerState = (decision: number, slots: (string | null)[], home: Record<string, number> = {}): PickerState => ({ decision, slots: [...slots], home: { ...home } });

/** Locked cards pushed into the pool go back to their home slot when it is free. */
function restoreHomes(s: PickerState): void {
  for (const [id, idx] of Object.entries(s.home)) {
    if (s.slots.includes(id) || s.slots[idx] !== null) continue;
    s.slots[idx] = id;
  }
}

/** Put a card in a slot. A card already there goes to the pool, or swaps into the slot the dragged card left. */
export function placeCard(s: PickerState, id: string, to: number, locked: ReadonlySet<string>, fixed: ReadonlySet<string> = new Set()): void {
  if (locked.has(id)) return;
  const from = s.slots.indexOf(id);
  if (from === to) return;
  const occupant = s.slots[to] ?? null;
  if (occupant && fixed.has(occupant)) return;
  if (from >= 0) s.slots[from] = null;
  if (occupant && locked.has(occupant)) s.home[occupant] = to;
  if (occupant && from >= 0 && !locked.has(occupant)) s.slots[from] = occupant;
  s.slots[to] = id;
  restoreHomes(s);
}

/** Take a card out of its slot (back to the pool). */
export function removeCard(s: PickerState, id: string, locked: ReadonlySet<string>): void {
  const from = s.slots.indexOf(id);
  if (from < 0 || locked.has(id)) return;
  s.slots[from] = null;
  restoreHomes(s);
}

/** A tap on a pool card: first open slot, or (with one slot) in place of the card there. */
function tapPool(s: PickerState, id: string, locked: ReadonlySet<string>, fixed: ReadonlySet<string>): void {
  const open = s.slots.indexOf(null);
  if (open >= 0) placeCard(s, id, open, locked, fixed);
  else if (s.slots.length === 1) placeCard(s, id, 0, locked, fixed);
}

export function renderSlotPicker(target: HTMLElement, o: SlotPickerOptions): void {
  const { state: s } = o;
  const locked = o.locked ?? new Set<string>();
  const fixed = o.fixed ?? new Set<string>();
  const byId = new Map(o.cards.map((c) => [c.id, c]));
  const change = (fn: () => void): void => { fn(); o.onChange(); };
  const slotH = Math.round(o.width * 1.4);

  // Pushed-out locked cards are shown in the pool, dimmed, so you can see what would be let go.
  const pool = o.cards.filter((c) => !s.slots.includes(c.id));
  const movableInPool = pool.filter((c) => !locked.has(c.id));

  const slotEls = s.slots.map((id, i) => {
    const slot = h('div', { class: `pick-slot${id ? ' filled' : ''}`, data: { slot: String(i) } });
    slot.style.width = `${o.width}px`;
    slot.style.height = `${slotH}px`;
    const card = id ? byId.get(id) : undefined;
    if (!card) { slot.append(h('span', {}, 'Open slot')); return slot; }
    const isLocked = locked.has(card.id);
    const tap = (): void => {
      if (swallowClick) return;
      change(() => {
        if (!isLocked) removeCard(s, card.id, locked);
        else if (movableInPool.length === 1 && !fixed.has(card.id)) placeCard(s, movableInPool[0]!.id, i, locked, fixed);
      });
    };
    const b = o.makeCard(card, o.width, tap);
    if (isLocked) b.classList.add('locked');
    else attachDrag(b, card, o, target);
    slot.append(b);
    return slot;
  });

  const poolEls = pool.map((c) => {
    const isLocked = locked.has(c.id);
    const tap = (): void => {
      if (swallowClick || isLocked) return;
      change(() => tapPool(s, c.id, locked, fixed));
    };
    const b = o.makeCard(c, o.width, tap);
    if (isLocked) { b.classList.add('locked', 'letgo'); b.title = 'Let go'; }
    else attachDrag(b, c, o, target);
    return b;
  });

  const confirm = h('button', { class: 'btn primary', on: { click: () => o.confirm.run() } }, o.confirm.label);
  confirm.disabled = !o.confirm.enabled;
  replace(target, h('div', { class: 'picker' },
    o.aside ?? null,
    h('section', { class: 'picker-slots' }, h('h3', {}, o.slotsLabel), h('div', { class: 'picker-slotlist' }, ...slotEls)),
    h('section', { class: 'picker-pool-wrap' }, h('h3', {}, o.poolLabel),
      h('div', { class: 'picker-pool', data: { zone: 'pool' } }, ...(poolEls.length ? poolEls : [h('span', { class: 'stage-empty' }, 'Every card is in a slot.')])))),
  h('p', { class: 'stage-hint picker-hint' }, o.hint),
  h('div', { class: 'decision-buttons' }, ...(o.extras ?? []), confirm));
}

/** Drag a card button with mouse, touch or pen. A short movement is still a tap. */
function attachDrag(btn: HTMLButtonElement, card: PickerCard, o: SlotPickerOptions, root: HTMLElement): void {
  let pid = -1;
  let sx = 0;
  let sy = 0;
  let ghost: HTMLElement | null = null;
  let over: Element | null = null;
  const locked = o.locked ?? new Set<string>();

  const targetAt = (x: number, y: number): { slot: number } | { pool: true } | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const slot = el.closest('[data-slot]');
      if (slot && root.contains(slot)) return { slot: Number((slot as HTMLElement).dataset['slot']) };
      const pool = el.closest('[data-zone="pool"]');
      if (pool && root.contains(pool)) return { pool: true };
    }
    return null;
  };
  const highlight = (x: number, y: number): void => {
    const t = targetAt(x, y);
    const el = !t ? null : 'slot' in t ? root.querySelector(`[data-slot="${t.slot}"]`) : root.querySelector('[data-zone="pool"]');
    if (el === over) return;
    over?.classList.remove('over');
    el?.classList.add('over');
    over = el;
  };
  const finish = (x: number, y: number, drop: boolean): void => {
    ghost?.remove();
    ghost = null;
    over?.classList.remove('over');
    over = null;
    btn.classList.remove('dragging');
    if (pid >= 0) { try { btn.releasePointerCapture(pid); } catch { /* already released */ } }
    pid = -1;
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 0);
    if (!drop) return;
    const t = targetAt(x, y);
    const s = o.state;
    if (t && 'slot' in t) placeCard(s, card.id, t.slot, locked, o.fixed);
    else if (t) removeCard(s, card.id, locked);
    o.onChange();
  };

  btn.style.touchAction = 'none';
  btn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pid = e.pointerId;
    sx = e.clientX;
    sy = e.clientY;
    try { btn.setPointerCapture(pid); } catch { /* not capturable */ }
  });
  btn.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    if (!ghost) {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) < 8) return;
      o.onDragStart?.();
      ghost = h('div', { class: 'drag-ghost' }, o.ghost(card, o.width));
      document.body.append(ghost);
      btn.classList.add('dragging');
    }
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    highlight(e.clientX, e.clientY);
  });
  btn.addEventListener('pointerup', (e) => {
    if (e.pointerId !== pid) return;
    if (ghost) finish(e.clientX, e.clientY, true);
    else pid = -1; // a tap: the click handler does the work
  });
  btn.addEventListener('pointercancel', (e) => { if (e.pointerId === pid && ghost) finish(e.clientX, e.clientY, false); pid = -1; });
}
