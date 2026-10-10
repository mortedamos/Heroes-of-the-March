// Sound-effect and location-music tracker.
//   npm run sfx
// Looks at public/sounds, compares it with data/sfx-catalog.json and writes:
//   public/sounds/manifest.json   what the game may load (no entry = no request = no 404)
//   docs/SFX-TRACKER.md           what you have and what you still need (markdown)
//   public/music/manifest.json    which location tracks exist (no entry = neutral music plays, no request, no 404)
//   tools/sfx-data.js             the same data for tools/sfx-tracker.html (open it in a browser to see and play your sounds)
//
// A sound is `name.mp3` or up to three variants `name_1.mp3`, `name_2.mp3`, `name_3.mp3`
// (a - works as well as _, and .ogg, .wav and .webm also work).

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAMILIES, THEMES, themeFor } from '../src/client/render/env/themes.ts';
import { GAME_MUSIC, LOCATION_MOOD, LOCATION_PROMPT, SUNO_EXCLUDE } from './sfx-moods.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const DIR = join(root, 'public', 'sounds');
const MAX_VARIANTS = 3;
const MUSIC_DIR = join(root, 'public', 'music', 'locations');
const AMB_DIR = join(root, 'public', 'ambience');
const EXT = /\.(mp3|ogg|wav|webm)$/i;

interface Entry { name: string; group: string; length: string; priority: boolean; wired: boolean; plays: string; search: string; ambience?: boolean; look?: string }
const catalog = (JSON.parse(readFileSync(join(root, 'data', 'sfx-catalog.json'), 'utf8')) as { sounds: Entry[] }).sounds;
const names = new Set(catalog.filter((c) => !c.ambience).map((c) => c.name));

const files = readdirSync(DIR).filter((f) => EXT.test(f)).sort();
const found = new Map<string, { file: string; n: number }[]>();
const unknown: string[] = [];
const extra: string[] = [];
for (const f of files) {
  // Names may use - or _ (card-flip_1.mp3, card_flip_2.mp3); a trailing -1 / _1 is the variant number.
  const stem = f.replace(EXT, '').replace(/_/g, '-').toLowerCase();
  let name = stem;
  let n = 0;
  if (!names.has(stem)) {
    const m = /^(.+)-([1-9])$/.exec(stem);
    if (m && names.has(m[1]!)) { name = m[1]!; n = Number(m[2]); } else { unknown.push(f); continue; }
  }
  if (n > MAX_VARIANTS) { extra.push(f); continue; }
  const list = found.get(name) ?? [];
  list.push({ file: f, n });
  found.set(name, list);
}

const manifest: Record<string, string[]> = {};
for (const c of catalog) {
  const list = found.get(c.name);
  if (list) manifest[c.name] = list.sort((a, b) => a.n - b.n).slice(0, MAX_VARIANTS).map((x) => x.file);
}

