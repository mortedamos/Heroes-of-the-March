// One-off: applies the designer's second card-sheet pass of 2026-10-14 (v0.6) to src/data/cards.json.
//   - heroes: stats cut or trimmed on many heroes, Allied taken off Aelthir, Kazra, Caelan and Ysolde, Ysolde's ability renamed;
//   - encounters: harder encounters with minions, Morvaine draws three, the Harvest Crone none, two renames;
//   - resources: Call the Five Crowns removed, Gold Filings is now Forgewrights Tools, Rune of Unmaking and two wands cheaper,
//     three new plain resources (numbers 5083-5085).
// Idempotent: it refuses to run on a v0.6 file. Usage: node scripts/apply-sheet-pass-b.mjs <heroes.json>

import { readFileSync, writeFileSync } from 'node:fs';

const DB = 'src/data/cards.json';
const NUMBERS = 'data/card-numbers.json';
const db = JSON.parse(readFileSync(DB, 'utf8'));
if (db.version === 'v0.6') { console.log('already v0.6'); process.exit(0); }
const numFile = JSON.parse(readFileSync(NUMBERS, 'utf8'));
const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const find = (kind, number) => {
  const c = db[kind].find((x) => x.number === number);
  if (!c) throw new Error(`no ${kind} ${number}`);
  return c;
};

// ---- heroes: the Heroes tab (a JSON transcription, one row per hero) is the truth for every field ----------------
// row: [number, name, tags, P, M, G, nemesis, allied, companionTo, abilityName, abilityText]
const list = (x) => String(x ?? '').split(',').map((t) => t.trim()).filter(Boolean);
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (rows.length !== db.heroes.length) throw new Error('hero count differs: ' + rows.length + ' rows, ' + db.heroes.length + ' heroes');
const changes = [];
for (const [no, name, tags, P, M, G, nemesis, allied, companionTo, abilityName, abilityText] of rows) {
  const h = find('heroes', Number(no));
  const before = JSON.stringify([h.name, h.groups, h.stats, h.abilityName, h.abilityText, h.allied ?? [], h.nemesis ?? [], h.companionTo ?? []]);
  h.name = name; h.groups = list(tags); h.stats = { P, M, G }; h.abilityName = abilityName; h.abilityText = abilityText.trim();
  for (const [key, val] of [['allied', allied], ['nemesis', nemesis], ['companionTo', companionTo]]) { if (list(val).length) h[key] = list(val); else delete h[key]; }
  const after = JSON.stringify([h.name, h.groups, h.stats, h.abilityName, h.abilityText, h.allied ?? [], h.nemesis ?? [], h.companionTo ?? []]);
  if (before !== after) { changes.push(h.name); if (!h.revision) h.revision = 'Revised in the card sheet (v0.6).'; }
}
console.log('heroes changed:', changes.length, changes.map((n) => n.split(',')[0]).join('; '));

// ---- encounters ------------------------------------------------------------------------------------
const enc = (n, f) => Object.assign(find('encounters', n), f);
enc(4004, { difficulty: 8 });
enc(4005, { difficulty: 8 });
enc(4008, { difficulty: 11 });
enc(4013, { minions: { count: 3, group: null }, conditionText: 'When this card comes into play draw three minions.' });
enc(4018, { minions: { count: 0, group: null } });
enc(4023, { difficulty: 10 });
enc(4024, { difficulty: 10 });
enc(4025, { difficulty: 10 });
enc(4027, { difficulty: 9 });
enc(4028, { name: 'The Whispering Unknown', difficulty: 11 });
enc(4032, { name: 'Vorhal the Cursed, First of the Wardens' });
enc(4056, { difficulty: 10 });

// ---- resources -------------------------------------------------------------------------------------
const gone = db.resources.findIndex((r) => r.number === 5002);
if (gone < 0) throw new Error('Call the Five Crowns missing');
db.resources.splice(gone, 1);
Object.assign(find('resources', 5011), { name: 'Forgewrights Tools', conditionText: '+5 against Ironbound.' });
Object.assign(find('resources', 5029), { value: 2, conditionText: '+5 against Ironbound.', groups: ['Dwarf', 'Ironbound'] });
find('resources', 5066).value = 4;
find('resources', 5067).value = 4;

const used = new Set(Object.values(numFile.numbers));
let next = Math.max(...Object.values(numFile.numbers).filter((n) => n >= 5001 && n < 6001)) + 1;
const added = [];
for (const [name, tag, value] of [['Dwarven Warhammer', 'Dwarf', 1], ['Leyline Protractor', 'Collegium', 2], ['Mythral Armor', 'Elf', 1]]) {
  const id = slug(name);
  if (db.resources.some((r) => r.id === id)) throw new Error('duplicate ' + id);
  while (used.has(next)) next += 1;
  used.add(next); numFile.numbers[id] = next;
  db.resources.push({ kind: 'resource', id, name, groups: [tag], quote: null, art: null, value, wand: false, council: false, conditionText: null, number: next });
  added.push(`${next} ${name}`);
}

db.version = 'v0.6';
writeFileSync(DB, JSON.stringify(db, null, 1) + '\n');
numFile.numbers = Object.fromEntries(Object.entries(numFile.numbers).sort((a, b) => a[1] - b[1]));
writeFileSync(NUMBERS, JSON.stringify(numFile, null, 2) + '\n');
console.log(`heroes ${db.heroes.length}, locations ${db.locations.length}, encounters ${db.encounters.length}, resources ${db.resources.length}`);
console.log('new numbers:', added.join('; '));
