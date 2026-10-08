// Turn flow: a step machine that runs until it needs a player decision.
// Queued tasks (card effects) always run before the next step.
//
// Turn order:
//   turnStart -> [turnStart window] -> companions -> location -> [afterLocation window]
//   -> encounter -> challenge (the encounter's one stat is announced) -> [beforeBidding window] -> bidding
//   (activated abilities may be used on your bidding decisions) -> [beforeReveal window] -> reveal
//   -> [endOfBidding window] -> resolve -> turnEnd

import { abilityOf, peekTop, type OwnedSource } from './abilities';
import type { Ctx } from './context';
import { IllegalMove } from './context';
import type { CompanionDef, EncounterDef, Stat } from './cardTypes';
import {
  activeAbility, activeEffects, addEffect, cardOption, companionCount, companionEnters, councilHeroes, disabledCards, discardCompanion,
  drawRaw, drawResources, enforceCompanionLimit, fire, maxCompanions, flushOpeningEntrants, noteMultiBid, hasGroup, leaveLocation, locationEnters, ownerOf, peekOption,
  playerHas, replaceLocation, statName,
} from './effects';
import { OPENING_COMPANION_POOL } from './rules';
import { nextFloat } from './rng';
import { ALL_VISIBLE, challengeStat, difficultyFor, resourceValue, totalFor } from './totals';
import {
  NO_HERO,
  type AbilityOption, type AbilityWindow, type Bid, type CardId, type ChooseTask, type ChoosePurpose, type DeckName,
  type HoldReason, type PlayerId, type PlayerState, type ResultPart, type Step, type Task, type TurnResult,
} from './types';

export function drawSize(ctx: Ctx): number {
  const r = ctx.s.rules.drawSize;
  return r === 'playerCount' ? ctx.s.players.length : r;
}

/**
 * Once everyone has a hero: each player's starting companions and resource
 * hand. The hero comes first: you choose who you are, then who rides with you
 * (the opening companion draft; nobody is dealt companions).
 */
export function dealStartingTeams(ctx: Ctx): void {
  const size = drawSize(ctx);
  for (const p of ctx.s.players) {
    for (let i = 0; i < size; i++) {
      const c = ctx.take('resource');
      if (c) p.hand.push(c);
    }
    ctx.emit({ type: 'drew', player: p.id, deck: 'resource', cards: p.hand.map((c) => ctx.ref(c)), reason: 'Setup' });
  }
}

export function advance(ctx: Ctx): void {
  let guard = 0;
  while (!ctx.s.pending && !ctx.s.hold && ctx.s.turn.step !== 'gameOver') {
    if (++guard > 10_000) throw new Error('advance: runaway loop');
    const task = ctx.s.tasks.shift();
    if (task) { runTask(ctx, task); continue; }
    const step = ctx.s.turn.step;
    const eventsBefore = ctx.events.length;
    STEPS[step](ctx);
    if (ctx.s.autoPause) ctx.s.hold = holdAfter(ctx, step, eventsBefore);
  }
}

/**
 * Presentation checkpoints: pause after steps players should get to see
 * (the host resumes after a delay). Purely pacing; never changes rules.
 */
function holdAfter(ctx: Ctx, ran: Step, eventsBefore: number): HoldReason | null {
  if (ctx.s.pending || ctx.s.turn.step === 'gameOver') return null;
  switch (ran) {
    case 'location': return 'location'; // the place is shown before anything happens in it
    case 'encounter': return 'encounter';
    case 'reveal': return ctx.events.slice(eventsBefore).some((e) => e.type === 'revealed') ? 'reveal' : null;
    case 'resolve': return 'resolve';
    default: return null;
  }
}

function goTo(ctx: Ctx, step: Step): void {
  const t = ctx.s.turn;
  t.step = step;
  t.cursor = 0;
  if (step === 'bidding') {
    t.bidder = t.active;
    t.passesInARow = 0;
  }
}

// --- activated abilities -------------------------------------------------------

function usageKey(card: CardId, ability: string): string {
  return `${card}:${ability}`;
}

/** Activated abilities `p` may use right now in `window`. */
export function availableActivations(ctx: Ctx, p: PlayerState, window: AbilityWindow): AbilityOption[] {
  const t = ctx.s.turn;
  const out: AbilityOption[] = [];
  const isOwnTurn = p === ctx.active;
  const off = disabledCards(ctx);
  const sources: { card: CardId; kind: 'hero' | 'companion' }[] = [
    { card: p.hero, kind: 'hero' }, ...p.companions.map((c) => ({ card: c, kind: 'companion' as const })),
  ];
  for (const src of sources) {
    if (off.has(src.card)) continue;
    const acts = abilityOf(ctx.defId(src.card))?.activations;
    if (!acts) continue;
    for (const act of acts) {
      if (!act.windows.includes(window)) continue;
      if (act.turn === 'own' && !isOwnTurn) continue;
      if (act.turn === 'others' && isOwnTurn) continue;
      const key = usageKey(src.card, act.id);
      if (act.per === 'game') {
        if ((p.used[key] ?? 0) > 0) continue;
      } else {
        const n = t.used[key] ?? 0;
        // Hesk of Two Homes: once per turn, re-use another companion's once-per-turn ability.
        const heskReuse = n === 1 && src.kind === 'companion' && !t.used[`hesk:${p.id}`] && playerHas(ctx, p, (a) => a.reuseCompanionAbility) !== src.card && playerHas(ctx, p, (a) => a.reuseCompanionAbility) !== null;
        if (n > 0 && !heskReuse) continue;
      }
      const self: OwnedSource = { card: src.card, owner: p.id, kind: src.kind };
      if (act.canUse && !act.canUse(ctx, self)) continue;
      out.push({ source: src.card, ability: act.id, label: act.label });
    }
  }
  return out;
}

/** Use an activated ability. Throws IllegalMove if it isn't available in this window. */
export function useActivation(ctx: Ctx, p: PlayerState, window: AbilityWindow, source: CardId, abilityId: string): void {
  if (!availableActivations(ctx, p, window).some((o) => o.source === source && o.ability === abilityId)) {
    throw new IllegalMove('ability_unavailable');
  }
  const act = abilityOf(ctx.defId(source))!.activations!.find((a) => a.id === abilityId)!;
  const key = usageKey(source, abilityId);
  const t = ctx.s.turn;
  if (act.per === 'game') p.used[key] = 1;
  else {
    if ((t.used[key] ?? 0) > 0) t.used[`hesk:${p.id}`] = 1;
    t.used[key] = (t.used[key] ?? 0) + 1;
  }
  ctx.emit({ type: 'abilityUsed', player: p.id, source: ctx.ref(source), ability: abilityId, label: act.label });
  // Aldric's player gets to answer before it resolves.
  const shield = counterer(ctx, p);
  if (shield) {
    ctx.queueFirst({
      t: 'choose', purpose: 'counterAbility', player: shield.owner, source: ctx.def(shield.card).name,
      prompt: `${p.name} used ${ctx.def(source).name}. Counter it with Shield of the Dawn?`,
      options: [{ value: 'counter', label: 'Counter it' }, { value: 'allow', label: 'Let it resolve' }],
      min: 1, max: 1, data: { user: p.id, source, ability: abilityId, shield: shield.card },
    });
    return;
  }
  runActivation(ctx, p, source, abilityId);
}

