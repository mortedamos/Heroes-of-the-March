import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import cards from '../src/data/cards.json';
import { buildPrompt, findImage, imageInfo, parseBrief, RATIOS, SIZES } from './skies-lib.ts';

const brief = parseBrief(readFileSync(new URL('../art/SKYBOX-BRIEF-LOCATIONS.md', import.meta.url), 'utf8'));
const locationIds = new Set(cards.locations.map((l) => l.id));

describe('the sky painting brief', () => {
  it('lists 26 paintings: 9 indoors and 17 outdoors', () => {
    expect(brief).toHaveLength(26);
    expect(brief.filter((b) => b.kind === 'indoor')).toHaveLength(9);
    expect(brief.filter((b) => b.kind === 'outdoor')).toHaveLength(17);
  });

  it('names each painting after a location, once', () => {
    const ids = brief.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(locationIds.has(id), id).toBe(true);
  });

  it('describes every painting', () => {
    for (const b of brief) expect(b.scene.length, b.id).toBeGreaterThan(40);
  });

  it('paints the places that are indoors indoors', () => {
    const indoor = brief.filter((b) => b.kind === 'indoor').map((b) => b.id).sort();
    expect(indoor).toEqual([
      'barrowdeep', 'the-collegium-observatory', 'the-deep-forge-of-karrak', 'the-endless-stair', 'the-hearthlands-archive',
      'the-sealed-archive', 'the-umbral-deep', 'the-wardens-hall', 'tomb-of-the-first-wardens',
    ]);
  });
});

describe('prompts', () => {
  const room = brief.find((b) => b.kind === 'indoor')!;
  const land = brief.find((b) => b.kind === 'outdoor')!;

  it('carry the scene and keep characters, text and tables out', () => {
    for (const b of [room, land]) {
      const p = buildPrompt(b);
      expect(p).toContain(b.scene.replace(/\.$/, ''));
      expect(p).toMatch(/no characters/i);
      expect(p).toMatch(/no text/i);
      expect(p).toMatch(/no table/i);
    }
  });

  it('put the horizon near the bottom edge, and ask for a room or a landscape', () => {
    expect(buildPrompt(room)).toMatch(/inside of a room/);
    expect(buildPrompt(land)).toMatch(/horizon/);
    for (const b of [room, land]) expect(buildPrompt(b)).toMatch(/10% up from the bottom edge/);
  });
});

describe('asking for pictures', () => {
  it('asks for the widest shape first, and for the size that is enough first', () => {
    expect(RATIOS[0]).toBe('4:1');
    expect(RATIOS).toContain('21:9');
    expect(SIZES[0]).toBe('2K');
  });

  it('finds the picture whatever shape the reply is', () => {
    const jpeg = '/9j/' + 'A'.repeat(5000);
    const png = 'iVBORw0KGgo' + 'A'.repeat(5000);
    expect(findImage({ output_image: { data: png, mime_type: 'image/png' } })).toEqual({ data: png, mime: 'image/png' });
    expect(findImage({ candidates: [{ content: { parts: [{ text: 'hi' }, { inlineData: { mimeType: 'image/jpeg', data: jpeg } }] } }] })).toEqual({ data: jpeg, mime: 'image/jpeg' });
    expect(findImage({ steps: [{ type: 'model_output', content: [{ type: 'image', data: jpeg }] }] })).toEqual({ data: jpeg, mime: 'image/jpeg' });
  });

  it('takes the picture, not a longer string that is not one', () => {
    const jpeg = '/9j/' + 'A'.repeat(5000);
    const signature = 'EvQBCvEBAXLI' + 'B'.repeat(20000);
    expect(findImage({ steps: [{ signature }, { content: [{ data: jpeg }] }] })).toEqual({ data: jpeg, mime: 'image/jpeg' });
    expect(findImage({ steps: [{ signature }] })).toBeNull();
  });

  it('finds no picture in a reply without one', () => {
    expect(findImage({ error: { message: 'no' } })).toBeNull();
    expect(findImage(null)).toBeNull();
    expect(findImage({ text: 'x'.repeat(5000) + ' not base64!' })).toBeNull();
  });

  it('reads the size of a PNG and a JPEG from the header', () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 4096);
    new DataView(png.buffer).setUint32(20, 1024);
    expect(imageInfo(png)).toEqual({ width: 4096, height: 1024, type: 'png' });

    // SOI, an APP0 segment of length 6, then a baseline frame header: precision 8, height 1024, width 4096.
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 0, 0, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x00, 0x10, 0x00, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(imageInfo(jpg)).toEqual({ width: 4096, height: 1024, type: 'jpeg' });
    expect(imageInfo(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  });
});
