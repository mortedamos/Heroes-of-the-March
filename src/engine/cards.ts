// Card database access. The JSON (src/data/cards.json) is the source of truth; this
// module indexes it, resolves the named-ability targets and sanity-checks its shape.

import raw from '../data/cards.json';
import type {
  CardDatabase, CardDef, EncounterDef, HeroDef, LocationDef, ResourceDef,
} from './cardTypes';

const db = raw as unknown as CardDatabase;

const byId = new Map<string, CardDef>();
for (const list of [db.heroes, db.locations, db.encounters, db.resources]) {
  for (const c of list as CardDef[]) {
    if (byId.has(c.id)) throw new Error(`duplicate card id ${c.id}`);
    byId.set(c.id, c);
  }
}

export const CARDS = db;

export function getDef(defId: string): CardDef {
  const d = byId.get(defId);
  if (!d) throw new Error(`unknown card ${defId}`);
  return d;
}

export function hasDef(defId: string): boolean {
  return byId.has(defId);
}

function asKind<T extends CardDef>(kind: T['kind']) {
  return (defId: string): T => {
    const d = getDef(defId);
    if (d.kind !== kind) throw new Error(`${defId} is a ${d.kind}, not a ${kind}`);
    return d as T;
  };
}

export const heroDef = asKind<HeroDef>('hero');
export const locationDef = asKind<LocationDef>('location');
export const encounterDef = asKind<EncounterDef>('encounter');
export const resourceDef = asKind<ResourceDef>('resource');

export function allDefs(): CardDef[] {
  return [...byId.values()];
}

// --- named-ability targets (Allied, Nemesis, Companion To) --------------------------------

/** What an Allied / Nemesis entry points at: every card with a tag, or one particular card. */
export type Target = { tag: string } | { def: string };

/** Does this card match the target? ("All" cards, like The Old Quarry, match every tag.) */
export function matchesTarget(def: CardDef, t: Target): boolean {
  return 'tag' in t ? def.groups.includes(t.tag) || def.groups.includes('All') : def.id === t.def;
}

const TAGS = new Set<string>();
for (const d of byId.values()) for (const g of d.groups) if (g !== 'All') TAGS.add(g);

const shortName = (d: CardDef) => d.name.split(',')[0]!.trim().toLowerCase();

/**
 * Resolve one sheet entry. It is a tag ("Goose") or one card: its name before the comma ("Varg Ironjaw"),
 * or the name without its title ("Hobart Thimblewick" for "Farmer Hobart Thimblewick"). A word that is a
 * tag is the tag ("Skarra" is also the start of several card names), unless exactly one card has that name.
 * Anything that matches nothing, or several cards, is a data error and stops the game from loading.
 */
export function resolveTarget(entry: string, owner: string): Target {
  const want = entry.trim().toLowerCase();
  const exact = [...byId.values()].filter((d) => shortName(d) === want);
  const tag = [...TAGS].find((t) => t.toLowerCase() === want);
  if (tag && exact.length === 1) throw new Error(`${owner}: "${entry}" is both a tag and a card name`);
  if (tag) return { tag };
  const loose = exact.length ? exact : [...byId.values()].filter((d) => shortName(d).endsWith(` ${want}`));
  if (loose.length === 1) return { def: loose[0]!.id };
  throw new Error(`${owner}: "${entry}" ${loose.length ? 'matches several cards' : 'is not a tag or a card'}`);
}

const alliedBy = new Map<string, Target[]>();
const nemesisBy = new Map<string, Target[]>();
const companionBy = new Map<string, string[]>();
for (const h of db.heroes) {
  if (h.allied?.length) alliedBy.set(h.id, h.allied.map((e) => resolveTarget(e, `${h.name} (Allied)`)));
  if (h.nemesis?.length) nemesisBy.set(h.id, h.nemesis.map((e) => resolveTarget(e, `${h.name} (Nemesis)`)));
  if (h.companionTo?.length) {
    companionBy.set(h.id, h.companionTo.map((e) => {
      const t = resolveTarget(e, `${h.name} (Companion To)`);
      if (!('def' in t) || byId.get(t.def)?.kind !== 'hero') throw new Error(`${h.name} (Companion To): "${e}" is not a hero`);
      if (t.def === h.id) throw new Error(`${h.name} is a companion to itself`);
      return t.def;
    }));
  }
}
// Two heroes that are each other's companions would both ride for free.
for (const [id, partners] of companionBy) {
  for (const p of partners) if (companionBy.get(p)?.includes(id)) throw new Error(`${id} and ${p} are companions to each other`);
}

/** Balance experiments only: switch the named abilities off for the rest of the run ('allied', 'nemesis', 'companion'). */
export function stripNamedAbilities(which: readonly string[]): void {
  if (which.includes('allied')) alliedBy.clear();
  if (which.includes('nemesis')) nemesisBy.clear();
  if (which.includes('companion')) companionBy.clear();
}

/** Balance experiments only: take one hero's Allied, Nemesis and Companion To away (a "stats only" hero); returns the undo. */
export function stripNamedAbilitiesOf(defId: string): () => void {
  const a = alliedBy.get(defId), n = nemesisBy.get(defId), c = companionBy.get(defId);
  alliedBy.delete(defId); nemesisBy.delete(defId); companionBy.delete(defId);
  return () => {
    if (a) alliedBy.set(defId, a);
    if (n) nemesisBy.set(defId, n);
    if (c) companionBy.set(defId, c);
  };
}

export const alliedTargets = (defId: string): readonly Target[] => alliedBy.get(defId) ?? [];
export const nemesisTargets = (defId: string): readonly Target[] => nemesisBy.get(defId) ?? [];
/** The heroes this hero is a companion to (any one of them in the party makes it ride for free). */
export const companionsOf = (defId: string): readonly string[] => companionBy.get(defId) ?? [];
