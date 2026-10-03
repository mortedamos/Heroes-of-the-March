// Command validation and application.
//
// SECURITY: this is the trust boundary. `raw` may be anything a malicious
// client can put in a JSON message. We:
//   1. parse it against a strict allowlist schema (types, lengths, no extra keys),
//   2. check it answers the pending decision (id match rejects stale/replayed commands),
//   3. check the *host-supplied* seat owns that decision,
//   4. apply it to a clone, so a failure part-way can never corrupt the real state.
// Errors returned to clients are short codes and never include internals.

import { Ctx, IllegalMove } from './context';
import { companionCount, companionEnters, maxCompanions, noteMultiBid } from './effects';
import { advance, applyChoice, resolveBid, useActivation } from './flow';
import type { CardId, Command, GameEvent, GameState, PlayerId } from './types';

export const MAX_COMMAND_BYTES = 2048;
const CARD_ID = /^[a-z0-9]{1,32}$/;
const ABILITY_ID = /^[a-zA-Z]{1,24}$/;
const PICK = /^[a-z0-9:-]{1,64}$/;
const MAX_PICKS = 8;

type Check = (v: unknown) => boolean;
interface Schema { required: Record<string, Check>; optional?: Record<string, Check> }
const isDecision: Check = (v) => Number.isSafeInteger(v) && (v as number) > 0;
const isCardId: Check = (v) => typeof v === 'string' && CARD_ID.test(v);
const isCardIdOrNull: Check = (v) => v === null || isCardId(v);
const isBool: Check = (v) => typeof v === 'boolean';
const isAbilityId: Check = (v) => typeof v === 'string' && ABILITY_ID.test(v);
const isPicks: Check = (v) =>
  Array.isArray(v) && v.length <= MAX_PICKS && v.every((x) => typeof x === 'string' && PICK.test(x)) && new Set(v).size === v.length;

const SCHEMAS: Record<Command['type'], Schema> = {
  'companion.draw': { required: { decision: isDecision } },
  'companion.skip': { required: { decision: isDecision } },
  'companion.keep': { required: { decision: isDecision, replace: isCardIdOrNull } },
  'companion.discard': { required: { decision: isDecision } },
  'bid.play': { required: { decision: isDecision, card: isCardId }, optional: { faceDown: isBool } },
  'bid.pass': { required: { decision: isDecision } },
  'ability.use': { required: { decision: isDecision, source: isCardId, ability: isAbilityId } },
  'ability.done': { required: { decision: isDecision } },
  'choose': { required: { decision: isDecision, picks: isPicks } },
};

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Validate an untrusted value as a Command, or throw IllegalMove('bad_command'). */
export function parseCommand(raw: unknown): Command {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new IllegalMove('bad_command');
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) throw new IllegalMove('bad_command');
  const obj = raw as Record<string, unknown>;
  const type = obj['type'];
  if (typeof type !== 'string' || !has(SCHEMAS, type)) throw new IllegalMove('bad_command');
  const schema = SCHEMAS[type as Command['type']];
  const optional = schema.optional ?? {};
  for (const k of Object.keys(obj)) {
    if (k === 'type') continue;
    const check = has(schema.required, k) ? schema.required[k] : has(optional, k) ? optional[k] : undefined;
    if (!check || !check(obj[k])) throw new IllegalMove('bad_command');
  }
  for (const k of Object.keys(schema.required)) if (!has(obj, k)) throw new IllegalMove('bad_command');
  // Rebuild from validated fields only: nothing else from the input survives.
  const out: Record<string, unknown> = { type };
  for (const k of [...Object.keys(schema.required), ...Object.keys(optional)]) {
    if (!has(obj, k)) continue;
    out[k] = Array.isArray(obj[k]) ? [...(obj[k] as unknown[])] : obj[k];
  }
  return out as Command;
}

export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };

/**
 * Apply an untrusted command from `seat`. `seat` MUST come from the host's
 * authenticated connection, never from the message itself.
 */
export function applyCommand(state: GameState, seat: PlayerId, raw: unknown): ApplyResult {
  let cmd: Command;
  try {
    cmd = parseCommand(raw);
  } catch {
    return { ok: false, error: 'bad_command' };
  }
  if (state.winner !== null || state.turn.step === 'gameOver') return { ok: false, error: 'game_over' };
  if (state.hold) return { ok: false, error: 'paused' };
  const d = state.pending;
  if (!d) return { ok: false, error: 'no_decision_pending' };
  if (cmd.decision !== d.id) return { ok: false, error: 'stale_decision' };
  if (d.player !== seat) return { ok: false, error: 'not_your_decision' };

  const next = structuredClone(state);
  const ctx = new Ctx(next);
  try {
    handle(ctx, seat, cmd);
    advance(ctx);
  } catch (e) {
    if (e instanceof IllegalMove) return { ok: false, error: e.code };
    // Unexpected engine fault: keep the old state, surface a generic error.
    console.error('[engine] internal error applying command', cmd.type, e);
    return { ok: false, error: 'internal_error' };
  }
  next.version += 1;
  return { ok: true, state: next, events: ctx.events };
}

