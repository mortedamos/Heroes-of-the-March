// Writes docs/HOUSE-RULES.md from RULE_NOTES (src/engine/rules.ts), so the document cannot drift from the game.
//   npm run rules-doc
import { writeFileSync } from 'node:fs';
import { DEFAULT_RULES, RULE_NOTES } from '../src/engine/rules.ts';

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const lines = [
  '# House rules: rulings for review',
  '',
  'These are the calls the engine makes where the v0.3 rules are silent or ambiguous, and the rules this edition adds (the adventuring party, the fall rule, steady draws, one stat per encounter).',
  'The source of truth is `RULE_NOTES` in `src/engine/rules.ts`, which the in-game **Rules & status** panel also shows; this file is generated from it (`npm run rules-doc`), so edit the notes, not this file.',
  'Tunable numbers live in `DEFAULT_RULES` (same file).',
  '',
  '| Topic | Ruling |',
  '|---|---|',
  ...RULE_NOTES.map((n) => `| ${cell(n.topic)} | ${cell(n.ruling)} |`),
  '',
  '## Default values',
  '',
  '| Setting | Value |',
  '|---|---|',
  ...Object.entries(DEFAULT_RULES).map(([k, v]) => `| \`${k}\` | ${String(v)} |`),
  '',
  'How the numbers were set (encounter difficulty, steady draws) and how the new game compares with the old one: [BALANCE-party.md](BALANCE-party.md).',
  '',
];
writeFileSync('docs/HOUSE-RULES.md', lines.join('\n'));
console.log(`${RULE_NOTES.length} rulings written`);