// --- place sounds: public/ambience/<place>-background_1..3.mp3 (the slot in the catalog), or any other <place>_*.mp3 / any_*.mp3 ---
// A place is a location id (the-goose-and-kettle), a family of places that stands in for locations with no sounds of their own
// (tavern, forest...), felt or any. Location ids contain dashes, so the place is the longest one the file name starts with.
mkdirSync(AMB_DIR, { recursive: true });
const ambLooks = new Set([...Object.keys(THEMES), ...Object.keys(FAMILIES), 'any']);
const placeOf = (file: string): string | undefined => {
  const stem = file.toLowerCase().replace(/_/g, '-');
  return [...ambLooks].filter((p) => stem.startsWith(`${p}-`)).sort((a, b) => b.length - a.length)[0];
};
const ambSlots = new Set(catalog.filter((c) => c.ambience).map((c) => c.name));
const ambFound = new Map<string, { file: string; n: number }[]>();
const ambExtra: string[] = [];
const ambManifest: Record<string, string[]> = {};
const ambUnknown: string[] = [];
for (const f of readdirSync(AMB_DIR).filter((x) => EXT.test(x)).sort()) {
  const stem = f.replace(EXT, '').replace(/_/g, '-').toLowerCase();
  let name = stem;
  let n = 0;
  const m = /^(.+)-([1-9])$/.exec(stem);
  if (!ambSlots.has(stem) && m && ambSlots.has(m[1]!)) { name = m[1]!; n = Number(m[2]); }
  const look = placeOf(f);
  if (!look) { ambUnknown.push(f); continue; }
  (ambManifest[look] ??= []).push(f);
  if (ambSlots.has(name)) {
    if (n > MAX_VARIANTS) { extra.push(f); continue; }
    const list = ambFound.get(name) ?? [];
    list.push({ file: 'ambience/' + f, n });
    ambFound.set(name, list);
  } else ambExtra.push(f);
}
writeFileSync(join(AMB_DIR, 'manifest.json'), `${JSON.stringify(ambManifest, null, 2)}\n`);
// In the tracker the files of a place sound are shown under their slot (paths start with ambience/).
for (const [name, list] of ambFound) manifest[name] = list.sort((a, b) => a.n - b.n).slice(0, MAX_VARIANTS).map((x) => x.file);

// --- location music: public/music/locations/<location-id>.mp3 ----------------------
const MOOD: Record<string, string> = {
  felt: 'fantasy tavern-table ambience',
  tavern: 'cosy medieval tavern, lute and fiddle, warm folk',
  harbor: 'misty harbour, low strings, sea shanty undertone, melancholy',
  snow: 'arctic winter, sparse piano and choir pads, cold wind',
  crypt: 'dark ambient crypt, eerie choir, low drones, dread',
  forge: 'dwarven forge, heavy percussion, anvil rhythm, brass',
  forest: 'enchanted forest, flutes, harp, gentle mystery',
  fortress: 'noble castle, stately brass and strings, heroic march',
  archive: 'candlelit library, harpsichord and soft strings, scholarly mystery',
  plains: 'pastoral road, acoustic guitar, whistle, golden-hour journey',
  sky: 'airship voyage, soaring strings, adventurous wonder',
};
const locations = (JSON.parse(readFileSync(join(root, 'src', 'data', 'cards.json'), 'utf8')) as { locations: { id: string; name: string }[] }).locations;
const locIds = new Set(locations.map((l) => l.id));
const musicFiles = readdirSync(MUSIC_DIR, { withFileTypes: true }).filter((f) => f.isFile() && EXT.test(f.name)).map((f) => f.name).sort();
const musicManifest: Record<string, string> = {};
const musicUnknown: string[] = [];
for (const f of musicFiles) {
  const id = f.replace(EXT, '').replace(/_/g, '-').toLowerCase();
  if (locIds.has(id)) musicManifest[id] ??= `locations/${f}`; else musicUnknown.push(f);
}
// The tracks that belong to no place (title, drafts, neutral playlist): public/music/<file>, named as src/client/audio/Music.ts asks for them.
const topMusic = new Set(readdirSync(join(root, 'public', 'music')).filter((f) => EXT.test(f)));
const gameMusic = GAME_MUSIC.map((t) => ({ ...t, have: topMusic.has(t.file), path: `music/${t.file}` }));
const musicOther = [...topMusic].filter((f) => !GAME_MUSIC.some((t) => t.file === f)).sort();
// One row per location for the tracker: its music, and its own place sounds (the `<id>-background` slot).
const music = locations.map((l) => {
  const look = THEMES[themeFor(l.id)];
  const slot = `${l.id}-background`;
  return {
    id: l.id, name: l.name, theme: look.family, indoors: look.indoors,
    mood: LOCATION_MOOD[l.id] ?? MOOD[look.family] ?? '', prompt: LOCATION_PROMPT[l.id] ?? '',
    have: Boolean(musicManifest[l.id]), file: musicManifest[l.id] ? `music/${musicManifest[l.id]}` : null,
    slot, placeSounds: manifest[slot] ?? [],
  };
});
writeFileSync(join(root, 'public', 'music', 'manifest.json'), `${JSON.stringify({ locations: musicManifest }, null, 2)}\n`);

