// New-game form (vs bots). Values are validated again by the engine.

import type { BotLevel } from '../../bots/heuristic';
import { MAX_PLAYERS, MIN_PLAYERS, type HouseRules } from '../../engine';
import { isTouch } from '../viewport';
import titleArt from '@art/ui__title_ridge.webp?url';
import titleArtTall from '@art/ui__title_ridge_tall.webp?url';
import { BUILD } from '../../build-info';
import { h } from './dom';
import { DEFAULT_LENGTH, GAME_LENGTHS, lengthRules, lengthTip, parseLength, renownFor, type GameLength } from './gameLength';
import { BOT_SKILLS, DEFAULT_SKILL, parseSkill } from './botSkill';
import { segmentedField } from './segmented';
import { startTitleEffects } from './titleFx';
import { TITLE_FRAME_URL } from './titleFrame';

export interface SetupChoice {
  name: string;
  bots: number;
  level: BotLevel;
  /** Short, normal or long: the Renown needed to win (10, 20, 30). */
  length: GameLength;
}

/** The house rules a setup choice turns into (the engine validates them again). */
export function rulesFor(c: SetupChoice): Partial<HouseRules> {
  return {
    handModel: 'steady', // every player draws 2 at the start of a turn, hand limit 6: no longer a choice
    ...lengthRules(c.length),
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
    out.level = parseSkill(v['level']);
    out.length = parseLength(v['length']);
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

    // Bot skill and game length: three buttons each, with a tooltip on every button and the chosen one's tip written under the row.
    const skill = segmentedField('Bot skill', BOT_SKILLS, prefs.level ?? DEFAULT_SKILL);
    const lede = h('p', { class: 'lede' });
    const length = segmentedField('Game length', GAME_LENGTHS.map((l) => ({ id: l.id, label: l.label, tip: lengthTip(l.id) })), prefs.length ?? DEFAULT_LENGTH, (id) => {
      lede.textContent = `The Marchstone has split. Hold the most of the Marches: first to ${renownFor(id)} Renown wins.`;
    });

    const start = h('button', { class: 'btn primary big', type: 'submit' }, 'Ride out');
    const form = h('form', { class: 'setup-card' },
      h('h1', {}, 'Heroes of the March'),
      lede,
      h('label', {}, h('span', {}, 'Your name'), name),
      h('label', {}, h('span', {}, 'Opponents'), bots),
      skill.el,
      length.el,
      start,
      h('p', { class: 'fine' }, 'Local game against bots. Online multiplayer is coming.'),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const choice: SetupChoice = {
        name: name.value,
        bots: Math.min(MAX_PLAYERS - 1, Math.max(MIN_PLAYERS - 1, Number.parseInt(bots.value, 10) || 2)),
        level: skill.get(),
        length: length.get(),
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
