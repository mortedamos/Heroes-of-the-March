// Pure layout: GameView -> where every visible card sits on the table.
// Coordinates: x right, z toward the viewer, y up. Card size is 1 x 1.4 at scale 1.

import type { DeckName, GameView, PlayerPublicView } from '../../engine';
import { DECKS } from '../../engine/types';

export interface Placement {
  key: string;
  /** Card definition, or null for an unknown (face-down) card. */
  def: string | null;
  back: DeckName;
  x: number; y: number; z: number;
  scale: number;
  faceUp: boolean;
  /** Where a newly appearing card animates from. */
  spawn: { x: number; z: number };
  /** Card owner, for highlighting. */
  owner?: string;
  /** A resource card someone bid (yours fly in from your hand). */
  bid?: boolean;
}

export interface SeatAnchor { player: string; x: number; z: number; scale: number; isYou: boolean; rowWidth: number }

/**
 * Screen shapes. 'wide': desktop and tablet landscape, dock over the bottom.
 * 'tall': portrait; opponents move into rows above the centre, dock below the table.
 * 'short': phone landscape; dock in a side column.
 */
export type Shape = 'wide' | 'tall' | 'short';

/** The table area the camera should keep in view (world units). */
export interface Frame { minX: number; maxX: number; minZ: number; maxZ: number }

export interface Layout {
  shape: Shape;
  frame: Frame;
  cards: Placement[];
  seats: SeatAnchor[];
  decks: Record<DeckName, { x: number; z: number; count: number }>;
  discards: Record<DeckName, { x: number; z: number; count: number }>;
  center: { location: { x: number; z: number }; encounter: { x: number; z: number } };
}

const CARD_Y = 0.012;
// Stacks live in the lower corners, clear of every seat's cards and bids.
const DECK_POS: Record<DeckName, { x: number; z: number }> = {
  hero: { x: -5.1, z: 0.5 },
  companion: { x: -5.1, z: 1.45 },
  location: { x: -5.1, z: 2.4 },
  encounter: { x: 5.1, z: 0.5 },
  resource: { x: 5.1, z: 1.45 },
};
const DISCARD_OFFSET = { x: 0.78, z: 0 };
export const deckPos = (d: DeckName) => DECK_POS[d];
export const discardPos = (d: DeckName) => {
  const p = DECK_POS[d];
  const side = p.x < 0 ? 1 : -1;
  return { x: p.x + DISCARD_OFFSET.x * side, z: p.z };
};

const LOCATION_POS = { x: -1.6, z: -1.05 };
const ENCOUNTER_POS = { x: -0.15, z: -1.05 };

/** Where opponent j of k sits, in turn order after you. */
function opponentAnchor(shape: Shape, j: number, k: number): { x: number; z: number; scale: number } {
  if (shape === 'tall') {
    // Portrait: one row across the top, or a U (near-left, far row, near-right) for 4+.
    if (k <= 3) {
      const xs = k === 1 ? [0] : k === 2 ? [-2.9, 2.9] : [-3.9, 0, 3.9];
      return { x: xs[j]!, z: -5.0, scale: 0.72 };
    }
    const far = k === 4 ? [-2.2, 2.2] : [-3.9, 0, 3.9];
    if (j === 0) return { x: -3.9, z: -4.6, scale: 0.62 };
    if (j === k - 1) return { x: 3.9, z: -4.6, scale: 0.62 };
    return { x: far[j - 1]!, z: -8.2, scale: 0.62 };
  }
  // Spread opponents evenly over an arc from the left side, across the top, to the right side.
  const t = (j + 0.5) / k;
  const angle = THREE_DEG(172 + t * 196);
  const rx = k >= 4 ? 6.9 : 6.2;
  const rz = 4.1;
  return { x: Math.cos(angle) * rx, z: Math.sin(angle) * rz - 0.2, scale: k >= 4 ? 0.58 : 0.68 };
}

