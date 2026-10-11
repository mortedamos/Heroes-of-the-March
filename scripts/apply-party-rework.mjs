// One-off: the party rework (Oct 2026). Heroes and companions become one kind, "hero"; each player runs a party of three.
//  - Old heroes: stats halved (rounded up); trigger and Kin bonus set aside (data/set-aside.json).
//  - Old companions become heroes. Seven that reference "your hero" are set aside whole.
//  - "companion" wording becomes "hero" / "party" across every card's rules text.
//  - Encounters get easier: Physical -5, Mental -6, Guile -5 (calibrated with the balance sim; the first guess was -3 / -3 / -4).
// Idempotent: refuses to run on a v0.4 file. Card numbers are keyed by id and do not change.
import { readFileSync, writeFileSync } from 'node:fs';

const DB = 'src/data/cards.json';
const ASIDE = 'data/set-aside.json';
const db = JSON.parse(readFileSync(DB, 'utf8'));
if (db.version === 'v0.4' || !db.companions) { console.log('already applied'); process.exit(0); }
const log = [];

// --- 1. Set-aside register ----------------------------------------------------------------------
const SET_ASIDE_COMPANIONS = [2020, 2021, 2017, 2018, 2022, 2032, 2016]; // Osric, Rosalind, Hobart, Caelan, Brisa, Grumma, Mags
const aside = {
  _about: 'Rules content set aside by the party rework (Oct 2026): kept for reference and possible reuse on other cards, not used in the game. Working engine code for all of it is in git at the commit below.',
  engineCommit: '262e213',
  oldHeroes: db.heroes.map((h) => ({
    number: h.number, id: h.id, name: h.name, originalStats: h.stats, triggerText: h.triggerText, kinText: h.kinText ?? null,
  })),
  setAsideCards: structuredClone(db.companions.filter((c) => SET_ASIDE_COMPANIONS.includes(c.number))),
  changedMeaning: {},
};

// --- 2. Reword rules text ---------------------------------------------------------------------------
const rename = (t) => t
  .replace(/above your companion limit/g, 'above your party size')
  .replace(/is already your companion/g, 'is already in your party')
  .replace(/\(normal companion limits apply\)/g, '(your party size still applies)')
  .replace(/\bcompanions\b/g, 'heroes').replace(/\bcompanion\b/g, 'hero')
  .replace(/\bCompanions\b/g, 'Heroes').replace(/\bCompanion\b/g, 'Hero');

// Hand-written replacements where the meaning changes (original text kept in set-aside.changedMeaning).
const TEXT = {
  1002: 'Once per game, at the end of bidding, if you would fall, you don\'t. Instead, you draw 3 resources.',
  1003: 'Before bidding on any turn, choose a hero of an opponent. That hero does not contribute any stats this turn.',
  1007: 'Your party may have four heroes instead of three.',
  1009: 'During bidding, you may disable one ability of another player\'s heroes. Once per turn, you may counter an ability of another player\'s heroes as it is used.',
  1010: 'Ignore any opponent\'s ability that would force one of your heroes to contribute a different stat, stop one of your heroes contributing stats, or make one of your resource cards count as a negative.',
  1015: 'Before bidding, once per turn, choose an opponent. If that opponent uses an ability against your heroes, you may draw a resource.',
  2023: 'At the end of bidding, you win the current encounter and automatically take the location. However, you must discard all resources and one of your heroes falls. You may use this ability only once per game.',
  3020: 'All players immediately draw a resource card for every Warden they have in play.',
  5006: 'If you fall after this card is played, you may choose any hero from the hero stack to take the place of the one who fell, instead of waiting for a draw.',
  5031: 'If you would fall the round this card was played, you don\'t; instead, draw a resource card for every other player.',
  5076: 'When this card is revealed or played face up, if you lose the current encounter (one of your heroes falls), the winner has -3 during the next encounter. It has +1 if Oskar is in your party.',
};

const textFields = (c) => (c.kind === 'hero' || c.kind === 'companion' ? ['abilityText'] : ['conditionText']);
const HALVE = (n) => Math.ceil(n / 2);
const allCards = [...db.heroes, ...db.companions, ...db.locations, ...db.encounters, ...db.resources];

for (const c of allCards) {
  for (const f of textFields(c)) {
    const before = c[f];
    if (before == null) continue;
    const after = TEXT[c.number] ?? rename(before);
    if (after !== before) {
      if (TEXT[c.number]) aside.changedMeaning[c.number] = { name: c.name, was: before };
      c[f] = after;
      log.push(`text ${c.number} ${c.name}`);
    }
  }
}
for (const n of Object.keys(TEXT)) if (!allCards.some((c) => c.number === Number(n))) throw new Error(`no card ${n}`);

// --- 3. Merge the kinds ----------------------------------------------------------------------------------
const NOTE_HALVED = (c, old) => `Party rework: stats halved, rounded up (was ${old.P}/${old.M}/${old.G}); trigger and Kin bonus set aside.`;
const oldHeroes = db.heroes.map((h) => {
  const old = h.stats;
  const out = { ...h, stats: { P: HALVE(old.P), M: HALVE(old.M), G: HALVE(old.G) }, revision: NOTE_HALVED(h, old) };
  delete out.triggerText; delete out.kinText;
  return out;
});
const companions = db.companions
  .filter((c) => !SET_ASIDE_COMPANIONS.includes(c.number))
  .map((c) => {
    const out = { ...c, kind: 'hero' };
    // Revision notes are history ("Was a draw for Underway companions"), so they keep their original words.
    if (c.number === 2033) out.revision = 'Counts as both an Orc and a Human.';
    return out;
  });
db.heroes = [...oldHeroes, ...companions];
delete db.companions;
log.push(`heroes ${db.heroes.length} (set aside ${SET_ASIDE_COMPANIONS.length} companions)`);

// --- 4. Easier encounters ---------------------------------------------------------------------------------
const SHIFT = { P: 5, M: 6, G: 5 }; // calibrated with the balance sim (docs/BALANCE-party.md), not the first guess of 3 / 3 / 4
for (const e of db.encounters) { e.difficulty -= SHIFT[e.stat]; }
const titan = db.encounters.find((e) => e.number === 4036);
if (titan) titan.conditionText = 'If the challenge is changed to Mental or Guile, its difficulty is 5.';

db.version = 'v0.4';
writeFileSync(DB, JSON.stringify(db, null, 1) + '\n');
writeFileSync(ASIDE, JSON.stringify(aside, null, 2) + '\n');
console.log(log.join('\n'));
