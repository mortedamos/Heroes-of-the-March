// Converts the design spreadsheet into typed card JSON for the game.
//   node scripts/build-cards.ts
// Input:  source-docs/Heroes-of-the-March-card-data.xlsx, data/art-map.json, _build/art/*.webp
// Output: src/data/cards.json
//
// The spreadsheet is treated as untrusted input: every field is type-checked,
// strings are length-bounded, and anything malformed fails the build loudly.

import ExcelJS from 'exceljs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCardNumbers } from './cardNumbers.ts';
import type {
  CardDatabase, CompanionDef, EncounterDef, HeroDef, LocationDef, ResourceDef, Stat,
} from '../src/engine/cardTypes.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const XLSX = join(root, 'source-docs', 'Heroes-of-the-March-card-data.xlsx');
const ART_DIR = join(root, '_build', 'art');
const ART_MAP = join(here, '..', 'data', 'art-map.json');
const OUT = join(here, '..', 'src', 'data', 'cards.json');

const MAX_TEXT = 600;
const problems: string[] = [];

type Cell = string | number | null;
type Row = Record<string, Cell>;

function cellValue(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown };
    if (o.result !== undefined) return cellValue(o.result);
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join('');
    if (typeof o.text === 'string') return o.text;
  }
  return String(v);
}

async function readSheets(): Promise<Map<string, Row[]>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);
  const out = new Map<string, Row[]>();
  wb.eachSheet((ws) => {
    const rows: Row[] = [];
    let header: string[] | null = null;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map(cellValue);
      if (!header) {
        header = vals.map((v) => String(v ?? '').trim());
        return;
      }
      const r: Row = Object.create(null);
      header.forEach((h, i) => { if (h) r[h] = vals[i] ?? null; });
      rows.push(r);
    });
    out.set(ws.name, rows);
  });
  return out;
}

function text(r: Row, key: string, ctx: string): string | null {
  const v = r[key];
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim().normalize('NFC');
  if (s.length > MAX_TEXT) problems.push(`${ctx}: "${key}" longer than ${MAX_TEXT} chars`);
  return s.slice(0, MAX_TEXT) || null;
}

function reqText(r: Row, key: string, ctx: string): string {
  const s = text(r, key, ctx);
  if (!s) { problems.push(`${ctx}: missing "${key}"`); return '?'; }
  return s;
}

function num(r: Row, key: string, ctx: string, min: number, max: number): number {
  const v = r[key];
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    problems.push(`${ctx}: "${key}" = ${JSON.stringify(v)} (expected ${min}..${max})`);
    return 0;
  }
  return n;
}

function groups(r: Row, key: string, ctx: string): string[] {
  const s = text(r, key, ctx);
  if (!s) return [];
  return s.split(',').map((g) => g.trim()).filter(Boolean);
}

const slugs = new Set<string>();
function slug(name: string): string {
  const base = name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (slugs.has(base)) problems.push(`duplicate card id "${base}"`);
  slugs.add(base);
  return base;
}

function isActive(r: Row): boolean {
  return r['Active'] === 1 || r['Active'] === '1';
}

// Art mapping -------------------------------------------------------------

const artFiles = new Set(readdirSync(ART_DIR).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)));
const artMapRaw: unknown = JSON.parse(readFileSync(ART_MAP, 'utf8'));
if (typeof artMapRaw !== 'object' || artMapRaw === null || Array.isArray(artMapRaw)) throw new Error('art-map.json must be an object');
const artMap = new Map<string, string>();
for (const [k, v] of Object.entries(artMapRaw)) {
  if (k.startsWith('_')) continue;
  if (typeof v !== 'string' || !/^[a-z0-9_]+$/.test(v)) { problems.push(`art-map: bad value for "${k}"`); continue; }
  if (!artFiles.has(v)) { problems.push(`art-map: "${k}" -> missing file ${v}.webp`); continue; }
  artMap.set(k, v);
}
const usedArtNames = new Set<string>();
function art(name: string): string | null {
  const a = artMap.get(name);
  if (a) usedArtNames.add(name);
  return a ?? null;
}

// Parsers -----------------------------------------------------------------

function parseRange(v: Cell, ctx: string): [number, number] {
  const s = String(v ?? '').trim();
  const m = /^([1-6])(?:\s*[-–]\s*([1-6]))?$/.exec(s);
  if (!m) { problems.push(`${ctx}: bad die range ${JSON.stringify(v)}`); return [0, 0]; }
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return [lo, hi];
}

const COUNT_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };

