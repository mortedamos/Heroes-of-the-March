// Every card as a CSV for review in a spreadsheet (Google Sheets: File > Import). The # column is the card's permanent number.
//   npm run export:cards   ->   _build/cards.csv
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { themeFor } from '../src/client/render/env/themes.ts';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type C = Record<string, any>;
const cards = JSON.parse(readFileSync('src/data/cards.json', 'utf8')) as { heroes: C[]; companions: C[]; locations: C[]; encounters: C[]; resources: C[] };
const H = ['#', 'Type', 'Name', 'Tag 1', 'Tag 2', 'Tag 3', 'Tag 4', 'Physical', 'Mental', 'Guile', 'Total', 'Renown', 'Stat', 'Difficulty', 'Minion value', 'Minions drawn', 'Minion group', 'Value', 'Wand', 'Council', 'Ability or table look', 'Rules text', 'Trigger', 'Kin bonus', 'Revision note'];
const q = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const rows: unknown[][] = [H];
let n = 1;
const add = (o: Record<string, unknown>) => { n++; rows.push(H.map((h) => o[h] ?? '')); };
const tags = (c: C): Record<string, string> => Object.fromEntries(((c['groups'] ?? []) as string[]).slice(0, 4).map((t, i) => [`Tag ${i + 1}`, t]));
for (const c of cards.heroes) add({ '#': c.number, Type: 'Hero', Name: c.name, ...tags(c), Physical: c.stats.P, Mental: c.stats.M, Guile: c.stats.G, Total: `=SUM(H${n + 1}:J${n + 1})`, 'Ability or table look': c.abilityName, 'Rules text': c.abilityText, Trigger: c.triggerText, 'Kin bonus': c.kinText, 'Revision note': c.revision });
for (const c of cards.companions) add({ '#': c.number, Type: 'Companion', Name: c.name, ...tags(c), Physical: c.stats.P, Mental: c.stats.M, Guile: c.stats.G, Total: `=SUM(H${n + 1}:J${n + 1})`, 'Ability or table look': c.abilityName, 'Rules text': c.abilityText, 'Revision note': c.revision });
for (const c of cards.locations) add({ '#': c.number, Type: 'Location', Name: c.name, ...tags(c), Renown: c.renown, 'Ability or table look': themeFor(c.id), 'Rules text': c.conditionText });
for (const c of cards.encounters) add({ '#': c.number, Type: 'Encounter', Name: c.name, ...tags(c), Stat: c.stat, Difficulty: c.difficulty, 'Minion value': c.minionValue, 'Minions drawn': c.minions?.count ?? 0, 'Minion group': c.minions?.group, 'Rules text': c.conditionText });
for (const c of cards.resources) add({ '#': c.number, Type: 'Resource', Name: c.name, ...tags(c), Value: c.value, Wand: c.wand ? 'Yes' : '', Council: c.council ? 'Yes' : '', 'Rules text': c.conditionText });
mkdirSync('_build', { recursive: true });
writeFileSync('_build/cards.csv', rows.map((r) => r.map(q).join(',')).join('\n') + '\n');
console.log(rows.length - 1);