// tools/ and docs/ are not in the repository (they are git-ignored), so a fresh checkout, such as
// the one the deploy workflow builds from, does not have them yet.
mkdirSync(join(root, 'tools'), { recursive: true });
mkdirSync(join(root, 'docs'), { recursive: true });
// public/sounds/manifest.json is for the game's effects only; place sounds have their own manifest (public/ambience).
writeFileSync(join(DIR, 'manifest.json'), `${JSON.stringify(Object.fromEntries(Object.entries(manifest).filter(([k]) => !ambSlots.has(k))), null, 2)}\n`);
// A plain script (not JSON) so tools/sfx-tracker.html also works when opened straight from disk.
writeFileSync(join(root, 'tools', 'sfx-data.js'), `window.SFX = ${JSON.stringify({ maxVariants: MAX_VARIANTS, catalog, manifest, unknown, extra, music, gameMusic, musicOther, sunoExclude: SUNO_EXCLUDE, musicUnknown, ambExtra, ambUnknown })};\n`);

// --- the tracker ---------------------------------------------------------------
const have = catalog.filter((c) => manifest[c.name]);
const priority = catalog.filter((c) => c.priority);
const mark = (c: Entry): string => {
  const v = manifest[c.name]?.length ?? 0;
  return v === 0 ? '❌ missing' : v >= MAX_VARIANTS ? `✅ ${v}/${MAX_VARIANTS}` : `🟡 ${v}/${MAX_VARIANTS} variants`;
};
let md = '# Sound effects tracker\n\n';
md += '_Generated by `npm run sfx` from `public/sounds` and `data/sfx-catalog.json`. Do not edit by hand._\n\n';
md += `**${have.length} of ${catalog.length}** sounds present. Priority sounds (★): **${priority.filter((c) => manifest[c.name]).length} of ${priority.length}**. `;
md += `Wired into the game: **${catalog.filter((c) => c.wired).length}** (the rest are listed so you can find them now; they play once the game uses them).\n\n`;
md += 'Name files `name.mp3`, or `name_1.mp3` to `name_3.mp3` for up to three variants chosen at random. A sound that is not in the manifest is never requested, so a missing file causes no error.\n\n';
md += '**Place sounds** (the groups `Place sounds` and `Place sounds by location`) go in `public/ambience/` instead: three per place, named like `the-goose-and-kettle-background_1.mp3` to `_3`, or `fortress-background_1.mp3` for a whole family of places. While the camera is lifted away from the board, the music drops to 25% and now and then one sound for the place on the table drifts in. A location plays its own sounds, or its family\'s when it has none. Any other file starting with a place name (`forest_wind2.mp3`) or `any_` also plays there.\n\n';
for (const group of [...new Set(catalog.map((c) => c.group))]) {
  md += `## ${group}\n\n| Sound | Status | Plays in game | When | Length | Search for | ★ |\n|---|---|---|---|---|---|---|\n`;
  for (const c of catalog.filter((x) => x.group === group)) {
    md += `| \`${c.name}\` | ${mark(c)} | ${c.wired ? 'yes' : 'not yet'} | ${c.plays} | ${c.length} | ${c.search} | ${c.priority ? '★' : ''} |\n`;
  }
  md += '\n';
}
const missingPriority = priority.filter((c) => !manifest[c.name]);
md += '## Next to find\n\n';
md += missingPriority.length ? missingPriority.map((c) => `- \`${c.name}\`: ${c.plays} (${c.length})`).join('\n') : 'All priority sounds are present.';
md += '\n';
if (unknown.length) md += `\n## Files not in the catalog\n\n${unknown.map((f) => `- \`${f}\` (rename it, or add it to \`data/sfx-catalog.json\`)`).join('\n')}\n`;
if (ambExtra.length) md += `\n## Extra place sounds (not a slot above, but they play for their look)\n\n${ambExtra.map((f) => `- \`${f}\``).join('\n')}\n`;
if (ambUnknown.length) md += `\n## Files in public/ambience that start with no look name\n\n${ambUnknown.map((f) => `- \`${f}\` (rename it to start with a location id, a family: tavern, harbor, snow, crypt, forge, forest, fortress, archive, plains, sky, felt, or any)`).join('\n')}\n`;
if (extra.length) md += `\n## Ignored: more than ${MAX_VARIANTS} variants\n\n${extra.map((f) => `- \`${f}\``).join('\n')}\n`;