/** "When this card comes into play draw two Undead minions." -> {count: 2, group: 'Undead'} */
function parseMinions(condition: string | null, listed: number, ctx: string): EncounterDef['minions'] {
  if (!listed) return { count: 0, group: null };
  const m = condition ? /draw (a|an|one|two|three) (?:([A-Z][\w-]*(?: [A-Z][\w-]*)?) )?minions?\b/.exec(condition) : null;
  if (!m) {
    // Minion count listed but drawn by a scripted condition (e.g. Iron Mites).
    return { count: 0, group: null };
  }
  const count = COUNT_WORDS[m[1]!] ?? 0;
  if (count !== listed) problems.push(`${ctx}: condition draws ${count} minions but sheet lists ${listed}`);
  return { count, group: m[2] ?? null };
}

// Build -------------------------------------------------------------------

const sheets = await readSheets();
function sheet(name: string): Row[] {
  const s = sheets.get(name);
  if (!s) throw new Error(`missing sheet "${name}"`);
  return s;
}

const heroes: HeroDef[] = [];
const companions: CompanionDef[] = [];
for (const r of sheet('Heroes & Companions').filter(isActive)) {
  const name = reqText(r, 'Name', 'hero/companion');
  const ctx = `"${name}"`;
  const stats = { P: num(r, 'P', ctx, 0, 20), M: num(r, 'M', ctx, 0, 20), G: num(r, 'G', ctx, 0, 20) };
  const type = text(r, 'Type', ctx);
  const common = {
    id: slug(name), name, groups: groups(r, 'Group', ctx), quote: text(r, 'Quote', ctx), art: art(name), stats,
    abilityName: text(r, 'Ability', ctx) ?? '', abilityText: text(r, 'Ability text', ctx) ?? '',
  };
  if (type === 'Hero') heroes.push({ ...common, kind: 'hero', triggerText: text(r, 'Trigger (heroes)', ctx) ?? '' });
  else if (type === 'Companion') companions.push({ ...common, kind: 'companion' });
  else problems.push(`${ctx}: unknown type ${JSON.stringify(type)}`);
}

// Balance overrides (data/balance.json) on top of the spreadsheet ---------------

const BALANCE = join(here, '..', 'data', 'balance.json');
if (existsSync(BALANCE)) {
  const raw: unknown = JSON.parse(readFileSync(BALANCE, 'utf8'));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('balance.json must be an object');
  for (const [name, change] of Object.entries(raw)) {
    if (name.startsWith('_')) continue;
    const card = [...heroes, ...companions].find((c) => c.name === name);
    if (!card) { problems.push(`balance: no hero or companion named "${name}"`); continue; }
    const c = change as Record<string, unknown>;
    // A rename: the card keeps its sheet row but gets a new name (and so a new id).
    if (typeof c['name'] === 'string' && c['name'].trim()) {
      card.name = c['name'].trim();
      card.id = slug(card.name);
      delete c['name'];
      if (Object.keys(c).length === 0) continue; // nothing else to apply, no revision note needed
    }
    for (const k of Object.keys(c)) {
      if (!['stats', 'abilityName', 'abilityText', 'triggerText', 'note'].includes(k)) problems.push(`balance: "${name}" has unknown field "${k}"`);
    }
    if (c['stats'] !== undefined) {
      const s = c['stats'] as Record<string, unknown>;
      for (const [stat, v] of Object.entries(s)) {
        if (!['P', 'M', 'G'].includes(stat) || !Number.isInteger(v) || (v as number) < 0 || (v as number) > 20) {
          problems.push(`balance: "${name}" has a bad stat ${stat}=${JSON.stringify(v)}`);
        } else card.stats[stat as Stat] = v as number;
      }
    }
    for (const k of ['abilityName', 'abilityText', 'triggerText'] as const) {
      const v = c[k];
      if (v === undefined) continue;
      if (typeof v !== 'string' || !v.trim() || v.length > MAX_TEXT) { problems.push(`balance: "${name}" has a bad ${k}`); continue; }
      if (k === 'triggerText' && card.kind !== 'hero') { problems.push(`balance: "${name}" is not a hero`); continue; }
      (card as unknown as Record<string, unknown>)[k] = v.trim();
    }
    if (typeof c['note'] !== 'string' || !c['note'].trim()) problems.push(`balance: "${name}" needs a note`);
    else card.revision = String(c['note']).trim().slice(0, MAX_TEXT);
  }
}

const locations: LocationDef[] = sheet('Locations').filter(isActive).map((r) => {
  const name = reqText(r, 'Name', 'location');
  const ctx = `"${name}"`;
  return {
    kind: 'location', id: slug(name), name, groups: groups(r, 'Groups', ctx), quote: text(r, 'Quote', ctx), art: art(name),
    renown: num(r, 'Renown', ctx, 0, 20), conditionText: text(r, 'Condition', ctx),
  };
});