function runActivation(ctx: Ctx, p: PlayerState, source: CardId, abilityId: string): void {
  const act = abilityOf(ctx.defId(source))!.activations!.find((a) => a.id === abilityId)!;
  act.use(ctx, { card: source, owner: p.id, kind: source === p.hero ? 'hero' : 'companion' });
}

/** The first other player (clockwise) holding a live counter ability (Aldric) that is still unused this turn. */
function counterer(ctx: Ctx, user: PlayerState): { card: CardId; owner: PlayerId } | null {
  const off = disabledCards(ctx);
  for (const o of ctx.clockwise()) {
    if (o.id === user.id) continue;
    for (const card of [o.hero, ...o.companions]) {
      if (off.has(card) || !abilityOf(ctx.defId(card))?.counter) continue;
      if ((ctx.s.turn.used[usageKey(card, 'shield')] ?? 0) > 0) continue;
      return { card, owner: o.id };
    }
  }
  return null;
}

/** Walk players clockwise from the current player, offering abilities usable in this window. */
function runWindow(ctx: Ctx, window: AbilityWindow, next: Step): void {
  const t = ctx.s.turn;
  const n = ctx.s.players.length;
  while (t.cursor < n) {
    const p = ctx.s.players[(t.active + t.cursor) % n]!;
    const abilities = availableActivations(ctx, p, window);
    if (abilities.length) {
      ctx.decide({ kind: 'activate', player: p.id, window, abilities });
      return;
    }
    t.cursor += 1;
  }
  goTo(ctx, next);
}

// --- encounter helpers -------------------------------------------------------------

/** Reveal the top encounter and its minions. Returns false if the stack is exhausted. */
export function revealEncounter(ctx: Ctx): boolean {
  const t = ctx.s.turn;
  // An encounter found by a location's search (The Frostfells) is this turn's encounter.
  const found = t.chosenEncounter;
  t.chosenEncounter = null;
  let card = found ?? ctx.take('encounter');
  if (!card) return false;
  // Destiny the Frog: a Skarra encounter is drawn and becomes the encounter; Destiny becomes its minion.
  let sidekick: CardId | null = null;
  const fetch = abilityOf(ctx.defId(card))?.fetchesGroup;
  if (fetch) {
    const other = ctx.takeMatching('encounter', (c) => hasGroup(ctx.def(c), fetch));
    if (other) { sidekick = card; card = other; }
  }
  t.encounter = card;
  ctx.emit({ type: 'encounterRevealed', card: ctx.ref(card) });
  fire(ctx, 'encounterEntered', { card, asMinion: false });
  // Minions (which never draw minions of their own).
  const def = ctx.def(card) as EncounterDef;
  const addMinion = (m: CardId) => {
    t.minions.push(m);
    ctx.emit({ type: 'minionDrawn', card: ctx.ref(m) });
    fire(ctx, 'encounterEntered', { card: m, asMinion: true });
    fire(ctx, 'minionDrawn', { card: m });
  };
  if (sidekick) addMinion(sidekick);
  for (let i = 0; i < (sidekick ? 0 : def.minions.count); i++) {
    const group = def.minions.group;
    // Skarra's minion can be anyone but another Skarra.
    const skarra = hasGroup(def, 'Skarra') && !group;
    const m = group ? ctx.takeMatching('encounter', (c) => hasGroup(ctx.def(c), group))
      : skarra ? ctx.takeMatching('encounter', (c) => !hasGroup(ctx.def(c), 'Skarra')) : ctx.take('encounter');
    if (!m) break;
    addMinion(m);
  }
  // Barrowdeep: an Undead encounter draws one extra Undead minion.
  const extra = ctx.location ? abilityOf(ctx.location.id)?.extraMinion : undefined;
  if (extra && hasGroup(def, extra)) {
    const m = ctx.takeMatching('encounter', (c) => hasGroup(ctx.def(c), extra));
    if (m) addMinion(m);
  }
  return true;
}

/** End of an encounter: the main card and minions are discarded. */
function discardEncounterCards(ctx: Ctx, main: CardId | null, minions: CardId[]): void {
  if (main) ctx.discard('encounter', main);
  for (const m of minions) ctx.discard('encounter', m);
}

function announceChallenge(ctx: Ctx): void {
  const enc = ctx.encounter!;
  const stat = challengeStat(ctx, null) ?? enc.stat;
  ctx.emit({ type: 'challengeSelected', stat, difficulty: difficultyFor(ctx, null)?.total ?? enc.difficulty });
  fire(ctx, 'challengeFaced', { stat, player: ctx.active.id });
}

/** Pick Your Fight: discard the encounter and minions, draw a new one and announce its challenge. */
export function replaceEncounter(ctx: Ctx, reason: string): void {
  const t = ctx.s.turn;
  if (t.encounter) {
    ctx.emit({ type: 'encounterReplaced', from: ctx.ref(t.encounter), reason });
  }
  discardEncounterCards(ctx, t.encounter, t.minions);
  for (const c of t.companionMinions) ctx.discard('companion', c);
  t.encounter = null;
  t.minions = [];
  t.companionMinions = [];
  if (!revealEncounter(ctx)) return;
  announceChallenge(ctx);
  fire(ctx, 'encounterReplaced', { player: ctx.active.id });
  t.passesInARow = 0;
}

// --- steps ---------------------------------------------------------------------------

