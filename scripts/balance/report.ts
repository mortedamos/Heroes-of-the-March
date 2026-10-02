// Turns the raw experiment JSON in docs/balance-data into docs/CARD-BALANCE.md tables.
//   node _build/balance/report.mjs [dataDir] > docs/CARD-BALANCE-TABLES.md

import { readFileSync, readdirSync } from 'node:fs';
import { allDefs, getDef } from '../../src/engine/cards';
import { describeAbility, merge, type CardAgg, type Cell, type Shard } from './sim';

const dir = process.argv[2] ?? 'docs/balance-data';
/** Merge every chunk file for an experiment (hero-r1.json, hero-r2.json, ...). */
const load = (name: string): Shard | null => {
  const re = new RegExp(`^${name}(-r\\d+)?\\.json$`);
  const parts = readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as Shard);
  return parts.length ? merge(parts) : null;
};

const pct = (x: number, d = 1) => (x * 100).toFixed(d);
const wilson = (w: number, n: number): [number, number] => {
  if (!n) return [0, 0];
  const z = 1.96, p = w / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
};

/** Win rate relative to the fair share, pooled over player counts. */
function rel(cells: Cell[], ns: number[]): { r: number; se: number; games: number; wins: number } {
  let wins = 0, exp = 0, v = 0, games = 0;
  cells.forEach((c, i) => { const p = 1 / ns[i]!; wins += c.wins; exp += c.games * p; v += c.games * p * (1 - p); games += c.games; });
  return { r: exp ? wins / exp : 0, se: exp ? Math.sqrt(v) / exp : 0, games, wins };
}

const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

const nameOf = (id: string) => getDef(id).name;
const statTotal = (id: string) => { const d = getDef(id); return d.kind === 'hero' || d.kind === 'companion' ? d.stats.P + d.stats.M + d.stats.G : 0; };
const statStr = (id: string) => { const d = getDef(id); return d.kind === 'hero' || d.kind === 'companion' ? `${d.stats.P}/${d.stats.M}/${d.stats.G}` : ''; };

function mech(id: string): string {
  const i = describeAbility(id);
  const kind = i.hooks.length + i.activations.length ? (i.activations.length ? 'activated' : 'triggered') : i.statics.length ? 'static' : 'none';
  return `${i.status} / ${kind}`;
}

