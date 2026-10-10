// Shared effect primitives used by the turn flow and by card abilities.

import { KINGDOMS, type CardDef, type CardKind, type Stat } from './cardTypes';
import type { Ctx } from './context';
import { abilityOf, type Ability, type Source, type TriggerName, type TriggerPayload } from './abilities';
import { nextInt } from './rng';
import { challengeStat, difficultyFor } from './totals';
import type { CardId, DeckName, EffectKind, PlayerId, PlayerState, TurnEffect } from './types';

// --- groups ---------------------------------------------------------------

/** Group check. Cards whose groups include "All" (The Old Quarry) match every group. */
export function hasGroup(def: CardDef, group: string): boolean {
  return def.groups.includes(group) || def.groups.includes('All');
}

/** A card's kingdoms (a half-breed like Hesk has two). */
export function kingdomsOf(def: CardDef): string[] {
  return def.groups.filter((g) => (KINGDOMS as readonly string[]).includes(g));
}

// --- turn effects -------------------------------------------------------------

/** Cards whose abilities are switched off this turn (Aldric's Shield of the Dawn). */
export function disabledCards(ctx: Ctx): Set<CardId> {
  const out = new Set<CardId>();
  for (const e of ctx.s.turn.effects) if (e.kind === 'disableAbilities') out.add(e.target);
  return out;
}

/** A hero's ability, unless it has been disabled this turn. */
export function activeAbility(ctx: Ctx, card: CardId): Ability | undefined {
  if (ctx.s.turn.effects.length && disabledCards(ctx).has(card)) return undefined;
  return abilityOf(ctx.defId(card));
}

/** Effects currently in force (their source hasn't been disabled). */
export function activeEffects(ctx: Ctx, kind?: EffectKind): TurnEffect[] {
  const effects = ctx.s.turn.effects;
  if (!effects.length) return [];
  const off = disabledCards(ctx);
  return effects.filter((e) => (!kind || e.kind === kind) && (e.kind === 'disableAbilities' || !off.has(e.source)));
}

/** Effects whose target is a player, not a card. */
export const PLAYER_TARGET_KINDS: readonly EffectKind[] = ['statBonus', 'autoWin', 'grudge', 'grudgeWatch'];

/**
 * Marshal Hedda Ironvow's "Hold the Line": once per turn, an opponent's ability that would affect one of
 * her controller's heroes is cancelled. Returns true if it was.
 */
function heldTheLine(ctx: Ctx, e: Omit<TurnEffect, 'id'>): boolean {
  if (e.kind !== 'silenceHero' && e.kind !== 'forceStat' && e.kind !== 'disableAbilities') return false;
  if (!ctx.s.cards[e.target] || ctx.def(e.target).kind !== 'hero') return false;
  const victim = ownerOf(ctx, e.target);
  if (!victim || victim === e.owner) return false;
  const off = disabledCards(ctx);
  for (const c of ctx.player(victim).party) {
    if (off.has(c) || !abilityOf(ctx.defId(c))?.holdTheLine) continue;
    const key = `${c}:hold`;
    if (ctx.s.turn.used[key]) continue;
    ctx.s.turn.used[key] = 1;
    ctx.emit({ type: 'abilityUsed', player: victim, source: ctx.ref(c), ability: 'hold', label: 'Cancel an opponent\'s ability that would affect your hero' });
    ctx.emit({ type: 'abilityIgnored', player: victim, by: ctx.ref(c), source: ctx.ref(e.source), targetCard: ctx.ref(e.target) });
    return true;
  }
  return false;
}