const STEPS: Record<Step, (ctx: Ctx) => void> = {
  /** Opening hero draft: clockwise from the first player, look at N heroes, keep one. Then deal teams. */
  draft(ctx) {
    const p = ctx.clockwise().find((x) => x.hero === NO_HERO);
    if (!p) {
      dealStartingTeams(ctx);
      goTo(ctx, 'companionDraft');
      return;
    }
    queueHeroDraft(ctx, p, 'Choose your hero');
  },

  /** Opening companion draft: clockwise from the first player, each privately fills their two slots from a pool. */
  companionDraft(ctx) {
    const p = ctx.clockwise().find((x) => !x.used['companionDraft']);
    if (!p) { goTo(ctx, 'turnStart'); return; }
    p.used['companionDraft'] = 1;
    // A hero who may keep more companions (Ysolde: three) gets the extra slot here too (the pool stays the same size).
    const extra = Math.max(0, maxCompanions(ctx, p) - ctx.s.rules.maxCompanions);
    const need = Math.max(0, ctx.s.rules.startingCompanions + extra);
    const offered = peekTop(ctx, 'companion', OPENING_COMPANION_POOL);
    if (!offered.length || need === 0) return;
    const n = Math.min(need, offered.length);
    ctx.queueFirst({
      t: 'choose', purpose: 'companionDraft', player: p.id, source: 'Companion draft',
      prompt: `Choose ${n} companion${n === 1 ? '' : 's'} from these ${offered.length}.`,
      options: offered.map((c) => peekOption(ctx, ctx.defId(c), c, ctx.def(c).name)),
      min: n, max: n,
    });
  },

  turnStart(ctx) {
    const t = ctx.s.turn;
    t.number += 1;
    t.result = null;
    if (t.number > ctx.s.rules.maxTurns) return endGame(ctx);
    const p = ctx.active;
    ctx.emit({ type: 'turnStarted', player: p.id, turn: t.number });
    // Resting companions (Tova) return on their controller's turn.
    for (const c of [...p.resting]) {
      p.resting = p.resting.filter((x) => x !== c);
      p.companions.push(c);
      // Shown like any ability: the card comes back up and says what it does.
      if (abilityOf(ctx.defId(c))?.restReturnDraw) ctx.emit({ type: 'abilityUsed', player: p.id, source: ctx.ref(c), ability: 'return', label: 'Turns face up and draws two extra resource cards' });
      ctx.emit({ type: 'companionFaceDown', player: p.id, card: ctx.ref(c), faceDown: false });
      if (abilityOf(ctx.defId(c))?.restReturnDraw) drawResources(ctx, p.id, 2, ctx.def(c).name);
    }
    const r = ctx.s.rules;
    if (r.handModel === 'refill') {
      // v0.3: the current player refills to the draw size.
      const need = drawSize(ctx) - p.hand.length;
      if (need > 0) drawResources(ctx, p.id, need, 'Start of turn');
    } else {
      // Steady: everyone draws a little every turn, up to the hand limit.
      for (const x of ctx.clockwise()) {
        const n = Math.min(x === p ? r.activeDraw : r.othersDraw, r.handLimit - x.hand.length);
        if (n > 0) drawResources(ctx, x.id, n, 'Start of turn');
      }
    }
    fire(ctx, 'turnStart', { player: p.id });
    // Nothing may be used until every player has picked their companions: on the very first turn the
    // start-of-turn abilities wait until the companion phase is over.
    goTo(ctx, t.number === 1 ? 'companions' : 'winTurnStart');
  },

  winTurnStart: (ctx) => runWindow(ctx, 'turnStart', ctx.s.turn.number === 1 ? 'location' : 'companions'),

  companions(ctx) {
    const t = ctx.s.turn;
    // There is no first-turn companion phase: everyone already chose in the opening draft.
    const count = t.number === 1 ? 0 : ctx.s.rules.companionPhase === 'everyone' ? ctx.s.players.length : 1;
    if (t.cursor >= count) {
      if (t.number === 1) {
        goTo(ctx, 'winTurnStart');
        flushOpeningEntrants(ctx); // the opening phase is over: abilities are live
      } else goTo(ctx, 'location');
      return;
    }
    const p = ctx.s.players[(t.active + t.cursor) % ctx.s.players.length]!;
    if (ctx.s.decks.companion.length + ctx.s.discards.companion.length === 0) { t.cursor += 1; return; }
    ctx.decide({ kind: 'companion.offer', player: p.id });
  },

  location(ctx) {
    const card = ctx.take('location');
    if (!card) return endGame(ctx);
    locationEnters(ctx, card, 'Turn');
    goTo(ctx, 'winAfterLocation');
  },

  winAfterLocation: (ctx) => runWindow(ctx, 'afterLocation', 'encounter'),

  encounter(ctx) {
    if (!revealEncounter(ctx)) return endGame(ctx);
    goTo(ctx, 'challenge');
  },

  challenge(ctx) {
    announceChallenge(ctx);
    goTo(ctx, 'winBeforeBidding');
  },

  winBeforeBidding: (ctx) => runWindow(ctx, 'beforeBidding', 'bidding'),

  bidding(ctx) {
    const t = ctx.s.turn;
    const n = ctx.s.players.length;
    if (t.passesInARow >= n) {
      t.revealCursor = t.bidder; // the player who would have bid next
      goTo(ctx, 'winBeforeReveal');
      return;
    }
    const p = ctx.s.players[t.bidder]!;
    const abilities = availableActivations(ctx, p, 'bidding');
    if (p.hand.length === 0 && abilities.length === 0) {
      ctx.emit({ type: 'passed', player: p.id, auto: true });
      t.passesInARow += 1;
      t.bidder = (t.bidder + 1) % n;
      return;
    }
    const faceUp = p.bids.length === 0;
    const canFaceDown = faceUp && Boolean(playerHas(ctx, p, (a) => a.mayBidFaceDown));
    ctx.decide({ kind: 'bid', player: p.id, faceUp, canFaceDown, abilities });
  },

  winBeforeReveal: (ctx) => runWindow(ctx, 'beforeReveal', 'reveal'),

  reveal(ctx) {
    const t = ctx.s.turn;
    const n = ctx.s.players.length;
    for (let i = 0; i < n; i++) {
      const seat = (t.revealCursor + i) % n;
      const p = ctx.s.players[seat]!;
      const bid = p.bids.find((b) => !b.visible);
      if (bid) {
        bid.visible = true;
        ctx.emit({ type: 'revealed', player: p.id, card: ctx.ref(bid.card) });
        resolveBid(ctx, p, bid);
        noteMultiBid(ctx, p);
        t.revealCursor = (seat + 1) % n;
        return;
      }
    }
    goTo(ctx, 'winEndOfBidding');
  },

  winEndOfBidding: (ctx) => runWindow(ctx, 'endOfBidding', 'resolve'),

  resolve(ctx) {
    const t = ctx.s.turn;
    const rows: TurnResult['rows'] = [];
    for (const p of ctx.clockwise()) {
      if (!ctx.s.rules.allPlayersFaceEncounter && p.bids.length === 0) continue;
      const tb = totalFor(ctx, p, ALL_VISIBLE)!;
      const diff = difficultyFor(ctx, p)!.total;
      let total = tb.total;
      const parts: ResultPart[] = [];
      const nm = (c: CardId) => ctx.def(c).name.split(',')[0]!;
      parts.push({ kind: 'hero', card: ctx.ref(p.hero), label: nm(p.hero), value: tb.hero - tb.kin });
      if (tb.kin) parts.push({ kind: 'kin', card: ctx.ref(p.hero), label: 'Kin', value: tb.kin });
      for (const c of tb.companions) parts.push({ kind: 'companion', card: ctx.ref(c.source), label: nm(c.source), value: c.value });
      for (const c of tb.council) parts.push({ kind: 'council', card: null, label: nm(c.source), value: c.value });
      for (const c of tb.resources) parts.push({ kind: 'resource', card: ctx.ref(c.source), label: nm(c.source), value: c.value });
      for (const b of tb.bonuses) parts.push({ kind: b.amount < 0 ? 'penalty' : 'bonus', card: b.source && ctx.s.cards[b.source] ? ctx.ref(b.source) : null, label: b.label, value: b.amount });
      if (total !== tb.total) parts.push({ kind: 'bonus', card: ctx.ref(p.hero), label: nm(p.hero), value: total - tb.total });
      rows.push({ player: p.id, total, difficulty: diff, survived: total >= diff, stat: tb.stat, parts });
    }

    // Mira Coldwater: "You win the current encounter and automatically take the location."
    const auto = activeEffects(ctx, 'autoWin').at(-1);
    let winner: string | null = null;
    let margin: number | null = null;
    /** Survivors level on the highest total: nobody takes the location (see below). */
    let tied: string[] = [];
    let byEffect: string | undefined;
    const survivors = rows.filter((r) => r.survived).sort((a, b) => b.total - a.total);
    if (auto) {
      winner = auto.target;
      byEffect = ctx.def(auto.source).name;
    } else if (survivors.length) {
      const best = survivors[0]!.total;
      const top = survivors.filter((r) => r.total === best).map((r) => r.player);
      if (top.length > 1) tied = top;
      else {
        winner = top[0]!;
        const runnerUp = survivors.find((r) => r.player !== winner);
        const w = survivors.find((r) => r.player === winner)!;
        margin = runnerUp ? w.total - runnerUp.total : w.total - w.difficulty;
      }
    }

    const locations = t.location ? [t.location, ...(winner ? t.extraLocations : [])] : [];
    const result: TurnResult = { stat: challengeStat(ctx, null) ?? 'P', rows, winner, margin, locations, ...(tied.length ? { tied } : {}), ...(byEffect ? { byEffect } : {}) };
    t.result = result;
    ctx.emit({ type: 'outcome', result });

    // Cards that reward the survivors (The Treasure Trow).
    const survivorIds = rows.filter((r) => r.survived).map((r) => r.player);
    if (survivorIds.length) {
      for (const e of [t.encounter, ...t.minions]) {
        if (e) abilityOf(ctx.defId(e))?.onDefeated?.(ctx, { card: e, owner: null, kind: 'encounter' }, survivorIds);
      }
    }
    // Grudges: the winner carries a penalty into the next encounter (Oskar's Grudge Book, The Book of Grudges).
    if (winner) {
      const wp = ctx.player(winner);
      let penalty = 0;
      for (const e of activeEffects(ctx, 'grudge')) if (e.target === winner) { penalty += e.amount ?? 3; ctx.log(winner, ctx.def(e.source).name, `${wp.name} won, and has -${e.amount ?? 3} in the next encounter`); }
      for (const r of rows) {
        if (r.survived || r.player === winner) continue;
        const loser = ctx.player(r.player);
        if (loser.bids.some((b) => b.visible && ctx.defId(b.card) === 'the-book-of-grudges')) {
          penalty += 3;
          ctx.log(loser.id, 'The Book of Grudges', `${wp.name} won, and has -3 in the next encounter`);
        }
      }
      wp.penaltyNext += penalty;
    }

    if (winner && t.location) {
      const wp = ctx.player(winner);
      fire(ctx, 'locationWon', { player: winner, margin: margin ?? 99 });
      const renown = locations.reduce((a, c) => { const d = ctx.def(c); return a + (d.kind === 'location' ? d.renown : 0); }, 0);
      leaveLocation(ctx, t.location);
      wp.claimed.push(...locations);
      wp.renown += renown;
      t.location = null;
      t.extraLocations = [];
      ctx.emit({ type: 'renownGained', player: winner, amount: renown, total: wp.renown, locations: locations.map((c) => ctx.ref(c)) });
    }

    // A tie: the current location is discarded (turnEnd does it) and each tied player instead draws a location
    // at random and claims it. Only the card's Renown counts: its abilities and conditions never trigger.
    if (tied.length && t.location) {
      for (const pid of tied) {
        const prize = ctx.take('location');
        if (!prize) continue;
        const d = ctx.def(prize);
        const renown = d.kind === 'location' ? d.renown : 0;
        const tp = ctx.player(pid);
        tp.claimed.push(prize);
        tp.renown += renown;
        ctx.emit({ type: 'renownGained', player: pid, amount: renown, total: tp.renown, locations: [ctx.ref(prize)] });
      }
    }

    // Who would fall: everyone who failed, plus Mira's player (the price of her ability).
    const falling = rows.filter((r) => !r.survived).map((r) => r.player);
    if (auto) {
      const mp = ctx.player(auto.target);
      for (const c of mp.hand) ctx.discard('resource', c);
      if (mp.hand.length) ctx.log(mp.id, byEffect!, `discards ${mp.hand.length} resource${mp.hand.length === 1 ? '' : 's'}`);
      mp.hand = [];
      if (!falling.includes(mp.id)) falling.push(mp.id);
    }
    for (const pid of falling) {
      const p = ctx.player(pid);
      if (t.noFalls) { ctx.emit({ type: 'fallPrevented', player: p.id, source: 'Shield of Xorthalos' }); continue; }
      if (activeAbility(ctx, p.hero)?.unburied && !p.used['unburied']) {
        p.used['unburied'] = 1;
        ctx.emit({ type: 'fallPrevented', player: p.id, source: ctx.def(p.hero).name });
        drawResources(ctx, p.id, 3, ctx.def(p.hero).name);
        continue;
      }
      if (p.bids.some((b) => ctx.defId(b.card) === 'the-amulet-of-aesia') && !(auto && auto.target === pid)) {
        ctx.emit({ type: 'fallPrevented', player: p.id, source: 'The Amulet of Aesia' });
        drawResources(ctx, p.id, ctx.s.players.length - 1, 'The Amulet of Aesia');
        continue;
      }
      // The Hall of Rest: choose the next hero when this one falls.
      if (p.bids.some((b) => ctx.defId(b.card) === 'the-hall-of-rest')) p.used['hallOfRest'] = 1;
      // Everyone who failed falls at the end of this turn.
      if (!t.failed.includes(p.id)) {
        t.failed.push(p.id);
        ctx.emit({ type: 'heroFalls', player: p.id });
      }
    }
    goTo(ctx, 'turnEnd');
  },

  turnEnd(ctx) {
    const t = ctx.s.turn;
    discardEncounterCards(ctx, t.encounter, t.minions);
    for (const c of t.setAside) ctx.discard('encounter', c);
    for (const c of t.companionMinions) ctx.discard('companion', c);
    t.encounter = null;
    t.minions = [];
    t.setAside = [];
    t.companionMinions = [];
    if (t.location) {
      leaveLocation(ctx, t.location);
      ctx.discard('location', t.location);
      t.location = null;
    }
    // Unclaimed bonus locations were never revealed: return them unseen.
    if (t.extraLocations.length) ctx.returnToDeck('location', t.extraLocations);
    t.extraLocations = [];

    // Mags Tolliver is discarded after she doubles a hero.
    for (const e of t.effects) {
      if (e.kind === 'heroMultiplier' && ctx.defId(e.source) === 'mags-tolliver-market-trader') {
        discardCompanion(ctx, ctx.player(e.owner), e.source, 'Queen for a Day');
      }
    }

    // Gauntlet of Returning: may bring a companion back from the discard pile.
    const gauntletOwners = ctx.s.players.filter((p) => p.bids.some((b) => ctx.defId(b.card) === 'gauntlet-of-returning'));

    const borrowed: string[] = [];
    for (const p of ctx.s.players) {
      for (const b of p.bids) ctx.discard('resource', b.card);
      p.bids = [];
      p.seen = [];
      borrowed.push(...p.councilHeroes);
      p.councilHeroes = [];
      p.statOverride = null;
      // This encounter's penalty ends; a winner's grudge starts with the next one.
      p.penalty = p.penaltyNext;
      p.penaltyNext = 0;
    }
    ctx.returnToDeck('hero', borrowed);
    // One after another: each faller's choices (companion, new hero) finish before the next hero is drawn.
    for (const pid of t.failed) ctx.queue({ t: 'heroFalls', player: pid });
    t.failed = [];
    t.wandsDisabled = false;
    t.noFalls = false;
    t.effects = [];
    t.used = {};
    ctx.emit({ type: 'turnEnded', player: ctx.active.id });

    for (const p of gauntletOwners) {
      const pile = ctx.s.discards.companion;
      if (!pile.length) continue;
      ctx.queue({
        t: 'choose', purpose: 'gauntlet', player: p.id, source: 'Gauntlet of Returning',
        prompt: 'Gauntlet of Returning: bring a companion back from the discard pile?',
        options: pile.map((c) => cardOption(ctx, c)), min: 0, max: 1,
      });
    }

    if (ctx.s.players.some((p) => p.renown >= ctx.s.rules.renownToWin)) return endGame(ctx);
    t.active = (t.active + 1) % ctx.s.players.length;
    goTo(ctx, 'turnStart');
  },

  gameOver() { /* terminal */ },
};

