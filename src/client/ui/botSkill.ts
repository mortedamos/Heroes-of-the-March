// How well the bots play: chosen on the title screen. The levels themselves are in src/bots.

import type { BotLevel } from '../../bots/heuristic';

export const BOT_SKILLS: readonly { id: BotLevel; label: string; tip: string }[] = [
  { id: 'easy', label: 'Easy', tip: 'Cautious and a little random' },
  { id: 'normal', label: 'Normal', tip: 'A steady, sensible opponent' },
  { id: 'hard', label: 'Hard', tip: 'Reads the table closely' },
];

export const DEFAULT_SKILL: BotLevel = 'normal';

/** Anything that is not a known level (an old saved setting, a hand-edited one) is the default. */
export const parseSkill = (v: unknown): BotLevel => BOT_SKILLS.find((s) => s.id === v)?.id ?? DEFAULT_SKILL;