/**
 * Continue past a presentation checkpoint. Host-only: this is never reachable
 * from a client message (clients can only send Commands).
 */
export function resume(state: GameState): ApplyResult {
  if (!state.hold) return { ok: false, error: 'not_paused' };
  const next = structuredClone(state);
  next.hold = null;
  const ctx = new Ctx(next);
  try {
    advance(ctx);
  } catch (e) {
    console.error('[engine] internal error while resuming', e);
    return { ok: false, error: 'internal_error' };
  }
  next.version += 1;
  return { ok: true, state: next, events: ctx.events };
}

const KIND_FOR: Record<Command['type'], ReadonlyArray<string>> = {
  'companion.draw': ['companion.offer'], 'companion.skip': ['companion.offer'],
  'companion.keep': ['companion.place'], 'companion.discard': ['companion.place'],
  'bid.play': ['bid'], 'bid.pass': ['bid'],
  'ability.use': ['bid', 'activate'], 'ability.done': ['activate'],
  'choose': ['choose'],
};

function handle(ctx: Ctx, seat: PlayerId, cmd: Command): void {
  const s = ctx.s;
  const d = s.pending!;
  const p = ctx.player(seat);
  if (!KIND_FOR[cmd.type].includes(d.kind)) throw new IllegalMove('wrong_command_for_decision');
  s.pending = null;

  switch (cmd.type) {
    case 'companion.draw': {
      // One companion at random: keep it (replacing one at the limit) or let it go.
      const card = ctx.take('companion');
      if (!card) { s.turn.cursor += 1; return; }
      ctx.emit({ type: 'drew', player: p.id, deck: 'companion', cards: [ctx.ref(card)], reason: 'Companion phase' });
      ctx.decide({ kind: 'companion.place', player: p.id, drawn: card, mustReplace: companionCount(p) >= maxCompanions(ctx, p, card) });
      return;
    }
    case 'companion.skip':
      ctx.emit({ type: 'companionSkipped', player: p.id });
      s.turn.cursor += 1;
      return;
    case 'companion.keep': {
      if (d.kind !== 'companion.place') throw new IllegalMove('wrong_command_for_decision');
      const replace = cmd.replace;
      if (replace !== null && !p.companions.includes(replace) && !p.inactiveCompanions.includes(replace) && !p.resting.includes(replace)) {
        throw new IllegalMove('not_your_companion');
      }
      if (d.mustReplace && replace === null) throw new IllegalMove('must_replace');
      companionEnters(ctx, p, d.drawn, replace);
      s.turn.cursor += 1;
      return;
    }
    case 'companion.discard': {
      if (d.kind !== 'companion.place') throw new IllegalMove('wrong_command_for_decision');
      ctx.discard('companion', d.drawn);
      ctx.emit({ type: 'companionDeclined', player: p.id, card: ctx.ref(d.drawn) });
      s.turn.cursor += 1;
      return;
    }
    case 'bid.play': {
      if (d.kind !== 'bid') throw new IllegalMove('wrong_command_for_decision');
      const idx = p.hand.indexOf(cmd.card as CardId);
      if (idx < 0) throw new IllegalMove('card_not_in_hand');
      if (cmd.faceDown && !d.canFaceDown) throw new IllegalMove('must_bid_face_up');
      p.hand.splice(idx, 1);
      const faceUp = d.faceUp && !cmd.faceDown;
      const bid = { card: cmd.card, visible: faceUp, resolved: false, playedFaceUp: faceUp };
      p.bids.push(bid);
      ctx.emit({ type: 'bid', player: p.id, card: ctx.ref(cmd.card), faceUp });
      if (faceUp) { resolveBid(ctx, p, bid); noteMultiBid(ctx, p); }
      s.turn.passesInARow = 0;
      s.turn.bidder = (s.turn.bidder + 1) % s.players.length;
      return;
    }
    case 'bid.pass':
      ctx.emit({ type: 'passed', player: p.id, auto: false });
      s.turn.passesInARow += 1;
      s.turn.bidder = (s.turn.bidder + 1) % s.players.length;
      return;
    case 'ability.use': {
      if (d.kind === 'bid') {
        useActivation(ctx, p, 'bidding', cmd.source, cmd.ability);
        // Acting keeps bidding open: everyone gets another chance to respond.
        s.turn.passesInARow = 0;
      } else if (d.kind === 'activate') {
        useActivation(ctx, p, d.window, cmd.source, cmd.ability);
      }
      return;
    }
    case 'ability.done':
      s.turn.cursor += 1;
      return;
    case 'choose': {
      if (d.kind !== 'choose') throw new IllegalMove('wrong_command_for_decision');
      const picks = cmd.picks;
      if (picks.length < d.min || picks.length > d.max) throw new IllegalMove('bad_pick_count');
      if (!picks.every((x) => d.options.some((o) => o.value === x))) throw new IllegalMove('bad_pick');
      applyChoice(ctx, d, picks);
      return;
    }
  }
}
