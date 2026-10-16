// Turn flow: a step machine that runs until it needs a player decision.
// Queued tasks (card effects) always run before the next step.
//
// Turn order:
//   turnStart -> [turnStart window] -> recruit -> location -> [afterLocation window]
//   -> encounter -> challenge (the encounter's one stat is announced) -> [beforeBidding window] -> bidding
//   (activated abilities may be used on your bidding decisions) -> [beforeReveal window] -> reveal
//   -> [endOfBidding window] -> resolve -> turnEnd

import { abilityOf, peekTop, type OwnedSource } from './abilities';
import type { Ctx } from './context';
import { IllegalMove } from './context';
import type { EncounterDef, HeroDef, Stat } from './cardTypes';
import {
  activeEffects, addEffect, cardOption, heroEnters, councilHeroes, defenderOf, defendHeroEffect, disabledCards, discardHero,
  drawRaw, drawResources, enforceAllLimits, enforcePartyLimit, fire, flushOpeningEntrants, hasGroup, leaveLocation, locationEnters, ownerOf, partyLoad, partySize, peekOption,
  hostileTo, locationAbility, playerHas, replaceLocation, ridingHeroes, statName,
} from './effects';
import { nextFloat } from './rng';
import { ALL_VISIBLE, challengeStat, difficultyFor, totalFor } from './totals';
import {
  type AbilityOption, type AbilityWindow, type Bid, type CardId, type ChooseTask, type ChoosePurpose, type DeckName,
  type DefendedEffect, type HoldReason, type PlayerId, type PlayerState, type ResultPart, type Step, type Task, type TurnResult,
} from './types';

export function drawSize(ctx: Ctx): number {
  const r = ctx.s.rules.drawSize;
  return r === 'playerCount' ? ctx.s.players.length : r;
}

