// A painting that is a flat, wide picture (a "strip") rather than a 2:1 panorama of the whole sky.
//
// The camera only ever shows a small window of the sky dome (measured in the game): about x 4% to 46% of the way round
// it, and rows 33% to 47% of the way down it. A 2:1 panorama spends most of its pixels on what is never seen; a strip
// puts all of them in that window. The strip is stuck onto the dome like a poster, its bottom edge on the horizon (row
// 50%), centred on the way the camera looks (x 25%), and it fades into the plain sky at its other edges.
//
// How tall it is on the dome follows from its shape, so that it is not stretched: a degree of dome is the same number of
// screen pixels across as up (about 9.9, measured in the game), so a picture of aspect A looks right when it spans 1 / A
// degrees up for each degree across.

/** A 2:1 picture is a panorama of the whole sky; any other shape is a strip (16:9 is 1.78, 21:9 is 2.33, 4:1 is 4). */
export const PANORAMA_ASPECT = 2;
const PANORAMA_TOLERANCE = 0.08;

/** How much of the way round the dome a strip spans, as fractions of a turn: it is centred on 0.25, straight ahead. */
export const STRIP_X: readonly [number, number] = [0.06, 0.44];

/** Where its bottom edge sits: the horizon, as a fraction of the way down the dome. */
export const STRIP_BOTTOM_ROW = 0.5;

/** It never spans less up the dome than this (degrees), so nearly all of the sky that can be seen is covered (a very wide picture is stretched a little to do it). */
const MIN_UP_DEG = 30;
const MAX_UP_DEG = 100;

export type StripWindow = [x0: number, x1: number, uvBottom: number, uvTop: number];

/** Is a picture of this shape a strip? */
export const isStrip = (aspect: number): boolean => Math.abs(aspect - PANORAMA_ASPECT) > PANORAMA_TOLERANCE;

/**
 * The patch of dome a strip of this aspect (width over height) covers, as [x0, x1, uvBottom, uvTop] in the dome's own
 * coordinates (uv.y runs up, so the bottom is 1 - the row it lies at).
 */
export function stripWindow(aspect: number): StripWindow {
  const across = (STRIP_X[1] - STRIP_X[0]) * 360;
  const up = Math.min(MAX_UP_DEG, Math.max(MIN_UP_DEG, across / Math.max(0.1, aspect)));
  return [STRIP_X[0], STRIP_X[1], 1 - STRIP_BOTTOM_ROW, 1 - (STRIP_BOTTOM_ROW - up / 180)];
}

/** How far up a strip its horizon sits so that the part of the dome the camera shows (rows 33% to 47%) is covered, as a fraction of its height from the bottom edge. */
export function stripVisibleBand(aspect: number): { from: number; to: number } {
  const w = stripWindow(aspect);
  const upRows = w[3] - w[2];
  return { from: (STRIP_BOTTOM_ROW - 0.47) / upRows, to: Math.min(1, (STRIP_BOTTOM_ROW - 0.33) / upRows) };
}
