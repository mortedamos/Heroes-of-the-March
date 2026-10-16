// How many heroes an opening party may hold when it is drafted from a pool.
//
// A hero that is a Companion To another hero does not use one of the party's places while that hero is in the party
// (see ridingHeroes in effects.ts), and a hero such as Ysolde adds a place. In the opening draft the party is not built
// yet, so the same rule is worked out here from the heroes' definitions alone; the screen, the bots and the engine's
// validation of the choice all use it.

import { abilityOf } from './abilities';
import { companionsOf } from './cards';

/** How many of these heroes ride free: each is a Companion To a hero that is also in the list (chains work). `cap` is rules.companionCap. */
export function ridersAmong(defs: readonly string[], cap = 9): number {
  const have = new Set(defs);
  let n = 0;
  for (const d of defs) {
    if (n >= cap) break; // a balance lever: only the first few ride for free
    if (companionsOf(d).some((c) => have.has(c))) n += 1;
  }
  return n;
}

/** The places a party drafted from these heroes has: the party size, any bonus the heroes bring, and one for every hero that rides free. */
export function draftPlaces(defs: readonly string[], partySize: number, cap = 9): number {
  let size = partySize;
  for (const d of new Set(defs)) size += abilityOf(d)?.partyBonus ?? 0;
  return size + ridersAmong(defs, cap);
}
