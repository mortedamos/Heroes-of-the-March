// One-off: apply the owner's Google Sheet rework (Oct 2026) to src/data/cards.json and data/card-numbers.json.
// Removed cards leave the game but keep their numbers reserved; renamed cards keep their ids and numbers.
import { readFileSync, writeFileSync } from 'node:fs';

const DB = 'src/data/cards.json';
const NUMS = 'data/card-numbers.json';
const db = JSON.parse(readFileSync(DB, 'utf8'));
const nums = JSON.parse(readFileSync(NUMS, 'utf8'));
const kinds = ['heroes', 'companions', 'locations', 'encounters', 'resources'];
const all = () => kinds.flatMap((k) => db[k]);
const byNum = (n) => all().find((c) => c.number === n);
const log = [];

// 1. Removals -----------------------------------------------------------------------------------
const REMOVED = [3001, 3003, 3006, 3007, 3012, 3025, 3032, 3036, 3037, 4009, 4010, 4019, 4022, 4030, 4034, 4037, 4044, 4047, 4051, 4054, 5010, 5013, 5021, 5023, 5030, 5033, 5036, 5040, 5059];
for (const k of kinds) db[k] = db[k].filter((c) => !REMOVED.includes(c.number));
nums._about = nums._about; // numbers of removed cards stay reserved in `numbers`

// 2. Edits to existing cards: [number, name, groups, fields] ------------------------------------
const H = (p, m, g) => ({ stats: { P: p, M: m, G: g } });
const E = (stat, difficulty, minionValue, count, group = null, conditionText = null) =>
  ({ stat, difficulty, minionValue, minions: { count, group }, conditionText });
