// The look of every location: surface, light, weather and table. A theme is data; Environment turns it into a
// 3D scene and blends between themes.
//
// Every location has a look of its own (see docs/LOCATION-LOOKS.md), built from one of ten base environments, its
// "family": `derive('forest', { ... })` is the forest with these changes. A look that has no painting of its own
// shows its family's (see Environment.artOf), so a place can be given its own sky later without touching the code.

import type { SkylineKind, SurfaceSpec } from './surfaces';
import type { GroundKind } from './ground';

/** The base environments, and the plain felt that shows before any location has been revealed. */
export type FamilyId = 'felt' | 'tavern' | 'harbor' | 'snow' | 'crypt' | 'forge' | 'forest' | 'fortress' | 'archive' | 'plains' | 'sky';

/** Every location that has a look of its own: the ids of the location cards. */
export const LOCATION_IDS = [
  'the-goose-and-kettle',
  'parting-strand',
  'the-barrowlands', 'tomb-of-the-first-wardens', 'barrowdeep', 'the-umbral-deep',
  'the-deep-forge-of-karrak', 'the-old-quarry', 'the-crack-in-the-marchstone', 'gorewatch',
  'the-storybook-glade', 'the-silverwood-hunt', 'sylvaneth', 'the-hollow-hills', 'the-hollow-between', 'the-mirror-marches', 'silverlake-at-midsummer',
  'marchguard-keep', 'the-wardens-hall', 'the-field-of-oaths', 'grimgate', 'kingsford', 'the-speaking-stones',
  'the-hearthlands-archive', 'the-mage-college-vaults', 'the-sealed-archive', 'the-collegium-observatory', 'the-endless-stair',
  'the-endless-road', 'clover-hollow', 'hearthmeadow',
  'the-skyship-valour',
] as const;
export type LocationId = (typeof LOCATION_IDS)[number];

/** A look the table can have: the plain felt, or a location. */
export type ThemeId = 'felt' | LocationId;

/**
 * What drifts through a place. Points (embers to butterflies) fall, rise or wander; `ripples` are rings spreading on
 * the ground, `shootingstar` a streak across the sky now and then, `page` one loose sheet that stirs on the floor.
 */
export type FxKind =
  | 'embers' | 'sparks' | 'snow' | 'fireflies' | 'motes' | 'wisps' | 'leaves'
  | 'petals' | 'ash' | 'lanterns' | 'butterflies' | 'ripples' | 'shootingstar' | 'page';

/** The weather that can fall or blow indoors: nothing wet, nothing from a tree. (Ripples are a pool, the star is seen through an open dome.) */
export const INDOOR_FX: readonly FxKind[] = ['embers', 'sparks', 'motes', 'wisps', 'ash', 'ripples', 'shootingstar', 'page'];

/**
 * What the playing surface is the top of. `plain` is the felt slab (rim and plinth, see Environment); every
 * other kind is built as 3D by tables.ts.
 */
export type TableKind =
  | 'plain' | 'tavern' | 'hall' | 'study' | 'altar' | 'vault' | 'anvil' | 'ship' | 'skyship'
  | 'dolmen' | 'ironslab' | 'trestle' | 'block' | 'landing';

export interface TableSpec {
  kind: TableKind;
  /** How far the playing surface stands above the ground (the ground drops by this much under the table). */
  height: number;
  /** Altars: what settles on the stone's edges. Without it the altar is bare stone. */
  cover?: 'moss' | 'snow' | 'flowers';
  /** The colours the table's body (its sides, legs, chairs, masonry) is made from, where they should differ from the playing surface. */
  body?: Partial<SurfaceSpec>;
  /** Vaults: the colour of the runes that glow along the cornice. */
  glow?: string;
}

export interface Accent { color: string; i: number; pos: [number, number, number]; flicker: number }

export interface Look {
  /** Horizon colour: background, fog and the bottom of the sky. */
  sky: string;
  skyTop: string;
  /** Fog starts and ends this far beyond the camera's distance to the table. */
  fogNear: number;
  fogFar: number;
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  key: string;
  keyI: number;
  warm: string;
  warmI: number;
  warmPos: [number, number, number];
  exposure: number;
  rim: string;
  rimRough: number;
  rimMetal: number;
  accents: [Accent, Accent];
}

export interface FxSpec {
  kind: FxKind;
  n: number;
  color: string;
  size: number;
  additive: boolean;
  /** Each particle is a colour picked between these two (leaves, petals, ash, butterflies); without it they all take `color`. */
  tint?: [string, string];
}

export interface Theme {
  /** The base environment this look was built from: it lends its panorama, place sounds and music mood. */
  family: FamilyId;
  /** Is the table inside a structure (a room, a tomb, a cave) rather than outside, surrounded by structures? */
  indoors: boolean;
  look: Look;
  top: SurfaceSpec;
  floor: SurfaceSpec;
  fx: FxSpec[];
  /** Slanted shafts of light: colour and strength (0 = none). */
  beams: { color: string; n: number; strength: number };
  /** Drifting mist: colour, count, strength. */
  mist: { color: string; n: number; strength: number } | null;
  table: TableSpec;
  /** The ground is not a flat plane: rolling waves, rolling clouds, or jagged rock. */
  floorShape?: GroundKind;
  /** The sea and sky rock gently round the table, as if it were bobbing on the water: the peak tilt, in degrees. */
  sway?: number;
  /** The panorama slides round the sky in a loop, this many turns per second. Only for a panorama that wraps round. */
  skyScroll?: number;
  /** A painted silhouette ring for a place that has no panorama. Unused: every look is a painted sky or a plain gradient. */
  skyline: { kind: SkylineKind; far: string; near: string } | null;
}

const none: Accent = { color: '#000000', i: 0, pos: [0, 3, -5], flicker: 0 };
const light = (color: string, i: number, pos: [number, number, number], flicker = 0.2): Accent => ({ color, i, pos, flicker });
const fx = (kind: FxKind, n: number, color: string, size: number, additive = true, tint?: [string, string]): FxSpec => ({ kind, n, color, size, additive, ...(tint ? { tint } : {}) });
const noBeams = { color: '#000000', n: 0, strength: 0 };

type Base = Omit<Theme, 'family'>;

