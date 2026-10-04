// The look of every location: surface, light, weather and scenery. A theme is
// data; Environment turns it into a 3D scene and blends between themes.

import type { SkylineKind, SurfaceSpec } from './surfaces';

export type ThemeId = 'felt' | 'tavern' | 'harbor' | 'snow' | 'crypt' | 'forge' | 'forest' | 'fortress' | 'archive' | 'plains' | 'sky';
export type FxKind = 'embers' | 'sparks' | 'snow' | 'fireflies' | 'motes' | 'wisps' | 'leaves';
export type PropSet = 'none' | 'tavern' | 'harbor' | 'snow' | 'crypt' | 'forge' | 'forest' | 'fortress' | 'archive' | 'plains' | 'sky';

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

export interface FxSpec { kind: FxKind; n: number; color: string; size: number; additive: boolean }

export interface Theme {
  look: Look;
  top: SurfaceSpec;
  floor: SurfaceSpec;
  fx: FxSpec[];
  /** Slanted shafts of light: colour and strength (0 = none). */
  beams: { color: string; n: number; strength: number };
  /** Drifting mist: colour, count, strength. */
  mist: { color: string; n: number; strength: number } | null;
  props: PropSet;
  skyline: { kind: SkylineKind; far: string; near: string } | null;
}

const none: Accent = { color: '#000000', i: 0, pos: [0, 3, -5], flicker: 0 };

