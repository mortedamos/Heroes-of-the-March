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

export function sharesKingdom(a: CardDef, b: CardDef): boolean {
  const ka = kingdomsOf(a);
  return kingdomsOf(b).some((k) => ka.includes(k));
}

/** Companions under `p`'s control (in play, face up) that share their hero's kingdom. */
export function kinCount(ctx: Ctx, p: PlayerState): number {
  if (!p.hero) return 0;
  const hero = ctx.def(p.hero);
  return p.companions.filter((c) => sharesKingdom(hero, ctx.def(c))).length;
}

// --- turn effects -------------------------------------------------------------

/** Cards whose abilities are switched off this turn (Aldric's Shield of the Dawn). */
export function disabledCards(ctx: Ctx): Set<CardId> {
  const out = new Set<CardId>();
  for (const e of ctx.s.turn.effects) if (e.kind === 'disableAbilities') out.add(e.target);
  return out;
}

/** A hero's or companion's ability, unless it has been disabled this turn. */
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
export const PLAYER_TARGET_KINDS: readonly EffectKind[] = ['forceHeroStat', 'statBonus', 'heroMultiplier', 'autoWin', 'grudge'];

/**
 * Marshal Hedda Ironvow's "Hold the Line": once per turn, an opponent's ability that would affect one of
 * her controller's companions is cancelled. Returns true if it was.
 */
