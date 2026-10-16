// A row of connected buttons for choosing one of a few options on the title screen. Each button has a tooltip, and the line
// under the row repeats the tooltip of the chosen option (touch screens show no hover tooltips).

import { h } from './dom';

export interface SegOption<T extends string> { id: T; label: string; tip: string }

export interface SegmentedField<T extends string> {
  el: HTMLElement;
  /** The chosen option. */
  get(): T;
}

/** `onChange` is called after every change and once at the start (so anything that depends on the choice can show it). */
export function segmentedField<T extends string>(title: string, options: readonly SegOption<T>[], initial: T, onChange?: (id: T) => void): SegmentedField<T> {
  let chosen = initial;
  const buttons = options.map((o) => h('button', { class: 'seg', type: 'button', role: 'radio', title: o.tip, data: { id: o.id } }, o.label));
  const note = h('span', { class: 'seg-note' });
  const show = (): void => {
    buttons.forEach((b) => { const on = b.dataset['id'] === chosen; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    note.textContent = options.find((o) => o.id === chosen)?.tip ?? '';
  };
  buttons.forEach((b, i) => b.addEventListener('click', () => { chosen = options[i]!.id; show(); onChange?.(chosen); }));
  const el = h('div', { class: 'seg-field' }, h('span', {}, title),
    h('div', { class: 'segmented', role: 'radiogroup', aria: { label: title } }, ...buttons), note);
  show();
  onChange?.(chosen);
  return { el, get: () => chosen };
}
