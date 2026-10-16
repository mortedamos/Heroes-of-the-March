// How many places the "Build your party" screen shows when a hero drawn on a later turn is being placed.

/**
 * The party size, or more when companions already ride free beside their heroes. The engine lets a hero that rides free
 * (a Companion To a hero already in the party) join even when the party is full (`mustReplace` is false then), so the
 * screen needs a place of its own for them: without it the only choices would be to replace someone or let them go.
 *
 * @param partySize places in the party
 * @param held heroes already held (face up, face down and resting)
 * @param mustReplace the engine's answer: false when the drawn hero fits without replacing anyone
 */
export function placeSlotCount(partySize: number, held: number, mustReplace: boolean): number {
  const extra = !mustReplace && held >= partySize ? 1 : 0;
  return Math.max(partySize, held + extra);
}

/** The label above the places: held heroes over places, or a plainer note when free companions take the count past the size. */
export function partyLabel(held: number, partySize: number): string {
  return held > partySize ? `Your party (${held} heroes; ${partySize} places, free companions do not use one)` : `Your party (${held}/${partySize})`;
}