function heldTheLine(ctx: Ctx, e: Omit<TurnEffect, 'id'>): boolean {
  if (e.kind !== 'silenceCompanion' && e.kind !== 'forceCompanionStat' && e.kind !== 'disableAbilities') return false;
  if (!ctx.s.cards[e.target] || ctx.def(e.target).kind !== 'companion') return false;
  const victim = ownerOf(ctx, e.target);
  if (!victim || victim === e.owner) return false;
  const off = disabledCards(ctx);
  for (const c of ctx.player(victim).companions) {
    if (off.has(c) || !abilityOf(ctx.defId(c))?.holdTheLine) continue;
    const key = `${c}:hold`;
    if (ctx.s.turn.used[key]) continue;
    ctx.s.turn.used[key] = 1;
    ctx.emit({ type: 'abilityUsed', player: victim, source: ctx.ref(c), ability: 'hold', label: 'Cancel an opponent\'s ability that would affect your companion' });
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
  const victim = hostileVictim(ctx, effect);
  if (victim && ctx.s.cards[victim.hero]) {
    // Brunna's "Walls First": make it visible that the hero's ability is shielding the target.
    ctx.emit({ type: 'abilityIgnored', player: victim.id, by: ctx.ref(victim.hero), source: ctx.ref(e.source), targetCard: cardTarget && ctx.s.cards[cardTarget] ? ctx.ref(cardTarget) : null });
  }
  return effect;
}

/** The player an opponent's hurtful effect lands on, if their hero shrugs such effects off. */
function hostileVictim(ctx: Ctx, e: TurnEffect): PlayerState | null {
  if (e.kind !== 'silenceCompanion' && e.kind !== 'forceCompanionStat' && e.kind !== 'forceHeroStat' && e.kind !== 'negateBid') return null;
  const id = e.kind === 'forceHeroStat' ? e.target : ownerOf(ctx, e.target);
  const victim = id ? ctx.s.players.find((p) => p.id === id) ?? null : null;
  if (!victim || victim.id === e.owner || !victim.hero) return null;
  const a = activeAbility(ctx, victim.hero);
  return a?.ignoreHostileEffects || a?.ignoreForcedStat ? victim : null;
}

export function isIgnored(ctx: Ctx, e: TurnEffect): boolean {
  return hostileVictim(ctx, e) !== null;
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
  for (const c of p.companions) {
    const mb = activeAbility(ctx, c)?.multiBidBonus;
    if (!mb || confirmed < mb.cards) continue;
    const key = `multiBid:${c}`;
    if (ctx.s.turn.used[key]) continue;
    ctx.s.turn.used[key] = 1;
    ctx.emit({ type: 'abilityUsed', player: p.id, source: ctx.ref(c), ability: 'multiBid', label: `+${mb.bonus} to the value of each resource card played` });
  }
}

/** Who controls a card in play (hero, companion or bid), if anyone. */
export function ownerOf(ctx: Ctx, card: CardId): PlayerId | null {
  for (const p of ctx.s.players) {
    if (p.hero === card || p.companions.includes(card) || p.inactiveCompanions.includes(card) || p.resting.includes(card) || p.bids.some((b) => b.card === card)) return p.id;
  }
  return null;
}

// --- sources in play --------------------------------------------------------

/** Every card whose abilities are currently live, in clockwise order from the current player. */
export function sourcesInPlay(ctx: Ctx): Source[] {
  const out: Source[] = [];
  const off = ctx.s.turn.effects.length ? disabledCards(ctx) : null;
  for (const p of ctx.clockwise()) {
    if (!off?.has(p.hero)) out.push({ card: p.hero, owner: p.id, kind: 'hero' });
    for (const c of p.companions) if (!off?.has(c)) out.push({ card: c, owner: p.id, kind: 'companion' });
  }
  const t = ctx.s.turn;
  if (t.location) out.push({ card: t.location, owner: null, kind: 'location' });
  if (t.encounter) out.push({ card: t.encounter, owner: null, kind: 'encounter' });
  for (const m of t.minions) out.push({ card: m, owner: null, kind: 'encounter' });
  return out;
}

export function companionsInPlay(ctx: Ctx): { card: CardId; owner: PlayerState }[] {
  const out: { card: CardId; owner: PlayerState }[] = [];
  for (const p of ctx.clockwise()) for (const c of p.companions) out.push({ card: c, owner: p });
  return out;
}

/** Does this player control a live source with this ability flag? */
export function playerHas(ctx: Ctx, p: PlayerState, test: (a: Ability) => boolean | undefined): CardId | null {
  const off = ctx.s.turn.effects.length ? disabledCards(ctx) : null;
  for (const c of [p.hero, ...p.companions]) {
    if (off?.has(c)) continue;
    const a = abilityOf(ctx.defId(c));
    if (a && test(a)) return c;
  }
  return null;
}

/**
 * The opening companion phase (turn 1, before every player has picked): no hero or
 * companion ability may trigger or be used until it is over (see RULE_NOTES).
 */
export function inOpening(ctx: Ctx): boolean {
  const t = ctx.s.turn;
  return t.number === 1 && (t.step === 'turnStart' || t.step === 'companions');
}

/** Fire a trigger on every live source. Setup and the opening companion phase never fire triggers. */
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

// --- dice ----------------------------------------------------------------------

/**
 * A die roll made by an ability. The Hollow Hills invert ability die ranges;
 * Mogra Swiftfoot lets her controller (on their own turn) roll twice and keep
 * the better result for them. Rolls fire "when a N is rolled" triggers.
 */
export function abilityRoll(ctx: Ctx, player: PlayerId, prefer: 'high' | 'low'): number {
  const hollow = ctx.location?.id === 'the-hollow-hills';
  const effective = (raw: number) => (hollow ? 7 - raw : raw);
  const first = ctx.roll(player, 'ability');
  fire(ctx, 'die', { value: first, player });
  let chosen = first;
  const p = ctx.player(player);
  const mogra = p === ctx.active ? playerHas(ctx, p, (a) => a.rerollAbilityDice) : null;
  if (mogra) {
    const second = ctx.roll(player, 'ability');
    fire(ctx, 'die', { value: second, player });
    const better = prefer === 'high' ? effective(second) > effective(first) : effective(second) < effective(first);
    if (better) chosen = second;
    ctx.log(player, ctx.def(mogra).name, `rolled twice and kept ${chosen}`);
  }
  if (hollow) ctx.log(player, 'The Hollow Hills', `inverts the roll: ${chosen} counts as ${effective(chosen)}`);
  return effective(chosen);
}

// --- drawing ---------------------------------------------------------------

/** Draw resources for a player. `reason` names the card/rule responsible (for the log). */
export function drawResources(ctx: Ctx, player: PlayerId, n: number, reason: string): number {
  if (n <= 0) return 0;
  const p = ctx.player(player);
  let count = n;
  // Archmage Corvin Varro: any time you would draw a resource, you may draw an additional one.
  const extra = p.hero ? activeAbility(ctx, p.hero)?.extraDrawOnDraw : undefined;
  if (extra === true || (extra === 'ownTurn' && p === ctx.active)) {
    count += 1;
    // Shown as a zap into the resource deck (no big card: it happens on every draw).
    if (ctx.s.turn.number > 0 && p.hero) ctx.emit({ type: 'abilityZap', player, source: ctx.ref(p.hero), deck: 'resource', pile: 'deck' });
  }
  // Sigrun Stonefast: once per turn, may look at three random discarded cards and take one instead.
  const sigrun = ctx.s.discards.resource.length && !ctx.s.turn.used[`sigrun:${player}`] ? playerHas(ctx, p, (a) => a.drawFromDiscardChoice) : null;
  if (sigrun && ctx.s.turn.number > 0) {
    const pile = ctx.s.discards.resource;
    const looks = Math.min(pile.length, 3 + extraReveals(ctx, player));
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
    p.councilHeroes.push(h);
    called++;
    ctx.emit({ type: 'councilHero', player, card: ctx.ref(h) });
  }
  if (called > 0) ctx.log(player, source, `called ${called} hero${called > 1 ? 'es' : ''} to their side`);
}

/**
 * How many companions `p` may keep: the house limit (or the hero's, Ysolde), plus one for every bonus pair
 * (Varg and Moss, Goldie and Gimlet) with both members in the party. `incoming` is a card about to join,
 * counted as if it were already in play (so the second of a pair may be played above the limit).
 */
export function maxCompanions(ctx: Ctx, p: PlayerState, incoming?: CardId): number {
  const heroMax = p.hero ? activeAbility(ctx, p.hero)?.maxCompanions : undefined;
  const base = Math.max(ctx.s.rules.maxCompanions, heroMax ?? 0);
  const inPlay = new Set([...p.companions, ...p.inactiveCompanions, ...p.resting].map((c) => ctx.defId(c)));
  if (incoming) inPlay.add(ctx.defId(incoming));
  let pairs = 0;
  for (const id of inPlay) {
    const partner = abilityOf(id)?.pair;
    if (partner && id < partner && inPlay.has(partner)) pairs++;
  }
  return base + pairs;
}

/** Companions counting toward the limit (including face-down and resting ones). */
export function companionCount(p: PlayerState): number {
  return p.companions.length + p.inactiveCompanions.length + p.resting.length;
}

// --- companions -------------------------------------------------------------

export function companionEnters(ctx: Ctx, p: PlayerState, card: CardId, replaced: CardId | null): void {
  if (replaced) {
    ctx.removeFromPlayer(p, replaced);
    ctx.discard('companion', replaced);
  }
  p.companions.push(card);
  ctx.emit({ type: 'companionPlayed', player: p.id, card: ctx.ref(card), replaced: replaced ? ctx.ref(replaced) : null });
  if (inOpening(ctx)) {
    ctx.s.turn.openingEntrants.push({ player: p.id, card });
    return;
  }
  if (replaced) fire(ctx, 'companionLeft', { card: replaced, player: p.id });
  enterPlayEffects(ctx, p, card);
  // Replacing half of a bonus pair breaks it: drop back to the limit.
  if (replaced) enforceCompanionLimit(ctx, p, 'Bonus companion lost');
}

function enterPlayEffects(ctx: Ctx, p: PlayerState, card: CardId): void {
  const self: Source = { card, owner: p.id, kind: 'companion' };
  abilityOf(ctx.defId(card))?.onEnter?.(ctx, self);
  fire(ctx, 'companionEntered', { card, player: p.id });
}

/** End of the opening companion phase: companions recruited during it now "enter play", in turn order. */
export function flushOpeningEntrants(ctx: Ctx): void {
  const t = ctx.s.turn;
  const entrants = t.openingEntrants;
  t.openingEntrants = [];
  for (const { player, card } of entrants) {
    const p = ctx.player(player);
    if (p.companions.includes(card)) enterPlayEffects(ctx, p, card);
  }
}

export function discardCompanion(ctx: Ctx, p: PlayerState, card: CardId, reason: string): void {
  if (!p.companions.includes(card) && !p.inactiveCompanions.includes(card) && !p.resting.includes(card)) return;
  ctx.removeFromPlayer(p, card);
  ctx.discard('companion', card);
  ctx.emit({ type: 'companionDiscarded', player: p.id, card: ctx.ref(card), reason });
  fire(ctx, 'companionLeft', { card, player: p.id });
  // Losing half of a bonus pair drops the limit: discard down to it at once.
  enforceCompanionLimit(ctx, p, 'Bonus companion lost');
}

/** Queue discards until the player is within their companion limit. */
export function enforceCompanionLimit(ctx: Ctx, p: PlayerState, reason: string): void {
  // Discards already waiting in the queue count (each one resolves with a fresh check).
  const queued = ctx.s.tasks.filter((t) => t.t === 'choose' && t.purpose === 'discardCompanion' && t.player === p.id && t.data?.['enforce']).length;
  const excess = companionCount(p) - maxCompanions(ctx, p) - queued;
  for (let i = 0; i < excess; i++) {
    ctx.queueFirst({
      t: 'choose', purpose: 'discardCompanion', player: p.id, prompt: `${reason}: discard a companion`,
      options: [...p.companions, ...p.inactiveCompanions, ...p.resting].map((c) => cardOption(ctx, c)),
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

/** Undo lingering location effects (The Storybook Glade turns companions back up). */
export function leaveLocation(ctx: Ctx, _card: CardId): void {
  for (const p of ctx.s.players) {
    if (p.inactiveCompanions.length === 0) continue;
    for (const c of p.inactiveCompanions) {
      p.companions.push(c);
      ctx.emit({ type: 'companionFaceDown', player: p.id, card: ctx.ref(c), faceDown: false });
    }
    p.inactiveCompanions = [];
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

// --- ability reveals (Mogra's Against the Odds) -----------------------------------

/** Extra cards an ability of `owner`'s reveals: one, if they control Mogra (who says so in the log). */
export function extraReveals(ctx: Ctx, owner: PlayerId): number {
  const mogra = playerHas(ctx, ctx.player(owner), (a) => a.extraReveal);
  if (!mogra) return 0;
  ctx.log(owner, ctx.def(mogra).name, 'Against the Odds: reveals one extra card');
  return 1;
}

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
