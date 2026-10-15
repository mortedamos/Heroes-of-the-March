// One-off: applies the designer's third card-sheet pass of 2026-10-14 (v0.7) to src/data/cards.json.
//   - heroes: Grukka gets Nemesis Capital and a new ability text, Ysolde 2/2/3, Farmer Hobart 3/2/4 with a once-a-turn draw,
//     Corvin loses Allied, Rook gains Marchguard, Thessaly loses Collegium;
//   - resources: Pariapt of the Phoenix is now Amulet of the Phoenix; three new cards (numbers 5086-5088 as written in the sheet);
//   - encounters: a typo fixed in Destiny the Frog.
// The sheet writes "Capitol" for the location tag, which is "Capital" everywhere else; it is normalised here.
// Idempotent: it refuses to run on a v0.7 file. Usage: node scripts/apply-sheet-pass-c.mjs <heroes.json>

import { readFileSync, writeFileSync } from 'node:fs';

const DB = 'src/data/cards.json';
const NUMBERS = 'data/card-numbers.json';
const db = JSON.parse(readFileSync(DB, 'utf8'));
if (db.version === 'v0.7') { console.log('already v0.7'); process.exit(0); }
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
const fixCapital = (s) => String(s ?? '').replace(/\bcapitol\b/g, 'capital').replace(/\bCapitol\b/g, 'Capital');
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (rows.length !== db.heroes.length) throw new Error('hero count differs: ' + rows.length + ' rows, ' + db.heroes.length + ' heroes');
const changes = [];
for (const [no, name, tags, P, M, G, nemesis, allied, companionTo, abilityName, abilityText] of rows) {
  const h = find('heroes', Number(no));
  const state = () => JSON.stringify([h.name, h.groups, h.stats, h.abilityName, h.abilityText, h.allied ?? [], h.nemesis ?? [], h.companionTo ?? []]);
  const before = state();
  h.name = name; h.groups = list(tags); h.stats = { P, M, G }; h.abilityName = abilityName; h.abilityText = fixCapital(abilityText).trim();
  for (const [key, val] of [['allied', allied], ['nemesis', fixCapital(nemesis)], ['companionTo', companionTo]]) { if (list(val).length) h[key] = list(val); else delete h[key]; }
  if (before !== state()) { changes.push(h.name); h.revision = 'Revised in the card sheet (v0.7).'; }
}
console.log('heroes changed:', changes.length, changes.map((n) => n.split(',')[0]).join('; '));

// ---- encounters ------------------------------------------------------------------------------------
Object.assign(find('encounters', 4058), { conditionText: 'When this card comes into play as an encounter, draw a Skarra encounter. That card becomes the encounter, and this card becomes the minion.' });

// ---- resources -------------------------------------------------------------------------------------
find('resources', 5035).name = 'Amulet of the Phoenix';
const added = [];
for (const [number, name, groups, value, text] of [
  [5086, 'Pariapt of Peace', ['Accord'], 2, 'Allied and Nemesis give no bonuses this turn.'],
  [5087, 'The Tome of Nethrak', ['Undead', 'Collegium'], 4, 'When revealed or played face up, draw an Undead minion for this encounter.'],
  [5088, 'Immobilizing Word', ['Marchguard'], 1, 'Choose an opponent. Their Companion heroes are turned face down, cannot use their abilities, and contribute nothing this encounter.'],
]) {
  const id = slug(name);
  if (db.resources.some((r) => r.id === id)) throw new Error('duplicate ' + id);
  if (Object.values(numFile.numbers).includes(number)) throw new Error('number taken ' + number);
  numFile.numbers[id] = number;
  db.resources.push({ kind: 'resource', id, name, groups, quote: null, art: null, value, wand: false, council: false, conditionText: text, number });
  added.push(`${number} ${name}`);
}

db.version = 'v0.7';
writeFileSync(DB, JSON.stringify(db, null, 1) + '\n');
numFile.numbers = Object.fromEntries(Object.entries(numFile.numbers).sort((a, b) => a[1] - b[1]));
writeFileSync(NUMBERS, JSON.stringify(numFile, null, 2) + '\n');
console.log(`heroes ${db.heroes.length}, locations ${db.locations.length}, encounters ${db.encounters.length}, resources ${db.resources.length}`);
console.log('new numbers:', added.join('; '));