const EDITS = [
  // Heroes
  [1001, null, ['Orc'], { ...H(10, 6, 8), abilityName: 'Strike the Heart' }],
  [1009, null, ['Human', 'Marchguard'], H(10, 4, 8)],
  [1015, null, ['Dwarf', 'Warden'], { ...H(8, 7, 9), abilityName: 'Entered in the Book of Grudges' }],
  [1010, null, ['Dwarf'], H(8, 6, 8)],
  [1005, null, ['Halfellow', 'Warden'], { ...H(7, 8, 9), abilityText: 'Before cards are revealed at the end of bidding, claim a face-down resource card from another player as your own. If you have resource cards, a random one of yours takes its place, face down. It is not revealed until the bidding reveal step, as normal.' }],
  [1006, null, ['Dwarf'], H(7, 6, 9)],
  [1002, null, ['Dwarf'], { ...H(7, 6, 8), abilityText: 'At the end of bidding, if you would not survive the encounter, you gain 5 to any one stat until the end of the round.', triggerText: 'When an Undead encounter enters play, draw a resource.' }],
  [1004, null, ['Elf'], { ...H(6, 10, 10), abilityName: 'Master Manipulator', triggerText: 'When a hero falls, draw 3 resources.' }],
  [1003, null, ['Elf', 'Accord'], H(4, 8, 9)],
  [1008, null, ['Halfellow'], H(4, 7, 10)],
  [1011, null, ['Human', 'Marchguard', 'Collegium'], H(4, 8, 9)],
  [1007, null, ['Elf', 'Warden'], { ...H(4, 4, 2), triggerText: 'When an Beast encounter enters play, draw a resource.' }],
  [1013, null, ['Halfellow', 'Warden'], { ...H(4, 10, 8), abilityText: 'Once per turn, after the location is revealed, you may look at the next two locations. You may replace the current location with one of them. Shuffle the other two back into the location stack.' }],
  [1012, null, ['Human', 'Collegium'], { ...H(2, 10, 8), triggerText: 'When a Mental challenge is faced, draw a resource.' }],
  // Companions
  [2001, null, ['Halfellow'], H(2, 4, 5)],
  [2004, null, ['Halfellow', 'Marchguard'], H(3, 3, 4)],
  [2036, null, ['Halfellow', 'Beast'], H(3, 3, 3)],
  // Locations
  [3010, null, ['Wardhouse', 'Orc'], { renown: 3, conditionText: 'All players must discard a resource card.' }],
  [3014, 'Hearthlands Historical Society', ['Halfellow', 'Accord'], { renown: 5 }],
  [3019, null, ['Elf'], { renown: 4 }],
  [3034, null, ['Halfellow'], { renown: 2, conditionText: 'All players may draw a companion and put them into play, then discard a companion in play.' }],
  [3038, null, ['Marchguard', 'Collegium'], { renown: 3, conditionText: 'The challenge type of the current encounter is changed to mental.' }],
  // Encounters
  [4007, 'Abbess Hollis, the Unremembered', ['Human', 'Undead'], E('G', 13, 2, 1, 'Undead', 'When this card comes into play draw an Undead minion.')],
  [4045, null, [], E('P', 15, 4, 0)],
  [4021, null, ['Undead'], E('M', 14, 1, 0)],
  [4058, null, ['Orc', 'Beast'], E('G', 11, 1, 0, null, 'When this card comes into play as an encounter, draw a Skarra enounter. That card becomes the encounter, and this card becomes the minion.')],
  [4046, null, ['Beast'], E('P', 15, 2, 0)],
  [4013, null, ['Oathbreaker', 'Elf'], E('G', 14, 2, 2, null, 'When this card comes into play draw two minions.')],
  [4038, null, ['Orc', 'Beast'], E('G', 14, 4, 0)],
  [4020, 'Infectous Zombie', ['Undead'], E('G', 13, 4, 0, null, 'When this card comes into play as an encounter or a minion, each player with a companion turns up the top resource card. The player with the lowest value (ties turn up again) selects a companion to go into play as a minion, adding the relevant stat bonus to the selected challenge’s difficulty. The resource cards are then discarded.')],
  [4048, null, ['Ironbound', 'Undead'], E('P', 15, 4, 0)],
  [4011, null, ['Ironbound', 'Undead'], E('P', 15, 3, 0)],
  [4008, null, ['Oathbreaker', 'Human', 'Collegium'], E('G', 15, 3, 0)],
  [4027, null, ['Collegium', 'Undead', 'Human'], E('M', 13, 1, 2, 'Undead', 'When this card comes into play draw two Undead minions.')],
  [4036, null, ['Ironbound', 'Dwarf'], E('P', 18, 5, 0, null, 'If the challenge is changed to Mental or Guile, its difficulty is 10.')],
  [4040, null, ['Undead', 'Halfellow'], E('P', 14, 4, 0)],
  [4016, null, ['Oathbreaker', 'Skarra', 'Orc'], E('M', 14, -2, 1, null, 'When this card comes into play draw a minion. The minion cannot be Skarra.')],
  [4031, null, ['Elf', 'Oathbreaker', 'Skarra', 'Orc'], E('M', 16, -3, 0, null, 'When this card comes into play draw a minion. The minion cannot be Skarra.')],
  [4025, 'Skarra, the Bog-Mother', ['Oathbreaker', 'Skarra', 'Orc'], E('G', 14, -1, 1, null, 'When this card comes into play draw a minion. The minion cannot be Skarra.')],
  [4026, null, ['Oathbreaker', 'Skarra', 'Orc'], E('M', 13, -2, 1, null, 'When this card comes into play draw a minion. The minion cannot be Skarra.')],
  [4029, null, ['Oathbreaker', 'Skarra', 'Orc', 'Accord'], E('M', 14, -2, 1, null, 'When this card comes into play draw a minion. The minion cannot be Skarra.')],
  [4002, 'Gorathaxus, Goose of the Void', ['Undead', 'Goose'], E('P', 14, 3, 0)],
  [4056, null, ['Beast'], E('G', 13, 2, 1, null, 'When this card comes into play draw a minion.')],
  [4001, null, ['Undead', 'Human', 'Marchguard'], E('G', 15, 2, 0)],
  [4055, null, ['Elf', 'Oathbreaker', 'Undead'], E('M', 16, 2, 1, null, 'When this card comes into play draw a minion.')],
  [4018, 'Harvest Crone', ['Halfellow', 'Undead'], E('G', 13, 2, 1)],
  [4057, 'Hollow Kin', ['Halfellow', 'Undead'], E('M', 14, 2, 0)],
  [4039, null, ['Human', 'Undead'], E('P', 14, 4, 0)],
  [4050, 'Iron Golem', ['Ironbound', 'Collegium'], E('P', 14, 5, 1, 'Ironbound')],
  [4023, null, ['Elf', 'Oathbreaker'], E('G', 14, 2, 1, null, 'When this card comes into play draw a minion.')],
  [4053, 'The Prisoner of the Ward', [], E('G', 15, 3, 0)],
  [4015, null, ['Oathbreaker', 'Accord'], E('M', 18, -3, 0)],
  [4059, 'Treasure Trow', ['Wardhouse'], E('G', 12, 0, 0, null, 'When this card comes into play, all players draw a resource card. When it is defeated, each player who survived may draw a resource card.')],
  [4032, null, ['Oathbreaker', 'Undead', 'Warden', 'Accord'], E('M', 18, -2, 0)],
  [4035, null, ['Orc', 'Beast'], E('P', 14, 3, 0)],
  // Resources
  [5029, null, ['Dwarf', 'Ironbound'], { value: 3 }],
  [5075, null, ['Halfellow', 'Goose'], { value: 1, conditionText: 'All goose cards gain an additional +2 for this encounter.' }],
  [5035, 'Pariapt of the Phoenix', [], { value: 3 }],
  [5031, null, ['Human', 'Elf', 'Accord'], { value: 3 }],
  [5028, null, ['Human'], { value: 3 }],
  [5034, "Wayfinder's Compass", ['Halfellow'], { value: 3 }],
  [5004, null, [], { value: 0 }], [5003, null, [], { value: 0 }], [5002, null, [], { value: 0 }], [5007, null, [], { value: 0 }],
  [5039, null, ['Warden'], { value: 3 }],
  [5012, null, [], { value: 2 }], [5014, null, [], { value: 2 }],
  [5019, null, ['Accord'], { value: 2 }],
  [5024, null, ['Human', 'Collegium'], { value: 3 }],
  [5025, null, ['Elf'], { value: 3 }],
  [5026, null, ['Warden'], { value: 3 }],
  [5058, null, ['Halfellow'], { value: 4 }],
  [5061, null, ['Elf'], { value: 4 }],
  [5063, null, ['Warden'], { value: 4 }],
  [5074, null, ['Warden'], { value: 3 }],
];
for (const [n, name, groups, fields] of EDITS) {
  const c = byNum(n);
  if (!c) { log.push(`MISSING ${n}`); continue; }
  const before = JSON.stringify(c);
  if (name) c.name = name;
  c.groups = groups;
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'stats') c.stats = { ...c.stats, ...v };
    else c[k] = v;
  }
  if (JSON.stringify(c) !== before) log.push(`edited ${n} ${c.name}`);
  else log.push(`unchanged ${n} ${c.name}`);
}