/** Seat anchors: you at the bottom, opponents around the far side. */
function seatAnchors(view: GameView, shape: Shape): SeatAnchor[] {
  const n = view.players.length;
  const youIdx = Math.max(0, view.players.findIndex((p) => p.id === view.you));
  const ordered = Array.from({ length: n }, (_, i) => view.players[(youIdx + i) % n]!);
  const out: SeatAnchor[] = [];
  const rows = (p: PlayerPublicView) => 1 + Math.max(p.maxCompanions, p.companions.length + p.inactiveCompanions.length);
  ordered.forEach((p, i) => {
    if (i === 0 && view.you) {
      // On compact screens nothing covers the bottom edge, so sit lower and clear of the stacks.
      out.push({ player: p.id, x: 0, z: shape === 'wide' ? 2.55 : 3.2, scale: 0.92, isYou: true, rowWidth: rows(p) * 1.05 * 0.92 });
      return;
    }
    const k = view.you ? n - 1 : n;
    const j = view.you ? i - 1 : i;
    const a = opponentAnchor(shape, j, k);
    out.push({ player: p.id, ...a, isYou: false, rowWidth: rows(p) * 1.05 * a.scale });
  });
  return out;
}

/**
 * The area to keep in view: the centre, the stacks, and every seat with room
 * for a full row, its bids, its claimed locations and its name plate.
 * Uses the most cards a row can hold, so the camera doesn't drift as rows grow.
 */
function frameFor(seats: SeatAnchor[]): Frame {
  const f: Frame = { minX: -5.6, maxX: 5.6, minZ: -2.3, maxZ: 2.9 };
  const grow = (x0: number, x1: number, z0: number, z1: number) => {
    f.minX = Math.min(f.minX, x0); f.maxX = Math.max(f.maxX, x1);
    f.minZ = Math.min(f.minZ, z0); f.maxZ = Math.max(f.maxZ, z1);
  };
  for (const s of seats) {
    const half = (4 * 1.05 * s.scale) / 2;
    if (s.isYou) grow(s.x - half - 0.9, s.x + half, s.z - 1.9, s.z + 0.75);
    // Opponents: plate above the cards, bids in front, claimed pile on the right.
    else grow(s.x - half, s.x + half + 0.9 * s.scale, s.z - 1.4 * s.scale - 1.3, s.z + 2.2 * s.scale + 0.2);
  }
  return f;
}

/** How much larger a hero is drawn than a companion on the table. */
const HERO_SCALE = 1.18;

function THREE_DEG(d: number): number {
  return (d * Math.PI) / 180;
}

