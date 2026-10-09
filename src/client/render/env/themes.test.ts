import { describe, expect, it } from 'vitest';
import cards from '../../../data/cards.json';
import { FAMILIES, INDOOR_FX, LOCATION_IDS, THEMES, sharesFamilySky, themeFor, type ThemeId } from './themes';

const locationIds = cards.locations.map((l) => l.id);
const lookIds = Object.keys(THEMES) as ThemeId[];
const places = lookIds.filter((id) => id !== 'felt');

describe('location looks', () => {
  it('gives every location card a look of its own, and nothing else', () => {
    expect([...LOCATION_IDS].sort()).toEqual([...locationIds].sort());
    for (const id of locationIds) expect(themeFor(id), id).toBe(id);
    expect([...places].sort()).toEqual([...locationIds].sort());
  });

  it('falls back to the plain felt for no location or an unknown one', () => {
    expect(themeFor(null)).toBe('felt');
    expect(themeFor(undefined)).toBe('felt');
    expect(themeFor('no-such-place')).toBe('felt');
    expect(themeFor('constructor')).toBe('felt');
  });

  it('has a complete definition for every look, built from a family', () => {
    for (const [id, t] of Object.entries(THEMES)) {
      expect(t.look.fogFar, id).toBeGreaterThan(t.look.fogNear);
      expect(t.top.tile, id).toBeGreaterThan(0);
      expect(t.floor.tile, id).toBeGreaterThan(0);
      expect(t.look.accents, id).toHaveLength(2);
      expect(t.table.height, id).toBeGreaterThan(0);
      expect(FAMILIES[t.family], id).toBeDefined();
      expect(typeof t.indoors, id).toBe('boolean');
    }
  });

  it('gives no two places the same light', () => {
    const lights = places.map((id) => `${THEMES[id].look.sky}|${THEMES[id].look.key}|${THEMES[id].look.hemiSky}`);
    expect(new Set(lights).size).toBe(places.length);
  });

  it('never draws a painted silhouette ring: a place has a painting or a plain gradient sky', () => {
    for (const id of places) expect(THEMES[id].skyline, id).toBeNull();
  });
});

describe('indoors and outdoors', () => {
  it('puts the table inside a structure in exactly these places', () => {
    const indoors = places.filter((id) => THEMES[id].indoors).sort();
    expect(indoors).toEqual([
      'barrowdeep', 'the-collegium-observatory', 'the-deep-forge-of-karrak', 'the-endless-stair', 'the-goose-and-kettle',
      'the-hearthlands-archive', 'the-mage-college-vaults', 'the-sealed-archive', 'the-umbral-deep', 'the-wardens-hall',
      'tomb-of-the-first-wardens',
    ].sort());
  });

  it('lets only dust, smoke, sparks and the like drift indoors', () => {
    for (const id of places.filter((p) => THEMES[p].indoors)) {
      for (const f of THEMES[id].fx) expect(INDOOR_FX, `${id}: ${f.kind}`).toContain(f.kind);
      expect(THEMES[id].floorShape, id).toBeUndefined();
    }
  });

  it('lends its family sky only to a place with the same enclosure', () => {
    const own = places.filter((id) => !sharesFamilySky(id)).sort();
    // An indoor place in an outdoor family, or the other way round: each waits for a painting of its own.
    expect(own).toEqual([
      'barrowdeep', 'the-deep-forge-of-karrak', 'the-umbral-deep', 'the-wardens-hall', 'tomb-of-the-first-wardens',
    ].sort());
    expect(sharesFamilySky('the-goose-and-kettle')).toBe(true);
    expect(sharesFamilySky('the-barrowlands')).toBe(true);
    expect(sharesFamilySky('the-mage-college-vaults')).toBe(true);
  });
});

