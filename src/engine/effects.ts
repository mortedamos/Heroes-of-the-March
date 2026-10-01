// Shared effect primitives used by the turn flow and by card abilities.

import type { CardDef, CardKind, Stat } from './cardTypes';
import type { Ctx } from './context';
import { abilityOf, type Ability, type Source, type TriggerName, type TriggerPayload } from './abilities';
import { nextInt } from './rng';
import type { CardId, EffectKind, PlayerId, PlayerState, TurnEffect } from './types';

// --- groups ---------------------------------------------------------------

/** Group check. Cards whose groups include "All" (The Old Quarry) match every group. */
export function hasGroup(def: CardDef, group: string): boolean {
  return def.groups.includes(group) || def.groups.includes('All');
}

export function kingdomOf(def: CardDef): string | null {
  return def.groups.find((g) => ['Human', 'Elf', 'Dwarf', 'Orc', 'Halfellow'].includes(g)) ?? null;
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

export function addEffect(ctx: Ctx, e: Omit<TurnEffect, 'id'>): TurnEffect {
  const t = ctx.s.turn;
  t.effectSeq += 1;
  const effect: TurnEffect = { ...e, id: t.effectSeq };
  t.effects.push(effect);
  const cardTarget = e.kind === 'forceHeroStat' || e.kind === 'statBonus' || e.kind === 'heroMultiplier' || e.kind === 'autoWin' ? null : e.target;
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

/**
 * Pell Quillon's "Proofs and Theorems" is a standing bonus: show it the first time it takes effect
 * in a turn (the moment the player has put out enough confirmed resource cards).
 */
export function noteMultiBid(ctx: Ctx, p: PlayerState): void {
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
  // Sigrun Stonefast: may take random cards from the discard pile instead.
  const sigrun = ctx.s.discards.resource.length ? playerHas(ctx, p, (a) => a.drawFromDiscardChoice) : null;
  if (sigrun && ctx.s.turn.number > 0) {
    ctx.queueFirst({
      t: 'choose', purpose: 'sigrunDraw', player, source: ctx.def(sigrun).name,
      prompt: `Encore! Draw ${count} from the resource stack, or take ${count} at random from the discard pile?`,
      options: [{ value: 'deck', label: 'Draw from the stack' }, { value: 'discard', label: `Random from discard (${ctx.s.discards.resource.length})` }],
      min: 1, max: 1, data: { n: count, reason },
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

export function maxCompanions(ctx: Ctx, p: PlayerState): number {
  const heroMax = p.hero ? activeAbility(ctx, p.hero)?.maxCompanions : undefined;
  return Math.max(ctx.s.rules.maxCompanions, heroMax ?? 0);
}

/** Top the tavern back up to its size with face-up companions. */
export function refillTavern(ctx: Ctx): void {
  const t = ctx.s.tavern;
  while (t.length < ctx.s.rules.tavernSize) {
    const c = ctx.take('companion');
    if (!c) break;
    t.push(c);
    ctx.emit({ type: 'tavernRefilled', card: ctx.ref(c) });
  }
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
  enterPlayEffects(ctx, p, card);
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
}

/** Queue discards until the player is within their companion limit. */
export function enforceCompanionLimit(ctx: Ctx, p: PlayerState, reason: string): void {
  const excess = companionCount(p) - maxCompanions(ctx, p);
  for (let i = 0; i < excess; i++) {
    ctx.queueFirst({
      t: 'choose', purpose: 'discardCompanion', player: p.id, prompt: `${reason}: discard a companion`,
      options: [...p.companions, ...p.inactiveCompanions, ...p.resting].map((c) => cardOption(ctx, c)),
      min: 1, max: 1, source: reason,
    });
  }
}

// --- locations --------------------------------------------------------------

export function locationEnters(ctx: Ctx, card: CardId, reason: string): void {
  ctx.s.turn.location = card;
  ctx.emit({ type: 'locationRevealed', card: ctx.ref(card), reason });
  abilityOf(ctx.defId(card))?.onEnter?.(ctx, { card, owner: null, kind: 'location' });
  fire(ctx, 'locationEntered', { card });
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
