// How long a game is: the Renown a player needs to win. Chosen on the title screen and passed to the engine as a house rule
// (renownToWin), which the engine validates again.

export type GameLength = 'short' | 'normal' | 'long';

export const GAME_LENGTHS: readonly { id: GameLength; label: string; renown: number }[] = [
  { id: 'short', label: 'Short', renown: 10 },
  { id: 'normal', label: 'Normal', renown: 20 },
  { id: 'long', label: 'Long', renown: 30 },
];

export const DEFAULT_LENGTH: GameLength = 'normal';

/** Renown needed to win a game of this length. */
export const renownFor = (length: GameLength): number => GAME_LENGTHS.find((l) => l.id === length)!.renown;

/** The tooltip for a length: "10 Renown to Win". */
export const lengthTip = (length: GameLength): string => `${renownFor(length)} Renown to Win`;

/** The house rules a length turns into (the engine validates them again). */
export const lengthRules = (length: GameLength): { renownToWin: number } => ({ renownToWin: renownFor(length) });

/** Anything that is not a known length (an old saved setting, a hand-edited one) is the default. */
export const parseLength = (v: unknown): GameLength => GAME_LENGTHS.find((l) => l.id === v)?.id ?? DEFAULT_LENGTH;