/** The ten base environments (and the felt). */
export const FAMILIES: Record<FamilyId, Base> = {
  felt: {
    indoors: false,
    look: {
      sky: '#15110d', skyTop: '#0c0907', fogNear: 11, fogFar: 29,
      hemiSky: '#fff4e0', hemiGround: '#2a1c10', hemi: 0.9, key: '#ffe7c2', keyI: 2.1,
      warm: '#ffb466', warmI: 30, warmPos: [0, 6, 1], exposure: 1.05,
      rim: '#5b3a1f', rimRough: 0.55, rimMetal: 0.05, accents: [none, none],
    },
    top: { kind: 'felt', a: '#23483e', b: '#23483e', tile: 0.18, rough: 0.95 },
    floor: { kind: 'felt', a: '#0f0b08', b: '#0f0b08', tile: 4, rough: 1 },
    fx: [], beams: noBeams, mist: null, table: { kind: 'plain', height: 0.9 }, skyline: null,
  },

  tavern: {
    indoors: true,
    look: {
      sky: '#1b120b', skyTop: '#0e0805', fogNear: 9, fogFar: 24,
      hemiSky: '#ffe2b8', hemiGround: '#3a2412', hemi: 0.75, key: '#ffd7a0', keyI: 1.7,
      warm: '#ff9a45', warmI: 38, warmPos: [0, 5, 2], exposure: 1.08,
      rim: '#3a2412', rimRough: 0.6, rimMetal: 0.05,
      accents: [light('#ff8a3a', 22, [-9, 3, -6], 0.35), light('#ff8a3a', 22, [9, 3, -6], 0.35)],
    },
    top: { kind: 'planks', a: '#58381f', b: '#76502d', tile: 5, rough: 0.75, opts: { rows: 4 } },
    floor: { kind: 'planks', a: '#2e1d10', b: '#4a2e19', tile: 5, rough: 0.8 },
    fx: [fx('motes', 90, '#ffd9a0', 0.14)],
    beams: { color: '#ffd9a0', n: 2, strength: 0.1 }, mist: null, table: { kind: 'tavern', height: 5.2 },
    skyline: { kind: 'arches', far: '#1a110a', near: '#120b06' },
  },

  harbor: {
    indoors: false,
    look: {
      sky: '#56646e', skyTop: '#2c3840', fogNear: 7, fogFar: 19,
      hemiSky: '#cfe0ee', hemiGround: '#2b343a', hemi: 0.9, key: '#dbe8f2', keyI: 1.5,
      warm: '#ffb070', warmI: 12, warmPos: [0, 5, 1], exposure: 1.0,
      rim: '#3a2e22', rimRough: 0.8, rimMetal: 0,
      accents: [light('#ffb36a', 18, [-8, 3, -5], 0.25), light('#ffb36a', 18, [8, 3, -5], 0.25)],
    },
    top: { kind: 'planks', a: '#5b5146', b: '#857662', tile: 6, rough: 0.8, opts: { rows: 5, nails: true } },
    floor: { kind: 'soft', a: '#1b3a47', b: '#4f8296', tile: 14, rough: 0.25, metal: 0.1, opts: { blobs: 60, r: [30, 70] } },
    fx: [], beams: noBeams, mist: { color: '#c9d8e2', n: 7, strength: 0.22 },
    table: { kind: 'ship', height: 1.7 }, floorShape: 'waves', sway: 1.1, skyScroll: 1 / 600,
    skyline: { kind: 'town', far: '#46535c', near: '#2a343b' },
  },

  snow: {
    indoors: false,
    look: {
      sky: '#9db4cc', skyTop: '#4d6a8c', fogNear: 7, fogFar: 21,
      hemiSky: '#dcecff', hemiGround: '#4a5a70', hemi: 0.85, key: '#e6f1ff', keyI: 1.6,
      warm: '#9cc8ff', warmI: 14, warmPos: [0, 6, 1], exposure: 1.1,
      rim: '#8ea3b6', rimRough: 0.6, rimMetal: 0,
      accents: [light('#8fc2ff', 16, [-8, 3, -5], 0.1), light('#b7d4ff', 10, [8, 4, -3], 0.1)],
    },
    top: { kind: 'slab', a: '#7d8a98', b: '#b0bdca', tile: 9.5, rough: 0.8, opts: { sparkle: true } },
    floor: { kind: 'soft', a: '#b8c8d8', b: '#eef5fb', tile: 14, rough: 0.95, opts: { sparkle: true } },
    fx: [fx('snow', 200, '#ffffff', 0.16, false)],
    beams: { color: '#cfe8ff', n: 2, strength: 0.08 }, mist: { color: '#e6f0fa', n: 6, strength: 0.2 },
    table: { kind: 'altar', height: 5, cover: 'snow' },
    skyline: { kind: 'peaks', far: '#7f98b4', near: '#5d7490' },
  },

  crypt: {
    indoors: false,
    look: {
      sky: '#1a2a24', skyTop: '#070d0b', fogNear: 7, fogFar: 18,
      hemiSky: '#a9d4c0', hemiGround: '#0c1210', hemi: 0.5, key: '#bfe8d8', keyI: 1.1,
      warm: '#58ffb4', warmI: 10, warmPos: [0, 3, 0], exposure: 1.0,
      rim: '#2c312e', rimRough: 0.9, rimMetal: 0,
      accents: [light('#4dffb0', 14, [-7, 2, -5], 0.5), light('#4dffb0', 12, [8, 2, 3], 0.5)],
    },
    top: { kind: 'slab', a: '#4a514d', b: '#6c756f', tile: 9.5, rough: 0.9, opts: { moss: true } },
    floor: { kind: 'flagstone', a: '#1a1e1c', b: '#2a302d', tile: 5, rough: 0.95, opts: { moss: true } },
    fx: [fx('wisps', 36, '#7dffc4', 0.5)],
    beams: { color: '#c8f5e6', n: 2, strength: 0.07 }, mist: { color: '#4fa08a', n: 7, strength: 0.2 },
    table: { kind: 'vault', height: 4.6 },
    skyline: { kind: 'graves', far: '#16211d', near: '#0a100e' },
  },

  forge: {
    indoors: false,
    look: {
      sky: '#1a0a06', skyTop: '#0a0403', fogNear: 7, fogFar: 18,
      hemiSky: '#ff9a6a', hemiGround: '#8a3814', hemi: 0.6, key: '#ff9560', keyI: 1.2,
      warm: '#ff5a1e', warmI: 26, warmPos: [0, 3, 0], exposure: 1.05,
      rim: '#4e4e56', rimRough: 0.45, rimMetal: 0.2,
      accents: [light('#ff5a1e', 30, [-9, 2.5, -6], 0.5), light('#ff7a2e', 26, [9, 2.5, -4], 0.5)],
    },
    top: { kind: 'steel', a: '#50545d', b: '#868c98', tile: 6, rough: 0.5, metal: 0.2 },
    floor: { kind: 'magma', a: '#171413', b: '#38322d', glow: '#ff5a1e', tile: 16, rough: 0.95 },
    fx: [fx('sparks', 120, '#ffb057', 0.12)],
    beams: noBeams, mist: { color: '#3b2a22', n: 6, strength: 0.22 },
    table: { kind: 'anvil', height: 5 }, floorShape: 'rock',
    skyline: { kind: 'stacks', far: '#2a1410', near: '#0d0605' },
  },

  forest: {
    indoors: false,
    look: {
      sky: '#335544', skyTop: '#12261c', fogNear: 9, fogFar: 24,
      hemiSky: '#d6ffd0', hemiGround: '#16301f', hemi: 0.65, key: '#fff2c0', keyI: 1.9,
      warm: '#9be58a', warmI: 14, warmPos: [0, 5, 1], exposure: 1.05,
      rim: '#5a6556', rimRough: 0.95, rimMetal: 0,
      accents: [light('#9bff8a', 12, [-8, 2, -4], 0.4), light('#8ad6ff', 10, [8, 2, -5], 0.4)],
    },
    top: { kind: 'slab', a: '#566052', b: '#7b8574', tile: 9.5, rough: 0.95, opts: { moss: true, lichen: true } },
    floor: { kind: 'moss', a: '#1c321d', b: '#2f5230', tile: 5, rough: 1 },
    fx: [fx('fireflies', 60, '#d8ff7a', 0.2), fx('leaves', 36, '#b0c860', 0.24, false)],
    beams: { color: '#fff1b8', n: 4, strength: 0.12 }, mist: { color: '#9fd6b0', n: 6, strength: 0.16 },
    table: { kind: 'altar', height: 5, cover: 'moss' },
    skyline: { kind: 'pines', far: '#1e3a2a', near: '#0f2218' },
  },

  fortress: {
    indoors: false,
    look: {
      sky: '#aab8c8', skyTop: '#5a7aa8', fogNear: 9, fogFar: 28,
      hemiSky: '#fff6e6', hemiGround: '#3b3226', hemi: 0.9, key: '#fff0d0', keyI: 1.9,
      warm: '#ffc890', warmI: 18, warmPos: [0, 6, 1], exposure: 1.1,
      rim: '#2f2a25', rimRough: 0.75, rimMetal: 0.15,
      accents: [light('#ffb060', 16, [-9, 3, -6], 0.35), light('#ffb060', 16, [9, 3, -6], 0.35)],
    },
    top: { kind: 'planks', a: '#3a2a1d', b: '#58432d', tile: 5, rough: 0.7, opts: { rows: 4, nails: true } },
    floor: { kind: 'flagstone', a: '#3a3a37', b: '#524f4a', tile: 5, rough: 0.95 },
    fx: [fx('motes', 70, '#fff0c8', 0.12)],
    beams: { color: '#fff1c4', n: 3, strength: 0.12 }, mist: { color: '#dfe6ee', n: 4, strength: 0.1 },
    table: { kind: 'hall', height: 6 },
    skyline: { kind: 'castle', far: '#7686a0', near: '#3c4658' },
  },

  archive: {
    indoors: true,
    look: {
      sky: '#0f0c18', skyTop: '#06050c', fogNear: 10, fogFar: 26,
      hemiSky: '#cdbfff', hemiGround: '#1a1426', hemi: 0.6, key: '#e5d8ff', keyI: 1.4,
      warm: '#ffc78a', warmI: 26, warmPos: [0, 4, 2], exposure: 1.0,
      rim: '#2b1a10', rimRough: 0.45, rimMetal: 0.15,
      accents: [light('#ffbf7a', 18, [-8, 3, -5], 0.3), light('#b69cff', 14, [8, 3, -5], 0.2)],
    },
    top: { kind: 'planks', a: '#2d1b12', b: '#4c321f', tile: 5, rough: 0.35, opts: { rows: 5 } },
    floor: { kind: 'planks', a: '#20150f', b: '#33231a', tile: 5, rough: 0.7 },
    fx: [fx('motes', 110, '#d8c8ff', 0.13)],
    beams: { color: '#cfc2ff', n: 2, strength: 0.1 }, mist: null, table: { kind: 'study', height: 5.6 },
    skyline: { kind: 'arches', far: '#17122a', near: '#0c0914' },
  },

  plains: {
    indoors: false,
    look: {
      sky: '#d9b987', skyTop: '#6f9ac8', fogNear: 11, fogFar: 30,
      hemiSky: '#fff4d8', hemiGround: '#3d3320', hemi: 0.9, key: '#ffd89a', keyI: 1.9,
      warm: '#ffbe70', warmI: 14, warmPos: [0, 6, 1], exposure: 1.1,
      rim: '#77735f', rimRough: 0.95, rimMetal: 0, accents: [none, none],
    },
    top: { kind: 'slab', a: '#7c786a', b: '#a29d8d', tile: 9.5, rough: 0.95, opts: { moss: true, lichen: true } },
    floor: { kind: 'moss', a: '#4a6a30', b: '#7e9a46', tile: 5, rough: 1 },
    fx: [fx('motes', 90, '#ffe6a8', 0.12), fx('leaves', 20, '#d8c070', 0.2, false)],
    beams: { color: '#ffe9b0', n: 3, strength: 0.12 }, mist: { color: '#f0d9a8', n: 4, strength: 0.1 },
    table: { kind: 'altar', height: 5, cover: 'moss' },
    skyline: { kind: 'hills', far: '#8c9a70', near: '#5f7048' },
  },

  sky: {
    indoors: false,
    look: {
      sky: '#8fc1ee', skyTop: '#3b78c4', fogNear: 11, fogFar: 30,
      hemiSky: '#ffffff', hemiGround: '#7fa3c8', hemi: 0.95, key: '#fff6e0', keyI: 1.9,
      warm: '#ffe0b0', warmI: 10, warmPos: [0, 6, 1], exposure: 1.1,
      rim: '#6b4a2a', rimRough: 0.6, rimMetal: 0.1, accents: [none, none],
    },
    top: { kind: 'planks', a: '#8a6a44', b: '#b58f5c', tile: 6, rough: 0.6, opts: { rows: 5, nails: true } },
    floor: { kind: 'soft', a: '#b9cde6', b: '#ffffff', tile: 16, rough: 1, opts: { blobs: 50, r: [40, 90] } },
    fx: [fx('motes', 50, '#ffffff', 0.1)],
    beams: { color: '#fff7d8', n: 3, strength: 0.12 }, mist: { color: '#ffffff', n: 8, strength: 0.28 },
    table: { kind: 'skyship', height: 2.9 }, floorShape: 'clouds', skyScroll: 1 / 420,
    skyline: { kind: 'clouds', far: '#dbe9f7', near: '#f3f8fd' },
  },
};