export const THEMES: Record<ThemeId, Theme> = {
  felt: {
    look: {
      sky: '#15110d', skyTop: '#0c0907', fogNear: 11, fogFar: 29,
      hemiSky: '#fff4e0', hemiGround: '#2a1c10', hemi: 0.9, key: '#ffe7c2', keyI: 2.1,
      warm: '#ffb466', warmI: 30, warmPos: [0, 6, 1], exposure: 1.05,
      rim: '#5b3a1f', rimRough: 0.55, rimMetal: 0.05, accents: [none, none],
    },
    top: { kind: 'felt', a: '#23483e', b: '#23483e', tile: 0.18, rough: 0.95 },
    floor: { kind: 'felt', a: '#0f0b08', b: '#0f0b08', tile: 4, rough: 1 },
    fx: [], beams: { color: '#000000', n: 0, strength: 0 }, mist: null, props: 'none', skyline: null,
  },

  tavern: {
    look: {
      sky: '#1b120b', skyTop: '#0e0805', fogNear: 9, fogFar: 24,
      hemiSky: '#ffe2b8', hemiGround: '#3a2412', hemi: 0.75, key: '#ffd7a0', keyI: 1.7,
      warm: '#ff9a45', warmI: 38, warmPos: [0, 5, 2], exposure: 1.08,
      rim: '#3a2412', rimRough: 0.6, rimMetal: 0.05,
      accents: [{ color: '#ff8a3a', i: 22, pos: [-9, 3, -6], flicker: 0.35 }, { color: '#ff8a3a', i: 22, pos: [9, 3, -6], flicker: 0.35 }],
    },
    top: { kind: 'planks', a: '#58381f', b: '#76502d', tile: 5, rough: 0.75 },
    floor: { kind: 'planks', a: '#2e1d10', b: '#4a2e19', tile: 5, rough: 0.8 },
    fx: [{ kind: 'motes', n: 90, color: '#ffd9a0', size: 0.14, additive: true }],
    beams: { color: '#ffd9a0', n: 2, strength: 0.1 }, mist: null, props: 'tavern',
    skyline: { kind: 'arches', far: '#1a110a', near: '#120b06' },
  },

  harbor: {
    look: {
      sky: '#56646e', skyTop: '#2c3840', fogNear: 7, fogFar: 19,
      hemiSky: '#cfe0ee', hemiGround: '#2b343a', hemi: 0.9, key: '#dbe8f2', keyI: 1.5,
      warm: '#ffb070', warmI: 12, warmPos: [0, 5, 1], exposure: 1.0,
      rim: '#2c261f', rimRough: 0.7, rimMetal: 0,
      accents: [{ color: '#ffb36a', i: 18, pos: [-8, 3, -5], flicker: 0.25 }, { color: '#ffb36a', i: 18, pos: [8, 3, -5], flicker: 0.25 }],
    },
    top: { kind: 'planks', a: '#4b4238', b: '#6b5d4c', tile: 5, rough: 0.45 },
    floor: { kind: 'soft', a: '#1d3640', b: '#3d6676', tile: 14, rough: 0.25, metal: 0.1, opts: { blobs: 60, r: [30, 70] } },
    fx: [], beams: { color: '#000000', n: 0, strength: 0 }, mist: { color: '#c9d8e2', n: 7, strength: 0.22 }, props: 'harbor',
    skyline: { kind: 'town', far: '#46535c', near: '#2a343b' },
  },

  snow: {
    look: {
      sky: '#9db4cc', skyTop: '#4d6a8c', fogNear: 7, fogFar: 21,
      hemiSky: '#dcecff', hemiGround: '#4a5a70', hemi: 0.85, key: '#e6f1ff', keyI: 1.6,
      warm: '#9cc8ff', warmI: 14, warmPos: [0, 6, 1], exposure: 1.1,
      rim: '#8fb4cf', rimRough: 0.25, rimMetal: 0.1,
      accents: [{ color: '#8fc2ff', i: 16, pos: [-8, 3, -5], flicker: 0.1 }, { color: '#b7d4ff', i: 10, pos: [8, 4, -3], flicker: 0.1 }],
    },
    top: { kind: 'soft', a: '#8fa4ba', b: '#c6d6e6', tile: 6, rough: 0.95, opts: { sparkle: true } },
    floor: { kind: 'soft', a: '#b8c8d8', b: '#eef5fb', tile: 14, rough: 0.95, opts: { sparkle: true } },
    fx: [{ kind: 'snow', n: 200, color: '#ffffff', size: 0.16, additive: false }],
    beams: { color: '#cfe8ff', n: 2, strength: 0.08 }, mist: { color: '#e6f0fa', n: 6, strength: 0.2 }, props: 'snow',
    skyline: { kind: 'peaks', far: '#7f98b4', near: '#5d7490' },
  },

  crypt: {
    look: {
      sky: '#1a2a24', skyTop: '#070d0b', fogNear: 7, fogFar: 18,
      hemiSky: '#a9d4c0', hemiGround: '#0c1210', hemi: 0.5, key: '#bfe8d8', keyI: 1.1,
      warm: '#58ffb4', warmI: 10, warmPos: [0, 3, 0], exposure: 1.0,
      rim: '#1d201e', rimRough: 0.9, rimMetal: 0,
      accents: [{ color: '#4dffb0', i: 14, pos: [-7, 2, -5], flicker: 0.5 }, { color: '#4dffb0', i: 12, pos: [8, 2, 3], flicker: 0.5 }],
    },
    top: { kind: 'flagstone', a: '#3a3f3c', b: '#565d58', tile: 5, rough: 0.9, opts: { moss: true } },
    floor: { kind: 'flagstone', a: '#1a1e1c', b: '#2a302d', tile: 5, rough: 0.95, opts: { moss: true } },
    fx: [{ kind: 'wisps', n: 36, color: '#7dffc4', size: 0.5, additive: true }],
    beams: { color: '#c8f5e6', n: 2, strength: 0.07 }, mist: { color: '#4fa08a', n: 7, strength: 0.2 }, props: 'crypt',
    skyline: { kind: 'graves', far: '#16211d', near: '#0a100e' },
  },

  forge: {
    look: {
      sky: '#1a0a06', skyTop: '#0a0403', fogNear: 7, fogFar: 18,
      hemiSky: '#ff9a6a', hemiGround: '#1a0a05', hemi: 0.45, key: '#ff9560', keyI: 1.2,
      warm: '#ff5a1e', warmI: 26, warmPos: [0, 3, 0], exposure: 1.05,
      rim: '#1c1816', rimRough: 0.5, rimMetal: 0.35,
      accents: [{ color: '#ff5a1e', i: 30, pos: [-9, 2.5, -6], flicker: 0.5 }, { color: '#ff7a2e', i: 26, pos: [9, 2.5, -4], flicker: 0.5 }],
    },
    top: { kind: 'lava', a: '#2b2724', b: '#3d3631', glow: '#ff6a1e', tile: 6, rough: 0.85 },
    floor: { kind: 'lava', a: '#1a1614', b: '#2a2420', glow: '#ff5a1e', tile: 6, rough: 0.9 },
    fx: [{ kind: 'sparks', n: 120, color: '#ffb057', size: 0.12, additive: true }],
    beams: { color: '#000000', n: 0, strength: 0 }, mist: { color: '#3b2a22', n: 6, strength: 0.22 }, props: 'forge',
    skyline: { kind: 'stacks', far: '#2a1410', near: '#0d0605' },
  },

  forest: {
    look: {
      sky: '#335544', skyTop: '#12261c', fogNear: 9, fogFar: 24,
      hemiSky: '#d6ffd0', hemiGround: '#16301f', hemi: 0.65, key: '#fff2c0', keyI: 1.9,
      warm: '#9be58a', warmI: 14, warmPos: [0, 5, 1], exposure: 1.05,
      rim: '#4a3520', rimRough: 0.9, rimMetal: 0,
      accents: [{ color: '#9bff8a', i: 12, pos: [-8, 2, -4], flicker: 0.4 }, { color: '#8ad6ff', i: 10, pos: [8, 2, -5], flicker: 0.4 }],
    },
    top: { kind: 'moss', a: '#233c24', b: '#3f6532', tile: 5, rough: 1 },
    floor: { kind: 'moss', a: '#1c321d', b: '#2f5230', tile: 5, rough: 1 },
    fx: [
      { kind: 'fireflies', n: 60, color: '#d8ff7a', size: 0.2, additive: true },
      { kind: 'leaves', n: 36, color: '#b0c860', size: 0.24, additive: false },
    ],
    beams: { color: '#fff1b8', n: 4, strength: 0.12 }, mist: { color: '#9fd6b0', n: 6, strength: 0.16 }, props: 'forest',
    skyline: { kind: 'pines', far: '#1e3a2a', near: '#0f2218' },
  },

  fortress: {
    look: {
      sky: '#aab8c8', skyTop: '#5a7aa8', fogNear: 9, fogFar: 28,
      hemiSky: '#fff6e6', hemiGround: '#3b3226', hemi: 0.9, key: '#fff0d0', keyI: 1.9,
      warm: '#ffc890', warmI: 18, warmPos: [0, 6, 1], exposure: 1.1,
      rim: '#3c3a38', rimRough: 0.9, rimMetal: 0,
      accents: [{ color: '#ffb060', i: 16, pos: [-9, 3, -6], flicker: 0.35 }, { color: '#ffb060', i: 16, pos: [9, 3, -6], flicker: 0.35 }],
    },
    top: { kind: 'flagstone', a: '#4f4e4a', b: '#6a675f', tile: 5, rough: 0.9 },
    floor: { kind: 'flagstone', a: '#3a3a37', b: '#524f4a', tile: 5, rough: 0.95 },
    fx: [{ kind: 'motes', n: 70, color: '#fff0c8', size: 0.12, additive: true }],
    beams: { color: '#fff1c4', n: 3, strength: 0.12 }, mist: { color: '#dfe6ee', n: 4, strength: 0.1 }, props: 'fortress',
    skyline: { kind: 'castle', far: '#7686a0', near: '#3c4658' },
  },

  archive: {
    look: {
      sky: '#0f0c18', skyTop: '#06050c', fogNear: 10, fogFar: 26,
      hemiSky: '#cdbfff', hemiGround: '#1a1426', hemi: 0.6, key: '#e5d8ff', keyI: 1.4,
      warm: '#ffc78a', warmI: 26, warmPos: [0, 4, 2], exposure: 1.0,
      rim: '#2b1a10', rimRough: 0.45, rimMetal: 0.15,
      accents: [{ color: '#ffbf7a', i: 18, pos: [-8, 3, -5], flicker: 0.3 }, { color: '#b69cff', i: 14, pos: [8, 3, -5], flicker: 0.2 }],
    },
    top: { kind: 'leather', a: '#3c1626', b: '#c9a85a', tile: 5, rough: 0.7 },
    floor: { kind: 'planks', a: '#20150f', b: '#33231a', tile: 5, rough: 0.7 },
    fx: [{ kind: 'motes', n: 110, color: '#d8c8ff', size: 0.13, additive: true }],
    beams: { color: '#cfc2ff', n: 2, strength: 0.1 }, mist: null, props: 'archive',
    skyline: { kind: 'arches', far: '#17122a', near: '#0c0914' },
  },

  plains: {
    look: {
      sky: '#d9b987', skyTop: '#6f9ac8', fogNear: 11, fogFar: 30,
      hemiSky: '#fff4d8', hemiGround: '#3d3320', hemi: 0.9, key: '#ffd89a', keyI: 1.9,
      warm: '#ffbe70', warmI: 14, warmPos: [0, 6, 1], exposure: 1.1,
      rim: '#4d3a22', rimRough: 0.9, rimMetal: 0, accents: [none, none],
    },
    top: { kind: 'dirt', a: '#62502f', b: '#86703f', tile: 5, rough: 1 },
    floor: { kind: 'moss', a: '#4a6a30', b: '#7e9a46', tile: 5, rough: 1 },
    fx: [
      { kind: 'motes', n: 90, color: '#ffe6a8', size: 0.12, additive: true },
      { kind: 'leaves', n: 20, color: '#d8c070', size: 0.2, additive: false },
    ],
    beams: { color: '#ffe9b0', n: 3, strength: 0.12 }, mist: { color: '#f0d9a8', n: 4, strength: 0.1 }, props: 'plains',
    skyline: { kind: 'hills', far: '#8c9a70', near: '#5f7048' },
  },

  sky: {
    look: {
      sky: '#8fc1ee', skyTop: '#3b78c4', fogNear: 11, fogFar: 30,
      hemiSky: '#ffffff', hemiGround: '#7fa3c8', hemi: 0.95, key: '#fff6e0', keyI: 1.9,
      warm: '#ffe0b0', warmI: 10, warmPos: [0, 6, 1], exposure: 1.1,
      rim: '#6b4a2a', rimRough: 0.6, rimMetal: 0.1, accents: [none, none],
    },
    top: { kind: 'planks', a: '#6e5234', b: '#8f6e44', tile: 5, rough: 0.65 },
    floor: { kind: 'soft', a: '#d6e6f7', b: '#ffffff', tile: 16, rough: 1, opts: { blobs: 50, r: [40, 90] } },
    fx: [{ kind: 'motes', n: 50, color: '#ffffff', size: 0.1, additive: true }],
    beams: { color: '#fff7d8', n: 3, strength: 0.12 }, mist: { color: '#ffffff', n: 8, strength: 0.28 }, props: 'sky',
    skyline: { kind: 'clouds', far: '#dbe9f7', near: '#f3f8fd' },
  },
};

