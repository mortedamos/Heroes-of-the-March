// One-off diagnostic: how often does a bot with Professor Barnaby actually swap the location, and does it gain Renown?
//   npx rolldown scripts/balance/probe-maps.ts --format esm --platform node --file _build/probe/probe-maps.mjs && node _build/probe/probe-maps.mjs [games] [hero-fragment]
import { getDef, allDefs } from '../../src/engine/cards';
import type { GameEvent } from '../../src/engine/types';
import { mix, playGame, type AggMap } from './sim';

const games = Number(process.argv[2] ?? 300);
const frag = process.argv[3] ?? 'barnaby';
const hero = allDefs().find((d) => d.kind === 'hero' && d.id.includes(frag))!.id;
const renown = (def: string) => { const d = getDef(def); return d.kind === 'location' ? d.renown : 0; };

let swaps = 0, swapGain = 0, swapGames = 0, turnsHeld = 0, wonByHolder = 0, wonByOthers = 0, renownWonHolder = 0, renownWonOthers = 0, wins = 0, total = 0;
const cards: AggMap = {};
for (let i = 0; i < games; i++) {
  const n = 3;
  const seat = i % n;
  const seed = mix(7, i);
  let swappedThisGame = 0;
  const holderId = `p${seat}`;
  const onEvent = (e: GameEvent) => {
    if (e.type === 'turnStarted') turnsHeld++;
    if (e.type === 'locationReplaced' && /Maps/.test(e.reason ?? '')) { swaps++; swappedThisGame++; swapGain += renown(e.to.def) - renown(e.from.def); }
    if (e.type === 'outcome' && e.result.winner) {
      const r = e.result.locations.reduce((sum, _c) => sum + 0, 0);
      void r;
    }
    if (e.type === 'renownGained') {
      if (e.player === holderId) { wonByHolder++; renownWonHolder += e.amount; } else { wonByOthers++; renownWonOthers += e.amount; }
    }
  };
  const rec = playGame({ n, seed, level: 'normal', force: { seat, def: hero }, randomDraft: true, onEvent }, cards);
  total++;
  if (rec.players.find((p) => p.seat === seat)?.won) wins++;
  if (swappedThisGame) swapGames++;
}
console.log(JSON.stringify({
  hero, games: total, winRate: (wins / total).toFixed(3), expected: (1 / 3).toFixed(3), gamesWithSwap: swapGames, swaps, swapsPerGame: (swaps / total).toFixed(2),
  meanRenownGainPerSwap: swaps ? (swapGain / swaps).toFixed(2) : null,
  holderWins: wonByHolder, holderRenownPerWin: wonByHolder ? (renownWonHolder / wonByHolder).toFixed(2) : null,
  othersWins: wonByOthers, othersRenownPerWin: wonByOthers ? (renownWonOthers / wonByOthers).toFixed(2) : null,
  turnsPerGame: (turnsHeld / total).toFixed(1),
}, null, 1));
