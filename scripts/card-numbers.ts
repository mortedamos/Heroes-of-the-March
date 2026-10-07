// Number the cards in src/data/cards.json without rebuilding it from the spreadsheet.
//   npm run numbers
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCardNumbers } from './cardNumbers.ts';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'cards.json');
const db = JSON.parse(readFileSync(file, 'utf8')) as Parameters<typeof applyCardNumbers>[0] & { version: string };
const added = applyCardNumbers(db);
writeFileSync(file, JSON.stringify(db, null, 1) + '\n');
console.log(`numbered ${Object.values(db).filter(Array.isArray).flat().length} cards (${added} new)`);
