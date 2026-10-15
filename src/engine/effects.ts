// Shared effect primitives used by the turn flow and by card abilities.

import { KINGDOMS, type CardDef, type CardKind, type Stat } from './cardTypes';
import type { Ctx } from './context';
import { abilityOf, type Ability, type Source, type TriggerName, type TriggerPayload } from './abilities';
import { companionsOf } from './cards';
import { nextInt } from './rng';
import { challengeStat, difficultyFor } from './totals';
import type { CardId, DeckName, DefendedEffect, EffectKind, PlayerId, PlayerState, TurnEffect } from './types';

// --- groups ---------------------------------------------------------------

/** Group check. Cards whose groups include "All" (The Old Quarry) match every group. */
export function hasGroup(def: CardDef, group: string): boolean {
  return def.groups.includes(group) || def.groups.includes('All');
}

/**
 * Group check for a card in play. Barrowdeep makes every encounter and minion count as Undead, and a hero
 * turned into a zombie by the Infectious Zombie gains the Undead tag.
 */
export function isOfGroup(ctx: Ctx, card: CardId, group: string): boolean {
  const d = ctx.def(card);
  if (hasGroup(d, group)) return true;
  const t = ctx.s.turn;
  if (d.kind === 'encounter' && (card === t.encounter || t.minions.includes(card))) {
    const loc = ctx.location;
    if (loc && abilityOf(loc.id)?.encountersCountAs === group) return true;
  }
  return group === 'Undead' && t.heroMinions.includes(card);
}

/** A card's kingdoms (a half-breed like Hesk has two). */
export function kingdomsOf(def: CardDef): string[] {
  return def.groups.filter((g) => (KINGDOMS as readonly string[]).includes(g));
}

// --- turn effects -------------------------------------------------------------