/** Which look each location has. Anything unlisted keeps the plain felt. */
const LOCATION_THEME: Record<string, ThemeId> = {
  'the-waystone-inn-rivermeet': 'tavern', 'the-goose-and-kettle': 'tavern', 'the-moot-hall': 'tavern',
  'old-kingsford-docks': 'harbor', 'parting-strand': 'harbor',
  'the-frostfells': 'snow',
  'the-barrowlands': 'crypt', 'tomb-of-the-first-wardens': 'crypt', 'barrowdeep': 'crypt', 'the-last-field': 'crypt', 'the-umbral-deep': 'crypt',
  'the-deep-forge-of-karrak': 'forge', 'the-old-quarry': 'forge', 'the-crack-in-the-marchstone': 'forge', 'gorewatch': 'forge',
  'the-storybook-glade': 'forest', 'the-silverwood-hunt': 'forest', 'the-memory-of-the-heartwood': 'forest', 'sylvaneth': 'forest',
  'the-hollow-hills': 'forest', 'the-hollow-between': 'forest', 'the-mirror-marches': 'forest', 'silverlake-at-midsummer': 'forest',
  'marchguard-keep': 'fortress', 'the-wardens-hall': 'fortress', 'the-well-of-oaths': 'fortress', 'the-field-of-oaths': 'fortress',
  'grimgate': 'fortress', 'kingsford': 'fortress', 'the-heart-of-the-marchstone': 'fortress', 'the-speaking-stones': 'fortress',
  'the-hearthlands-archive': 'archive', 'the-mage-college-vaults': 'archive', 'the-sealed-archive': 'archive',
  'the-collegium-observatory': 'archive', 'the-endless-stair': 'archive',
  'the-endless-road': 'plains', 'clover-hollow': 'plains', 'hearthmeadow': 'plains',
  'the-skyship-valour': 'sky', 'wreck-of-the-skyship-gallant': 'sky',
};

export const themeFor = (locationDef: string | null | undefined): ThemeId => (locationDef && LOCATION_THEME[locationDef]) || 'felt';
