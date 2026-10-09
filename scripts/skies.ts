// Make the painted skies with Gemini.
//   npm run skies -- list                       what there is to make, and what is made and installed
//   npm run skies -- prompts [--only a,b]       the full prompts, to paste into the Gemini app by hand
//   npm run skies -- generate [--only a,b]      ask Gemini for each one that is not made yet (--force: again)
//   npm run skies -- install [--only a,b]       copy made pictures into public/locations and the manifest
//
// The pictures to make, and what each shows, are the tables of art/SKYBOX-BRIEF-LOCATIONS.md. The key is read from the
// GEMINI_API_KEY environment variable and is never printed. Made pictures are kept in _build/art-work/skies/ (not in git)
// until they are installed. A picture that is not 2:1 is a flat strip (see src/client/render/env/strip.ts).
//
// Options: --model <id>  --api interactions|generate  --ratio 4:1  --size 4K  --dry (print, do not ask)

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt, findImage, imageInfo, parseBrief, RATIOS, SIZES, type SkyBrief } from './skies-lib.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRIEF = join(root, 'art', 'SKYBOX-BRIEF-LOCATIONS.md');
const WORK = join(root, '_build', 'art-work', 'skies');
const LOCATIONS = join(root, 'public', 'locations');
const MANIFEST = join(LOCATIONS, 'manifest.json');
const HOST = 'https://generativelanguage.googleapis.com/v1beta';
/** The models to try, best first: the one the Gemini docs recommend for new work, then the generation before it, then the premium one. */
const MODELS = ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3-pro-image'];

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const argv = process.argv.slice(2);
const command = argv.find((a) => !a.startsWith('--')) ?? 'list';
const flag = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name: string): boolean => argv.includes(`--${name}`);

const all = parseBrief(readFileSync(BRIEF, 'utf8'));
const only = flag('only')?.split(',').map((s) => s.trim()).filter(Boolean);
if (only) for (const id of only) if (!all.some((b) => b.id === id)) { console.error(`No painting called "${id}". Try: npm run skies -- list`); process.exit(1); }
const chosen = all.filter((b) => !only || only.includes(b.id));

const madeFile = (id: string): string | null => {
  for (const ext of ['jpg', 'png', 'webp']) { const p = join(WORK, `${id}.${ext}`); if (existsSync(p)) return p; }
  return null;
};
/** How many pixels across a picture is shrunk to on install. */
const MAX_WIDTH = 4096;
const kb = (n: number): string => `${Math.round(n / 1024)} KB`;

/** One request for one picture. */
async function ask(key: string, api: string, model: string, prompt: string, ratio: string, size: string): Promise<{ data: Buffer; mime: string }> {
  const url = api === 'interactions' ? `${HOST}/interactions` : `${HOST}/models/${model}:generateContent`;
  const body = api === 'interactions'
    ? { model, input: prompt, response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: ratio, image_size: size } }
    : { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ratio, imageSize: size } } };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    const e = (Array.isArray(json) ? json[0] : json) as { error?: { message?: string } } | null;
    throw new ApiError(res.status, e?.error?.message ?? text.slice(0, 300));
  }
  const img = findImage(json);
  if (!img) throw new ApiError(200, `the reply held no image (${text.slice(0, 200).replace(/"data":"[^"]*"/g, '"data":"…"')})`);
  return { data: Buffer.from(img.data, 'base64'), mime: img.mime };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The way of asking that worked last time, so only the first picture has to find it. */
let working: { api: string; model: string; ratio: string; size: string } | null = null;

async function make(key: string, b: SkyBrief): Promise<{ data: Buffer; mime: string; how: NonNullable<typeof working> }> {
  const prompt = buildPrompt(b);
  const apis = flag('api') ? [flag('api')!] : ['interactions', 'generate'];
  const models = flag('model') ? [flag('model')!] : MODELS;
  const ratios = flag('ratio') ? [flag('ratio')!] : [...RATIOS];
  const sizes = flag('size') ? [flag('size')!] : [...SIZES];
  const combos = working
    ? [working]
    : apis.flatMap((api) => models.flatMap((model) => ratios.flatMap((ratio) => sizes.map((size) => ({ api, model, ratio, size })))));
  const notes: string[] = [];
  for (const how of combos) {
    for (let attempt = 0; ; attempt++) {
      try {
        const out = await ask(key, how.api, how.model, prompt, how.ratio, how.size);
        working = how;
        return { ...out, how };
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        // Out of money, or not allowed: nothing else will work either.
        if ([401, 402, 403].includes(e.status)) throw e;
        if ((e.status === 429 || e.status >= 500) && attempt < 3) { await sleep(15_000 * (attempt + 1)); continue; }
        notes.push(`${how.api} ${how.model} ${how.ratio} ${how.size}: ${e.status} ${e.message.slice(0, 160)}`);
        // A refusal of this prompt (not of the way of asking) is not worth trying the other ways for.
        if (e.status === 400 && /safety|blocked|prohibited|policy/i.test(e.message)) throw new ApiError(400, `refused: ${e.message.slice(0, 200)}`);
        break;
      }
    }
  }
  throw new ApiError(400, `no way of asking worked:\n  ${notes.slice(-6).join('\n  ')}`);
}