/** Add a turn effect. Returns null if it was cancelled (Hold the Line). */
export function addEffect(ctx: Ctx, e: Omit<TurnEffect, 'id'>): TurnEffect | null {
  if (heldTheLine(ctx, e)) return null;
  const t = ctx.s.turn;
  t.effectSeq += 1;
  const effect: TurnEffect = { ...e, id: t.effectSeq };
  t.effects.push(effect);
  const cardTarget = PLAYER_TARGET_KINDS.includes(e.kind) ? null : e.target;
  ctx.emit({
    type: 'effect', effect: { ...effect }, source: ctx.ref(e.source),
    targetCard: cardTarget && ctx.s.cards[cardTarget] ? ctx.ref(cardTarget) : null,
    targetPlayer: cardTarget ? ownerOf(ctx, cardTarget) : e.target,
  });
  // Oskar's "Entered in the Book of Grudges": the watched opponent used an ability against his player's heroes.
  const hostile = e.kind === 'silenceHero' || e.kind === 'forceStat' || e.kind === 'negateBid' || e.kind === 'disableAbilities'
    || (e.kind === 'statBonus' && (e.amount ?? 0) < 0);
  if (hostile) {
    const hit = PLAYER_TARGET_KINDS.includes(e.kind) ? e.target : ownerOf(ctx, e.target);
    for (const w of t.effects) {
      if (w.kind === 'grudgeWatch' && w.target === e.owner && w.owner === hit && w.owner !== e.owner) {
        drawResources(ctx, w.owner, 1, ctx.def(w.source).name);
      }
    }
  }
  const shield = hostileShield(ctx, effect);
  if (shield) {
    // Brunna's "Walls First": make it visible that her ability is shielding the target.
    ctx.emit({ type: 'abilityIgnored', player: shield.victim.id, by: ctx.ref(shield.by), source: ctx.ref(e.source), targetCard: cardTarget && ctx.s.cards[cardTarget] ? ctx.ref(cardTarget) : null });
  }
  return effect;
}

/** The player an opponent's hurtful effect lands on, and the hero that shrugs such effects off (Brunna), if any. */
function hostileShield(ctx: Ctx, e: TurnEffect): { victim: PlayerState; by: CardId } | null {
  if (e.kind !== 'silenceHero' && e.kind !== 'forceStat' && e.kind !== 'negateBid') return null;
  const id = ownerOf(ctx, e.target);
  const victim = id ? ctx.s.players.find((p) => p.id === id) ?? null : null;
  if (!victim || victim.id === e.owner) return null;
  const by = playerHas(ctx, victim, (a) => a.ignoreHostileEffects || a.ignoreForcedStat);
  return by ? { victim, by } : null;
}

export function isIgnored(ctx: Ctx, e: TurnEffect): boolean {
  return hostileShield(ctx, e) !== null;
}

/** The turn has reached the end of bidding: resource cards are being (or have been) revealed. */
export function bidsBeingRevealed(ctx: Ctx): boolean {
  const step = ctx.s.turn.step;
  return step === 'reveal' || step === 'winEndOfBidding' || step === 'resolve' || step === 'turnEnd';
}

/**
 * Pell Quillon's "Proofs and Theorems": at the end of bidding, as the cards are revealed, if two or more
 * were played each gains value. Show it the first time it takes effect in a turn.
 */
export function noteMultiBid(ctx: Ctx, p: PlayerState): void {
  if (!bidsBeingRevealed(ctx)) return;
  const confirmed = p.bids.filter((b) => b.visible).length;
  for (const c of p.party) {
    const mb = activeAbility(ctx, c)?.multiBidBonus;
    if (!mb || confirmed < mb.cards) continue;
    const key = `multiBid:${c}`;
    if (ctx.s.turn.used[key]) continue;
    ctx.s.turn.used[key] = 1;
    ctx.emit({ type: 'abilityUsed', player: p.id, source: ctx.ref(c), ability: 'multiBid', label: `+${mb.bonus} to the value of each resource card played` });
  }
}

/** Who controls a card in play (a hero or a bid), if anyone. */
export function ownerOf(ctx: Ctx, card: CardId): PlayerId | null {
  for (const p of ctx.s.players) {
    if (p.party.includes(card) || p.inactive.includes(card) || p.resting.includes(card) || p.bids.some((b) => b.card === card)) return p.id;
  }
  return null;
}

// --- sources in play --------------------------------------------------------

/** Every card whose abilities are currently live, in clockwise order from the current player. */
export function sourcesInPlay(ctx: Ctx): Source[] {
  const out: Source[] = [];
  const off = ctx.s.turn.effects.length ? disabledCards(ctx) : null;
  for (const p of ctx.clockwise()) {
    for (const c of p.party) if (!off?.has(c)) out.push({ card: c, owner: p.id, kind: 'hero' });
  }
  const t = ctx.s.turn;
  if (t.location) out.push({ card: t.location, owner: null, kind: 'location' });
  if (t.encounter) out.push({ card: t.encounter, owner: null, kind: 'encounter' });
  for (const m of t.minions) out.push({ card: m, owner: null, kind: 'encounter' });
  return out;
}