/** House rule: the player(s) with the lowest Renown draw extra resources (unless everyone is tied). */

/** Goldie's Rumour Mill: `p` looks at every face-down card `target` has bid, and remembers them for the rest of the turn. */
export function lookAtBids(ctx: Ctx, p: PlayerState, target: PlayerState, source: string): void {
  const hidden = target.bids.filter((b) => !b.visible).map((b) => b.card);
  if (!hidden.length) return;
  for (const c of hidden) {
    if (!p.seen.includes(c)) p.seen.push(c);
    ctx.emit({ type: 'cardShown', player: p.id, card: ctx.ref(c), reason: source });
  }
  ctx.queueFirst({
    t: 'choose', purpose: 'rumourMill', player: p.id, source,
    prompt: `Rumour Mill: ${target.name}'s face-down cards are ${hidden.map((c) => ctx.def(c).name).join(', ')}.`,
    options: [...hidden.map((c) => peekOption(ctx, 'seen', c, `${target.name}: ${ctx.def(c).name}`)), { value: 'done', label: 'Got it' }],
    min: 1, max: 1,
  });
}

/** Apply a revealed (or face-up) resource's effects. */
export function resolveBid(ctx: Ctx, p: PlayerState, bid: Bid): void {
  if (bid.resolved) return;
  bid.resolved = true;
  abilityOf(ctx.defId(bid.card))?.onReveal?.(ctx, { card: bid.card, owner: p.id, kind: 'resource' });
  fire(ctx, 'resourceEntered', { card: bid.card, player: p.id });
}