/** What a location changes about its family. `null` clears a setting the family has; the rest replaces it (look, surfaces and table field by field). */
interface Override {
  indoors?: boolean;
  look?: Partial<Look>;
  top?: Partial<SurfaceSpec>;
  floor?: Partial<SurfaceSpec>;
  fx?: FxSpec[];
  beams?: Theme['beams'];
  mist?: Theme['mist'];
  table?: Partial<TableSpec>;
  floorShape?: GroundKind | null;
  sway?: number | null;
  skyScroll?: number | null;
}

function derive(family: FamilyId, o: Override = {}): Theme {
  const b = FAMILIES[family];
  const out: Theme = {
    ...b,
    family,
    indoors: o.indoors ?? b.indoors,
    look: { ...b.look, ...o.look },
    top: { ...b.top, ...o.top },
    floor: { ...b.floor, ...o.floor },
    fx: o.fx ?? b.fx,
    beams: o.beams ?? b.beams,
    mist: o.mist === undefined ? b.mist : o.mist,
    table: { ...b.table, ...o.table },
    skyline: null,
  };
  if (o.floorShape === null) delete out.floorShape; else if (o.floorShape) out.floorShape = o.floorShape;
  if (o.sway === null) delete out.sway; else if (o.sway !== undefined) out.sway = o.sway;
  if (o.skyScroll === null) delete out.skyScroll; else if (o.skyScroll !== undefined) out.skyScroll = o.skyScroll;
  return out;
}

