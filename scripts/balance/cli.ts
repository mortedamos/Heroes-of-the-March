// Usage (after `npm run balance:build`):
//   node _build/balance/cli.mjs run <hero|comp|nat> [--games N] [--ns 3,4] [--ablate] [--level normal] [--seed S] [--shards K] [--only id,id] [--out file.json]
//   (--only keeps just the companions whose id contains one of the given fragments; comp experiment only)
// Experiments are fully determined by (seed, game index): rerunning gives identical numbers.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BotLevel } from '../../src/bots/heuristic';
import { companionIds, heroIds, merge, mix, mulberry, newCell, playGame, strip, type AggMap, type Cell, type GameSpec, type Shard } from './sim';


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
  const ablate = opt.ablate === '1';
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
  const heroes = heroIds(), comps = pick(companionIds());

  if (experiment === 'hero') {
    for (const h of heroes) for (const n of ns) for (let g = from + shard; g < from + games; g += shards) {
      const seed = mix(base, hashStr(h), n, g);
      const r = mulberry(mix(seed, 1));
      const others = heroes.filter((x) => x !== h);
      for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [others[i], others[j]] = [others[j]!, others[i]!]; }
      const seat = g % n;
      const dealt: Record<number, string> = {};
      let k = 0;
      for (let s = 0; s < n; s++) dealt[s] = s === seat ? h : others[k++]!;
      const restore = ablate ? strip(h) : () => {};
      try {
        const spec: GameSpec = { n, seed, level, heroes: dealt, rules: { heroDraft: 1 } };
        record(`${h}|${n}`, playGame(spec, cards), seat);
      } finally { restore(); }
      played++;
    }
  } else if (experiment === 'comp') {
    for (const c of comps) for (const n of ns) for (let g = from + shard; g < from + games; g += shards) {
      const seed = mix(base, hashStr(c), n, g);
      const seat = g % n;
      const restore = ablate ? strip(c) : () => {};
      try {
        const spec: GameSpec = { n, seed, level, rules: { heroDraft: 1 }, force: { seat, def: c }, randomDraft: true };
        record(`${c}|${n}`, playGame(spec, cards), seat);
      } finally { restore(); }
      played++;
    }
  } else if (experiment === 'nat') {
    const cycle = [3, 4, 3, 4, 5, 2, 6];
    for (let g = from + shard; g < from + games; g += shards) {
      const n = cycle[g % cycle.length]!;
      const seed = mix(base, 0x9a7, g);
      const rec = playGame({ n, seed, level }, cards);
      const c = (cells[`all|${n}`] ??= newCell());
      c.games++; c.turns += rec.turns; if (rec.capped) c.capped++;
      for (const p of rec.players) { c.posGames[p.pos]!++; if (p.won) c.posWins[p.pos]!++; c.falls += p.falls; }
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
  console.error('usage: cli.mjs run <hero|comp|nat> [options]');
  process.exit(1);
}

void main();