function perCard(exp: Shard | null, ab: Shard | null, kind: 'hero' | 'companion', out: string[]): { id: string; r: number; se: number; worth: number | null }[] {
  if (!exp) { out.push('_no data_'); return []; }
  const ids = allDefs().filter((d) => d.kind === kind).map((d) => d.id);
  const ns = [...new Set(Object.keys(exp.cells).map((k) => Number(k.split('|')[1])))].sort();
  const rows: { id: string; r: number; se: number; worth: number | null; cells: Cell[]; line: (string | number)[] }[] = [];
  for (const id of ids) {
    const cells = ns.map((n) => exp.cells[`${id}|${n}`]).filter(Boolean) as Cell[];
    if (!cells.length) continue;
    const nn = ns.filter((n) => exp.cells[`${id}|${n}`]);
    const R = rel(cells, nn);
    const A = ab ? rel(nn.map((n) => ab.cells[`${id}|${n}`]!).filter(Boolean), nn) : null;
    const worth = A ? R.r - A.r : null;
    const worthSe = A ? Math.sqrt(R.se ** 2 + A.se ** 2) : 0;
    const agg = exp.cards[id] as CardAgg | undefined;
    const eff = agg && agg.turns ? (agg.produced + agg.used) / agg.turns : 0;
    const perN = nn.map((n) => { const c = exp.cells[`${id}|${n}`]!; const [lo, hi] = wilson(c.wins, c.games); return `${pct(c.wins / c.games)} (${pct(lo, 0)}–${pct(hi, 0)})`; });
    const flag = Math.abs(R.r - 1) > 1.96 * R.se ? (R.r > 1 ? '▲' : '▼') : '';
    rows.push({ id, r: R.r, se: R.se, worth, cells, line: [
      nameOf(id), statStr(id), statTotal(id), ...perN, `**${R.r.toFixed(2)}** ±${(1.96 * R.se).toFixed(2)} ${flag}`,
      A ? A.r.toFixed(2) : '–', worth === null ? '–' : `${worth >= 0 ? '+' : ''}${worth.toFixed(2)}${Math.abs(worth) > 1.96 * worthSe ? '' : ' (n.s.)'}`,
      eff.toFixed(2), agg && agg.eligible ? pct(agg.zero / agg.eligible, 0) + '%' : '–', mech(id)] });
  }
  rows.sort((a, b) => b.r - a.r);
  out.push(table(['Card', 'P/M/G', 'Σ', ...ns.map((n) => `${n}p win % (95% CI)`), 'Relative win rate (1.00 = fair) ±95%', 'Stats-only rel.', 'Ability worth', 'Effects /turn held', 'Held ≥3 turns, never fired', 'Impl. / kind'], rows.map((r) => r.line)));
  // heterogeneity: is the spread more than noise?
  let chi = 0, df = -1;
  for (const r of rows) { chi += ((r.r - 1) / r.se) ** 2; df++; }
  const mean = rows.reduce((s, r) => s + r.r, 0) / rows.length;
  const sd = Math.sqrt(rows.reduce((s, r) => s + (r.r - mean) ** 2, 0) / rows.length);
  const noise = Math.sqrt(rows.reduce((s, r) => s + r.se ** 2, 0) / rows.length);
  out.push('', `Spread: relative win rates run from ${rows[rows.length - 1]!.r.toFixed(2)} to ${rows[0]!.r.toFixed(2)}; sd ${sd.toFixed(3)} against a pure-noise sd of about ${noise.toFixed(3)}. Heterogeneity χ² = ${chi.toFixed(0)} on ${df} df (the 95% cut-off for pure noise is about ${(df + 1.645 * Math.sqrt(2 * df)).toFixed(0)}).`);
  // stats vs win rate correlation
  const xs = rows.map((r) => statTotal(r.id)), ys = rows.map((r) => r.r);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0), vx = xs.reduce((s, x) => s + (x - mx) ** 2, 0), vy = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  out.push(`Stat total vs relative win rate: r = ${(cov / Math.sqrt(vx * vy)).toFixed(2)}.`);
  return rows;
}

const out: string[] = [];
const hero = load('hero'), heroAb = load('hero-ablate'), comp = load('comp'), compAb = load('comp-ablate'), nat = load('nat');

out.push('## Heroes (controlled: each hero dealt to a rotating seat, other seats dealt random heroes)', '');
perCard(hero, heroAb, 'hero', out);
out.push('', '## Companions (controlled: each companion forced into a rotating seat\'s opening pair; all opening drafts random)', '');
perCard(comp, compAb, 'companion', out);

// --- position check ---------------------------------------------------------------
for (const [label, sh] of [['hero', hero], ['comp', comp]] as const) {
  if (!sh) continue;
  out.push('', `### Turn-order check (${label} experiment): win rate by seat relative to first player`, '');
  const rows: (string | number)[][] = [];
  for (const n of [3, 4]) {
    const pg = Array(6).fill(0), pw = Array(6).fill(0);
    for (const [k, c] of Object.entries(sh.cells)) if (k.endsWith(`|${n}`)) c.posGames.forEach((v, i) => { pg[i] += v; pw[i] += c.posWins[i]!; });
    rows.push([`${n}p`, ...pg.slice(0, n).map((g, i) => `${pct(pw[i] / g)}%`)]);
  }
  out.push(table(['', 'first', '2nd', '3rd', '4th'], rows));
}