export const THEMES: Record<ThemeId, Theme> = {
  felt: { ...FAMILIES.felt, family: 'felt' },

  // -- Tavern --------------------------------------------------------------------------------
  // Indoors, a low-beamed halfellow pub at night: the warmest interior, in a haze of pipe smoke.
  'the-goose-and-kettle': derive('tavern', {
    look: { warmI: 44, exposure: 1.12 },
    fx: [fx('motes', 120, '#ffd9a0', 0.14)],
    mist: { color: '#8a6a4a', n: 5, strength: 0.14 },
  }),

  // -- Harbor --------------------------------------------------------------------------------
  // Outdoors on a quay: grey dawn, sea fog, a thread of cold gold. (A repainted sky that does not wrap round must switch the sliding sky off: skyScroll: null.)
  'parting-strand': derive('harbor', {
    look: {
      sky: '#6a7882', skyTop: '#38444e', fogNear: 6, fogFar: 17, hemiSky: '#cdd9e4', key: '#d9e4ee', keyI: 1.4, warm: '#ffd9a0', warmI: 11,
      accents: [light('#ffb36a', 20, [-8, 3, -5], 0.4), light('#8fb4d8', 8, [8, 3, -5], 0.1)],
    },
    mist: { color: '#cfdbe4', n: 9, strength: 0.28 },
  }),

  // -- Crypt: a wild graveyard, a formal tomb, an ancient mound, a natural abyss -------------
  // Outdoors, open downs at night under a sick-green moon: turf and wet earth underfoot.
  'the-barrowlands': derive('crypt', {
    floor: { kind: 'moss', a: '#0e1a14', b: '#1c2c22', tile: 5, rough: 1, opts: {} },
  }),

  // Indoors, a sealed rib-vaulted tomb: slate and pale gold, the only crypt that is holy rather than haunted.
  'tomb-of-the-first-wardens': derive('crypt', {
    indoors: true,
    look: {
      sky: '#14161d', skyTop: '#07080b', fogNear: 8, fogFar: 20, hemiSky: '#aab4c8', hemiGround: '#10141c', hemi: 0.5,
      key: '#e8e0c8', keyI: 1.2, warm: '#ffe2a0', warmI: 12, warmPos: [0, 3, 0], exposure: 1.02, rim: '#2d3036',
      accents: [light('#ffe2a0', 12, [-7, 2, -5], 0.15), light('#ffd890', 10, [8, 2, 3], 0.15)],
    },
    top: { kind: 'slab', a: '#4d535c', b: '#6f7682', tile: 9.5, rough: 0.85, opts: {} },
    floor: { kind: 'flagstone', a: '#2a2d33', b: '#3d4149', tile: 9, rough: 0.9, glow: '#ffe2a0', opts: { glyphs: 'runes' } },
    fx: [fx('motes', 70, '#ffe8b0', 0.12)],
    beams: { color: '#ffe8b0', n: 1, strength: 0.14 }, mist: null,
    table: { glow: '#ffe2a0' },
  }),

  // Indoors, deep in an ancient passage tomb: rough megaliths and earth, ghost-blue carvings, a bare capstone table.
  'barrowdeep': derive('crypt', {
    indoors: true,
    look: {
      sky: '#12161c', skyTop: '#06080b', fogNear: 6, fogFar: 16, hemiSky: '#b8d2ee', hemiGround: '#2c3446', hemi: 1.0,
      key: '#c4dcff', keyI: 1.2, warm: '#8ec8ff', warmI: 9, warmPos: [0, 3, 0], exposure: 1.15, rim: '#3a3732',
      accents: [light('#7fb8ff', 14, [-7, 2, -5], 0.4), light('#9cc8ff', 16, [8, -3.2, 4], 0.4)],
    },
    top: { kind: 'slab', a: '#4a4640', b: '#6b665c', tile: 9.5, rough: 0.95, opts: {} },
    floor: { kind: 'dirt', a: '#2a2118', b: '#3d3024', tile: 5, rough: 1 },
    fx: [fx('wisps', 44, '#9fd0ff', 0.5)],
    beams: { color: '#bcd6ff', n: 1, strength: 0.06 }, mist: { color: '#6a8aa8', n: 7, strength: 0.2 },
    table: { kind: 'dolmen', height: 4.6, glow: '#7fb8ff' },
  }),

  // Indoors, a cavern too big to see the roof of: violet fungus and cyan glints on black water.
  'the-umbral-deep': derive('crypt', {
    indoors: true,
    look: {
      sky: '#0c0a14', skyTop: '#04030a', fogNear: 6, fogFar: 15, hemiSky: '#9a86d8', hemiGround: '#07060d', hemi: 0.55,
      key: '#b8a8ff', keyI: 1.2, warm: '#8a6aff', warmI: 12, warmPos: [0, 3, 0], exposure: 1.15, rim: '#2f2e3a',
      accents: [light('#9a6bff', 14, [-7, 2, -5], 0.3), light('#5ae6ff', 9, [8, 2, 3], 0.3)],
    },
    top: { kind: 'slab', a: '#3a3b4c', b: '#5c5e74', tile: 9.5, rough: 0.55, opts: {} },
    floor: { kind: 'soft', a: '#0b0b12', b: '#1c1c2c', tile: 14, rough: 0.25, metal: 0.15, opts: { blobs: 50, r: [24, 60] } },
    fx: [fx('wisps', 50, '#b69cff', 0.35), fx('ripples', 10, '#a8b8ff', 1, false)],
    beams: noBeams, mist: { color: '#4a3c80', n: 6, strength: 0.16 },
    table: { kind: 'altar', height: 4.6 },
  }),

  // -- Forge: craft, quarry, wound, war --------------------------------------------------------
  // Indoors, a dwarven smithy hall: dressed stone, not a volcano, so the jagged ground is switched off.
  'the-deep-forge-of-karrak': derive('forge', {
    indoors: true,
    look: { sky: '#1a0f0a', skyTop: '#0a0605', fogNear: 8, fogFar: 20 },
    floor: { kind: 'channels', a: '#3a3836', b: '#56524e', tile: 12, rough: 0.8, glow: '#e8561a', opts: { rows: 4 } },
    mist: { color: '#8a8480', n: 7, strength: 0.14 },
    floorShape: null,
  }),

  // Outdoors, an open pit in bright flat overcast: pale broken stone, no fire.
  'the-old-quarry': derive('forge', {
    look: {
      sky: '#b9bcbc', skyTop: '#8a9096', fogNear: 10, fogFar: 28, hemiSky: '#e8ecef', hemiGround: '#5a5448', hemi: 1.0,
      key: '#f4f2ea', keyI: 1.7, warm: '#ffe9c8', warmI: 8, warmPos: [0, 6, 1], exposure: 1.1, rim: '#8a847a', rimRough: 0.9, rimMetal: 0,
      accents: [none, none],
    },
    top: { kind: 'slab', a: '#8f8a7e', b: '#b5afa0', tile: 9.5, rough: 0.9, metal: 0, opts: {} },
    floor: { kind: 'slab', a: '#7d786c', b: '#a39d8e', tile: 10, rough: 0.95, opts: {} },
    fx: [fx('motes', 70, '#e0d6c0', 0.12)],
    mist: { color: '#cfc8b8', n: 4, strength: 0.1 },
    table: { kind: 'block', height: 5 },
  }),

  // Outdoors, a torn dusk sky: the cracked ground glows pale gold and breathes.
  'the-crack-in-the-marchstone': derive('forge', {
    look: {
      sky: '#241a2a', skyTop: '#0c0812', fogNear: 7, fogFar: 19, hemiSky: '#c9b8ff', hemiGround: '#2a2010', hemi: 0.55,
      key: '#f5e8c8', keyI: 1.1, warm: '#ffe2a0', warmI: 24, warmPos: [0, 3, 0], exposure: 1.05, rim: '#2a2a32',
      accents: [light('#ffe8a8', 24, [-9, 2.5, -6], 0.15), light('#a47bff', 18, [9, 2.5, -4], 0.2)],
    },
    top: { kind: 'slab', a: '#3a3a44', b: '#5e5e6c', tile: 9.5, rough: 0.8, metal: 0, opts: {} },
    floor: { kind: 'magma', a: '#14121a', b: '#2c2833', glow: '#ffe2a0', tile: 16, rough: 0.95 },
    fx: [fx('wisps', 40, '#ffe2a0', 0.3), fx('sparks', 50, '#ffd88a', 0.1)],
    beams: { color: '#fff0c0', n: 3, strength: 0.12 }, mist: { color: '#5a4a7a', n: 5, strength: 0.14 },
    table: { kind: 'altar', height: 5 },
  }),

  // Outdoors, an orc fortress on a rocky rise over a marsh, under a sullen red sun: rock and mud, ash and gnats.
  'gorewatch': derive('forge', {
    look: {
      sky: '#3a2a22', skyTop: '#1a1210', fogNear: 7, fogFar: 19, hemiSky: '#c8aa90', hemiGround: '#4a4034', hemi: 1.0,
      key: '#ff9a6a', keyI: 1.8, warm: '#ff6a3a', warmI: 16, warmPos: [0, 3, 0], exposure: 1.15, rim: '#3a3532', rimMetal: 0.3,
      // Bonfires on the ramparts, and a sickly green bounce off the marsh below.
      accents: [light('#ff7a3a', 18, [-9, 2.5, -6], 0.5), light('#7aa060', 10, [9, 2.5, -4], 0.2)],
    },
    top: { kind: 'steel', a: '#4a4a50', b: '#74747e', tile: 6, rough: 0.5, metal: 0.2 },
    floor: { kind: 'dirt', a: '#3a2c22', b: '#5a4636', tile: 6, rough: 1 },
    fx: [fx('embers', 80, '#ff9a5a', 0.12), fx('ash', 70, '#a39d95', 0.12, false), fx('motes', 40, '#c9b890', 0.08)],
    mist: { color: '#6a7a5a', n: 8, strength: 0.2 },
    table: { kind: 'ironslab', height: 5 },
  }),

  // -- Forest: seven woods, seven moods ----------------------------------------------------------
  // Outdoors, a bright spring morning in a flowering clearing: pollen and petals.
  'the-storybook-glade': derive('forest', {
    look: {
      sky: '#a8d8b0', skyTop: '#6aa8d8', fogNear: 11, fogFar: 30, hemiSky: '#fff4e0', hemiGround: '#4a7a3a', hemi: 0.95,
      key: '#fff0c8', keyI: 2.2, warm: '#ffd0a0', warmI: 16, exposure: 1.12, rim: '#6a7a5a',
      accents: [light('#ffb0d0', 10, [-8, 2, -4], 0.1), light('#fff0a0', 10, [8, 2, -5], 0.1)],
    },
    top: { kind: 'slab', a: '#6a7a5e', b: '#92a083', tile: 9.5, rough: 0.95, opts: { moss: true, lichen: true } },
    floor: { kind: 'moss', a: '#3c6a2a', b: '#6aa044', tile: 5, rough: 1 },
    fx: [fx('motes', 110, '#ffe8a0', 0.12), fx('petals', 40, '#f6b9cf', 0.2, false), fx('butterflies', 14, '#ffe27a', 0.18, false)],
    beams: { color: '#fff1b8', n: 5, strength: 0.14 }, mist: { color: '#fff0d8', n: 4, strength: 0.1 },
    table: { cover: 'flowers' },
  }),

  // Outdoors, pre-dawn at the edge of a wood: cold silver light, mist, leaves swirling after unseen riders.
  'the-silverwood-hunt': derive('forest', {
    look: {
      sky: '#5a6e80', skyTop: '#202e44', fogNear: 8, fogFar: 22, hemiSky: '#cfe0f4', hemiGround: '#1a2a2a', hemi: 0.7,
      key: '#d8e8ff', keyI: 1.6, warm: '#bcd4f0', warmI: 10, exposure: 1.0,
      accents: [light('#a8c8ff', 10, [-8, 2, -4], 0.1), light('#ffd8a0', 8, [8, 2, -5], 0.1)],
    },
    top: { kind: 'slab', a: '#586062', b: '#808a8a', tile: 9.5, rough: 0.95, opts: { moss: true, lichen: true } },
    floor: { kind: 'moss', a: '#1a2c26', b: '#2e4a40', tile: 5, rough: 1 },
    fx: [fx('leaves', 60, '#b0c860', 0.22, false)],
    beams: { color: '#d8e8ff', n: 4, strength: 0.12 }, mist: { color: '#c8d8e8', n: 8, strength: 0.22 },
  }),

  // Outdoors under colossal trees, a golden-green afternoon: gold leaves and glowing motes.
  'sylvaneth': derive('forest', {
    look: {
      sky: '#6a8a50', skyTop: '#2a4a30', fogNear: 10, fogFar: 28, hemiSky: '#f4ffd0', hemiGround: '#2a4a1a', hemi: 0.8,
      key: '#ffe8a0', keyI: 2.0, warm: '#ffd870', warmI: 18, exposure: 1.1, rim: '#6a5a3a',
      accents: [light('#ffd870', 12, [-8, 3, -4], 0.15), light('#b8ff90', 10, [8, 3, -5], 0.15)],
    },
    top: { kind: 'slab', a: '#6a6a50', b: '#8e8a6c', tile: 9.5, rough: 0.95, opts: { moss: true, lichen: true } },
    floor: { kind: 'moss', a: '#3a3a1a', b: '#6a5a24', tile: 5, rough: 1 },
    fx: [fx('motes', 110, '#ffe08a', 0.12), fx('leaves', 50, '#d8b040', 0.24, false, ['#e8c458', '#b88a2a'])],
    beams: { color: '#ffe9a0', n: 6, strength: 0.14 }, mist: { color: '#c8e0a0', n: 5, strength: 0.12 },
  }),

  // Outdoors among grassy mounds in thick fog (the foggiest place in the game): pale blue-white fey lights.
  'the-hollow-hills': derive('forest', {
    look: {
      sky: '#bcc8c0', skyTop: '#8ea29a', fogNear: 5, fogFar: 14, hemiSky: '#e8f4f0', hemiGround: '#40503c', hemi: 0.8,
      key: '#dfeee8', keyI: 1.2, warm: '#cfe8e0', warmI: 8, exposure: 1.05,
      accents: [light('#bfe8ff', 12, [-8, 1.5, -4], 0.5), light('#d8f0ff', 10, [8, 1.5, -5], 0.5)],
    },
    floor: { kind: 'moss', a: '#34502e', b: '#587a48', tile: 5, rough: 1 },
    fx: [fx('fireflies', 50, '#c8ecff', 0.22)],
    beams: { color: '#e8f4ee', n: 2, strength: 0.07 }, mist: { color: '#e8f0ec', n: 10, strength: 0.34 },
  }),

  // Outdoors, endless clear twilight over still black water: indigo and teal, motes drifting without wind.
  'the-hollow-between': derive('forest', {
    look: {
      sky: '#1e2a4a', skyTop: '#0a1028', fogNear: 9, fogFar: 26, hemiSky: '#a8b8f0', hemiGround: '#0c1a28', hemi: 0.5,
      key: '#b8d0ff', keyI: 1.0, warm: '#9ad8d0', warmI: 8, exposure: 1.1,
      accents: [light('#6ae0d0', 10, [-8, 2, -4], 0.1), light('#8a8aff', 8, [8, 2, -5], 0.1)],
    },
    top: { kind: 'slab', a: '#5a6070', b: '#8088a0', tile: 9.5, rough: 0.85, opts: {} },
    floor: { kind: 'soft', a: '#070b16', b: '#16203a', tile: 14, rough: 0.18, metal: 0.2, opts: { blobs: 40, r: [30, 70] } },
    fx: [fx('motes', 90, '#cfe0ff', 0.12), fx('ripples', 6, '#a8c0ff', 1, false)],
    beams: noBeams, mist: { color: '#3a4a7a', n: 5, strength: 0.12 },
    table: { cover: undefined },
    floorShape: 'mirror',
  }),

  // Outdoors in a flooded wood under flat pewter light: glossy still water, a bare slab, no mist.
  'the-mirror-marches': derive('forest', {
    look: {
      sky: '#aab4b8', skyTop: '#7a888e', fogNear: 9, fogFar: 26, hemiSky: '#e4eef0', hemiGround: '#4a5a58', hemi: 1.0,
      key: '#eef2f0', keyI: 1.6, warm: '#e0e8e8', warmI: 6, exposure: 1.1, rim: '#6a706e',
      accents: [light('#c07a50', 5, [-8, 1, -4], 0.1), none],
    },
    top: { kind: 'slab', a: '#68706e', b: '#929a98', tile: 9.5, rough: 0.8, opts: {} },
    floor: { kind: 'soft', a: '#4a5a5c', b: '#9ab0b0', tile: 16, rough: 0.08, metal: 0.35, opts: { blobs: 30, r: [40, 90] } },
    fx: [fx('motes', 30, '#e8f0f0', 0.09), fx('ripples', 8, '#e0eef0', 1, false)],
    beams: noBeams, mist: null,
    table: { cover: undefined },
    floorShape: 'mirror',
  }),

  // Outdoors on a lake shore at lilac dusk: fireflies, floating lantern lights, lantern gold.
  'silverlake-at-midsummer': derive('forest', {
    look: {
      sky: '#6a5a8a', skyTop: '#2a2450', fogNear: 9, fogFar: 26, hemiSky: '#d8c8ff', hemiGround: '#2a2a4a', hemi: 0.75,
      key: '#ffd8b0', keyI: 1.5, warm: '#ffb870', warmI: 22, warmPos: [0, 5, 1], exposure: 1.08,
      accents: [light('#ffc070', 16, [-8, 3, -4], 0.3), light('#ffb060', 14, [8, 3, -5], 0.3)],
    },
    top: { kind: 'slab', a: '#5e6458', b: '#868c7c', tile: 9.5, rough: 0.95, opts: { moss: true, lichen: true } },
    floor: { kind: 'moss', a: '#243a2a', b: '#3e5a40', tile: 5, rough: 1 },
    fx: [fx('fireflies', 80, '#ffe890', 0.2), fx('lanterns', 16, '#ffc070', 1.0)],
    beams: { color: '#ffd8a0', n: 2, strength: 0.08 }, mist: { color: '#c8b8e8', n: 5, strength: 0.14 },
  }),

  // -- Fortress: six strongholds, six kinds -------------------------------------------------------
  // Outdoors in the inner castle courtyard, cold clear morning, low watch-fires.
  'marchguard-keep': derive('fortress', {
    look: {
      sky: '#a8b8cc', skyTop: '#5a7aa8', hemiSky: '#eef4ff', key: '#e8f0ff', keyI: 1.9, warm: '#ffd0a0', warmI: 12, exposure: 1.08,
      accents: [light('#ff9a50', 12, [-9, 3, -6], 0.35), light('#ff9a50', 12, [9, 3, -6], 0.35)],
    },
    fx: [fx('motes', 60, '#e8f0ff', 0.12)],
    beams: { color: '#e0ecff', n: 3, strength: 0.1 }, mist: { color: '#e6ecf4', n: 4, strength: 0.12 },
  }),

  // Indoors in a great stone hall: warm stone, deep red, gold shafts through slit windows, hearth sparks.
  'the-wardens-hall': derive('fortress', {
    indoors: true,
    look: {
      sky: '#2a1c14', skyTop: '#120c08', fogNear: 8, fogFar: 22, hemiSky: '#ffe0b0', hemiGround: '#3a2a1c', hemi: 0.7,
      key: '#ffe4b0', keyI: 1.5, warm: '#ffb060', warmI: 34, warmPos: [0, 5, 2], exposure: 1.08,
      accents: [light('#ff8a3a', 24, [-9, 3, -6], 0.4), light('#ffd890', 14, [9, 3, -6], 0.1)],
    },
    floor: { kind: 'flagstone', a: '#4a4036', b: '#62564a', tile: 5, rough: 0.95 },
    fx: [fx('motes', 80, '#ffe0a0', 0.12), fx('sparks', 30, '#ffb057', 0.1)],
    beams: { color: '#ffe2a0', n: 3, strength: 0.14 }, mist: null,
  }),

  // Outdoors on an open meadow under overcast: wind-flattened grass, no walls, seeds on the wind.
  'the-field-of-oaths': derive('fortress', {
    look: {
      sky: '#8a96a4', skyTop: '#5a6878', fogNear: 10, fogFar: 28, hemiSky: '#dce4ec', hemiGround: '#3a4a30', hemi: 0.95,
      key: '#e8ecf0', keyI: 1.4, warm: '#d8e0e8', warmI: 8, exposure: 1.05, accents: [none, none],
    },
    floor: { kind: 'moss', a: '#3a4e2a', b: '#6a7e44', tile: 5, rough: 1 },
    fx: [fx('motes', 70, '#e8e4d0', 0.1), fx('leaves', 24, '#c8d090', 0.18, false, ['#d8dcc0', '#b8c090'])],
    beams: noBeams, mist: { color: '#d0d8e0', n: 3, strength: 0.08 },
  }),

  // Outdoors at the dwarf capital at alpine dusk (the snow environment): flurries, brazier sparks, a heavy hall table.
  'grimgate': derive('snow', {
    look: {
      sky: '#7a8aa8', skyTop: '#2a3a5a', key: '#cfe0ff', keyI: 1.3, warm: '#ffb070', warmI: 18, exposure: 1.05,
      accents: [light('#ffb060', 16, [-8, 3, -5], 0.3), light('#ff9a50', 14, [8, 3, -3], 0.3)],
    },
    top: { kind: 'planks', a: '#3a3026', b: '#5a4a38', tile: 5, rough: 0.7, opts: { rows: 4, nails: true } },
    floor: { kind: 'soft', a: '#8fa0b8', b: '#c4d0e0', tile: 14, rough: 0.95, opts: { sparkle: true } },
    fx: [fx('snow', 90, '#ffffff', 0.16, false), fx('sparks', 20, '#ffb057', 0.1)],
    table: { kind: 'hall', height: 6, cover: undefined },
  }),

  // Outdoors in the commons of the capital city on a bright afternoon: cobbles, a trestle board, white-gold light.
  'kingsford': derive('fortress', {
    look: {
      sky: '#a8c4e8', skyTop: '#3a6ac0', fogNear: 11, fogFar: 30, hemiSky: '#ffffff', hemiGround: '#6a5a48', hemi: 1.0,
      key: '#fff4d8', keyI: 2.1, warm: '#ffe0b0', warmI: 12, exposure: 1.12, accents: [none, none],
    },
    top: { kind: 'planks', a: '#6a4a2a', b: '#8c6a3e', tile: 5, rough: 0.7, opts: { rows: 4, nails: true } },
    floor: { kind: 'cobbles', a: '#6a645a', b: '#8c8478', tile: 6, rough: 0.95 },
    fx: [fx('motes', 70, '#fff0c8', 0.12)],
    beams: { color: '#fff4d0', n: 3, strength: 0.1 }, mist: { color: '#f0f0f0', n: 4, strength: 0.08 },
    table: { kind: 'trestle', height: 5.2 },
  }),

  // Outdoors on a heather moor under a bruise-violet storm sky, one break in the cloud: glowing runes, seeds on the wind.
  'the-speaking-stones': derive('plains', {
    look: {
      sky: '#6a5a80', skyTop: '#2a2048', fogNear: 9, fogFar: 26, hemiSky: '#c0b0e0', hemiGround: '#3a3048', hemi: 0.8,
      key: '#ffe0b0', keyI: 1.7, warm: '#c8a8ff', warmI: 12, exposure: 1.05, rim: '#6a6a70',
      accents: [light('#b890ff', 10, [-8, 1.5, -4], 0.3), light('#a0c8ff', 8, [8, 1.5, -5], 0.3)],
    },
    top: { kind: 'slab', a: '#6a6a70', b: '#8e8e96', tile: 9.5, rough: 0.95, opts: { moss: true, lichen: true } },
    floor: { kind: 'moss', a: '#3a3048', b: '#6a5a78', tile: 5, rough: 1 },
    fx: [fx('motes', 60, '#e0d4ff', 0.1), fx('wisps', 12, '#c8b0ff', 0.4)],
    beams: { color: '#ffe9c0', n: 1, strength: 0.16 }, mist: { color: '#9a8ab8', n: 4, strength: 0.12 },
  }),

  // -- Archive: five kinds of knowledge ---------------------------------------------------------
  // Indoors in a small cosy museum room by daylight: honey wood, a green leather desk, lamp-green light.
  'the-hearthlands-archive': derive('archive', {
    look: {
      sky: '#3a2a1c', skyTop: '#1a120c', hemiSky: '#fff0d0', hemiGround: '#4a3a24', hemi: 0.85, key: '#fff0d0', keyI: 1.5,
      warm: '#ffd890', warmI: 30, exposure: 1.1, rim: '#4a3018',
      accents: [light('#9ae0a0', 14, [-8, 3, -5], 0.1), light('#ffc878', 16, [8, 3, -5], 0.2)],
    },
    top: { kind: 'leather', a: '#1f4a33', b: '#2f6a48', tile: 6, rough: 0.6 },
    floor: { kind: 'planks', a: '#5a4026', b: '#80603a', tile: 5, rough: 0.7 },
    fx: [fx('motes', 90, '#ffe8c0', 0.13)],
    beams: { color: '#ffe2a8', n: 2, strength: 0.12 },
    table: { body: { a: '#5a4026', b: '#80603a' } },
  }),

  // Indoors in the college's vaulted library: violet moonlight, blue-violet arcane motes.
  'the-mage-college-vaults': derive('archive', {
    floor: { kind: 'flagstone', a: '#1c1830', b: '#2c2646', tile: 10, rough: 0.6, glow: '#9a8aff', opts: { glyphs: 'sigils', rows: 4 } },
    fx: [fx('motes', 120, '#b8b0ff', 0.13), fx('wisps', 14, '#8ab8ff', 0.4)],
  }),

  // Indoors in a windowless stack: iron, wax red and one cold lamp, nearly monochrome.
  'the-sealed-archive': derive('archive', {
    look: {
      sky: '#16181c', skyTop: '#08090b', hemiSky: '#c8d0dc', hemiGround: '#14161a', hemi: 0.55, key: '#dfe6f0', keyI: 1.2,
      warm: '#e8f0ff', warmI: 18, warmPos: [0, 4, 2], exposure: 1.0, rim: '#2a2c30', rimMetal: 0.3,
      accents: [light('#c83a2a', 8, [-8, 3, -5], 0.15), light('#dfe8ff', 10, [8, 3, -5], 0.05)],
    },
    top: { kind: 'planks', a: '#26262a', b: '#3a3a40', tile: 5, rough: 0.5, opts: { rows: 5 } },
    floor: { kind: 'flagstone', a: '#1a1c20', b: '#2a2c32', tile: 5, rough: 0.9 },
    fx: [fx('motes', 60, '#d0d4dc', 0.1), fx('page', 1, '#e8e0cc', 1, false)],
    beams: noBeams,
  }),

  // Indoors under an open dome at night: midnight blue, brass, starlight, a shaft of moonlight.
  'the-collegium-observatory': derive('archive', {
    look: {
      sky: '#0a1228', skyTop: '#04060f', hemiSky: '#a8c0ff', hemiGround: '#0e1424', hemi: 0.75, key: '#c8d8ff', keyI: 1.6,
      warm: '#ffd890', warmI: 16, exposure: 1.1,
      accents: [light('#dbe8ff', 12, [-8, 3, -5], 0.05), light('#ffc070', 12, [8, 3, -5], 0.2)],
    },
    top: { kind: 'planks', a: '#2a2c3a', b: '#454a62', tile: 5, rough: 0.35, opts: { rows: 5 } },
    fx: [fx('motes', 130, '#e8f0ff', 0.1), fx('shootingstar', 1, '#e8f0ff', 1)],
    beams: { color: '#cfe0ff', n: 1, strength: 0.1 },
  }),

  // Indoors in a dwarven stair shaft: braziers above and below, amber on slate, ash drifting up.
  'the-endless-stair': derive('archive', {
    look: {
      sky: '#1a1a1e', skyTop: '#08080a', fogNear: 7, fogFar: 18, hemiSky: '#c8b8a0', hemiGround: '#1a1612', hemi: 0.5,
      key: '#ffd8a0', keyI: 1.1, warm: '#ff9a4a', warmI: 26, warmPos: [0, 3, 1], exposure: 1.05, rim: '#3a3632',
      accents: [light('#ff8a3a', 22, [-8, 3, -5], 0.45), light('#ff8a3a', 18, [8, -2, -5], 0.45)],
    },
    top: { kind: 'slab', a: '#4a4846', b: '#6a6662', tile: 9.5, rough: 0.9, opts: {} },
    floor: { kind: 'flagstone', a: '#26241f', b: '#3a362e', tile: 5, rough: 0.95 },
    fx: [fx('embers', 60, '#c8a070', 0.1), fx('motes', 40, '#d8c8a8', 0.1)],
    beams: noBeams, mist: { color: '#4a4238', n: 5, strength: 0.14 },
    table: { kind: 'landing', height: 5.6 },
  }),

  // -- Plains: road, village, capital -------------------------------------------------------------
  // Outdoors on a dirt road under a big afternoon sky: dust and seed fluff.
  'the-endless-road': derive('plains', {
    look: {
      sky: '#b0b8c0', skyTop: '#6a8ab0', hemiSky: '#fff4e0', hemiGround: '#4a4430', hemi: 0.9, key: '#fff0d0', keyI: 1.8,
      warm: '#ffd8a0', warmI: 12, exposure: 1.1,
    },
    floor: { kind: 'dirt', a: '#5a4630', b: '#8a7050', tile: 6, rough: 1 },
    fx: [fx('motes', 100, '#e8d4a8', 0.12), fx('leaves', 16, '#c8b070', 0.18, false, ['#d8c488', '#a89458'])],
    beams: { color: '#ffe8b0', n: 3, strength: 0.1 }, mist: { color: '#d8d0c0', n: 4, strength: 0.1 },
  }),

  // Outdoors in a green bowl of hills on a bright spring morning: pollen and bees.
  'clover-hollow': derive('plains', {
    look: {
      sky: '#b8dcf0', skyTop: '#6aaae0', fogNear: 11, fogFar: 30, hemiSky: '#ffffff', hemiGround: '#4a7a3a', hemi: 1.0,
      key: '#fff8e0', keyI: 2.0, warm: '#ffe8b0', warmI: 10, exposure: 1.12,
    },
    top: { kind: 'slab', a: '#7a8470', b: '#a4ae98', tile: 9.5, rough: 0.95, opts: { moss: true, lichen: true } },
    floor: { kind: 'moss', a: '#4a8030', b: '#86b848', tile: 5, rough: 1 },
    fx: [fx('motes', 100, '#fff0a0', 0.12), fx('butterflies', 10, '#ffe27a', 0.16, false, ['#ffe27a', '#ffffff'])],
    beams: { color: '#fff8d0', n: 3, strength: 0.1 }, mist: { color: '#ffffff', n: 3, strength: 0.08 },
  }),

  // Outdoors in the golden hour, the halfellow capital: a little chimney smoke.
  'hearthmeadow': derive('plains', {
    mist: { color: '#b8a890', n: 3, strength: 0.12 },
  }),

  // -- Sky ----------------------------------------------------------------------------------
  'the-skyship-valour': derive('sky'),
};

/**
 * Does this look borrow its family's panorama until it has one of its own? Only a place with the same enclosure as its
 * family does: a tomb (indoors) does not get the crypt family's open graveyard sky.
 */
export const sharesFamilySky = (id: ThemeId): boolean => THEMES[id].indoors === FAMILIES[THEMES[id].family].indoors;

/** Which look a location has. Anything unknown (or no location) keeps the plain felt. */
export const themeFor = (locationDef: string | null | undefined): ThemeId =>
  locationDef && Object.hasOwn(THEMES, locationDef) ? (locationDef as ThemeId) : 'felt';
