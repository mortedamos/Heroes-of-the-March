// The game menu: one button in the upper left opens it. Game actions, sound and graphics, and (in dev builds)
// the debug panel. One instance lives on the page for the whole session.

import { sfx } from '../audio/Sfx';
import { closeDebugMenu, toggleDebugMenu, type DebugApi } from './DebugMenu';
import { h, replace } from './dom';
import { closeMusicMenu, toggleMusicMenu } from './MusicMenu';

export interface MenuApi {
  /** One line on the game now ("Turn 3 · Perrin's turn · Bidding"); empty before it starts. */
  status(): string;
  rules(): void;
  log(): void;
  newGame(): void;
  /** The step-back camera: pulled back to show the whole place, until turned off. */
  stepBack: { get(): boolean; set(on: boolean): void };
  debug?: DebugApi;
}

const panel = h('div', { class: 'game-menu hidden', role: 'dialog', aria: { label: 'Menu' } });
let anchor: HTMLElement | null = null;
let mounted = false;

function hide(): void {
  panel.classList.add('hidden');
  anchor?.setAttribute('aria-expanded', 'false');
}

function render(api: MenuApi): void {
  /** Close the menu, then do `fn`: choosing anything leaves the menu. */
  const pick = (fn: () => void) => () => { sfx.play('click'); hide(); fn(); };
  const item = (label: string, fn: () => void): HTMLElement => h('button', { class: 'menu-item', on: { click: pick(fn) } }, label);
  const back = api.stepBack.get();
  const status = api.status();
  // Sections are groups so a short screen (a phone on its side) can lay them out in two columns.
  const group = (title: string, ...items: (HTMLElement | null)[]): HTMLElement =>
    h('div', { class: 'menu-group' }, h('div', { class: 'menu-head' }, title), ...items);
  replace(panel,
    h('div', { class: 'menu-brand' }, 'Heroes of the March'),
    status ? h('div', { class: 'menu-status' }, status) : null,
    group('Game', item('Rules', () => api.rules()), item('Log', () => api.log()), item('New game', () => api.newGame())),
    group('Sound', item('♫ Music', () => { if (anchor) toggleMusicMenu(anchor); })),
    group('Graphics',
      h('button', { class: 'menu-item menu-toggle', role: 'switch', aria: { checked: String(back) }, on: { click: pick(() => api.stepBack.set(!back)) } },
        h('span', {}, 'Step back camera'), h('span', { class: `menu-switch${back ? ' on' : ''}` })),
      h('div', { class: 'menu-hint' }, 'Pulls the camera back to show the whole place. Turn it off to return to the table.')),
    api.debug ? group('Debug', item('Debug panel', () => { if (anchor) toggleDebugMenu(anchor, api.debug!); })) : null,
  );
}

function place(): void {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  panel.style.top = `${Math.round(r.bottom + 6)}px`;
  panel.style.left = `${Math.max(8, Math.round(r.left))}px`;
}

function mount(): void {
  if (mounted) return;
  mounted = true;
  document.body.appendChild(panel);
  document.addEventListener('pointerdown', (e) => {
    if (!panel.classList.contains('hidden') && !panel.contains(e.target as Node) && !anchor?.contains(e.target as Node)) hide();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('resize', place);
}

/** The menu button was pressed: open the menu under it (or close it). */
export function toggleGameMenu(button: HTMLElement, api: MenuApi): void {
  mount();
  anchor = button;
  closeMusicMenu();
  closeDebugMenu();
  if (panel.classList.contains('hidden')) {
    render(api);
    place();
    panel.classList.remove('hidden');
    button.setAttribute('aria-expanded', 'true');
  } else hide();
}

export function closeGameMenu(): void {
  hide();
}
