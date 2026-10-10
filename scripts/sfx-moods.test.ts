import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAME_MUSIC, LOCATION_MOOD, LOCATION_PROMPT, SUNO_EXCLUDE } from './sfx-moods.ts';

const locations = (JSON.parse(readFileSync(new URL('../src/data/cards.json', import.meta.url), 'utf8')) as { locations: { id: string }[] }).locations;
const catalog = (JSON.parse(readFileSync(new URL('../data/sfx-catalog.json', import.meta.url), 'utf8')) as { sounds: { name: string; look?: string; ambience?: boolean }[] }).sounds;

describe('the music the tracker lists', () => {
  const source = readFileSync(new URL('../src/client/audio/Music.ts', import.meta.url), 'utf8');
  const quoted = (re: RegExp): string[] => [...(re.exec(source)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!);

  it('lists the tracks Music.ts plays besides the location ones, no more and no fewer', () => {
    const inGame = [...quoted(/TRACKS = \[([^\]]*)\]/), ...quoted(/TITLE_TRACK = ([^;]*);/), ...quoted(/OPENING_TRACK = ([^;]*);/)];
    expect(inGame.length).toBeGreaterThanOrEqual(5);
    expect(GAME_MUSIC.map((t) => t.file).sort()).toEqual(inGame.sort());
  });
});

describe('what each location needs to sound like', () => {
  it('has a music brief for every location, and none for a place that does not exist', () => {
    const ids = locations.map((l) => l.id).sort();
    expect(Object.keys(LOCATION_MOOD).sort()).toEqual(ids);
    for (const brief of Object.values(LOCATION_MOOD)) expect(brief.length).toBeGreaterThan(20);
  });

  it('keeps each Suno prompt for a real location, instrumental, and inside the style box limit', () => {
    const ids = new Set(locations.map((l) => l.id));
    for (const [id, prompt] of Object.entries(LOCATION_PROMPT)) {
      expect(ids.has(id), id).toBe(true);
      expect(prompt.toLowerCase(), id).toContain('instrumental');
      expect(prompt.length, id).toBeLessThanOrEqual(1000);
    }
  });

  it('has a Suno prompt for every location, each an instrumental that stays in the background', () => {
    expect(Object.keys(LOCATION_PROMPT).sort()).toEqual(locations.map((l) => l.id).sort());
    for (const [id, prompt] of Object.entries(LOCATION_PROMPT)) {
      const p = prompt.toLowerCase();
      expect(p, id).toContain('no vocals');
      // Asking Suno for a loop or for no ending makes it stop the track dead, so a prompt must not say either (the loop point is made when editing).
      expect(p, id).not.toMatch(/loop|no ending/);
      expect(p, id).toContain('1-5-6-5'); // the March motif is in every track
      // The Crack in the Marchstone was kept as first written, which the user liked; every other prompt says it in so many words.
      if (id !== 'the-crack-in-the-marchstone') expect(p, id).toContain('no crescendo');
    }
  });

  it('keeps the accordion out of every brief and prompt, and in the exclude list', () => {
    for (const text of [...Object.values(LOCATION_MOOD), ...Object.values(LOCATION_PROMPT), ...GAME_MUSIC.map((t) => t.brief)]) {
      expect(text.toLowerCase()).not.toContain('accordion');
    }
    expect(SUNO_EXCLUDE).toContain('accordion');
    expect(SUNO_EXCLUDE).not.toContain('fade out'); // excluding a fade makes Suno cut the track off
  });

  it('has a place-sound slot in the catalog for every location', () => {
    for (const l of locations) {
      const slot = catalog.find((c) => c.ambience && c.name === `${l.id}-background`);
      expect(slot, `${l.id}-background`).toBeDefined();
      expect(slot?.look).toBe(l.id);
    }
  });
});