describe('tables and ground', () => {
  it('puts a table of its own on every place but the plain felt', () => {
    expect(THEMES.felt.table.kind).toBe('plain');
    for (const id of places) expect(THEMES[id].table.kind, id).not.toBe('plain');
  });

  it('stands every raised table on legs, a block or a base tall enough to look raised', () => {
    // A 19-unit-wide table with 3-unit legs looks like it lies on the floor. (A ship's deck and a skyship's sit low on purpose.)
    for (const id of places) {
      if (!['ship', 'skyship'].includes(THEMES[id].table.kind)) expect(THEMES[id].table.height, id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gives these places the table built for them', () => {
    const kinds = Object.fromEntries(places.map((id) => [id, THEMES[id].table.kind]));
    expect(kinds).toMatchObject({
      barrowdeep: 'dolmen', gorewatch: 'ironslab', kingsford: 'trestle', 'the-old-quarry': 'block', 'the-endless-stair': 'landing',
      'tomb-of-the-first-wardens': 'vault', 'the-deep-forge-of-karrak': 'anvil', 'the-goose-and-kettle': 'tavern',
    });
    // Runes glow along the Tomb's cornice and spirals on Barrowdeep's standing stones.
    expect(THEMES['tomb-of-the-first-wardens'].table.glow).toBeTruthy();
    expect(THEMES.barrowdeep.table.glow).toBeTruthy();
  });

  it('dresses altars with what grows in their place, and leaves natural rock bare', () => {
    for (const id of ['the-hollow-hills', 'sylvaneth', 'hearthmeadow', 'the-endless-road'] as const) expect(THEMES[id].table.cover, id).toBe('moss');
    expect(THEMES['the-storybook-glade'].table.cover).toBe('flowers');
    for (const id of ['the-umbral-deep', 'the-crack-in-the-marchstone', 'the-hollow-between', 'the-mirror-marches'] as const) {
      expect(THEMES[id].table.kind, id).toBe('altar');
      expect(THEMES[id].table.cover, id).toBeUndefined();
    }
    // The hall table carries no snow even though its family's altar does.
    expect(THEMES.grimgate.family).toBe('snow');
    expect(THEMES.grimgate.table).toMatchObject({ kind: 'hall' });
    expect(THEMES.grimgate.table.cover).toBeUndefined();
  });

  it('keeps the green desk top on honey wood for the Historical Society', () => {
    const t = THEMES['the-hearthlands-archive'];
    expect(t.top.kind).toBe('leather');
    expect(t.table.kind).toBe('study');
    expect(t.table.body?.a).toBe('#5a4026');
  });

  it('shapes the ground only where it is water, cloud or broken rock', () => {
    const shaped = Object.fromEntries(places.filter((id) => THEMES[id].floorShape).map((id) => [id, THEMES[id].floorShape]));
    expect(shaped).toEqual({
      'parting-strand': 'waves', 'the-skyship-valour': 'clouds', 'the-hollow-between': 'mirror', 'the-mirror-marches': 'mirror',
      'the-old-quarry': 'rock', 'the-crack-in-the-marchstone': 'rock', gorewatch: 'rock',
    });
  });

  it('lays the Deep Forge on worked stone with channels of molten metal, not jagged rock or magma', () => {
    const t = THEMES['the-deep-forge-of-karrak'];
    expect(t.floor).toMatchObject({ kind: 'channels', glow: '#e8561a' });
    expect(t.floorShape).toBeUndefined();
  });

  it('inlays runes in the Tomb floor, sigils in the Mage Vaults floor and cobbles in Kingsford', () => {
    expect(THEMES['tomb-of-the-first-wardens'].floor.opts?.glyphs).toBe('runes');
    expect(THEMES['the-mage-college-vaults'].floor.opts?.glyphs).toBe('sigils');
    expect(THEMES.kingsford.floor.kind).toBe('cobbles');
    for (const id of ['tomb-of-the-first-wardens', 'the-mage-college-vaults'] as const) expect(THEMES[id].floor.glow, id).toBeTruthy();
  });

  it('lets the Crack in the Marchstone glow pale gold, not fire-orange', () => {
    expect(THEMES['the-crack-in-the-marchstone'].floor).toMatchObject({ kind: 'magma', glow: '#ffe2a0' });
    expect(THEMES['the-old-quarry'].floor.kind).toBe('slab');
  });

  it('slides the sky where there is water or cloud to pass by, and rocks it only on the water', () => {
    expect(places.filter((id) => THEMES[id].skyScroll).sort()).toEqual(['parting-strand', 'the-skyship-valour']);
    expect(places.filter((id) => THEMES[id].sway)).toEqual(['parting-strand']);
  });
});

describe('weather', () => {
  it('gives each of the new kinds of weather to the places it was made for', () => {
    const used = (kind: string): string[] => places.filter((id) => THEMES[id].fx.some((f) => f.kind === kind)).sort();
    expect(used('petals')).toEqual(['the-storybook-glade']);
    expect(used('butterflies')).toEqual(['clover-hollow', 'the-storybook-glade']);
    expect(used('lanterns')).toEqual(['silverlake-at-midsummer']);
    expect(used('ash')).toEqual(['gorewatch']);
    expect(used('ripples')).toEqual(['the-hollow-between', 'the-mirror-marches', 'the-umbral-deep']);
    expect(used('shootingstar')).toEqual(['the-collegium-observatory']);
    expect(used('page')).toEqual(['the-sealed-archive']);
  });

  it('names tint ranges as hex colours', () => {
    for (const id of places) for (const f of THEMES[id].fx) for (const c of f.tint ?? []) expect(c, `${id}: ${f.kind}`).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('families', () => {
  it('uses every family but the felt for at least one location', () => {
    const used = new Set(places.map((id) => THEMES[id].family));
    for (const f of Object.keys(FAMILIES)) if (f !== 'felt') expect(used.has(f as never), f).toBe(true);
  });
});