export function heroesInPlay(ctx: Ctx): { card: CardId; owner: PlayerState }[] {
  const out: { card: CardId; owner: PlayerState }[] = [];
  for (const p of ctx.clockwise()) for (const c of p.party) out.push({ card: c, owner: p });
  return out;
}

/** Does this player control a live source with this ability flag? */
export function playerHas(ctx: Ctx, p: PlayerState, test: (a: Ability) => boolean | undefined): CardId | null {
  const off = ctx.s.turn.effects.length ? disabledCards(ctx) : null;
  for (const c of p.party) {
    if (off?.has(c)) continue;
    const a = abilityOf(ctx.defId(c));
    if (a && test(a)) return c;
  }
  return null;
}

/**
 * The opening phase (turn 1, before every player has picked their party): no hero
 * ability may trigger or be used until it is over (see RULE_NOTES).
 */
export function inOpening(ctx: Ctx): boolean {
  const t = ctx.s.turn;
  return t.number === 1 && (t.step === 'turnStart' || t.step === 'recruit');
}

/** Fire a trigger on every live source. Setup and the opening phase never fire triggers. */
export function fire<K extends TriggerName>(ctx: Ctx, name: K, payload: TriggerPayload[K]): void {
  if (ctx.s.turn.number === 0 || inOpening(ctx)) return;
  if (ctx.triggerDepth > 8) return; // defensive: no runaway trigger chains
  ctx.triggerDepth++;
  try {
    for (const src of sourcesInPlay(ctx)) {
      const hook = abilityOf(ctx.defId(src.card))?.on?.[name];
      if (hook) hook(ctx, src, payload);
    }
  } finally {
    ctx.triggerDepth--;
  }
}

// --- drawing ---------------------------------------------------------------

/** Draw resources for a player. `reason` names the card/rule responsible (for the log). */
export function drawResources(ctx: Ctx, player: PlayerId, n: number, reason: string): number {
  if (n <= 0) return 0;
  const p = ctx.player(player);
  let count = n;
  // Archmage Corvin Varro: any time you would draw a resource, you may draw an additional one.
  const corvin = playerHas(ctx, p, (a) => a.extraDrawOnDraw !== undefined);
  const extra = corvin ? abilityOf(ctx.defId(corvin))?.extraDrawOnDraw : undefined;
  const corvinUsed = ctx.s.turn.used[`corvin:${player}`];
  if (extra === 'oncePerTurn' && !corvinUsed && ctx.s.turn.number > 0) ctx.s.turn.used[`corvin:${player}`] = 1;
  if (extra === true || (extra === 'ownTurn' && p === ctx.active) || (extra === 'oncePerTurn' && !corvinUsed && ctx.s.turn.number > 0)) {
    count += 1;
    // Shown as a zap into the resource deck (no big card: it happens on every draw).
    if (ctx.s.turn.number > 0 && corvin) ctx.emit({ type: 'abilityZap', player, source: ctx.ref(corvin), deck: 'resource', pile: 'deck' });
  }
  // Sigrun Stonefast: once per turn, may look at three random discarded cards and take one instead.
  const sigrun = ctx.s.discards.resource.length && !ctx.s.turn.used[`sigrun:${player}`] ? playerHas(ctx, p, (a) => a.drawFromDiscardChoice) : null;
  if (sigrun && ctx.s.turn.number > 0) {
    const pile = ctx.s.discards.resource;
    const looks = Math.min(pile.length, 3);
    const picked: CardId[] = [];
    while (picked.length < looks) {
      const c = pile[nextInt(ctx.s.rng, pile.length)]!;
      if (!picked.includes(c)) picked.push(c);
    }
    ctx.queueFirst({
      t: 'choose', purpose: 'sigrunPick', player, source: ctx.def(sigrun).name,
      prompt: `Encore! Take one of these ${looks} cards from the discard pile instead of drawing, or draw from the stack as usual.`,
      options: [...picked.map((c) => cardOption(ctx, c)), { value: 'deck', label: 'Draw from the stack instead' }],
      min: 1, max: 1, data: { n: count, reason, sigrun },
    });
    return 0;
  }
  return drawRaw(ctx, player, count, reason, 'deck');
}

