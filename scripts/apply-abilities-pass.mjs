// One-off: applies the designer's card-sheet pass of 2026-10-14 (v0.5) to src/data/cards.json.
//   - the Heroes tab replaces the hero list (49 heroes: new abilities, Allied / Nemesis / Companion To targets,
//     Brisa and Grumma back with new abilities, three new heroes that get permanent card numbers);
//   - a few locations and encounters were edited in the sheet (listed below);
//   - resources are unchanged.
// Cards in the sheet's "Set aside" tabs are not used. Idempotent: it refuses to run on a v0.5 file.
// Usage: node scripts/apply-abilities-pass.mjs <path to sheet-heroes-v05.json>

import { readFileSync, writeFileSync } from 'node:fs';

const DB = 'src/data/cards.json';
const NUMBERS = 'data/card-numbers.json';
const db = JSON.parse(readFileSync(DB, 'utf8'));
if (db.version === 'v0.5') { console.log('already v0.5'); process.exit(0); }
const aside = JSON.parse(readFileSync('data/set-aside.json', 'utf8'));
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const numFile = JSON.parse(readFileSync(NUMBERS, 'utf8'));

const list = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const oldByNumber = new Map(db.heroes.map((h) => [h.number, h]));
// Brisa and Grumma come back from the set-aside file: their id, art and quote are kept.
for (const c of aside.setAsideCards) if (c.number === 2022 || c.number === 2032) oldByNumber.set(c.number, { ...c, kind: 'hero' });

const used = new Set(Object.values(numFile.numbers));
let nextHero = Math.max(...Object.values(numFile.numbers).filter((n) => n >= 1001 && n < 3001)) + 1;
const newNumbers = [];

const heroes = rows.map(([no, name, tags, P, M, G, nemesis, allied, companionTo, abilityName, abilityText]) => {
  let old = no === 'NEW' ? null : oldByNumber.get(Number(no));
  if (no !== 'NEW' && !old) throw new Error(`no hero numbered ${no}`);
  const id = old ? old.id : slug(name);
  if (!old && db.heroes.some((h) => h.id === id)) throw new Error(`duplicate id ${id}`);
  let number = old?.number;
  if (number === undefined) {
    while (used.has(nextHero)) nextHero += 1;
    number = nextHero; used.add(number); numFile.numbers[id] = number; newNumbers.push(`${number} ${name}`);
  } else if (numFile.numbers[id] !== number) throw new Error(`number mismatch for ${id}`);
  const hero = {
    id, name, groups: list(tags), quote: old?.quote ?? null, art: old?.art ?? null,
    stats: { P, M, G }, abilityName, abilityText: abilityText.trim(),
    ...(list(allied).length ? { allied: list(allied) } : {}),
    ...(list(nemesis).length ? { nemesis: list(nemesis) } : {}),
    ...(list(companionTo).length ? { companionTo: list(companionTo) } : {}),
    kind: 'hero',
  };
  const sig = (h) => JSON.stringify([h.name, h.groups, h.stats, h.abilityName, h.abilityText, h.allied ?? [], h.nemesis ?? [], h.companionTo ?? []]);
  const changed = !old || sig(old) !== sig(hero);
  const revision = old?.revision ?? (changed && old ? 'Revised in the card sheet (v0.5).' : undefined);
  if (revision) hero.revision = revision;
  hero.number = number;
  return hero;
});
db.heroes = heroes;

// --- locations and encounters edited in the sheet -------------------------------
const patch = (kind, number, fields) => {
  const c = db[kind].find((x) => x.number === number);
  if (!c) throw new Error(`no ${kind} ${number}`);
  Object.assign(c, fields);
};
patch('locations', 3002, { conditionText: 'All players immediately draw a resource card for every Human hero they have in play.' });
patch('locations', 3004, { conditionText: 'The challenges and minion bonuses of Undead encounters are increased by 3.' });
patch('locations', 3011, { name: 'The Mirror Mire', conditionText: 'All resources are played face up. No ability can force them to be face down.' });
patch('locations', 3013, { conditionText: 'If any minions are in play at this location, their bonus is increased by 2.' });
patch('locations', 3016, { renown: 3 });
patch('locations', 3018, { conditionText: 'The challenges and minion bonuses of Ironbound encounters are increased by 2.' });
patch('locations', 3033, { conditionText: 'Fog of the Fey: All face-down resource cards stay hidden until the reveal step. No ability can force them to be revealed beforehand.' });
patch('locations', 3034, { conditionText: 'All players may draw a hero and put them into play. Party size in increased by 1 while this location is in play.' });
patch('locations', 3040, { conditionText: 'Draw one extra minion. All encounters and minions count as Undead.' });
const zombie = db.encounters.find((e) => e.number === 4020);
zombie.conditionText = 'When this card comes into play as an encounter or a minion, each player turns up the top resource card. The player with the lowest value (ties turn up again) selects a hero to go into play as a minion as a zombified hero. The resource cards are then discarded. The zombified hero adds the relevant stat bonus to the selected challenge’s difficulty and gains the undead tag.';
patch('encounters', 4031, { minions: { count: 1, group: null } });

db.version = 'v0.5';
writeFileSync(DB, JSON.stringify(db, null, 1) + '\n');
numFile.numbers = Object.fromEntries(Object.entries(numFile.numbers).sort((a, b) => a[1] - b[1]));
writeFileSync(NUMBERS, JSON.stringify(numFile, null, 2) + '\n');
console.log(`heroes ${db.heroes.length}, locations ${db.locations.length}, encounters ${db.encounters.length}, resources ${db.resources.length}`);
console.log('new numbers:', newNumbers.join('; '));
