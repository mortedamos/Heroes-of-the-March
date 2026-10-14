// Card definitions: static, public data generated from the design spreadsheet
// by scripts/build-cards.ts. Nothing in here is secret.

export type Stat = 'P' | 'M' | 'G';
export const STATS: readonly Stat[] = ['P', 'M', 'G'];
export const STAT_NAMES: Record<Stat, string> = { P: 'Physical', M: 'Mental', G: 'Guile' };

export type StatBlock = Record<Stat, number>;

export type CardKind = 'hero' | 'location' | 'encounter' | 'resource';

interface BaseDef {
  /** Stable, human-readable id (slug of the card name). Public information. */
  id: string;
  kind: CardKind;
  name: string;
  groups: string[];
  quote: string | null;
  /** Art file stem in _build/art (without extension), or null for a generated placeholder. */
  art: string | null;
  /** The card's permanent number (data/card-numbers.json): it stays with the card when its name is edited. */
  number?: number;
  /** Set when data/balance.json changes this card from the printed v0.3 version: the reason. */
  revision?: string;
}

/**
 * A member of an adventuring party. Three named abilities are data, not text:
 *  - allied: +1 to all stats for every other matching card on your board (your heroes, your resources);
 *  - nemesis: +1 to all stats for every matching location, encounter or minion;
 *  - companionTo: does not count against the party size while any of the named heroes is in your party.
 * Each entry names a tag ("Goose") or a single card ("Varg Ironjaw"); cards.ts resolves them.
 */
export interface HeroDef extends BaseDef {
  kind: 'hero';
  stats: StatBlock;
  abilityName: string;
  abilityText: string;
  allied?: string[];
  nemesis?: string[];
  companionTo?: string[];
}

export interface LocationDef extends BaseDef {
  kind: 'location';
  renown: number;
  conditionText: string | null;
}

/** The challenge an encounter poses: one stat, one printed difficulty. */
export interface Challenge {
  stat: Stat;
  difficulty: number;
}

export interface EncounterDef extends BaseDef {
  kind: 'encounter';
  minionValue: number;
  /** Minions drawn when this card enters play as the main encounter. */
  minions: { count: number; group: string | null };
  conditionText: string | null;
  /** The one stat this encounter is faced on (its highest printed difficulty). */
  stat: Stat;
  difficulty: number;
}

export interface ResourceDef extends BaseDef {
  kind: 'resource';
  value: number;
  wand: boolean;
  council: boolean;
  conditionText: string | null;
}

export type CardDef = HeroDef | LocationDef | EncounterDef | ResourceDef;

export interface CardDatabase {
  version: string;
  heroes: HeroDef[];
  locations: LocationDef[];
  encounters: EncounterDef[];
  resources: ResourceDef[];
}

export const KINGDOMS = ['Human', 'Elf', 'Dwarf', 'Orc', 'Halfellow'] as const;
export type Kingdom = typeof KINGDOMS[number];