/** Each player's starting resource hand. (Parties are drafted afterwards; nobody is dealt heroes.) */
export function dealStartingHands(ctx: Ctx): void {
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
  for (const src of p.party.map((card) => ({ card }))) {
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
        // Hesk of Two Homes: once per turn, re-use another hero's once-per-turn ability.
        const hesk = playerHas(ctx, p, (a) => a.reuseHeroAbility);
        const heskReuse = n === 1 && !t.used[`hesk:${p.id}`] && hesk !== src.card && hesk !== null;
        if (n > 0 && !heskReuse) continue;
      }
      const self: OwnedSource = { card: src.card, owner: p.id, kind: 'hero' };
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
  act.use(ctx, { card: source, owner: p.id, kind: 'hero' });
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
  const drawMinion = (): CardId | null => {
    const group = def.minions.group;
    // Skarra's minion can be anyone but another Skarra.
    const skarra = hasGroup(def, 'Skarra') && !group;
    return group ? ctx.takeMatching('encounter', (c) => hasGroup(ctx.def(c), group))
      : skarra ? ctx.takeMatching('encounter', (c) => !hasGroup(ctx.def(c), 'Skarra')) : ctx.take('encounter');
  };
  if (sidekick) addMinion(sidekick);
  for (let i = 0; i < (sidekick ? 0 : def.minions.count); i++) {
    const m = drawMinion();
    if (!m) break;
    addMinion(m);
  }
  // Barrowdeep: the encounter draws one extra minion.
  if (locationAbility(ctx)?.extraMinion) {
    const m = drawMinion();
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
  for (const c of t.heroMinions) ctx.discard('hero', c);
  t.encounter = null;
  t.minions = [];
  t.heroMinions = [];
  if (!revealEncounter(ctx)) return;
  announceChallenge(ctx);
  fire(ctx, 'encounterReplaced', { player: ctx.active.id });
  t.passesInARow = 0;
}

// --- steps ---------------------------------------------------------------------------

const STEPS: Record<Step, (ctx: Ctx) => void> = {
  /** Opening party draft: clockwise from the first player, each privately picks their heroes from a pool. */
  partyDraft(ctx) {
    const p = ctx.clockwise().find((x) => !x.used['partyDraft']);
    if (!p) { goTo(ctx, 'turnStart'); return; }
    p.used['partyDraft'] = 1;
    const offered = peekTop(ctx, 'hero', ctx.s.rules.draftPool);
    if (!offered.length) return;
    const n = Math.min(ctx.s.rules.partySize, offered.length);
    ctx.queueFirst({
      t: 'choose', purpose: 'partyDraft', player: p.id, source: 'Party draft',
      prompt: `Choose ${n} hero${n === 1 ? '' : 'es'} for your party from these ${offered.length}.`,
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
    // Resting heroes (Tova) return on their controller's turn.
    for (const c of [...p.resting]) {
      p.resting = p.resting.filter((x) => x !== c);
      p.party.push(c);
      // Shown like any ability: the card comes back up and says what it does.
      if (abilityOf(ctx.defId(c))?.restReturnDraw) ctx.emit({ type: 'abilityUsed', player: p.id, source: ctx.ref(c), ability: 'return', label: 'Turns face up and draws two extra resource cards' });
      ctx.emit({ type: 'heroFaceDown', player: p.id, card: ctx.ref(c), faceDown: false });
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
    // Nothing may be used until every player has picked their party: on the very first turn the
    // start-of-turn abilities wait until the opening phase is over.
    goTo(ctx, t.number === 1 ? 'recruit' : 'winTurnStart');
  },

  winTurnStart: (ctx) => runWindow(ctx, 'turnStart', ctx.s.turn.number === 1 ? 'location' : 'recruit'),

  recruit(ctx) {
    const t = ctx.s.turn;
    // There is no first-turn recruit phase: everyone already chose in the opening draft.
    const count = t.number === 1 ? 0 : ctx.s.rules.recruitPhase === 'everyone' ? ctx.s.players.length : 1;
    if (t.cursor >= count) {
      if (t.number === 1) {
        goTo(ctx, 'winTurnStart');
        flushOpeningEntrants(ctx); // the opening phase is over: abilities are live
      } else goTo(ctx, 'location');
      return;
    }
    const p = ctx.s.players[(t.active + t.cursor) % ctx.s.players.length]!;
    if (ctx.s.decks.hero.length + ctx.s.discards.hero.length === 0) { t.cursor += 1; return; }
    ctx.decide({ kind: 'recruit.offer', player: p.id });
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
    const mirror = Boolean(locationAbility(ctx)?.facesUp);
    const faceUp = p.bids.length === 0 || mirror;
    const canFaceDown = faceUp && !mirror && Boolean(playerHas(ctx, p, (a) => a.mayBidFaceDown));
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
        t.revealCursor = (seat + 1) % n;
        return;
      }
    }
    goTo(ctx, 'winEndOfBidding');
  },

  winEndOfBidding: (ctx) => runWindow(ctx, 'endOfBidding', 'resolve'),

  resolve(ctx) {
    const t = ctx.s.turn;
    fire(ctx, 'endOfBidding', { turn: t.number });
    const rows: TurnResult['rows'] = [];
    for (const p of ctx.clockwise()) {
      if (!ctx.s.rules.allPlayersFaceEncounter && p.bids.length === 0) continue;
      const tb = totalFor(ctx, p, ALL_VISIBLE)!;
      const diff = difficultyFor(ctx, p)!.total;
      const total = tb.total;
      const parts: ResultPart[] = [];
      const nm = (c: CardId) => ctx.def(c).name.split(',')[0]!;
      for (const c of tb.party) parts.push({ kind: 'hero', card: ctx.ref(c.source), label: nm(c.source), value: c.value });
      for (const c of tb.council) parts.push({ kind: 'council', card: null, label: nm(c.source), value: c.value });
      for (const c of tb.resources) parts.push({ kind: 'resource', card: ctx.ref(c.source), label: nm(c.source), value: c.value });
      for (const b of tb.bonuses) parts.push({ kind: b.amount < 0 ? 'penalty' : 'bonus', card: b.source && ctx.s.cards[b.source] ? ctx.ref(b.source) : null, label: b.label, value: b.amount });
      rows.push({ player: p.id, total, difficulty: diff, survived: total >= diff, stat: tb.stat, parts });
    }

    // Dagny Coldhearth: "You win the current encounter and automatically take the location."
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

    // Everyone who did not win the encounter (Mogra): they fell, or survived without taking the location.
    for (const r of rows) if (r.player !== winner) fire(ctx, 'bidLost', { player: r.player });

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
      enforceAllLimits(ctx);
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

    // Who would fall: everyone who failed, plus Dagny's player (the price of her ability).
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
      const thorgar = p.used['unburied'] ? null : playerHas(ctx, p, (a) => a.unburied);
      if (thorgar) {
        p.used['unburied'] = 1;
        ctx.emit({ type: 'fallPrevented', player: p.id, source: ctx.def(thorgar).name });
        drawResources(ctx, p.id, 3, ctx.def(thorgar).name);
        continue;
      }
      if (p.bids.some((b) => ctx.defId(b.card) === 'the-amulet-of-aesia') && !(auto && auto.target === pid)) {
        ctx.emit({ type: 'fallPrevented', player: p.id, source: 'The Amulet of Aesia' });
        drawResources(ctx, p.id, ctx.s.players.length - 1, 'The Amulet of Aesia');
        continue;
      }
      // The Hall of Rest: choose who takes the place of the fallen hero.
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
    for (const c of t.setAside) ctx.discard(ctx.def(c).kind === 'hero' ? 'hero' : 'encounter', c);
    for (const c of t.heroMinions) ctx.discard('hero', c);
    t.encounter = null;
    t.minions = [];
    t.setAside = [];
    t.heroMinions = [];
    if (t.location) {
      leaveLocation(ctx, t.location);
      ctx.discard('location', t.location);
      t.location = null;
      enforceAllLimits(ctx);
    }
    // Unclaimed bonus locations were never revealed: return them unseen.
    if (t.extraLocations.length) ctx.returnToDeck('location', t.extraLocations);
    t.extraLocations = [];

    // Amulet of the Phoenix: may bring a hero back from the discard pile.
    const gauntletOwners = ctx.s.players.filter((p) => p.bids.some((b) => ctx.defId(b.card) === 'gauntlet-of-returning'));

    const borrowed: string[] = [];
    for (const p of ctx.s.players) {
      for (const b of p.bids) ctx.discard('resource', b.card);
      p.bids = [];
      p.seen = [];
      borrowed.push(...p.borrowed);
      p.borrowed = [];
      p.statOverride = null;
      // This encounter's penalty ends; a winner's grudge starts with the next one.
      p.penalty = p.penaltyNext;
      p.penaltyNext = 0;
    }
    ctx.returnToDeck('hero', borrowed);
    // One after another: each faller finishes choosing before the next starts.
    for (const pid of t.failed) ctx.queue({ t: 'heroFalls', player: pid });
    t.failed = [];
    t.wandsDisabled = false;
    t.namedDisabled = false;
    t.locationIgnored = false;
    t.noFalls = false;
    t.effects = [];
    t.used = {};
    ctx.emit({ type: 'turnEnded', player: ctx.active.id });

    for (const p of gauntletOwners) {
      const pile = ctx.s.discards.hero;
      if (!pile.length) continue;
      ctx.queue({
        t: 'choose', purpose: 'gauntlet', player: p.id, source: 'Amulet of the Phoenix',
        prompt: 'Amulet of the Phoenix: bring a hero back from the discard pile?',
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
 * A player lost the encounter (or paid for Dagny): they choose which of their heroes falls. It goes to the
 * discard pile; the party refills in the recruit phase (or at once with The Hall of Rest).
 */
export function heroFalls(ctx: Ctx, p: PlayerState): void {
  const heroes = [...p.party, ...p.inactive, ...p.resting];
  if (!heroes.length) { delete p.used['hallOfRest']; return; }
  ctx.queueFirst({
    t: 'choose', purpose: 'fallHero', player: p.id, source: 'Your party fell',
    prompt: 'Your party fell: choose a hero to leave behind',
    options: heroes.map((c) => cardOption(ctx, c)), min: 1, max: 1,
  });
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
  const opposingHero = (v: string) => ctx.s.players.some((o) => o !== p && o.party.includes(v));
  const ownHero = (v: string) => p.party.includes(v) || p.inactive.includes(v) || p.resting.includes(v);
  const keep = (pred: (v: string) => boolean) => task.options.filter((o) => pred(o.value));
  switch (task.purpose) {
    case 'discardHero':
    case 'fallHero': return keep(ownHero);
    case 'faceDownHero':
    case 'heroMinion': return keep((v) => p.party.includes(v));
    case 'discardResource':
    case 'discardForCouncil':
    case 'torviFire':
    case 'aelderRoots':
    case 'marenGive': return keep(inHand);
    case 'brisaFlip': return keep((v) => p.bids.some((b) => b.card === v && b.visible && !b.flipped));
    case 'mograSteal': return keep((v) => ctx.s.players.some((o) => o.id === v && o !== p && o.hand.length > 0));
    case 'fetch': return keep((v) => v === 'skip' || inHand(v));
    // Another draw may have reshuffled the discard pile while this choice waited: those cards are hidden again.
    case 'sigrunPick': return keep((v) => v === 'deck' || ctx.s.discards.resource.includes(v));
    case 'forceHero':
    case 'rulingHero': return keep(opposingHero);
    case 'marenTarget': return keep((v) => ctx.s.players.some((o) => o.id === v && o.hand.length > 0));
    case 'rumourTarget': return keep((v) => ctx.s.players.some((o) => o.id === v && o !== p && o.bids.some((b) => !b.visible)));
    case 'curseTarget': return keep((v) => ctx.s.players.some((o) => o.id === v && o !== p));
    case 'immobilizeTarget': return keep((v) => ctx.s.players.some((o) => { const riding = ridingHeroes(ctx, o); return o.id === v && o !== p && o.party.some((c) => riding.has(c)); }));
    case 'appleSwap': return keep((v) => ctx.s.players.some((o) => o.bids.some((b) => b.card === v && b.visible)));
    case 'gauntlet': return keep((v) => ctx.s.discards.hero.includes(v));
    default: return task.options;
  }
}

/** Ask `victim` whether to counter (their once-per-turn Shield of the Dawn / Walls First). */
function counterPrompt(ctx: Ctx, victimId: PlayerId, shield: CardId, prompt: string, data: Record<string, string | number>): ChooseTask {
  return {
    t: 'choose', purpose: 'counterAbility', player: victimId, source: ctx.def(shield).name, prompt,
    options: [{ value: 'counter', label: 'Counter it' }, { value: 'allow', label: 'Let it happen' }], min: 1, max: 1,
    data: { ...data, shield },
  };
}

const shortOf = (ctx: Ctx, card: CardId) => ctx.def(card).name.split(',')[0]!;

/** Immobilizing Word: the victim's Companion heroes (those riding free beside a hero they are Companion To) are turned face down for this encounter. */
function immobilize(ctx: Ctx, word: CardId, owner: PlayerId, victimId: PlayerId): void {
  const victim = ctx.player(victimId);
  const riding = ridingHeroes(ctx, victim);
  for (const c of victim.party) {
    if (!riding.has(c)) continue;
    addEffect(ctx, { kind: 'facedown', source: word, owner, target: c });
  }
}

const flatten = (e: DefendedEffect): Record<string, string | number> => ({
  ek: e.kind, es: e.source, eo: e.owner, et: e.target, estat: e.stat ?? '', eamt: e.amount ?? 0,
});
const unflatten = (d: Record<string, string | number>): DefendedEffect => ({
  kind: String(d['ek']) as DefendedEffect['kind'], source: String(d['es']), owner: String(d['eo']), target: String(d['et']),
  ...(d['estat'] ? { stat: String(d['estat']) as Stat | 'all' } : {}), ...(Number(d['eamt']) ? { amount: Number(d['eamt']) } : {}),
});

/** One step of a hostile effect's walk past the defences of the hero's player: Hedda's redirect, then Aldric's counter, then it lands. */
function defend(ctx: Ctx, task: Extract<Task, { t: 'defend' }>): void {
  const e = task.effect;
  const then = task.then ?? '';
  const heroOwner = ctx.s.cards[e.target] ? ownerOf(ctx, e.target) : null;
  const victim = heroOwner && heroOwner !== e.owner ? ctx.player(heroOwner) : null;
  if (victim && task.stage === 'redirect') {
    const hedda = defenderOf(ctx, victim, 'redirect', e.target);
    if (hedda) {
      ctx.queueFirst({
        t: 'choose', purpose: 'redirectHero', player: victim.id, source: ctx.def(hedda).name,
        prompt: `${shortOf(ctx, e.source)} targets ${shortOf(ctx, e.target)}. Have ${shortOf(ctx, hedda)} take it instead, and draw a resource?`,
        options: [{ value: 'redirect', label: 'Take it instead' }, { value: 'allow', label: 'Let it land' }], min: 1, max: 1,
        data: { ...flatten(e), then, hedda },
      });
      return;
    }
    ctx.queueFirst({ ...task, stage: 'counter' });
    return;
  }
  if (victim && task.stage === 'counter') {
    const shield = defenderOf(ctx, victim, 'heroes');
    if (shield) {
      ctx.queueFirst(counterPrompt(ctx, victim.id, shield,
        `${shortOf(ctx, e.source)} would affect your hero ${shortOf(ctx, e.target)}. Counter it with ${shortOf(ctx, shield)}?`,
        { kind: 'effect', ...flatten(e), then, src: e.source }));
      return;
    }
  }
  const added = addEffect(ctx, e);
  if (added && then === 'statForced' && heroOwner) fire(ctx, 'statForced', { player: heroOwner, target: e.target });
}

function runTask(ctx: Ctx, task: Task): void {
  switch (task.t) {
    case 'defend':
      defend(ctx, task);
      return;
    case 'choose': {
      // A location's or encounter's effect on your heroes (or resources) can be countered first.
      const kind = task.data?.['counter'];
      if ((kind === 'heroes' || kind === 'resources') && !task.data?.['checked']) {
        const shield = defenderOf(ctx, ctx.player(task.player), kind);
        if (shield) {
          ctx.s.tasks.unshift({ ...task, data: { ...task.data, checked: 1 } });
          ctx.s.tasks.unshift(counterPrompt(ctx, task.player, shield,
            `${task.source} would affect your ${kind}. Counter it with ${shortOf(ctx, shield)}?`, { kind: 'task', src: shield }));
          return;
        }
      }
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
  // Strike the Heart on a card that is not a Capital: skipping is the same as shuffling it back.
  if (d.purpose === 'peekReplace' && !picks.length) picks = ['keep'];
  for (const pick of picks) {
    switch (d.purpose) {
      case 'discardHero':
        discardHero(ctx, p, pick, String(data['reason'] ?? 'Card effect'));
        break;
      case 'fallHero': {
        discardHero(ctx, p, pick, 'Fell');
        // The Hall of Rest: choose any hero from the stack to take the empty place.
        if (p.used['hallOfRest']) {
          delete p.used['hallOfRest'];
          const heroes = [...ctx.s.decks.hero, ...ctx.s.discards.hero].filter((c) => c !== pick);
          if (heroes.length) {
            ctx.queueFirst({
              t: 'choose', purpose: 'hallOfRest', player: p.id, source: 'The Hall of Rest',
              prompt: 'The Hall of Rest: choose who takes the place of the fallen hero',
              options: heroes.map((c) => {
                const d = ctx.def(c);
                const s = d.kind === 'hero' ? ` (P${d.stats.P} M${d.stats.M} G${d.stats.G})` : '';
                return peekOption(ctx, ctx.defId(c), c, `${d.name}${s}`);
              }),
              min: 1, max: 1,
            });
          }
        }
        break;
      }
      case 'faceDownHero':
        p.party = p.party.filter((c) => c !== pick);
        p.inactive.push(pick);
        ctx.emit({ type: 'heroFaceDown', player: p.id, card: ctx.ref(pick), faceDown: true });
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
      case 'forceHero': {
        const stat = data['stat'] as Stat;
        defendHeroEffect(ctx, { kind: 'forceStat', source: String(data['source']), owner: p.id, target: pick, stat }, 'statForced');
        break;
      }
      case 'rulingHero': {
        // Ruling of the Conclave: the hero must use whichever of its stats is lowest.
        const d = ctx.def(pick) as HeroDef;
        const stat = (['P', 'M', 'G'] as Stat[]).reduce((lo, s) => (d.stats[s] < d.stats[lo] ? s : lo));
        ctx.log(p.id, 'Ruling of the Conclave', `${d.name} must use ${statName(stat)}`);
        defendHeroEffect(ctx, { kind: 'forceStat', source: String(data['source']), owner: p.id, target: pick, stat }, 'statForced');
        break;
      }
      case 'redirectHero': {
        // Hedda: take the effect instead, and draw a resource. Then Aldric may still counter it.
        const effect = unflatten(data);
        const then = data['then'] ? 'statForced' as const : undefined;
        if (pick === 'redirect') {
          const hedda = String(data['hedda']);
          t.used[`${hedda}:redirect`] = 1;
          ctx.emit({ type: 'abilityUsed', player: p.id, source: ctx.ref(hedda), ability: 'redirect', label: 'Takes the effect instead of one of your other heroes' });
          effect.target = hedda;
          drawResources(ctx, p.id, 1, ctx.def(hedda).name);
        }
        ctx.queueFirst({ t: 'defend', effect, stage: 'counter', ...(then ? { then } : {}) });
        break;
      }
      case 'counterAbility': {
        const kind = String(data['kind']);
        const shield = String(data['shield']);
        const countered = pick === 'counter';
        if (countered) {
          t.used[`${shield}:shield`] = 1; // once per turn per card
          ctx.emit({ type: 'abilityCountered', player: p.id, source: ctx.ref(String(data['src'] ?? shield)), by: ctx.ref(shield) });
        }
        if (kind === 'effect') {
          if (!countered) ctx.queueFirst({ t: 'defend', effect: unflatten(data), stage: 'apply', ...(data['then'] ? { then: 'statForced' as const } : {}) });
        } else if (kind === 'task') {
          if (countered) ctx.s.tasks.shift(); // the effect it would have had on this player's cards (the next task) does not happen
        } else if (kind === 'location') {
          const next = String(data['next']);
          t.pendingLocation = null;
          if (countered) ctx.returnToDeck('location', [next]);
          else replaceLocation(ctx, next, String(data['mode']) as 'shuffleBack' | 'discard', String(data['reason']), true,
            data['rewardPlayer'] ? { player: String(data['rewardPlayer']), n: Number(data['rewardN']) } : undefined, Boolean(data['ignore']));
        } else if (kind === 'curse') {
          if (countered) {
            const from = ctx.player(String(data['from']));
            const card = String(data['card']);
            from.bids = from.bids.filter((b) => b.card !== card);
            ctx.discard('resource', card);
            ctx.emit({ type: 'resourceDiscarded', player: from.id, card: ctx.ref(card), reason: 'Countered' });
          } else placeCurse(ctx, String(data['card']), String(data['from']), String(data['to']));
        } else if (kind === 'trade') {
          if (!countered) swapCards(ctx, ctx.player(String(data['from'])), ctx.player(String(data['to'])), String(data['give']));
        } else if (kind === 'steal') {
          if (!countered) stealRandom(ctx, ctx.player(String(data['to'])), ctx.player(String(data['from'])), String(data['source']));
        } else if (kind === 'immobilize') {
          if (!countered) immobilize(ctx, String(data['card']), String(data['from']), String(data['to']));
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
        const shield = defenderOf(ctx, target, 'resources');
        if (shield) {
          ctx.queueFirst(counterPrompt(ctx, target.id, shield, `Royal Requisition would trade a card with your hand. Counter it with ${shortOf(ctx, shield)}?`,
            { kind: 'trade', from: p.id, to: target.id, give: pick, src: String(data['src'] ?? shield) }));
        } else swapCards(ctx, p, target, pick);
        break;
      }
      case 'mograSteal': {
        const victim = ctx.player(pick);
        const shield = defenderOf(ctx, victim, 'resources');
        const source = ctx.def(String(data['source'])).name;
        if (shield) {
          ctx.queueFirst(counterPrompt(ctx, victim.id, shield, `${p.name} would take a random card from your hand. Counter it with ${shortOf(ctx, shield)}?`,
            { kind: 'steal', from: victim.id, to: p.id, source, src: String(data['source']) }));
        } else stealRandom(ctx, p, victim, source);
        break;
      }
      case 'torviFire': {
        // Uncontrolled Explosion: discard the chosen resource and Torvi himself; every opponent has -6.
        const torvi = String(data['source']);
        p.hand = p.hand.filter((c) => c !== pick);
        ctx.discard('resource', pick);
        ctx.emit({ type: 'resourceDiscarded', player: p.id, card: ctx.ref(pick), reason: 'Uncontrolled Explosion' });
        discardHero(ctx, p, torvi, 'Uncontrolled Explosion');
        for (const o of ctx.s.players) if (o.id !== p.id) addEffect(ctx, { kind: 'statBonus', source: torvi, owner: p.id, target: o.id, stat: 'all', amount: -6 });
        ctx.log(p.id, ctx.def(torvi).name, 'Uncontrolled Explosion! Every opponent has -6');
        break;
      }
      case 'aelderRoots': {
        const aelder = String(data['source']);
        p.hand = p.hand.filter((c) => c !== pick);
        ctx.discard('resource', pick);
        ctx.emit({ type: 'resourceDiscarded', player: p.id, card: ctx.ref(pick), reason: 'Inexorable Roots' });
        addEffect(ctx, { kind: 'statBonus', source: aelder, owner: p.id, target: p.id, stat: 'all', amount: 3 });
        ctx.log(p.id, ctx.def(aelder).name, 'Inexorable Roots: +3 until the end of the encounter');
        break;
      }
      case 'brisaFlip': {
        const bid = p.bids.find((b) => b.card === pick);
        if (!bid) break;
        bid.flipped = true;
        addEffect(ctx, { kind: 'bidValue', source: String(data['source']), owner: p.id, target: pick, amount: 3 });
        ctx.log(p.id, ctx.def(String(data['source'])).name, `turns ${ctx.def(pick).name} face down: it contributes 3`);
        break;
      }
      case 'goldiePick': {
        // Tavern Keeper: three heroes were drawn; the one chosen goes on to the usual keep-or-let-go decision, the others are discarded.
        const drawn = String(data['cards']).split(',').filter(Boolean);
        t.setAside = t.setAside.filter((c) => !drawn.includes(c));
        const chosen = drawn.find((c) => ctx.defId(c) === pick);
        for (const c of drawn) if (c !== chosen) ctx.discard('hero', c);
        if (!chosen) { t.cursor += 1; break; }
        ctx.decide({ kind: 'recruit.place', player: p.id, drawn: chosen, mustReplace: partyLoad(ctx, p, chosen) > partySize(ctx, p, chosen) });
        break;
      }
      case 'peekReplace': {
        const card = String(data['card']);
        const pile = ctx.s.decks.location;
        if (pick === 'replace' && pile[pile.length - 1] === card) {
          pile.pop();
          replaceLocation(ctx, card, 'shuffleBack', 'Strike the Heart', false, { player: p.id, n: 2 });
        } else ctx.shuffle('location');
        break;
      }
      case 'pickLocation': {
        // "n0" / "n1": swap that location in; with a trailing "x": and ignore its rules text.
        const ignore = pick !== 'keep' && pick.endsWith('x');
        const card = pick === 'keep' ? null : String(data[ignore ? pick.slice(0, -1) : pick]);
        const pile = ctx.s.decks.location;
        if (card && pile.includes(card)) {
          pile.splice(pile.indexOf(card), 1);
          replaceLocation(ctx, card, 'shuffleBack', "The Society's Maps", false, undefined, ignore);
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
        if (target) {
          const looked = target.bids.filter((b) => !b.visible).map((b) => b.card);
          lookAtBids(ctx, p, target, String(data['source']));
          // Rumour Mill: if any of the cards looked at is a Halfellow card, a resource.
          if (looked.some((c) => hasGroup(ctx.def(c), 'Halfellow'))) drawResources(ctx, p.id, 1, 'Rumour Mill');
        }
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
        const shield = defenderOf(ctx, to, 'resources');
        if (shield) {
          ctx.queueFirst(counterPrompt(ctx, to.id, shield, `${ctx.def(card).name} would be placed in front of you. Counter it with ${shortOf(ctx, shield)}?`,
            { kind: 'curse', card, from: from.id, to: to.id, src: card }));
        } else placeCurse(ctx, card, from.id, to.id);
        break;
      }
      case 'immobilizeTarget': {
        const victim = ctx.player(pick);
        const word = String(data['card']);
        const shield = defenderOf(ctx, victim, 'heroes');
        if (shield) {
          ctx.queueFirst(counterPrompt(ctx, victim.id, shield, `${ctx.def(word).name} would turn your Companion heroes face down. Counter it with ${shortOf(ctx, shield)}?`,
            { kind: 'immobilize', card: word, from: p.id, to: victim.id, src: word }));
        } else immobilize(ctx, word, p.id, victim.id);
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
        hostileTo(ctx, bOwner.id, aOwner.id);
        break;
      }
      case 'partyDraft': {
        // The chosen heroes join now; their enter-play effects wait for the end of the opening phase.
        const card = ctx.takeMatching('hero', (c) => ctx.defId(c) === pick);
        if (card) {
          p.party.push(card);
          ctx.emit({ type: 'heroJoined', player: p.id, card: ctx.ref(card), replaced: null });
          ctx.s.turn.openingEntrants.push({ player: p.id, card });
        }
        // The ones passed over go back unseen, so the next player doesn't see a leftover pool.
        if (pick === picks[picks.length - 1]) ctx.shuffle('hero');
        break;
      }
      case 'hallOfRest': {
        const card = ctx.takeMatching('hero', (c) => ctx.defId(c) === pick);
        if (card) {
          heroEnters(ctx, p, card, null);
          enforcePartyLimit(ctx, p, 'The Hall of Rest');
        }
        break;
      }
      case 'gauntlet': {
        const pile = ctx.s.discards.hero;
        if (!pile.includes(pick)) break;
        pile.splice(pile.indexOf(pick), 1);
        heroEnters(ctx, p, pick, null);
        enforcePartyLimit(ctx, p, 'Amulet of the Phoenix');
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
        // The revealed heroes were set aside; the chosen Goose joins the player, the rest are discarded.
        const revealed = String(data['revealed']).split(',').filter(Boolean);
        t.setAside = t.setAside.filter((c) => !revealed.includes(c));
        const chosen = pick !== 'none' && revealed.includes(pick) ? pick : null;
        for (const c of revealed) if (c !== chosen) ctx.discard('hero', c);
        if (chosen) {
          heroEnters(ctx, p, chosen, null);
          enforcePartyLimit(ctx, p, 'Keeper of the Flock');
        }
        break;
      }
      case 'waystoneDraw': {
        if (pick !== 'draw') break;
        const c = ctx.take('hero');
        if (!c) break;
        ctx.emit({ type: 'drew', player: p.id, deck: 'hero', cards: [ctx.ref(c)], reason: 'The Goose & Kettle' });
        heroEnters(ctx, p, c, null);
        enforcePartyLimit(ctx, p, 'The Goose & Kettle');
        break;
      }
      case 'heroMinion':
        p.party = p.party.filter((c) => c !== pick);
        t.heroMinions.push(pick);
        ctx.emit({ type: 'heroMinion', player: p.id, card: ctx.ref(pick) });
        break;
    }
  }
}

/** A curse leaves its player's bids and is placed in front of the target, where its value counts against them. */
function placeCurse(ctx: Ctx, card: CardId, fromId: PlayerId, toId: PlayerId): void {
  const from = ctx.player(fromId);
  const to = ctx.player(toId);
  const at = from.bids.findIndex((b) => b.card === card);
  if (at < 0) return;
  const [bid] = from.bids.splice(at, 1);
  to.bids.push({ ...bid!, placedBy: fromId });
  ctx.emit({ type: 'cursePlaced', from: fromId, to: toId, card: ctx.ref(card) });
  hostileTo(ctx, toId, fromId);
}

/** Royal Requisition: `p` gives `give` and takes a random card from `target`'s hand. */
function swapCards(ctx: Ctx, p: PlayerState, target: PlayerState, give: CardId): void {
  if (!target.hand.length || !p.hand.includes(give)) return;
  const taken = target.hand.splice(Math.floor(randomUnit(ctx) * target.hand.length), 1)[0]!;
  p.hand = p.hand.filter((c) => c !== give);
  target.hand.push(give);
  p.hand.push(taken);
  ctx.emit({ type: 'cardsTraded', from: p.id, to: target.id, gave: ctx.ref(give), got: ctx.ref(taken) });
  hostileTo(ctx, target.id, p.id);
}

/** Smash and Grab: `thief` takes a random card from `victim`'s hand. */
function stealRandom(ctx: Ctx, thief: PlayerState, victim: PlayerState, source: string): void {
  if (!victim.hand.length) return;
  const taken = victim.hand.splice(Math.floor(randomUnit(ctx) * victim.hand.length), 1)[0]!;
  thief.hand.push(taken);
  ctx.emit({ type: 'drew', player: thief.id, deck: 'resource', cards: [ctx.ref(taken)], reason: source });
  ctx.log(thief.id, source, `takes a random card from ${victim.name}`);
  hostileTo(ctx, victim.id, thief.id);
}

/** Uniform [0,1) from the game RNG (e.g. a random card from another hand). */
function randomUnit(ctx: Ctx): number {
  return nextFloat(ctx.s.rng);
}

export { heroEnters };
