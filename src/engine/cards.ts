// Card database access. The JSON is generated at build time by
// scripts/build-cards.ts; this module indexes it and sanity-checks its shape.

import raw from '../data/cards.json';
import type {
  CardDatabase, CardDef, CompanionDef, EncounterDef, HeroDef, LocationDef, ResourceDef,
} from './cardTypes';

const db = raw as unknown as CardDatabase;

const byId = new Map<string, CardDef>();
for (const list of [db.heroes, db.companions, db.locations, db.encounters, db.resources]) {
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
export const companionDef = asKind<CompanionDef>('companion');
export const locationDef = asKind<LocationDef>('location');
export const encounterDef = asKind<EncounterDef>('encounter');
export const resourceDef = asKind<ResourceDef>('resource');

export function allDefs(): CardDef[] {
  return [...byId.values()];
}
