// One-off: applies the designer's fourth card-sheet pass of 2026-10-15 (v0.8) to src/data/cards.json.
//   - Barnaby is 2/6/4 and uses his maps during bidding; Oskar's Book of Grudges no longer names an opponent (heroes or resources);
//     Tansy draws when a Halfellow card is among the face-down cards she looks at;
//   - Gnash gets Nemesis: Elf, Pell Nemesis: Wardhouse, Nettle Allied: Halfellow.
// Only the Heroes tab changed. The sheet still writes "Capitol" for the location tag, which is "Capital" everywhere else; it is normalised here.
// Idempotent: it refuses to run on a v0.8 file. Usage: node scripts/apply-sheet-pass-d.mjs <heroes.json>

import { readFileSync, writeFileSync } from 'node:fs';

const DB = 'src/data/cards.json';
const db = JSON.parse(readFileSync(DB, 'utf8'));
if (db.version === 'v0.8') { console.log('already v0.8'); process.exit(0); }

// row: [number, name, tags, P, M, G, nemesis, allied, companionTo, abilityName, abilityText]
const list = (x) => String(x ?? '').split(',').map((t) => t.trim()).filter(Boolean);
const fixCapital = (s) => String(s ?? '').replace(/\bcapitol\b/g, 'capital').replace(/\bCapitol\b/g, 'Capital');
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (rows.length !== db.heroes.length) throw new Error('hero count differs: ' + rows.length + ' rows, ' + db.heroes.length + ' heroes');
const changes = [];
for (const [no, name, tags, P, M, G, nemesis, allied, companionTo, abilityName, abilityText] of rows) {
  const h = db.heroes.find((x) => x.number === Number(no));
  if (!h) throw new Error('no hero ' + no);
  const state = () => JSON.stringify([h.name, h.groups, h.stats, h.abilityName, h.abilityText, h.allied ?? [], h.nemesis ?? [], h.companionTo ?? []]);
  const before = state();
  h.name = name; h.groups = list(tags); h.stats = { P, M, G }; h.abilityName = abilityName; h.abilityText = fixCapital(abilityText).trim();
  for (const [key, val] of [['allied', allied], ['nemesis', fixCapital(nemesis)], ['companionTo', companionTo]]) { if (list(val).length) h[key] = list(val); else delete h[key]; }
  if (before !== state()) { changes.push(h.name); if (!h.revision) h.revision = 'Revised in the card sheet (v0.8).'; }
}
console.log('heroes changed:', changes.length, changes.map((n) => n.split(',')[0]).join('; '));

db.version = 'v0.8';
writeFileSync(DB, JSON.stringify(db, null, 1) + '\n');
console.log(`heroes ${db.heroes.length}, locations ${db.locations.length}, encounters ${db.encounters.length}, resources ${db.resources.length}`);
