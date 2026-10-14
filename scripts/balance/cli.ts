// Usage (after `npm run balance:build`):
//   node _build/balance/cli.mjs run <card|party|nat> [--games N] [--ns 3,4] [--ablate] [--level normal] [--seed S] [--shards K] [--ease P,M,G] [--strip allied,nemesis,companion] [--rules JSON] [--tweak JSON] [--only id,id] [--out file.json]
//   (--only keeps just the heroes whose id contains one of the given fragments; card experiment only)
// Experiments are fully determined by (seed, game index): rerunning gives identical numbers.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BotLevel } from '../../src/bots/heuristic';
import { ABILITIES } from '../../src/engine/abilities';
import { allDefs, stripNamedAbilities } from '../../src/engine/cards';
import { addGameMetrics, heroIds, merge, mix, newCell, playGame, strip, type AggMap, type Cell, type GameSpec, type Shard } from './sim';


function parseArgs(argv: string[]): { pos: string[]; opt: Record<string, string> } {
  const pos: string[] = [], opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) { const k = a.slice(2); const nx = argv[i + 1]; if (nx === undefined || nx.startsWith('--')) opt[k] = '1'; else { opt[k] = nx; i++; } } else pos.push(a);
  }
  return { pos, opt };
}

const hashStr = (s: string): number => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

function runShard(experiment: string, opt: Record<string, string>, shard: number, shards: number): Shard {
  const games = Number(opt.games ?? 200);
  const from = Number(opt.from ?? 0);
  const base = Number(opt.seed ?? 1);
  const ns = (opt.ns ?? '3,4').split(',').map(Number);
  const level = (opt.level ?? 'normal') as BotLevel;
  // --ease P,M,G: add to every encounter's printed difficulty (a calibration experiment; the card data is not touched).
  if (opt.ease) {
    const [eP = 0, eM = 0, eG = 0] = opt.ease.split(',').map(Number);
    const by = { P: eP, M: eM, G: eG };
    for (const d of allDefs()) if (d.kind === 'encounter') d.difficulty += by[d.stat];
  }
  // --strip allied,nemesis,companion: switch those named abilities off (a diagnostic experiment).
  if (opt.strip) stripNamedAbilities(opt.strip.split(','));
  const ablate = opt.ablate === '1';
  // --tweak '{"card-id":{"field":value}}': patch ability registry entries for the whole run (a calibration experiment).
  if (opt.tweak) for (const [id, patch] of Object.entries(JSON.parse(opt.tweak) as Record<string, object>)) Object.assign(ABILITIES[id] ?? (ABILITIES[id] = { status: 'full' }), patch);
  // --rules '{"activeDraw":3}': house-rule overrides for every game (a calibration experiment).
  const rules = opt.rules ? (JSON.parse(opt.rules) as Record<string, unknown>) : undefined;
  const cells: Record<string, Cell> = {};
  const cards: AggMap = {};
  let played = 0;
  const record = (key: string, rec: ReturnType<typeof playGame>, seat: number) => {
    const c = (cells[key] ??= newCell());
    c.games++; c.turns += rec.turns; if (rec.capped) c.capped++;
    const me = rec.players[seat]!;
    if (me.won) c.wins++;
    c.falls += me.falls;
    c.posGames[me.pos]!++; if (me.won) c.posWins[me.pos]!++;
  };
  const only = (opt.only ?? '').split(',').filter(Boolean);
  const pick = (ids: string[]) => (only.length ? ids.filter((id) => only.some((o) => id.includes(o))) : ids);
  const cardsFocus = pick(heroIds());

  if (experiment === 'card') {
    // Each hero is forced into a rotating seat's opening party; everyone drafts at random so preferences don't skew it.
    for (const c of cardsFocus) for (const n of ns) for (let g = from + shard; g < from + games; g += shards) {
      const seed = mix(base, hashStr(c), n, g);
      const seat = g % n;
      const restore = ablate ? strip(c) : () => {};
      try {
        const spec: GameSpec = { n, seed, level, force: { seat, def: c }, randomDraft: true };
        record(`${c}|${n}`, playGame(spec, cards), seat);
      } finally { restore(); }
      played++;
    }
  } else if (experiment === 'party') {
    // --party a,b,c: the named heroes (id fragments) are forced into a rotating seat's opening party; everyone else drafts at random.
    const ids = (opt.party ?? '').split(',').filter(Boolean).map((f) => heroIds().find((id) => id.includes(f)) ?? (() => { throw new Error('no hero ' + f); })());
    for (const n of ns) for (let g = from + shard; g < from + games; g += shards) {
      const seed = mix(base, hashStr(ids.join('+')), n, g);
      const seat = g % n;
      const spec: GameSpec = { n, seed, level, force: { seat, def: ids }, randomDraft: true, ...(rules ? { rules } : {}) };
      record(`${ids.join('+')}|${n}`, playGame(spec, cards), seat);
      played++;
    }
  } else if (experiment === 'nat') {
    const cycle = [3, 4, 3, 4, 5, 2, 6];
    for (let g = from + shard; g < from + games; g += shards) {
      const n = cycle[g % cycle.length]!;
      const seed = mix(base, 0x9a7, g);
      const rec = playGame({ n, seed, level, ...(rules ? { rules } : {}) }, cards);
      const c = (cells[`all|${n}`] ??= newCell());
      c.games++; c.turns += rec.turns; if (rec.capped) c.capped++;
      for (const p of rec.players) { c.posGames[p.pos]!++; if (p.won) c.posWins[p.pos]!++; c.falls += p.falls; }
      addGameMetrics(c, rec);
      played++;
    }
  } else throw new Error(`unknown experiment ${experiment}`);
  return { experiment, args: opt, cells, cards, games: played };
}

async function main(): Promise<void> {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  if (pos[0] === 'worker') {
    const shard = runShard(pos[1]!, opt, Number(opt.shard), Number(opt.shards));
    process.stdout.write(JSON.stringify(shard));
    return;
  }
  if (pos[0] === 'run') {
    const experiment = pos[1]!;
    const shards = Number(opt.shards ?? 4);
    const self = fileURLToPath(import.meta.url);
    const t0 = Date.now();
    const outs = await Promise.all(Array.from({ length: shards }, (_, i) => new Promise<Shard>((resolve, reject) => {
      const args = [self, 'worker', experiment, ...Object.entries(opt).flatMap(([k, v]) => [`--${k}`, v]), '--shard', String(i), '--shards', String(shards)];
      const ch = spawn(process.execPath, ['--max-old-space-size=2048', ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
      let buf = '';
      ch.stdout.on('data', (d: Buffer) => { buf += d.toString(); });
      ch.on('close', (code) => code === 0 ? resolve(JSON.parse(buf) as Shard) : reject(new Error(`worker ${i} exited ${code}`)));
    })));
    const merged = merge(outs);
    const file = opt.out ?? `docs/balance-data/${experiment}${opt.ablate ? '-ablate' : ''}.json`;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(merged));
    console.log(`${experiment}${opt.ablate ? ' (ablated)' : ''}: ${merged.games} games in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${file}`);
    return;
  }
  if (pos[0] === 'inspect') { console.log(Object.keys(JSON.parse(readFileSync(pos[1]!, 'utf8')))); return; }
  console.error('usage: cli.mjs run <card|nat> [options]');
  process.exit(1);
}

void main();