export function drawRaw(ctx: Ctx, player: PlayerId, n: number, reason: string, from: 'deck' | 'discard'): number {
  const p = ctx.player(player);
  const drawn: CardId[] = [];
  for (let i = 0; i < n; i++) {
    let c: CardId | null;
    if (from === 'discard') {
      const pile = ctx.s.discards.resource;
      c = pile.length ? pile.splice(nextInt(ctx.s.rng, pile.length), 1)[0]! : null;
    } else c = ctx.take('resource');
    if (!c) break;
    drawn.push(c);
  }
  p.hand.push(...drawn);
  if (drawn.length) ctx.emit({ type: 'drew', player, deck: 'resource', cards: drawn.map((c) => ctx.ref(c)), reason });
  return drawn.length;
}

/** Council resources: borrow heroes from the hero stack for this encounter. */
export function councilHeroes(ctx: Ctx, player: PlayerId, n: number, source: string): void {
  const p = ctx.player(player);
  let called = 0;
  for (let i = 0; i < n; i++) {
    const h = ctx.take('hero');
    if (!h) break;
    p.borrowed.push(h);
    called++;
    ctx.emit({ type: 'councilHero', player, card: ctx.ref(h) });
  }
  if (called > 0) ctx.log(player, source, `called ${called} hero${called > 1 ? 'es' : ''} to their side`);
}

/**
 * How many heroes `p` may keep: the house party size, plus one for Ysolde, plus one for every bonus pair
 * (Varg and Moss, Goldie and Gimlet) with both members in the party. `incoming` is a card about to join,
 * counted as if it were already in play (so the second of a pair may be played above the limit). Face-down and
 * resting heroes still count: they are in the party, they just give nothing for now.
 */
export function partySize(ctx: Ctx, p: PlayerState, incoming?: CardId): number {
  const inPlay = new Set([...p.party, ...p.inactive, ...p.resting].map((c) => ctx.defId(c)));
  if (incoming) inPlay.add(ctx.defId(incoming));
  let size = ctx.s.rules.partySize;
  for (const id of inPlay) {
    size += abilityOf(id)?.partyBonus ?? 0;
    const partner = abilityOf(id)?.pair;
    if (partner && id < partner && inPlay.has(partner)) size++;
  }
  return size;
}

/** Heroes counting toward the party size (including face-down and resting ones). */
export function partyCount(p: PlayerState): number {
  return p.party.length + p.inactive.length + p.resting.length;
}

// --- heroes joining and leaving ------------------------------------------------------

export function heroEnters(ctx: Ctx, p: PlayerState, card: CardId, replaced: CardId | null): void {
  if (replaced) {
    ctx.removeFromPlayer(p, replaced);
    ctx.discard('hero', replaced);
  }
  p.party.push(card);
  ctx.emit({ type: 'heroJoined', player: p.id, card: ctx.ref(card), replaced: replaced ? ctx.ref(replaced) : null });
  if (inOpening(ctx)) {
    ctx.s.turn.openingEntrants.push({ player: p.id, card });
    return;
  }
  if (replaced) fire(ctx, 'heroLeft', { card: replaced, player: p.id });
  enterPlayEffects(ctx, p, card);
  // Replacing half of a bonus pair breaks it: drop back to the limit.
  if (replaced) enforcePartyLimit(ctx, p, 'Bonus hero lost');
}

function enterPlayEffects(ctx: Ctx, p: PlayerState, card: CardId): void {
  const self: Source = { card, owner: p.id, kind: 'hero' };
  abilityOf(ctx.defId(card))?.onEnter?.(ctx, self);
  fire(ctx, 'heroEntered', { card, player: p.id });
}

/** End of the opening phase: heroes chosen during it now "enter play", in turn order. */
export function flushOpeningEntrants(ctx: Ctx): void {
  const t = ctx.s.turn;
  const entrants = t.openingEntrants;
  t.openingEntrants = [];
  for (const { player, card } of entrants) {
    const p = ctx.player(player);
    if (p.party.includes(card)) enterPlayEffects(ctx, p, card);
  }
}

export function discardHero(ctx: Ctx, p: PlayerState, card: CardId, reason: string): void {
  if (!p.party.includes(card) && !p.inactive.includes(card) && !p.resting.includes(card)) return;
  ctx.removeFromPlayer(p, card);
  ctx.discard('hero', card);
  ctx.emit({ type: 'heroLeft', player: p.id, card: ctx.ref(card), reason });
  fire(ctx, 'heroLeft', { card, player: p.id });
  // Losing half of a bonus pair (or Ysolde) drops the limit: discard down to it at once.
  enforcePartyLimit(ctx, p, 'Bonus hero lost');
}