async function generate(): Promise<void> {
  const key = process.env.GEMINI_API_KEY;
  if (!key && !has('dry')) { console.error('Set the GEMINI_API_KEY environment variable first.'); process.exit(1); }
  mkdirSync(WORK, { recursive: true });
  let made = 0;
  let failed = 0;
  for (const b of chosen) {
    if (!has('force') && madeFile(b.id)) { console.log(`skip  ${b.id} (made already; --force to make it again)`); continue; }
    if (has('dry')) { console.log(`\n${b.id} (${b.kind})\n${buildPrompt(b)}`); continue; }
    try {
      const r = await make(key!, b);
      const ext = r.mime.includes('png') ? 'png' : r.mime.includes('webp') ? 'webp' : 'jpg';
      const file = join(WORK, `${b.id}.${ext}`);
      writeFileSync(file, r.data);
      const info = imageInfo(r.data);
      writeFileSync(join(WORK, `${b.id}.json`), `${JSON.stringify({ id: b.id, prompt: buildPrompt(b), ...r.how, bytes: r.data.length, width: info?.width, height: info?.height, made: new Date().toISOString() }, null, 2)}\n`);
      const shape = info ? `${info.width}x${info.height}` : 'unknown size';
      const warn = info && Math.abs(info.width / info.height - 2) < 0.1 ? '  WARNING: about 2:1, so the game would take it for a whole-sky panorama' : '';
      console.log(`made  ${b.id}  ${shape}  ${kb(r.data.length)}  (${r.how.model}, ${r.how.ratio}, ${r.how.size})${warn}`);
      made++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`FAIL  ${b.id}: ${msg}`);
      failed++;
      if (e instanceof ApiError && [401, 402, 403].includes(e.status)) { console.error('Stopping: the key was refused (credits, billing or permission). Nothing more was asked.'); break; }
    }
    await sleep(1500);
  }
  console.log(`\n${made} made, ${failed} failed. Pictures are in ${WORK}.`);
  if (made) console.log('Look at them, then: npm run skies -- install');
}

function install(): void {
  const manifest = existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, Record<string, unknown>>) : {};
  let n = 0;
  for (const b of chosen) {
    const src = madeFile(b.id);
    if (!src) { console.log(`skip  ${b.id} (not made yet)`); continue; }
    const ext = src.endsWith('.png') ? 'png' : src.endsWith('.webp') ? 'webp' : 'jpg';
    const name = `${b.id}_sky.${ext}`;
    const dest = join(LOCATIONS, name);
    // The game shows a picture no sharper than about 4100 pixels across, so a bigger one is shrunk (with ffmpeg, if there is one).
    const info = imageInfo(readFileSync(src));
    let note = '';
    if (info && info.width > MAX_WIDTH && ext === 'jpg') {
      const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=${MAX_WIDTH}:-2`, '-q:v', '2', dest]);
      if (r.status === 0) note = `  (shrunk from ${info.width} to ${MAX_WIDTH} across)`;
      else { copyFileSync(src, dest); note = '  (not shrunk: ffmpeg not found)'; }
    } else copyFileSync(src, dest);
    manifest[b.id] = { ...(manifest[b.id] ?? {}), sky: name };
    const size = statSync(dest).size;
    console.log(`install  ${name}  ${kb(size)}${note}${size > 4 * 1024 * 1024 ? '  (big: over 4 MB)' : ''}`);
    n++;
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n${n} installed. Check each in the game (debug menu, Location look).`);
}

if (command === 'list') {
  let made = 0;
  let installed = 0;
  const manifest = existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, { sky?: string }>) : {};
  for (const b of chosen) {
    const m = madeFile(b.id) !== null;
    const i = Boolean(manifest[b.id]?.sky);
    if (m) made++;
    if (i) installed++;
    console.log(`${b.kind.padEnd(8)} ${b.id.padEnd(30)} ${m ? 'made     ' : 'not made '} ${i ? 'installed' : ''}`);
  }
  console.log(`\n${chosen.length} paintings: ${made} made, ${installed} installed.`);
} else if (command === 'prompts') {
  for (const b of chosen) console.log(`\n## ${b.id} (${b.kind})\n${buildPrompt(b)}`);
} else if (command === 'generate') {
  await generate();
} else if (command === 'install') {
  install();
} else {
  console.error('Commands: list, prompts, generate, install');
  process.exit(1);
}