/**
 * A hero falls: a new hero takes up the banner (chosen, with The Hall of Rest).
 * House rule (fallCost): the fall also costs one of your companions, chosen by you and
 * paid before the new hero arrives.
 */
export function heroFalls(ctx: Ctx, p: PlayerState): void {
  replaceFallenHero(ctx, p);
  if (!ctx.s.rules.fallCost) return;
  // queueFirst puts it in front, so the order is: the companion, then the new hero.
  ctx.queueFirst({
    t: 'choose', purpose: 'discardCompanion', player: p.id, source: 'Your hero fell',
    prompt: 'Your hero fell: discard one of your companions',
    options: [...p.companions, ...p.inactiveCompanions, ...p.resting].map((c) => cardOption(ctx, c)),
    min: 1, max: 1, data: { reason: 'Fallen hero' },
  });
}

function replaceFallenHero(ctx: Ctx, p: PlayerState): void {
  if (p.used['hallOfRest']) {
    delete p.used['hallOfRest'];
    const heroes = [...ctx.s.decks.hero, ...ctx.s.discards.hero];
    if (heroes.length) {
      ctx.queueFirst({
        t: 'choose', purpose: 'hallOfRest', player: p.id, source: 'The Hall of Rest',
        prompt: 'The Hall of Rest: choose who takes up your banner',
        options: heroes.map((c) => {
          const d = ctx.def(c);
          const s = d.kind === 'hero' ? ` (P${d.stats.P} M${d.stats.M} G${d.stats.G})` : '';
          return peekOption(ctx, ctx.defId(c), c, `${d.name}${s}`);
        }),
        min: 1, max: 1,
      });
      return;
    }
  }
  if (ctx.s.rules.heroDraft > 1 && ctx.s.rules.draftOnReplace) {
    queueHeroDraft(ctx, p, 'A new hero takes up your banner');
    return;
  }
  if (ctx.s.rules.heroDraft > 1) {
    // Draw the top hero: keep it, or send it back and take the next one instead.
    const [top] = peekTop(ctx, 'hero', 1);
    if (top) {
      ctx.queueFirst({
        t: 'choose', purpose: 'heroKeep', player: p.id, source: 'A new hero',
        prompt: 'A new hero takes up your banner: keep them, or send them back and draw another (you must keep that one)?',
        options: [
          peekOption(ctx, ctx.defId(top), top, heroLabel(ctx, top)),
          { value: 'redraw', label: 'Send them back and draw another' },
        ],
        min: 1, max: 1,
      });
      return;
    }
  }
  const next = ctx.take('hero');
  if (next) swapHero(ctx, p, next);
}

const heroLabel = (ctx: Ctx, c: CardId) => {
  const d = ctx.def(c);
  return d.kind === 'hero' ? `${d.name} (P${d.stats.P} M${d.stats.M} G${d.stats.G})` : d.name;
};

/**
 * Hero draft: look at the top N heroes, keep one, the rest go back and the
 * stack is shuffled. Used at the start and whenever a hero is replaced.
 * The cards stay hidden from everyone else and are shown by definition only.
 */