// --- natural play -------------------------------------------------------------------
if (nat) {
  out.push('', `## Natural play (${nat.games} games, bots draft and play normally)`, '');
  const cells = Object.entries(nat.cells).sort();
  out.push(table(['Players', 'Games', 'Avg turns', 'Capped (turn limit)', 'Falls /game'], cells.map(([k, c]) => [k.split('|')[1]!, c.games, (c.turns / c.games).toFixed(1), c.capped, (c.falls / c.games).toFixed(2)])));
  for (const kind of ['hero', 'companion'] as const) {
    out.push('', `### ${kind === 'hero' ? 'Heroes' : 'Companions'} in the final roster of winners vs. fair share`, '');
    const rows = allDefs().filter((d) => d.kind === kind).map((d) => {
      const a = nat.cards[d.id] as CardAgg | undefined;
      if (!a || !a.finalPg) return null;
      const r = a.finalWins / a.finalExp, z = (a.finalWins - a.finalExp) / Math.sqrt(a.finalVar);
      const heldR = a.wins / a.exp;
      const winRate = a.winTurns ? a.winEff / a.winTurns : 0, loseRate = a.loseTurns ? a.loseEff / a.loseTurns : 0;
      return { d, a, r, z, heldR, winRate, loseRate };
    }).filter(Boolean).sort((a, b) => b!.r - a!.r) as { d: ReturnType<typeof getDef>; a: CardAgg; r: number; z: number; heldR: number; winRate: number; loseRate: number }[];
    out.push(table(['Card', 'Player-games held', 'Picked (final roster)', 'Win ratio (final roster)', 'z', 'Win ratio (ever held)', 'Effects/turn: winners', 'losers'],
      rows.map((x) => [x.d.name, x.a.pg, x.a.finalPg, x.r.toFixed(2) + (Math.abs(x.z) > 1.96 ? (x.z > 0 ? ' ▲' : ' ▼') : ''), x.z.toFixed(1), x.heldR.toFixed(2), x.winRate.toFixed(2), x.loseRate.toFixed(2)])));
  }

  out.push('', '### Abilities that rarely do anything (natural play)', '');
  const dead: (string | number)[][] = [];
  for (const d of allDefs()) {
    const info = describeAbility(d.id);
    const a = nat.cards[d.id] as CardAgg | undefined;
    const triggerable = info.hooks.length + info.activations.length > 0;
    if (d.kind === 'hero' || d.kind === 'companion') {
      if (!a) { dead.push([d.name, d.kind, info.status, 'never held', '', '', '', '']); continue; }
      const eff = a.turns ? (a.produced + a.used) / a.turns : 0;
      dead.push([d.name, d.kind, `${info.status}${triggerable ? '' : ' (static only)'}`, a.turns, eff.toFixed(3), a.eligible ? pct(a.zero / a.eligible, 0) + '%' : '–', a.offered ? `${a.used}/${a.offered}` : '–', a.calls ? `${a.produced}/${a.calls}` : '–']);
    }
  }
  dead.sort((x, y) => Number(String(x[5]).replace('%', '') || 0) < Number(String(y[5]).replace('%', '') || 0) ? 1 : -1);
  out.push(table(['Card', 'Kind', 'Impl.', 'Turns held', 'Effects/turn', 'Held ≥3 turns, never fired', 'Activations used/offered', 'Hooks effective/called'], dead));

  out.push('', '### Locations, encounters and resources with abilities', '');
  const rows2: (string | number)[][] = [];
  for (const d of allDefs()) {
    if (d.kind === 'hero' || d.kind === 'companion') continue;
    const info = describeAbility(d.id);
    const a = nat.cards[d.id] as CardAgg | undefined;
    const text = d.conditionText;
    if (!text && !info.hooks.length && !info.activations.length) continue;
    rows2.push([d.name, d.kind, info.status, a?.appear ?? 0, a?.calls ?? 0, a?.produced ?? 0, a?.used ?? 0, (info.hooks.concat(info.activations, info.statics)).join(', ') || '–']);
  }
  rows2.sort((x, y) => Number(x[3]) - Number(y[3]));
  out.push(table(['Card', 'Kind', 'Impl.', 'Appearances', 'Hook calls', 'Effective', 'Used', 'Mechanisms'], rows2));
}
console.log(out.join('\n'));