const tieStat = new Map<string, Stat>();
{
  const raw = JSON.parse(readFileSync(join(here, '..', 'data', 'encounter-stats.json'), 'utf8')) as Record<string, unknown>;
  for (const stat of ['P', 'M', 'G'] as Stat[]) for (const n of (raw[stat] as string[] | undefined) ?? []) tieStat.set(n, stat);
}

const bumps = (JSON.parse(readFileSync(join(here, '..', 'data', 'encounter-difficulty.json'), 'utf8')) as { bumps: Record<string, number> }).bumps;

const encounters: EncounterDef[] = sheet('Encounters').filter(isActive).map((r) => {
  const name = reqText(r, 'Name', 'encounter');
  const ctx = `"${name}"`;
  const conditionText = text(r, 'Conditions', ctx);
  // One stat per encounter: its highest printed difficulty; ties are settled in data/encounter-stats.json.
  const finals = (['P', 'M', 'G'] as Stat[]).map((stat) => ({ stat, difficulty: num(r, `${stat} final`, `${ctx} ${stat}`, 0, 40) }));
  const top = Math.max(...finals.map((f) => f.difficulty));
  let tops = finals.filter((f) => f.difficulty === top);
  if (tops.length > 1) {
    const pick = tieStat.get(name);
    if (!pick) problems.push(`${ctx}: ties for highest difficulty (${tops.map((f) => f.stat).join('/')}) and is not listed in encounter-stats.json`);
    else if (!tops.some((f) => f.stat === pick)) problems.push(`${ctx}: encounter-stats.json picks ${pick}, which is not tied for highest`);
    else tops = tops.filter((f) => f.stat === pick);
  } else if (tieStat.has(name)) problems.push(`${ctx}: listed in encounter-stats.json but does not tie`);
  const { stat, difficulty: printed } = tops[0]!;
  const bump = bumps[name];
  if (!Number.isInteger(bump) || bump! < 1 || bump! > 3) problems.push(`${ctx}: encounter-difficulty.json needs a bump of 1 to 3`);
  const difficulty = printed + (bump ?? 0);
  return {
    kind: 'encounter', id: slug(name), name, groups: groups(r, 'Group', ctx), quote: text(r, 'Quote', ctx), art: art(name),
    minionValue: num(r, 'Minion value', ctx, -20, 20),
    minions: parseMinions(conditionText, num(r, 'Minions to draw', ctx, 0, 5), ctx),
    conditionText, stat, difficulty,
  };
});

const resources: ResourceDef[] = sheet('Resources').filter(isActive).map((r) => {
  const name = reqText(r, 'Name', 'resource');
  const ctx = `"${name}"`;
  return {
    kind: 'resource', id: slug(name), name, groups: [], quote: text(r, 'Quote', ctx), art: art(name),
    value: num(r, 'Value', ctx, -20, 20), wand: r['Wand'] === 1, council: r['Council'] === 1,
    conditionText: text(r, 'Condition', ctx),
  };
});

for (const name of artMap.keys()) if (!usedArtNames.has(name)) problems.push(`art-map: "${name}" doesn't match any active card`);

// Cross-check counts against the statistics sheet.
const expected: Record<string, number> = {};
for (const r of sheets.get('Game Statistics') ?? []) {
  const label = Object.values(r)[0];
  const count = Object.values(r)[1];
  if (typeof label === 'string' && typeof count === 'number') expected[label] = count;
}
const actual = { Heroes: heroes.length, Companions: companions.length, Locations: locations.length, Encounters: encounters.length, Resources: resources.length };
for (const [k, n] of Object.entries(actual)) {
  if (expected[k] !== undefined && expected[k] !== n) problems.push(`count mismatch for ${k}: sheet says ${expected[k]}, parsed ${n}`);
}

if (problems.length) {
  console.error(`Card build failed with ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

const db: CardDatabase = { version: 'v0.3', heroes, companions, locations, encounters, resources };
const numbered = applyCardNumbers(db);
if (numbered) console.log(`gave ${numbered} new card(s) a number (data/card-numbers.json)`);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(db, null, 1) + '\n');
const withArt = [...heroes, ...companions, ...locations, ...encounters, ...resources].filter((c) => c.art).length;
console.log(`Wrote ${OUT}\n  ${JSON.stringify(actual)}\n  ${withArt} cards have art`);
if (!existsSync(OUT)) process.exit(1);
