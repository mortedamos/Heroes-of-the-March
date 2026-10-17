import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import cards from '../../../data/cards.json';
import { FAMILIES, INDOOR_FX, LOCATION_IDS, THEMES, driftingFog, sharesFamilySky, themeFor, type ThemeId } from './themes';

const locationIds = cards.locations.map((l) => l.id);
const lookIds = Object.keys(THEMES) as ThemeId[];
const places = lookIds.filter((id) => id !== 'felt');

describe('location looks', () => {
  it('imports only types, so the scripts that read it can run it under plain Node', () => {
    const source = readFileSync('src/client/render/env/themes.ts', 'utf8');
    const imports = source.split(/\r?\n/).filter((l) => /^import\s/.test(l));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line, line).toMatch(/^import type\s/);
  });

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

  it('shapes the ground only where it is water, cloud, broken rock or swamp', () => {
    const shaped = Object.fromEntries(places.filter((id) => THEMES[id].floorShape).map((id) => [id, THEMES[id].floorShape]));
    expect(shaped).toEqual({
      'the-skyship-valour': 'clouds', 'the-hollow-between': 'mirror', 'the-mirror-marches': 'mirror', 'silverlake-at-midsummer': 'lake',
      'the-old-quarry': 'rock', gorewatch: 'bog',
    });
  });

  it('lays Gorewatch in a swamp of hammocks and marsh grass, not red earth', () => {
    const t = THEMES.gorewatch;
    expect(t.floor.kind).toBe('swamp');
    expect(t.floorShape).toBe('bog');
    expect(t.grass?.clumps).toBeGreaterThan(0);
    // The only swamp there is, with drifting fog and fireflies twinkling over its grass.
    expect(places.filter((id) => THEMES[id].grass?.swamp)).toEqual(['gorewatch']);
    expect(t.fog?.patches).toBeGreaterThan(0);
    expect(t.fx.some((f) => f.kind === 'fireflies')).toBe(true);
    // Dark water first, then a green land: neither is the red of the earth it had.
    const rg = (c: string): [number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16)];
    const [waterR, waterG] = rg(t.floor.a);
    const [landR, landG] = rg(t.floor.b);
    expect(waterG).toBeGreaterThanOrEqual(waterR);
    expect(landG).toBeGreaterThan(landR);
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

  it('slides the sky where there is cloud to pass by, and rocks nothing: no place has a sea any more', () => {
    expect(places.filter((id) => THEMES[id].skyScroll).sort()).toEqual(['the-skyship-valour']);
    expect(places.filter((id) => THEMES[id].sway)).toEqual([]);
  });
});

