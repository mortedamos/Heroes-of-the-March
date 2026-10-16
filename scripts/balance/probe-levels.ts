// Diagnostic: how do the bot levels do against each other? One focal seat plays at one level, everyone else at another.
//   npx rolldown scripts/balance/probe-levels.ts --format esm --platform node --file _build/probe/probe-levels.mjs && node _build/probe/probe-levels.mjs [games] [players]
import type { BotLevel } from '../../src/bots/heuristic';
import { mix, playGame, type AggMap } from './sim';

const games = Number(process.argv[2] ?? 1500);
const n = Number(process.argv[3] ?? 3);
const cards: AggMap = {};

function run(focal: BotLevel, others: BotLevel): { win: number; ci: number; falls: number } {
  let wins = 0, falls = 0, played = 0;
  for (let i = 0; i < games; i++) {
    const seat = i % n;
    const levels = Array.from({ length: n }, (_, s) => (s === seat ? focal : others));
    const rec = playGame({ n, seed: mix(31, i), level: others, levels }, cards);
    played++;
    const me = rec.players.find((p) => p.seat === seat)!;
    if (me.won) wins++;
    falls += me.falls;
  }
  const p = wins / played;
  return { win: p, ci: 1.96 * Math.sqrt((1 / n) * (1 - 1 / n) / played), falls: falls / played };
}

const rows: [string, BotLevel, BotLevel][] = [['hard among normal', 'hard', 'normal'], ['easy among normal', 'easy', 'normal'], ['normal among normal', 'normal', 'normal'], ['normal among easy', 'normal', 'easy'], ['hard among easy', 'hard', 'easy']];
for (const [label, focal, others] of rows) {
  const r = run(focal, others);
  console.log(`${label.padEnd(22)} wins ${(r.win * 100).toFixed(1)}% (fair ${(100 / n).toFixed(1)}%, ±${(r.ci * 100).toFixed(1)})  falls per game ${r.falls.toFixed(2)}`);
}