export function computeLayout(view: GameView, shape: Shape = 'wide'): Layout {
  const cards: Placement[] = [];
  const seats = seatAnchors(view, shape);
  const byId = new Map(view.players.map((p) => [p.id, p]));

  for (const seat of seats) {
    const p = byId.get(seat.player)!;
    const s = seat.scale;
    const gap = 1.05 * s;
    const row = [
      // No hero yet during the opening draft.
      ...(p.hero ? [{ card: p.hero, faceUp: true, back: 'hero' as DeckName }] : []),
      ...p.companions.map((c) => ({ card: c, faceUp: true, back: 'companion' as DeckName })),
      ...p.inactiveCompanions.map((c) => ({ card: c, faceUp: false, back: 'companion' as DeckName })),
      ...p.resting.map((c) => ({ card: c, faceUp: false, back: 'companion' as DeckName })),
    ];
    // Heroes are drawn a little larger than companions.
    const size = (r: { back: DeckName }) => (r.back === 'hero' ? HERO_SCALE : 1);
    const total = row.reduce((t, r) => t + gap * size(r), 0);
    let cursor = seat.x - total / 2;
    row.forEach((r) => {
      const w = gap * size(r);
      const spawn = r.back === 'hero' ? deckPos('hero') : deckPos('companion');
      cards.push({ key: r.card.id, def: r.card.def, back: r.back, x: cursor + w / 2, y: CARD_Y, z: seat.z, scale: s * size(r), faceUp: r.faceUp, spawn, owner: p.id });
      cursor += w;
    });

    // Bids and council heroes sit in front of each player's cards: toward the
    // centre for you, toward the viewer for opponents (so they never hide).
    const bx = seat.x;
    const bz = seat.isYou ? seat.z - 1.3 : seat.z + 1.4 * s + 0.2;
    const bs = seat.isYou ? 0.72 : s * 0.85;
    const bgap = 0.62 * bs / 0.72 + 0.02;
    const bidItems = [
      ...p.bids.map((b, i) => (b.hidden
        ? { key: `hid:${p.id}:${i}`, def: null, back: 'resource' as DeckName, faceUp: false }
        : { key: b.card.id, def: b.card.def, back: 'resource' as DeckName, faceUp: true })),
      ...p.councilHeroes.map((h) => ({ key: h.id, def: h.def, back: 'hero' as DeckName, faceUp: true })),
    ];
    const bx0 = bx - ((bidItems.length - 1) * bgap) / 2;
    bidItems.forEach((b, i) => {
      const spawn = b.back === 'hero' ? deckPos('hero') : { x: seat.x, z: seat.z + (seat.isYou ? 2 : 0) };
      cards.push({ key: b.key, def: b.def, back: b.back, x: bx0 + i * bgap, y: CARD_Y + i * 0.002, z: bz, scale: bs, faceUp: b.faceUp, spawn, owner: p.id, bid: b.back === 'resource' });
    });

    // Claimed locations: a small fanned pile beside the player's row.
    // (Yours go on the left; your name plate sits on the right.)
    const cs = seat.isYou ? 0.5 : s * 0.62;
    const cx = seat.isYou ? seat.x - seat.rowWidth / 2 - 0.6 : seat.x + seat.rowWidth / 2 + 0.4 * s / 0.62;
    const dir = seat.isYou ? -1 : 1;
    p.claimed.forEach((c, i) => {
      cards.push({ key: c.id, def: c.def, back: 'location', x: cx + dir * i * 0.09, y: CARD_Y + i * 0.004, z: seat.z - 0.12 + i * 0.06, scale: cs, faceUp: true, spawn: LOCATION_POS, owner: p.id });
    });
  }

  // Centre: location, hidden bonus locations, encounter and minions.
  const t = view.turn;
  for (let i = 0; i < t.extraLocations; i++) {
    cards.push({ key: `extra:${i}`, def: null, back: 'location', x: LOCATION_POS.x - 0.18 - i * 0.12, y: CARD_Y, z: LOCATION_POS.z - 0.2 - i * 0.1, scale: 1.1, faceUp: false, spawn: deckPos('location') });
  }
  if (t.location) cards.push({ key: t.location.id, def: t.location.def, back: 'location', ...LOCATION_POS, y: CARD_Y + 0.01, scale: 1.2, faceUp: true, spawn: deckPos('location') });
  if (t.encounter) cards.push({ key: t.encounter.id, def: t.encounter.def, back: 'encounter', ...ENCOUNTER_POS, y: CARD_Y + 0.01, scale: 1.2, faceUp: true, spawn: deckPos('encounter') });
  // Minions, companions taken as minions (Iron Mites), and cards set aside (Vaelis).
  const extras = [
    ...t.minions.map((m) => ({ ref: m, back: 'encounter' as DeckName, spawn: deckPos('encounter') })),
    ...t.companionMinions.map((m) => ({ ref: m, back: 'companion' as DeckName, spawn: deckPos('companion') })),
    ...t.setAside.map((m) => ({ ref: m, back: 'encounter' as DeckName, spawn: deckPos('encounter') })),
  ];
  extras.forEach((m, i) => {
    cards.push({ key: m.ref.id, def: m.ref.def, back: m.back, x: ENCOUNTER_POS.x + 1.35 + i * 0.95, y: CARD_Y, z: ENCOUNTER_POS.z + 0.1, scale: 0.85, faceUp: true, spawn: m.spawn });
  });

  // Discard tops.
  const decks = {} as Layout['decks'];
  const discards = {} as Layout['discards'];
  for (const d of DECKS) {
    decks[d] = { ...deckPos(d), count: view.decks[d] };
    const dp = discardPos(d);
    const dd = view.discards[d];
    discards[d] = { ...dp, count: dd.count };
    if (dd.top) {
      const h = Math.min(0.6, dd.count * 0.006);
      cards.push({ key: dd.top.id, def: dd.top.def, back: d, x: dp.x, y: h + CARD_Y, z: dp.z, scale: 0.55, faceUp: true, spawn: deckPos(d) });
    }
  }

  return { shape, frame: frameFor(seats), cards, seats, decks, discards, center: { location: LOCATION_POS, encounter: ENCOUNTER_POS } };
}