function queueHeroDraft(ctx: Ctx, p: PlayerState, prompt: string): void {
  const offered = peekTop(ctx, 'hero', ctx.s.rules.heroDraft);
  if (!offered.length) return;
  ctx.queueFirst({
    t: 'choose', purpose: 'heroDraft', player: p.id, source: 'Hero draft',
    prompt: `${prompt}: look at ${offered.length}, keep one.`,
    options: offered.map((c) => peekOption(ctx, ctx.defId(c), c, heroLabel(ctx, c))),
    min: 1, max: 1,
  });
}

function swapHero(ctx: Ctx, p: PlayerState, next: CardId): void {
  const old = p.hero;
  p.hero = next;
  if (old === NO_HERO) {
    // Opening draft: first hero, no fall.
    ctx.shuffle('hero');
    ctx.emit({ type: 'heroChanged', player: p.id, from: null, to: ctx.ref(next), reason: 'setup' });
    return;
  }
  ctx.returnToDeck('hero', [old]);
  ctx.emit({ type: 'heroChanged', player: p.id, from: ctx.ref(old), to: ctx.ref(next), reason: 'fell' });
  fire(ctx, 'heroFell', { player: p.id });
  // A smaller companion limit (e.g. losing Ysolde) forces discards.
  enforceCompanionLimit(ctx, p, 'Too many companions');
}

function endGame(ctx: Ctx): void {
  let best: PlayerState | null = null;
  for (const p of ctx.clockwise()) if (!best || p.renown > best.renown) best = p;
  ctx.s.winner = best?.id ?? null;
  ctx.s.turn.step = 'gameOver';
  ctx.s.pending = null;
  ctx.s.tasks = [];
  ctx.emit({ type: 'gameOver', winner: ctx.s.winner });
}

// --- tasks -------------------------------------------------------------------

/** Drop options that stopped being legal while the task waited in the queue. */
function stillValid(ctx: Ctx, task: ChooseTask): ChooseTask['options'] {
  const p = ctx.player(task.player);
  const inHand = (v: string) => p.hand.includes(v);
  const opposingCompanion = (v: string) => ctx.s.players.some((o) => o !== p && o.companions.includes(v));
  const keep = (pred: (v: string) => boolean) => task.options.filter((o) => pred(o.value));
  switch (task.purpose) {
    case 'discardCompanion': return keep((v) => p.companions.includes(v) || p.inactiveCompanions.includes(v) || p.resting.includes(v));
    case 'faceDownCompanion':
    case 'companionMinion': return keep((v) => p.companions.includes(v));
    case 'discardResource':
    case 'discardForCouncil':
    case 'marenGive': return keep(inHand);
    case 'fetch': return keep((v) => v === 'skip' || inHand(v));
    // Another draw may have reshuffled the discard pile while this choice waited: those cards are hidden again.
    case 'sigrunPick': return keep((v) => v === 'deck' || ctx.s.discards.resource.includes(v));
    case 'silenceCompanion':
    case 'forceCompanion':
    case 'rulingCompanion': return keep(opposingCompanion);
    case 'disableAbility': return keep((v) => ctx.s.players.some((o) => o !== p && (o.hero === v || o.companions.includes(v))));
    case 'marenTarget': return keep((v) => ctx.s.players.some((o) => o.id === v && o.hand.length > 0));
    case 'pipClaim': return keep((v) => {
      const [pid, idx] = v.split(':');
      const bid = ctx.s.players.find((o) => o.id === pid)?.bids[Number(idx)];
      return Boolean(bid && !bid.visible);
    });
    case 'rumourTarget': return keep((v) => ctx.s.players.some((o) => o.id === v && o !== p && o.bids.some((b) => !b.visible)));
    case 'curseTarget': return keep((v) => ctx.s.players.some((o) => o.id === v && o !== p));
    case 'appleSwap': return keep((v) => ctx.s.players.some((o) => o.bids.some((b) => b.card === v && b.visible)));
    case 'gauntlet': return keep((v) => ctx.s.discards.companion.includes(v));
    default: return task.options;
  }
}

function runTask(ctx: Ctx, task: Task): void {
  switch (task.t) {
    case 'choose': {
      const options = stillValid(ctx, task);
      const min = Math.min(task.min, options.length);
      const max = Math.min(task.max, options.length);
      if (max === 0) return;
      if (options.length === min) return applyChoice(ctx, task, options.map((o) => o.value));
      ctx.decide({ kind: 'choose', player: task.player, purpose: task.purpose, source: task.source, prompt: task.prompt, options, min, max, data: task.data ?? {} });
      return;
    }
    case 'replaceLocation': {
      const next = ctx.take('location');
      if (next) replaceLocation(ctx, next, task.mode, task.source);
      return;
    }
    case 'heroFalls':
      heroFalls(ctx, ctx.player(task.player));
      return;
    case 'draw':
      drawResources(ctx, task.player, task.n, task.source);
      return;
    case 'setLocation': {
      const card = ctx.takeMatching('location', (c) => ctx.defId(c) === task.defId);
      if (card) replaceLocation(ctx, card, 'shuffleBack', task.source);
      else ctx.log(null, task.source, 'had no effect (location not available)');
      return;
    }
  }
}

