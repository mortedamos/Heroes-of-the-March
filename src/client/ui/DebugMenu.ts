// The debug panel: tweak how the place looks while playing. Only offered in dev builds, or with ?debug in the URL.
// Settings are remembered in this browser so a reload keeps them.

import { h, replace } from './dom';

/** What the panel can change; GameClient wires it to the table's Environment. */
export interface DebugApi {
  /** Every look the table can have, for the picker. */
  themes: string[];
  /** The look showing now. */
  theme(): string;
  /** The look the picker holds fixed, or null while the game picks one per location. */
  pinned(): string | null;
  /** Hold a look fixed (null: follow the game again). */
  pin(id: string | null): void;
  fog(): number;
  setFog(level: number): void;
  haze(): number;
  setHaze(level: number): void;
  /** Play one of this look's place sounds now; false when it has none. */
  playAmbience(): boolean;
}

const STORE = 'hotm.debug';

export interface DebugPrefs { fog: number; haze: number; pinned: string | null }
export const DEBUG_DEFAULTS: DebugPrefs = { fog: 1, haze: 1, pinned: null };

export function debugEnabled(): boolean {
  try { return import.meta.env.DEV || new URLSearchParams(location.search).has('debug'); } catch { return false; }
}

export function loadDebugPrefs(): DebugPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<DebugPrefs>;
    const num = (x: unknown, d: number) => (typeof x === 'number' && x >= 0 && x <= 5 ? x : d);
    return { fog: num(v.fog, 1), haze: num(v.haze, 1), pinned: typeof v.pinned === 'string' ? v.pinned : null };
  } catch { return { ...DEBUG_DEFAULTS }; }
}

function savePrefs(api: DebugApi): void {
  try { localStorage.setItem(STORE, JSON.stringify({ fog: api.fog(), haze: api.haze(), pinned: api.pinned() })); } catch { /* private mode */ }
}

const panel = h('div', { class: 'debug-menu hidden', role: 'dialog', aria: { label: 'Debug' } });
let anchor: HTMLElement | null = null;
let mounted = false;

function slider(label: string, hint: string, value: number, max: number, set: (v: number) => void): HTMLElement {
  const input = h('input', { type: 'range', aria: { label } });
  input.min = '0'; input.max = String(max); input.step = '0.05'; input.value = String(value);
  const out = h('span', { class: 'debug-val' }, value.toFixed(2));
  input.addEventListener('input', () => { const v = Number(input.value); out.textContent = v.toFixed(2); set(v); });
  return h('label', { class: 'debug-row' }, h('span', { class: 'debug-label' }, label), input, out, h('span', { class: 'debug-hint' }, hint));
}

function render(api: DebugApi): void {
  const pick = h('select', { aria: { label: 'Location look' } });
  const follow = h('option', {}, `Follow the game (${api.theme()})`);
  follow.value = '';
  pick.appendChild(follow);
  for (const id of api.themes) {
    const o = h('option', {}, id);
    o.value = id;
    pick.appendChild(o);
  }
  pick.value = api.pinned() ?? '';
  pick.addEventListener('change', () => { api.pin(pick.value || null); savePrefs(api); render(api); });
  replace(panel,
    h('div', { class: 'music-title' }, 'Debug'),
    h('label', { class: 'debug-row' }, h('span', { class: 'debug-label' }, 'Location look'), pick,
      h('span', { class: 'debug-hint' }, 'Hold one place on the table, whatever the game reveals.')),
    slider('Fog level', '0 = none, 1 = as designed, higher = thicker. Moves how near the fog starts.', api.fog(), 4, (v) => { api.setFog(v); savePrefs(api); }),
    slider('Horizon haze', '0 = the panorama runs to the ground, 1 = as designed, higher = more mist at the horizon.', api.haze(), 3, (v) => { api.setHaze(v); savePrefs(api); }),
    h('div', { class: 'music-buttons' },
      h('button', { class: 'btn', title: 'Play one of this look\'s place sounds now', on: { click: (e) => { const b = e.currentTarget as HTMLButtonElement; b.textContent = api.playAmbience() ? 'Playing…' : 'No sound for this look'; setTimeout(() => { b.textContent = 'Play a place sound'; }, 1800); } } }, 'Play a place sound'),
      h('button', { class: 'btn', on: { click: () => { api.pin(null); api.setFog(1); api.setHaze(1); savePrefs(api); render(api); } } }, 'Reset')),
    h('div', { class: 'debug-hint' }, 'Tip: scroll down on the table to lift the camera and look at the horizon.'),
  );
}

function place(): void {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  panel.style.top = `${Math.round(r.bottom + 6)}px`;
  panel.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
}

function mount(): void {
  if (mounted) return;
  mounted = true;
  document.body.appendChild(panel);
  document.addEventListener('pointerdown', (e) => {
    if (!panel.classList.contains('hidden') && !panel.contains(e.target as Node) && !anchor?.contains(e.target as Node)) panel.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.classList.add('hidden'); });
  window.addEventListener('resize', place);
}

export function toggleDebugMenu(button: HTMLElement, api: DebugApi): void {
  mount();
  anchor = button;
  if (panel.classList.contains('hidden')) {
    render(api);
    place();
    panel.classList.remove('hidden');
  } else panel.classList.add('hidden');
}
