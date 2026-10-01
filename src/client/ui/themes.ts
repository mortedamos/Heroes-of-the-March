// How an ability looks: the light behind its card when it is shown, and the bolt it sends.
// Each ability belongs to one theme; the theme picks colours, the shape of the bolt and a sound.
// (Shapes differ as well as colours, so no theme depends on telling red from green.)

export type Theme = 'hex' | 'boon' | 'insight' | 'draw' | 'shield' | 'trade';

export interface Palette {
  /** Outer colour of the bolt and its impact ring. */
  glow: string;
  /** Bright core of the bolt. */
  core: string;
  /** The second line of the bolt and the sparkles. */
  accent: string;
  /** How jagged the bolt is (1 = the usual crackle, near 0 = a straight line). */
  wobble: number;
  /** How big the ring where it lands is. */
  ring: number;
}

export const PALETTE: Record<Theme, Palette> = {
  // Greens and purples, an old spell: sabotage, forcing, silencing, taking control.
  hex: { glow: '#a455ff', core: '#d9ffc9', accent: '#46e08c', wobble: 1.5, ring: 1 },
  // Warm gold: a bonus for the one who used it.
  boon: { glow: '#ffc94a', core: '#fff7d6', accent: '#ffe58a', wobble: 0.5, ring: 1 },
  // Cool blue-white, thin and straight: looking at a stack.
  insight: { glow: '#6cb8ff', core: '#ffffff', accent: '#bfe3ff', wobble: 0.04, ring: 0.7 },
  // Teal ribbon: cards coming to the one who used it.
  draw: { glow: '#2fd6c4', core: '#dcfff9', accent: '#7af0e0', wobble: 0.35, ring: 0.8 },
  // Steel: a counter or a shrug-off; a big ring stops the incoming bolt.
  shield: { glow: '#9fb6da', core: '#ffffff', accent: '#d6e2f5', wobble: 0.1, ring: 1.9 },
  // Amber, and the bolt goes both ways: something changes hands.
  trade: { glow: '#ffa21f', core: '#fff0cf', accent: '#ffcb6b', wobble: 0.45, ring: 1 },
};

/** The sound for each theme (a theme without a sound file falls back to the boon sound). */
export const THEME_SOUND: Record<Theme, string> = {
  hex: 'effect-negative', boon: 'effect-positive', insight: 'effect-insight', draw: 'effect-draw', shield: 'effect-shield', trade: 'effect-trade',
};

const BY_ABILITY: Record<string, Theme> = {
  // hex: forcing a stat, silencing, negating, replacing the encounter, winning outright
  force: 'hex', torch: 'hex', ruling: 'hex', negate: 'hex', notThisFight: 'hex', stonetouched: 'hex',
  // boon
  honk: 'boon', queen: 'boon', shadowsteeds: 'boon', multiBid: 'boon',
  // insight
  readAhead: 'insight', mineNow: 'insight', maps: 'insight',
  // draw
  rest: 'draw', return: 'draw',
  // trade
  requisition: 'trade', pockets: 'trade',
  // shield
  shield: 'shield',
};

export function themeForAbility(ability: string): Theme {
  return BY_ABILITY[ability] ?? 'boon';
}

/** Elder Futhark runes for the spell circle behind a hex. */
export const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