/** Queue discards until the player is within their party size. */
export function enforcePartyLimit(ctx: Ctx, p: PlayerState, reason: string): void {
  // Discards already waiting in the queue count (each one resolves with a fresh check).
  const queued = ctx.s.tasks.filter((t) => t.t === 'choose' && t.purpose === 'discardHero' && t.player === p.id && t.data?.['enforce']).length;
  const excess = partyCount(p) - partySize(ctx, p) - queued;
  for (let i = 0; i < excess; i++) {
    ctx.queueFirst({
      t: 'choose', purpose: 'discardHero', player: p.id, prompt: `${reason}: discard a hero`,
      options: [...p.party, ...p.inactive, ...p.resting].map((c) => cardOption(ctx, c)),
      min: 1, max: 1, source: reason, data: { enforce: 1 },
    });
  }
}

// --- locations --------------------------------------------------------------

export function locationEnters(ctx: Ctx, card: CardId, reason: string): void {
  const t = ctx.s.turn;
  // A location that arrives after the challenge was announced may change its type: "when a X challenge is faced" fires again.
  const before = t.encounter ? challengeStat(ctx, null) : null;
  t.location = card;
  ctx.emit({ type: 'locationRevealed', card: ctx.ref(card), reason });
  abilityOf(ctx.defId(card))?.onEnter?.(ctx, { card, owner: null, kind: 'location' });
  fire(ctx, 'locationEntered', { card });
  const after = t.encounter ? challengeStat(ctx, null) : null;
  if (before && after && before !== after) {
    ctx.emit({ type: 'challengeSelected', stat: after, difficulty: difficultyFor(ctx, null)?.total ?? 0 });
    fire(ctx, 'challengeFaced', { stat: after, player: ctx.active.id });
  }
}

/** Swap the current location (Wayfinder's Die, Portal Rune, The Umbral Ring...). */
export function replaceLocation(ctx: Ctx, next: CardId, mode: 'shuffleBack' | 'discard', reason: string): void {
  const prev = ctx.s.turn.location;
  if (prev) {
    leaveLocation(ctx, prev);
    if (mode === 'shuffleBack') ctx.returnToDeck('location', [prev]);
    else ctx.discard('location', prev);
    ctx.emit({ type: 'locationReplaced', from: ctx.ref(prev), to: ctx.ref(next), reason });
  }
  locationEnters(ctx, next, reason);
  if (prev) fire(ctx, 'locationReplaced', { from: prev, to: next });
}

/** Undo lingering location effects (The Storybook Glade turns heroes back up). */
export function leaveLocation(ctx: Ctx, _card: CardId): void {
  for (const p of ctx.s.players) {
    if (p.inactive.length === 0) continue;
    for (const c of p.inactive) {
      p.party.push(c);
      ctx.emit({ type: 'heroFaceDown', player: p.id, card: ctx.ref(c), faceDown: false });
    }
    p.inactive = [];
  }
}

// --- choice helpers -------------------------------------------------------------

/** A choice option showing a public card (by instance id). */
export function cardOption(ctx: Ctx, card: CardId, label?: string): { value: string; label: string; card: { def: string; id: CardId } } {
  return { value: card, label: label ?? ctx.def(card).name, card: { def: ctx.defId(card), id: card } };
}

/** A choice option showing a HIDDEN card to the chooser only: definition, never instance id. */
export function peekOption(ctx: Ctx, value: string, card: CardId, label: string): { value: string; label: string; card: { def: string } } {
  return { value, label, card: { def: ctx.defId(card) } };
}

export function statName(s: Stat): string {
  return s === 'P' ? 'Physical' : s === 'M' ? 'Mental' : 'Guile';
}

export function sourceName(ctx: Ctx, card: CardId): string {
  return ctx.def(card).name;
}

export type { CardKind };

// --- ability reveals ----------------------------------------------------------------

/**
 * Turn up the top `n` cards of a stack (refilling it from the discard if needed) to see whether an
 * ability works. Everyone sees them. The caller discards or keeps them.
 */
export function revealTop(ctx: Ctx, owner: PlayerId, deck: DeckName, n: number, reason: string): CardId[] {
  const out: CardId[] = [];
  for (let i = 0; i < n; i++) {
    const c = ctx.take(deck);
    if (!c) break;
    out.push(c);
    ctx.emit({ type: 'cardShown', player: owner, card: ctx.ref(c), reason });
  }
  return out;
}
