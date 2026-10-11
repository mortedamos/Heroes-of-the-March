// New-game form (vs bots). Values are validated again by the engine.

import type { BotLevel } from '../../bots/heuristic';
import { MAX_PLAYERS, MIN_PLAYERS, type HouseRules } from '../../engine';
import { isTouch } from '../viewport';
import titleArt from '@art/ui__title_ridge.webp?url';
import titleArtTall from '@art/ui__title_ridge_tall.webp?url';
import { BUILD } from '../../build-info';
import { h } from './dom';
import { startTitleEffects } from './titleFx';
import { TITLE_FRAME_URL } from './titleFrame';

export interface SetupChoice {
  name: string;
  bots: number;
  level: BotLevel;
}

/** The house rules a setup choice turns into (the engine validates them again). */
export function rulesFor(c: SetupChoice): Partial<HouseRules> {
  void c;
  return {
    handModel: 'steady', // every player draws 2 at the start of a turn, hand limit 6: no longer a choice
  };
}

/** "2026-09-30 10:40 · build 345" (nothing before the first stamped commit). */
export function buildStampText(): string {
  const when = [BUILD.date, BUILD.time].filter(Boolean).join(' ');
  if (!BUILD.number) return '';
  return `${when}${when ? ' · ' : ''}build ${BUILD.number}`;
}

const STORE_KEY = 'hotm.setup.v2';

function loadPrefs(): Partial<SetupChoice> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<SetupChoice> = {};
    if (typeof v['name'] === 'string') out.name = v['name'].slice(0, 24);
    if (Number.isInteger(v['bots'])) out.bots = Math.min(MAX_PLAYERS - 1, Math.max(MIN_PLAYERS - 1, v['bots'] as number));
    if (v['level'] === 'easy' || v['level'] === 'normal' || v['level'] === 'hard') out.level = v['level'];
    return out;
  } catch {
    return {};
  }
}

function savePrefs(c: SetupChoice): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(c)); } catch { /* storage unavailable: fine */ }
}

export function showSetup(root: HTMLElement): Promise<SetupChoice> {
  const prefs = loadPrefs();
  return new Promise((resolve) => {
    const name = h('input', { id: 'setup-name', type: 'text' });
    name.maxLength = 24;
    name.setAttribute('autocomplete', 'nickname');
    name.value = prefs.name ?? 'Warden';

    const bots = h('select', { id: 'setup-bots' });
    for (let n = MIN_PLAYERS - 1; n <= MAX_PLAYERS - 1; n++) {
      const o = h('option', {}, `${n} opponent${n === 1 ? '' : 's'} (${n + 1} players)`);
      o.value = String(n);
      bots.appendChild(o);
    }
    bots.value = String(prefs.bots ?? 2);

    const level = h('select', { id: 'setup-level' });
    for (const [v, label] of [['easy', 'Easy: cautious and a little random'], ['normal', 'Normal'], ['hard', 'Hard: reads the table']] as const) {
      const o = h('option', {}, label);
      o.value = v;
      level.appendChild(o);
    }
    level.value = prefs.level ?? 'normal';

    const start = h('button', { class: 'btn primary big', type: 'submit' }, 'Ride out');
    const form = h('form', { class: 'setup-card' },
      h('h1', {}, 'Heroes of the March'),
      h('p', { class: 'lede' }, 'The Marchstone has split. Hold the most of the Marches: first to 20 Renown wins.'),
      h('label', {}, h('span', {}, 'Your name'), name),
      h('label', {}, h('span', {}, 'Opponents'), bots),
      h('label', {}, h('span', {}, 'Bot skill'), level),
      start,
      h('p', { class: 'fine' }, 'Local game against bots. Online multiplayer is coming.'),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const choice: SetupChoice = {
        name: name.value,
        bots: Math.min(MAX_PLAYERS - 1, Math.max(MIN_PLAYERS - 1, Number.parseInt(bots.value, 10) || 2)),
        level: (['easy', 'normal', 'hard'] as const).find((x) => x === level.value) ?? 'normal',
      };
      savePrefs(choice);
      stopFx();
      wrap.remove();
      resolve(choice);
    });
    const wrap = h('div', { class: 'setup' }, form, h('div', { class: 'build-stamp' }, buildStampText()));
    // The title picture (heroes on the ridge, the split Marchstone); the form sits over its quiet middle.
    wrap.style.setProperty('--title-frame', TITLE_FRAME_URL); // the illuminated-manuscript border
    wrap.style.setProperty('--title-art', `url(${titleArt})`);
    wrap.style.setProperty('--title-art-tall', `url(${titleArtTall})`); // for upright and near-square screens, where the wide picture would crop the heroes
    // Fog drifting through the valley and embers rising from the stone; they stop when the screen closes.
    const stopFx = startTitleEffects(wrap);
    root.appendChild(wrap);
    // On phones, focusing would pop the keyboard up over the form.
    if (!isTouch()) {
      name.focus();
      name.select();
    }
  });
}