/** Resolve a choice. `picks` has already been validated against the options. */
export function applyChoice(
  ctx: Ctx,
  d: { purpose: ChoosePurpose; player: string; data?: Record<string, string | number> },
  picks: string[],
): void {
  const p = ctx.player(d.player);
  const data = d.data ?? {};
  const t = ctx.s.turn;
  for (const pick of picks) {
    switch (d.purpose) {
      case 'discardCompanion':
        discardCompanion(ctx, p, pick, String(data['reason'] ?? 'Card effect'));
        break;
      case 'faceDownCompanion':
        p.companions = p.companions.filter((c) => c !== pick);
        p.inactiveCompanions.push(pick);
        ctx.emit({ type: 'companionFaceDown', player: p.id, card: ctx.ref(pick), faceDown: true });
        break;
      case 'discardResource':
        p.hand = p.hand.filter((c) => c !== pick);
        ctx.discard('resource', pick);
        ctx.emit({ type: 'resourceDiscarded', player: p.id, card: ctx.ref(pick), reason: String(data['reason'] ?? 'Card effect') });
        break;
      case 'discardForCouncil':
        p.hand = p.hand.filter((c) => c !== pick);
        ctx.discard('resource', pick);
        ctx.emit({ type: 'resourceDiscarded', player: p.id, card: ctx.ref(pick), reason: 'Crossed Paths' });
        councilHeroes(ctx, p.id, 1, 'Crossed Paths');
        break;
      case 'silenceCompanion':
        addEffect(ctx, { kind: 'silenceCompanion', source: String(data['source']), owner: p.id, target: pick });
        break;
      case 'forceCompanion': {
        const stat = data['stat'] as Stat;
        const added = addEffect(ctx, { kind: 'forceCompanionStat', source: String(data['source']), owner: p.id, target: pick, stat });
        const victim = ownerOf(ctx, pick);
        if (added && victim) fire(ctx, 'statForced', { player: victim, target: pick });
        break;
      }
      case 'rulingCompanion': {
        // Ruling of the Conclave: the companion must use whichever of its stats is lowest.
        const d = ctx.def(pick) as CompanionDef;
        const stat = (['P', 'M', 'G'] as Stat[]).reduce((lo, s) => (d.stats[s] < d.stats[lo] ? s : lo));
        const added = addEffect(ctx, { kind: 'forceCompanionStat', source: String(data['source']), owner: p.id, target: pick, stat });
        if (added) ctx.log(p.id, 'Ruling of the Conclave', `${d.name} must use ${statName(stat)}`);
        const victim = ownerOf(ctx, pick);
        if (added && victim) fire(ctx, 'statForced', { player: victim, target: pick });
        break;
      }
      case 'forceHero': {
        const stat = data['stat'] as Stat;
        addEffect(ctx, { kind: 'forceHeroStat', source: String(data['source']), owner: p.id, target: pick, stat });
        fire(ctx, 'statForced', { player: pick, target: ctx.player(pick).hero });
        break;
      }
      case 'counterAbility': {
        const user = ctx.player(String(data['user']));
        const source = String(data['source']);
        const shield = String(data['shield']);
        if (pick === 'counter') {
          t.used[usageKey(shield, 'shield')] = 1; // shares Shield of the Dawn's once per turn
          ctx.emit({ type: 'abilityCountered', player: p.id, source: ctx.ref(source), by: ctx.ref(shield) });
          const cancelled = activeEffects(ctx).filter((e) => e.source === source);
          if (addEffect(ctx, { kind: 'disableAbilities', source: shield, owner: p.id, target: source })) {
            for (const e of cancelled) ctx.emit({ type: 'effectCancelled', effectId: e.id });
          }
        } else runActivation(ctx, user, source, String(data['ability']));
        break;
      }
      case 'disableAbility': {
        const cancelled = activeEffects(ctx).filter((e) => e.source === pick);
        if (addEffect(ctx, { kind: 'disableAbilities', source: String(data['source']), owner: p.id, target: pick })) {
          for (const e of cancelled) ctx.emit({ type: 'effectCancelled', effectId: e.id });
        }
        break;
      }
      case 'marenTarget':
        ctx.queueFirst({
          t: 'choose', purpose: 'marenGive', player: p.id, source: 'Royal Requisition',
          prompt: `Royal Requisition: which card do you give ${ctx.player(pick).name}?`,
          options: p.hand.map((c) => cardOption(ctx, c)), min: 1, max: 1, data: { target: pick },
        });
        break;
      case 'marenGive': {
        const target = ctx.player(String(data['target']));
        if (!target.hand.length) break;
        const taken = target.hand.splice(Math.floor(randomUnit(ctx) * target.hand.length), 1)[0]!;
        p.hand = p.hand.filter((c) => c !== pick);
        target.hand.push(pick);
        p.hand.push(taken);
        ctx.emit({ type: 'cardsTraded', from: p.id, to: target.id, gave: ctx.ref(pick), got: ctx.ref(taken) });
        break;
      }
      case 'pipClaim': {
        const [pid, idx] = pick.split(':');
        const from = ctx.player(pid!);
        const bid = from.bids[Number(idx)];
        if (!bid || bid.visible) break;
        from.bids.splice(Number(idx), 1);
        p.bids.push(bid);
        // Balance option: the victim gets a random card from Pip's hand in its place, face down.
        if (p.hand.length && playerHas(ctx, p, (a) => a.claimSwapsCard)) {
          const given = p.hand.splice(Math.floor(randomUnit(ctx) * p.hand.length), 1)[0]!;
          from.bids.splice(Number(idx), 0, { card: given, visible: false, resolved: false, playedFaceUp: false });
        }
        ctx.emit({ type: 'bidClaimed', from: from.id, to: p.id });
        break;
      }
      case 'peekReplace': {
        const card = String(data['card']);
        const pile = ctx.s.decks.location;
        if (pick === 'replace' && pile[pile.length - 1] === card) {
          pile.pop();
          replaceLocation(ctx, card, 'shuffleBack', 'Mine Now');
        } else ctx.shuffle('location');
        break;
      }
      case 'pickLocation': {
        const card = pick === 'keep' ? null : String(data[pick]);
        const pile = ctx.s.decks.location;
        if (card && pile.includes(card)) {
          pile.splice(pile.indexOf(card), 1);
          replaceLocation(ctx, card, 'shuffleBack', "The Society's Maps");
        }
        ctx.shuffle('location');
        break;
      }
      case 'wrenStack': {
        const deck = pick as DeckName;
        const [top] = peekTop(ctx, deck, 1);
        if (!top) break;
        ctx.emit({ type: 'peeked', player: p.id, deck, count: 1 });
        ctx.queueFirst({
          t: 'choose', purpose: 'wrenBottom', player: p.id, source: "I've Read Ahead",
          prompt: `I've Read Ahead: the top of the ${deck} stack is ${ctx.def(top).name}. Put it on the bottom?`,
          options: [peekOption(ctx, 'bottom', top, `Bottom ${ctx.def(top).name}`), { value: 'keep', label: 'Leave it on top' }],
          min: 1, max: 1, data: { deck, card: top },
        });
        break;
      }
      case 'wrenBottom': {
        const deck = String(data['deck']) as DeckName;
        const pile = ctx.s.decks[deck];
        if (pick === 'bottom' && pile[pile.length - 1] === data['card']) {
          pile.unshift(pile.pop()!);
          ctx.emit({ type: 'bottomed', player: p.id, deck });
        }
        break;
      }
      case 'oskarGrudge':
        // Entered in the Grudge Book: if `pick` wins this encounter they have -3 in the next (applied in resolve).
        addEffect(ctx, { kind: 'grudgeWatch', source: String(data['source']), owner: p.id, target: pick });
        break;
      case 'rumourMill':
        break; // the card was shown; nothing else happens
      case 'fetch': {
        // Gimlet: swap the chosen hand card with the top of the resource discard stack.
        const pile = ctx.s.discards.resource;
        if (pick === 'skip' || !p.hand.includes(pick) || !pile.length) break;
        const got = pile.pop()!;
        p.hand = p.hand.filter((c) => c !== pick);
        ctx.discard('resource', pick);
        p.hand.push(got);
        ctx.emit({ type: 'resourceDiscarded', player: p.id, card: ctx.ref(pick), reason: 'Fetch' });
        ctx.emit({ type: 'drew', player: p.id, deck: 'resource', cards: [ctx.ref(got)], reason: 'Fetch' });
        break;
      }
      case 'pickFight': {
        // Urzha: swap this encounter for the next one, or shuffle the stack so nothing is remembered.
        if (pick === 'replace' && ctx.s.decks.encounter[ctx.s.decks.encounter.length - 1] === data['card']) replaceEncounter(ctx, 'Pick Your Fight');
        else ctx.shuffle('encounter');
        break;
      }
      case 'rumourTarget': {
        const target = ctx.s.players.find((o) => o.id === pick && o !== p);
        if (target) lookAtBids(ctx, p, target, String(data['source']));
        break;
      }
      case 'vaelisGive': {
        const mv = Number(data['amount']);
        const to = pick === 'self' ? p.id : pick;
        addEffect(ctx, { kind: 'statBonus', source: String(data['card']), owner: p.id, target: to, stat: 'all', amount: mv });
        ctx.log(p.id, 'Master Manipulator', to === p.id ? `uses the minion bonus (${mv >= 0 ? '+' : ''}${mv}) for themselves` : `gives the minion bonus (${mv >= 0 ? '+' : ''}${mv}) to ${ctx.player(to).name}`);
        break;
      }
      case 'curseTarget': {
        const card = String(data['card']);
        const from = ctx.s.players.find((o) => o.bids.some((b) => b.card === card));
        const to = ctx.s.players.find((o) => o.id === pick && o !== from);
        if (!from || !to) break;
        const [bid] = from.bids.splice(from.bids.findIndex((b) => b.card === card), 1);
        to.bids.push(bid!);
        ctx.emit({ type: 'bidClaimed', from: from.id, to: to.id });
        break;
      }
      case 'appleSwap': {
        const apple = String(data['apple']);
        const aOwner = ctx.s.players.find((o) => o.bids.some((b) => b.card === apple));
        const bOwner = ctx.s.players.find((o) => o.bids.some((b) => b.card === pick));
        if (!aOwner || !bOwner) break;
        const ai = aOwner.bids.findIndex((b) => b.card === apple);
        const bi = bOwner.bids.findIndex((b) => b.card === pick);
        const aBid = aOwner.bids[ai]!;
        const bBid = bOwner.bids[bi]!;
        aOwner.bids[ai] = bBid;
        bOwner.bids[bi] = aBid;
        ctx.emit({ type: 'bidsSwapped', a: aOwner.id, aCard: ctx.ref(pick), b: bOwner.id, bCard: ctx.ref(apple) });
        break;
      }
      case 'heroDraft': {
        // swapHero shuffles the stack, so the heroes you passed on go back unseen.
        const card = ctx.takeMatching('hero', (c) => ctx.defId(c) === pick);
        if (card) swapHero(ctx, p, card);
        break;
      }
      case 'companionDraft': {
        // The chosen companions join now; their enter-play effects wait for the end of the opening phase.
        const card = ctx.takeMatching('companion', (c) => ctx.defId(c) === pick);
        if (card) {
          p.companions.push(card);
          ctx.emit({ type: 'companionPlayed', player: p.id, card: ctx.ref(card), replaced: null });
          ctx.s.turn.openingEntrants.push({ player: p.id, card });
        }
        // The ones passed over go back unseen, so the next player doesn't see a leftover pool.
        if (pick === picks[picks.length - 1]) ctx.shuffle('companion');
        break;
      }
      case 'heroKeep': {
        if (pick === 'redraw') {
          ctx.shuffle('hero'); // the one you passed on is shuffled back in
          const next = ctx.take('hero');
          if (next) swapHero(ctx, p, next);
        } else {
          const card = ctx.takeMatching('hero', (c) => ctx.defId(c) === pick);
          if (card) swapHero(ctx, p, card);
        }
        break;
      }
      case 'hallOfRest': {
        const card = ctx.takeMatching('hero', (c) => ctx.defId(c) === pick);
        if (card) swapHero(ctx, p, card);
        break;
      }
      case 'gauntlet': {
        const pile = ctx.s.discards.companion;
        if (!pile.includes(pick)) break;
        pile.splice(pile.indexOf(pick), 1);
        companionEnters(ctx, p, pick, null);
        enforceCompanionLimit(ctx, p, 'Gauntlet of Returning');
        break;
      }
      case 'sigrunPick': {
        const n = Number(data['n']);
        const reason = String(data['reason']);
        const pile = ctx.s.discards.resource;
        if (pick === 'deck' || !pile.includes(pick)) { drawRaw(ctx, p.id, n, reason, 'deck'); break; }
        // Once per turn: the chosen card leaves the discard pile, the others stay in it.
        t.used[`sigrun:${p.id}`] = 1;
        pile.splice(pile.indexOf(pick), 1);
        p.hand.push(pick);
        const sigrun = String(data['sigrun']);
        if (ctx.s.cards[sigrun]) ctx.emit({ type: 'abilityZap', player: p.id, source: ctx.ref(sigrun), deck: 'resource', pile: 'discard' });
        ctx.emit({ type: 'drew', player: p.id, deck: 'resource', cards: [ctx.ref(pick)], reason });
        if (n > 1) drawRaw(ctx, p.id, n - 1, reason, 'deck');
        break;
      }
      case 'tobinPick': {
        // The revealed companions were set aside; the chosen Goose joins the player, the rest are discarded.
        const revealed = String(data['revealed']).split(',').filter(Boolean);
        t.setAside = t.setAside.filter((c) => !revealed.includes(c));
        const chosen = pick !== 'none' && revealed.includes(pick) ? pick : null;
        for (const c of revealed) if (c !== chosen) ctx.discard('companion', c);
        if (chosen) {
          companionEnters(ctx, p, chosen, null);
          enforceCompanionLimit(ctx, p, 'Keeper of the Flock');
        }
        break;
      }
      case 'waystoneDraw': {
        if (pick !== 'draw') break;
        const c = ctx.take('companion');
        if (!c) break;
        ctx.emit({ type: 'drew', player: p.id, deck: 'companion', cards: [ctx.ref(c)], reason: 'The Waystone Inn' });
        companionEnters(ctx, p, c, null);
        ctx.queueFirst({
          t: 'choose', purpose: 'discardCompanion', player: p.id, source: 'The Waystone Inn',
          prompt: 'The Waystone Inn: now discard one of your companions',
          options: [...p.companions, ...p.inactiveCompanions, ...p.resting].map((x) => cardOption(ctx, x)), min: 1, max: 1,
        });
        break;
      }
      case 'companionMinion':
        p.companions = p.companions.filter((c) => c !== pick);
        t.companionMinions.push(pick);
        ctx.emit({ type: 'companionMinion', player: p.id, card: ctx.ref(pick) });
        break;
    }
  }
}

/** Uniform [0,1) from the game RNG (e.g. a random card from another hand). */
function randomUnit(ctx: Ctx): number {
  return nextFloat(ctx.s.rng);
}

export { companionEnters };
