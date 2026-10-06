// Permanent card numbers (data/card-numbers.json): card id -> number.
// Heroes 1001+, companions 2001+, locations 3001+, encounters 4001+, resources 5001+. A number is given once, never changes and is
// never reused, so a card can still be found by number after its name (and so its id) is edited.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'card-numbers.json');
const START = { heroes: 1001, companions: 2001, locations: 3001, encounters: 4001, resources: 5001 } as const;
type Kind = keyof typeof START;
interface Card { id: string; number?: number }

/** Give every card its number (new cards get the next free one for their type), save the list, and return how many were new. */
export function applyCardNumbers(db: Record<Kind, Card[]>): number {
  const raw = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as { _about?: string; numbers: Record<string, number> }) : { numbers: {} };
  const numbers = raw.numbers;
  const used = new Set(Object.values(numbers));
  let added = 0;
  for (const kind of Object.keys(START) as Kind[]) {
    let next = Math.max(START[kind] - 1, ...Object.values(numbers).filter((n) => n >= START[kind] && n < START[kind] + 1000)) + 1;
    for (const card of db[kind]) {
      if (numbers[card.id] === undefined) {
        while (used.has(next)) next += 1;
        numbers[card.id] = next;
        used.add(next);
        added += 1;
      }
      card.number = numbers[card.id]!;
    }
  }
  if (added || !existsSync(FILE)) {
    const sorted = Object.fromEntries(Object.entries(numbers).sort((a, b) => a[1] - b[1]));
    writeFileSync(FILE, JSON.stringify({ _about: raw._about, numbers: sorted }, null, 2) + '\n');
  }
  return added;
}