md += '\n# Music\n\n';
md += `**${gameMusic.filter((t) => t.have).length} of ${gameMusic.length}** game tracks present: the ones that belong to no place. Each location's own track is listed under Location music below. To add a game track, add it to \`TRACKS\` in \`src/client/audio/Music.ts\` and to \`GAME_MUSIC\` in \`scripts/sfx-moods.ts\`.\n\n`;
md += '| Track | File | Plays when | Status |\n|---|---|---|---|\n';
for (const t of gameMusic) md += `| ${t.label} | \`${t.file}\` | ${t.plays} | ${t.have ? '✅' : '❌ missing'} |\n`;
if (musicOther.length) md += `\nFiles in public/music that the game does not play: ${musicOther.map((f) => '`' + f + '`').join(', ')} (add them to \`TRACKS\` in \`Music.ts\`, or remove them).\n`;
md += '\n# Location music\n\n';
md += `_Each location can have its own track: \`public/music/locations/<location-id>.mp3\`. It loops while that location is on the table. The brief is a starting point for finding one, drawn from \`docs/LOCATION-LOOKS.md\`. A location without a track plays the next neutral track instead (\`neutral_music_*.mp3\`). A missing file is never requested, so there is no error._\n\n`;
md += `**${music.filter((m) => m.have).length} of ${music.length}** locations have their own track.\n\n`;
for (const theme of [...new Set(music.map((m) => m.theme))]) {
  md += `## ${theme}\n\n| Location | In/Out | Music file | Music | Place sounds | Music brief |\n|---|---|---|---|---|---|\n`;
  for (const m of music.filter((x) => x.theme === theme)) {
    const n = m.placeSounds.length;
    md += `| ${m.name} | ${m.indoors ? 'In' : 'Out'} | \`${m.id}.mp3\` | ${m.have ? '✅' : '❌ neutral'} | ${n === 0 ? `❌ ${theme}'s` : n >= MAX_VARIANTS ? `✅ ${n}/${MAX_VARIANTS}` : `🟡 ${n}/${MAX_VARIANTS}`} | ${m.mood} |\n`;
  }
  md += '\n';
}
if (musicUnknown.length) md += `## Music files that match no location\n\n${musicUnknown.map((f) => `- \`${f}\` (rename it to a location id)`).join('\n')}\n`;
writeFileSync(join(root, 'docs', 'SFX-TRACKER.md'), md);

console.log(`music: ${gameMusic.filter((t) => t.have).length}/${gameMusic.length} game tracks, ${music.filter((m) => m.have).length}/${music.length} locations have their own track`);
if (musicOther.length) console.log(`  music files the game does not play: ${musicOther.join(', ')}`);
if (musicUnknown.length) console.log(`  music files matching no location: ${musicUnknown.join(', ')}`);
console.log(`sfx: ${have.length}/${catalog.length} present (${priority.filter((c) => manifest[c.name]).length}/${priority.length} priority). Wrote manifest.json, docs/SFX-TRACKER.md and tools/sfx-data.js`);
if (unknown.length) console.log(`  not in the catalog: ${unknown.join(', ')}`);
if (extra.length) console.log(`  ignored (over ${MAX_VARIANTS} variants): ${extra.join(', ')}`);