// 3. New cards: the curse resources -------------------------------------------------------------
const CURSE = 'When this card is revealed or played face up, place it in front of an opposing player. It\'s value becomes part of their bid.';
const NEW = [
  [5081, 'rotten-apple', 'Rotten Apple', ['Halfellow'], -1],
  [5082, 'misdirecting-missive', 'Misdirecting Missive', ['Elf'], -2],
  [5077, 'grudge-marker', 'Grudge Marker', ['Dwarf'], -3],
  [5078, 'apprentices-exploding-wand', "Apprentice's Exploding Wand", ['Human', 'Collegium'], -4],
  [5079, 'cursed-locket', 'Cursed Locket', ['Undead'], -5],
  [5080, 'marked-for-the-hunt', 'Marked for the Hunt', ['Orc'], -6],
];
for (const [number, id, name, groups, value] of NEW) {
  if (all().some((c) => c.id === id)) continue;
  db.resources.push({ kind: 'resource', id, name, groups, quote: null, art: null, value, wand: false, council: false, conditionText: CURSE, number });
  nums.numbers[id] = number;
  log.push(`added ${number} ${name}`);
}
nums.numbers = Object.fromEntries(Object.entries(nums.numbers).sort((a, b) => a[1] - b[1]));

// Keep the on-disk shape: the db file uses 1-space indent and a trailing newline (see scripts/card-numbers.ts).
writeFileSync(DB, JSON.stringify(db, null, 1) + '\n');
writeFileSync(NUMS, JSON.stringify(nums, null, 2) + '\n');
console.log(log.join('\n'));
console.log('totals', kinds.map((k) => `${k}:${db[k].length}`).join(' '));
