// The debug panel: tweak how the place looks while playing. Only offered in dev builds, or with ?debug in the URL.
// Settings are remembered in this browser so a reload keeps them.

import { h, replace } from './dom';
import { FOG_DEFAULT, HAZE_DEFAULT } from '../render/env/Environment';

/** What the panel can change; GameClient wires it to the table's Environment. */
export interface DebugApi {
  /** Every look the table can have, for the picker: its id, its name, and the family of places it is listed under. */
  themes: { id: string; label: string; group: string }[];
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
  /** Show an image from disk as the sky of every place, to try a new painting (null: back to the real skies). Not saved. */
  tryPainting(file: File | null): void;
}

const STORE = 'hotm.debug';

export interface DebugPrefs { fog: number; haze: number; pinned: string | null }
export const DEBUG_DEFAULTS: DebugPrefs = { fog: FOG_DEFAULT, haze: HAZE_DEFAULT, pinned: null };

export function debugEnabled(): boolean {
  try { return import.meta.env.DEV || new URLSearchParams(location.search).has('debug'); } catch { return false; }
}

export function loadDebugPrefs(): DebugPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<DebugPrefs>;
    const num = (x: unknown, d: number) => (typeof x === 'number' && x >= 0 && x <= 5 ? x : d);
    return { fog: num(v.fog, DEBUG_DEFAULTS.fog), haze: num(v.haze, DEBUG_DEFAULTS.haze), pinned: typeof v.pinned === 'string' ? v.pinned : null };
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
  const follow = h('option', {}, `Follow the game (${api.themes.find((t) => t.id === api.theme())?.label ?? api.theme()})`);
  follow.value = '';
  pick.appendChild(follow);
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const t of api.themes) {
    let g = groups.get(t.group);
    if (!g) {
      g = document.createElement('optgroup');
      g.label = t.group;
      groups.set(t.group, g);
      pick.appendChild(g);
    }
    const o = h('option', {}, t.label);
    o.value = t.id;
    g.appendChild(o);
  }
  pick.value = api.pinned() ?? '';
  pick.addEventListener('change', () => { api.pin(pick.value || null); savePrefs(api); render(api); });
  const painting = h('input', { type: 'file', aria: { label: 'Try a painting' } });
  painting.accept = 'image/*';
  painting.addEventListener('change', () => { api.tryPainting(painting.files?.[0] ?? null); });
  replace(panel,
    h('div', { class: 'music-title' }, 'Debug'),
    h('label', { class: 'debug-row' }, h('span', { class: 'debug-label' }, 'Location look'), pick,
      h('span', { class: 'debug-hint' }, 'Hold one place on the table, whatever the game reveals.')),
    h('label', { class: 'debug-row' }, h('span', { class: 'debug-label' }, 'Try a painting'), painting,
      h('span', { class: 'debug-hint' }, 'Show an image from your disk as the sky of every place, to see a new painting before it is added. Pick a look above to see it in each place; Reset puts the real skies back. Nothing is saved.')),
    slider('Fog level', '0 = none, 0.5 = default, 1 = as each place was designed, higher = thicker. Moves how near the fog starts.', api.fog(), 4, (v) => { api.setFog(v); savePrefs(api); }),
    slider('Horizon haze', '0 = the panorama runs to the ground, 0.5 = default, 1 = as designed, higher = more mist at the horizon.', api.haze(), 3, (v) => { api.setHaze(v); savePrefs(api); }),
    h('div', { class: 'music-buttons' },
      h('button', { class: 'btn', title: 'Play one of this look\'s place sounds now', on: { click: (e) => { const b = e.currentTarget as HTMLButtonElement; b.textContent = api.playAmbience() ? 'Playing…' : 'No sound for this look'; setTimeout(() => { b.textContent = 'Play a place sound'; }, 1800); } } }, 'Play a place sound'),
      h('button', { class: 'btn', on: { click: () => { api.pin(null); api.tryPainting(null); api.setFog(DEBUG_DEFAULTS.fog); api.setHaze(DEBUG_DEFAULTS.haze); savePrefs(api); render(api); } } }, 'Reset')),
    h('div', { class: 'debug-hint' }, 'Tip: scroll down on the table to lift the camera and look at the horizon.'),
  );
}

function place(): void {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  panel.style.top = `${Math.round(r.bottom + 6)}px`;
  panel.style.left = `${Math.max(8, Math.round(r.left))}px`;
  panel.style.right = 'auto';
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

export function closeDebugMenu(): void {
  panel.classList.add('hidden');
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