/** The fifteen places that were changed on 2026-10-16: what each now has. */
describe('the places given new ground, grass, trees, fog and furniture', () => {
  const rg = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

  it('lays The Endless Road in old worn paving, with nothing polished and nothing carved', () => {
    const f = THEMES['the-endless-road'].floor;
    expect(f.kind).toBe('paving');
    expect(f.opts?.glyphs).toBeUndefined();
    expect(f.glow).toBeUndefined();
  });

  it('puts other tables, chairs, mugs and lanterns in the distance at the Goose & Kettle', () => {
    expect(THEMES['the-goose-and-kettle'].tavernware?.tables).toBeGreaterThanOrEqual(6);
    for (const id of places) if (id !== 'the-goose-and-kettle') expect(THEMES[id].tavernware, id).toBeUndefined();
  });

  it('shows the Goose & Kettle room smaller than it was painted, so the table does not look tiny in a giant hall', () => {
    const scale = THEMES['the-goose-and-kettle'].skyScale!;
    expect(scale).toBeGreaterThan(0.3);
    expect(scale).toBeLessThan(0.5);
    for (const id of places) if (id !== 'the-goose-and-kettle') expect(THEMES[id].skyScale, id).toBeUndefined();
  });

  it('makes Parting Strand a beach of loose grey stone: no waves, no rocking, no sliding sky', () => {
    const t = THEMES['parting-strand'];
    expect(t.floor.kind).toBe('pebbles');
    expect(t.floorShape).toBeUndefined();
    expect(t.sway).toBeUndefined();
    expect(t.skyScroll).toBeUndefined();
    // Grey: no colour of the stone leans far from it.
    for (const c of [t.floor.a, t.floor.b]) { const [r, g, b] = rg(c); expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(24); }
  });

  it('drifts patches of fog through the Barrowlands, Barrowdeep and the Umbral Deep, and drips water in the Deep', () => {
    for (const id of ['the-barrowlands', 'barrowdeep', 'the-umbral-deep'] as const) expect(THEMES[id].fog?.patches, id).toBeGreaterThan(0);
    const drips = places.filter((id) => THEMES[id].fx.some((f) => f.kind === 'drips'));
    expect(drips).toEqual(['the-umbral-deep']);
    expect(THEMES['the-umbral-deep'].fx.find((f) => f.kind === 'drips')!.n).toBeGreaterThan(THEMES['the-umbral-deep'].fx.find((f) => f.kind === 'ripples')!.n);
    expect(INDOOR_FX).toContain('drips');
  });

  it('lays Barrowdeep on the warm grey-brown earth of the painted passage, warm enough to stay brown under its blue light', () => {
    const f = THEMES.barrowdeep.floor;
    for (const c of [f.a, f.b]) { const [r, , b] = rg(c); expect(r - b, c).toBeGreaterThanOrEqual(24); }
  });

  it('keeps the Old Quarry floor to the dark brown of the ground nearest the painted rim', () => {
    const f = THEMES['the-old-quarry'].floor;
    for (const c of [f.a, f.b]) { const [r, , b] = rg(c); expect(r, c).toBeGreaterThan(b); expect(r, c).toBeLessThan(110); }
  });

  it('makes the Crack in the Marchstone a grassy field with long grass', () => {
    const t = THEMES['the-crack-in-the-marchstone'];
    expect(t.floor.kind).toBe('moss');
    expect(t.floor.glow === undefined || t.floor.kind !== 'magma').toBe(true);
    expect(t.floorShape).toBeUndefined();
    expect(t.grass?.clumps).toBeGreaterThan(1000);
  });

  it('plants the Glade, Silverwood and Sylvaneth with trees from the models and thinner grass than the swamp, the last two with fog', () => {
    const swamp = THEMES.gorewatch.grass!.clumps;
    for (const id of ['the-storybook-glade', 'the-silverwood-hunt', 'sylvaneth'] as const) {
      const t = THEMES[id];
      expect(t.trees?.count, id).toBeGreaterThan(5);
      expect(t.grass?.clumps, id).toBeLessThan(swamp);
      expect(t.grass?.clumps, id).toBeGreaterThan(300);
      // Every model a place asks for is in public/models.
      for (const k of t.trees!.kinds) expect(existsSync(`public/models/${k.file}`), `${id}: ${k.file}`).toBe(true);
    }
    expect(THEMES['the-silverwood-hunt'].trees!.kinds.map((k) => k.file)).toEqual(['Pine_Tree.fbx']);
    for (const id of ['the-silverwood-hunt', 'sylvaneth'] as const) expect(THEMES[id].fog?.patches, id).toBeGreaterThan(0);
  });

  it('lets the Hollow Hills run overgrown: the thickest and tallest grass, up close to the table', () => {
    const g = THEMES['the-hollow-hills'].grass!;
    for (const id of places) if (id !== 'the-hollow-hills' && THEMES[id].grass) {
      expect(g.clumps, id).toBeGreaterThan(THEMES[id].grass!.clumps);
      expect(g.tall ?? 1, id).toBeGreaterThanOrEqual(THEMES[id].grass!.tall ?? 1);
    }
    expect(g.reach![0]).toBeLessThan(15);
  });

  it('drifts twice the usual fog over the Hollow Between and the Mirror Mire', () => {
    const usual = driftingFog('#ffffff');
    for (const id of ['the-hollow-between', 'the-mirror-marches'] as const) {
      expect(THEMES[id].fog!.patches, id).toBe(usual.patches * 2);
      expect(THEMES[id].fog!.strength, id).toBeGreaterThan(usual.strength);
    }
    // And nowhere else has that much.
    for (const id of places) if (THEMES[id].fog && id !== 'the-hollow-between' && id !== 'the-mirror-marches' && id !== 'gorewatch') expect(THEMES[id].fog!.patches, id).toBeLessThanOrEqual(usual.patches);
  });

  it('shows the Mirror Mire with no fog and a haze of 1.5 until the player says otherwise, and mirrors the trees about the painted waterline', () => {
    const t = THEMES['the-mirror-marches'];
    expect(t.view).toEqual({ fog: 0, haze: 1.5 });
    expect(t.mirrorLine).toBeGreaterThan(0);
    for (const id of places) if (id !== 'the-mirror-marches') expect(THEMES[id].view, id).toBeUndefined();
  });

  it('makes Silverlake a lake of gentle moving water in the dark indigo of the painted one', () => {
    const t = THEMES['silverlake-at-midsummer'];
    expect(t.floorShape).toBe('lake');
    for (const c of [t.floor.a, t.floor.b]) { const [r, , b] = rg(c); expect(b, c).toBeGreaterThan(r); expect(b, c).toBeLessThan(120); }
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