/** Cards whose abilities are switched off this turn (Aldric's Shield of the Dawn). */
export function disabledCards(ctx: Ctx): Set<CardId> {
  const out = new Set<CardId>();
  for (const e of ctx.s.turn.effects) if (e.kind === 'disableAbilities' || e.kind === 'facedown') out.add(e.target);
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
 * An effect that lands on another player's hero (forcing a stat) first goes through that player's defences, one
 * after another: Hedda may take it instead (redirect), then Aldric may counter it. What survives is added with
 * addEffect and, for a forced stat, the "forced to use a different stat" trigger fires.
 */
export function defendHeroEffect(ctx: Ctx, effect: DefendedEffect, then?: 'statForced'): void {
  ctx.queueFirst({ t: 'defend', effect, stage: 'redirect', ...(then ? { then } : {}) });
}

/** A live hero of `p` with this kind of defence that has not been used this turn. */
export function defenderOf(ctx: Ctx, p: PlayerState, kind: 'redirect' | 'heroes' | 'resources', not?: CardId): CardId | null {
  const off = disabledCards(ctx);
  for (const c of p.party) {
    if (c === not || off.has(c)) continue;
    const a = abilityOf(ctx.defId(c));
    const has = kind === 'redirect' ? a?.redirect : a?.counter === kind;
    if (!has) continue;
    if ((ctx.s.turn.used[`${c}:${kind === 'redirect' ? 'redirect' : 'shield'}`] ?? 0) > 0) continue;
    return c;
  }
  return null;
}

/** Add a turn effect. Returns null if it was cancelled. */
export function addEffect(ctx: Ctx, e: Omit<TurnEffect, 'id'>, watch = true): TurnEffect | null {
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
  const hostile = e.kind === 'silenceHero' || e.kind === 'forceStat' || e.kind === 'negateBid' || e.kind === 'disableAbilities' || e.kind === 'facedown'
    || (e.kind === 'statBonus' && (e.amount ?? 0) < 0);
  if (hostile && watch) {
    const hit = PLAYER_TARGET_KINDS.includes(e.kind) ? e.target : ownerOf(ctx, e.target);
    for (const w of t.effects) {
      if (w.kind === 'grudgeWatch' && w.target === e.owner && w.owner === hit && w.owner !== e.owner) {
        drawResources(ctx, w.owner, 1, ctx.def(w.source).name);
      }
    }
  }
  return effect;
}

/** The turn has reached the end of bidding: resource cards are being (or have been) revealed. */
export function bidsBeingRevealed(ctx: Ctx): boolean {
  const step = ctx.s.turn.step;
  return step === 'reveal' || step === 'winEndOfBidding' || step === 'resolve' || step === 'turnEnd';
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

/** Every hero of `p` that is in the party: face up, face down or resting (they give nothing for now, but they are there). */
const heroesOfParty = (p: PlayerState): CardId[] => [...p.party, ...p.inactive, ...p.resting];

/**
 * The party limit: the house party size, plus Ysolde's extra place, plus the extra place some locations give
 * (The Goose & Kettle). Companions are not part of the limit: see partyLoad.
 */
export function partySize(ctx: Ctx, p: PlayerState, incoming?: CardId): number {
  let size = ctx.s.rules.partySize;
  const defs = new Set(heroesOfParty(p).map((c) => ctx.defId(c)));
  if (incoming) defs.add(ctx.defId(incoming));
  for (const id of defs) size += abilityOf(id)?.partyBonus ?? 0;
  const loc = ctx.location;
  if (loc) size += abilityOf(loc.id)?.partyBonus ?? 0;
  return size;
}

/**
 * The heroes of `p` that ride for free: a hero that is a Companion To another hero does not count against the
 * party limit while any of the heroes it names is in the party (face down and resting heroes are still in the
 * party). It is an ordinary member whenever those heroes are away, and chains work (Moss to Varg to Sigrun).
 * `incoming` is a card about to join, counted as if it were already in play.
 */
export function ridingHeroes(ctx: Ctx, p: PlayerState, incoming?: CardId): Set<CardId> {
  const cards = heroesOfParty(p);
  if (incoming) cards.push(incoming);
  const defs = new Set(cards.map((c) => ctx.defId(c)));
  const out = new Set<CardId>();
  for (const c of cards) {
    if (out.size >= ctx.s.rules.companionCap) break; // a balance lever: only the first few ride for free
    if (companionsOf(ctx.defId(c)).some((d) => defs.has(d))) out.add(c);
  }
  return out;
}

/** Heroes counting toward the party limit: everyone in the party except the companions riding for free. */
export function partyLoad(ctx: Ctx, p: PlayerState, incoming?: CardId): number {
  return heroesOfParty(p).length + (incoming ? 1 : 0) - ridingHeroes(ctx, p, incoming).size;
}

// --- heroes joining and leaving ------------------------------------------------------

export function heroEnters(ctx: Ctx, p: PlayerState, card: CardId, replaced: CardId | null): void {
  const riders = replaced ? ridingHeroes(ctx, p) : null;
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
  // Replacing the hero a companion rode with (or Ysolde) may leave the party over the limit.
  if (replaced) { dropLostCompanions(ctx, p, riders!); enforcePartyLimit(ctx, p, 'Bonus hero lost'); }
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
  const riders = ridingHeroes(ctx, p);
  ctx.removeFromPlayer(p, card);
  ctx.discard('hero', card);
  ctx.emit({ type: 'heroLeft', player: p.id, card: ctx.ref(card), reason });
  fire(ctx, 'heroLeft', { card, player: p.id });
  // Losing the hero a companion rode with (or Ysolde) may put the party over the limit: the companions go first.
  dropLostCompanions(ctx, p, riders);
  enforcePartyLimit(ctx, p, 'Bonus hero lost');
}

/**
 * A hero that was riding for free lost its place when the hero it rode with left. If the party is now over its
 * limit those companions leave on their own (no choice), one at a time, until it is back within the limit.
 * A companion stays if there is room for it.
 */
function dropLostCompanions(ctx: Ctx, p: PlayerState, ridersBefore: Set<CardId>): void {
  for (let guard = 0; guard < 12; guard++) {
    if (partyLoad(ctx, p) <= partySize(ctx, p)) return;
    const now = ridingHeroes(ctx, p);
    const lost = heroesOfParty(p).find((c) => ridersBefore.has(c) && !now.has(c));
    if (!lost) return;
    discardHero(ctx, p, lost, 'Companion left');
  }
}

/** Queue discards until the player is within their party size. */
export function enforcePartyLimit(ctx: Ctx, p: PlayerState, reason: string): void {
  // Discards already waiting in the queue count (each one resolves with a fresh check).
  const queued = ctx.s.tasks.filter((t) => t.t === 'choose' && t.purpose === 'discardHero' && t.player === p.id && t.data?.['enforce']).length;
  const excess = partyLoad(ctx, p) - partySize(ctx, p) - queued;
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
    fire(ctx, 'statChanged', { stat: after });
    fire(ctx, 'challengeFaced', { stat: after, player: ctx.active.id });
  }
}

/**
 * Swap the current location (Wayfinder's Die, Portal Rune, The Umbral Ring, Grukka, Barnaby...). Brunna's player
 * may counter it first (the first such player clockwise is asked); `answered` is set once they have.
 */
export function replaceLocation(ctx: Ctx, next: CardId, mode: 'shuffleBack' | 'discard', reason: string, answered = false, reward?: { player: PlayerId; n: number }): void {
  if (!answered && ctx.s.turn.location) {
    for (const p of ctx.clockwise()) {
      const shield = defenderOf(ctx, p, 'resources');
      if (!shield) continue;
      ctx.s.turn.pendingLocation = next;
      ctx.queueFirst({
        t: 'choose', purpose: 'counterAbility', player: p.id, source: ctx.def(shield).name,
        prompt: `${reason} would change the location. Counter it with ${ctx.def(shield).name.split(',')[0]}?`,
        options: [{ value: 'counter', label: 'Counter it' }, { value: 'allow', label: 'Let it happen' }], min: 1, max: 1,
        data: { kind: 'location', next, mode, reason, shield, ...(reward ? { rewardPlayer: reward.player, rewardN: reward.n } : {}) },
      });
      return;
    }
  }
  const prev = ctx.s.turn.location;
  if (prev) {
    leaveLocation(ctx, prev);
    if (mode === 'shuffleBack') ctx.returnToDeck('location', [prev]);
    else ctx.discard('location', prev);
    ctx.emit({ type: 'locationReplaced', from: ctx.ref(prev), to: ctx.ref(next), reason });
  }
  locationEnters(ctx, next, reason);
  if (prev) fire(ctx, 'locationReplaced', { from: prev, to: next });
  enforceAllLimits(ctx);
  // Grukka: the draw comes with the new location, so a countered swap gives nothing.
  if (reward) drawResources(ctx, reward.player, reward.n, reason);
}

/** Draw a minion (of `group`, or any) from the encounter stack into the current encounter, as its own card entering play. */
export function drawMinionNow(ctx: Ctx, group: string | null): CardId | null {
  const m = group ? ctx.takeMatching('encounter', (c) => hasGroup(ctx.def(c), group)) : ctx.take('encounter');
  if (!m) return null;
  ctx.s.turn.minions.push(m);
  ctx.emit({ type: 'minionDrawn', card: ctx.ref(m) });
  fire(ctx, 'encounterEntered', { card: m, asMinion: true });
  fire(ctx, 'minionDrawn', { card: m });
  return m;
}

/** The party limit can fall when a location leaves (The Goose & Kettle's extra place): everyone is brought back within it. */
export function enforceAllLimits(ctx: Ctx): void {
  for (const p of ctx.clockwise()) enforcePartyLimit(ctx, p, 'Bonus hero lost');
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
