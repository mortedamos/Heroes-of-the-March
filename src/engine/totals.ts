// Stat totals, difficulties and projections.
//
// SECURITY: every function that sums bids takes a `Visible` predicate. The
// engine resolves with ALL_VISIBLE (by then every card is revealed), but any
// number computed for a client's view must use visibleTo(viewer). Otherwise
// an opponent's face-down card would leak through a total, a card value or
// a "wands disabled" flag.

import { abilityOf } from './abilities';
import { getDef } from './cards';
import type { Challenge, CompanionDef, HeroDef, ResourceDef, Stat } from './cardTypes';
import type { Ctx } from './context';
import { activeAbility, activeEffects, bidsBeingRevealed, hasGroup } from './effects';
import type { Bid, CardId, PlayerId, PlayerState } from './types';

export type Visible = (owner: PlayerState, bid: Bid) => boolean;
/** Engine-only: sees every card. Never use for anything sent to a client. */
export const ALL_VISIBLE: Visible = () => true;
/** What a viewer may see: visible bids plus their own. A null viewer (spectator) sees only visible bids. */
export const visibleTo = (viewer: PlayerId | null): Visible =>
  (owner, bid) => bid.visible || (viewer !== null && owner.id === viewer);

export function currentChallenge(ctx: Ctx): Challenge | null {
  const enc = ctx.encounter;
  return enc ? { stat: enc.stat, difficulty: enc.difficulty } : null;
}

/** The stat a player must use: their own override, else the location's, else the challenge's. */
export function challengeStat(ctx: Ctx, p: PlayerState | null): Stat | null {
  if (p?.statOverride) return p.statOverride;
  const loc = ctx.location;
  const locStat = loc ? abilityOf(loc.id)?.challengeStat : undefined;
  if (locStat) return locStat;
  return currentChallenge(ctx)?.stat ?? null;
}

function locationBoost(ctx: Ctx, card: CardId): number {
  const loc = ctx.location;
  const boost = loc ? abilityOf(loc.id)?.groupBoost : undefined;
  return boost && hasGroup(ctx.def(card), boost.group) ? boost.amount : 0;
}

/** base: printed on the encounter card. */
export interface DifficultyBreakdown { base: number; boost: number; minions: number; ignoredMinions: boolean; total: number }

export function difficultyFor(ctx: Ctx, p: PlayerState | null): DifficultyBreakdown | null {
  const ch = currentChallenge(ctx);
  const t = ctx.s.turn;
  if (!ch || !t.encounter) return null;
  const boost = locationBoost(ctx, t.encounter);
  const perMinion = (ctx.location ? abilityOf(ctx.location.id)?.minionBonus : 0) ?? 0;
  let minions = 0;
  for (const m of t.minions) {
    const d = ctx.def(m);
    if (d.kind === 'encounter') minions += d.minionValue + locationBoost(ctx, m) + perMinion;
  }
  // Companions pressed into service as minions (Iron Mites) add their stat for the challenge.
  const chStat = challengeStat(ctx, null) ?? ch.stat;
  for (const c of t.companionMinions) {
    const d = ctx.def(c);
    if (d.kind === 'companion') minions += d.stats[chStat];
  }
  let ignoredMinions = false;
  if (p && minions > 0 && activeAbility(ctx, p.hero)?.ignorePositiveMinionBonus) {
    minions = 0;
    ignoredMinions = true;
  }
  return { base: ch.difficulty, boost, minions, ignoredMinions, total: ch.difficulty + boost + minions };
}

// --- player totals ---------------------------------------------------------

export interface Contribution { source: CardId; value: number }
export interface TotalBreakdown {
  stat: Stat;
  hero: number;
  companions: Contribution[];
  council: Contribution[];
  resources: Contribution[];
  bonus: number;
  total: number;
  /** Bids not counted because the viewer can't see them. */
  hiddenBids: number;
}

/** Brunna: forced stats only apply to her player's cards if they help. */
function applyForced(ctx: Ctx, p: PlayerState, normal: number, forced: number | null): number {
  if (forced === null) return normal;
  const a = activeAbility(ctx, p.hero);
  return a?.ignoreForcedStat || a?.ignoreHostileEffects ? Math.max(normal, forced) : forced;
}

/** Does this effect count against `p`? (Ignored when their hero shrugs off opponents' effects.) */
function hostileApplies(ctx: Ctx, p: PlayerState, effectOwner: string): boolean {
  return effectOwner === p.id || !activeAbility(ctx, p.hero)?.ignoreHostileEffects;
}

function heroValue(ctx: Ctx, p: PlayerState, stat: Stat): number {
  const hero = getDef(ctx.defId(p.hero)) as HeroDef;
  let v = hero.stats[stat];
  for (const c of p.companions) {
    const sub = activeAbility(ctx, c)?.heroStatSub;
    if (sub) v = Math.max(v, hero.stats[sub]);
  }
  const forced = activeEffects(ctx, 'forceHeroStat').filter((e) => e.target === p.id).at(-1);
  v = applyForced(ctx, p, v, forced ? hero.stats[forced.stat as Stat] : null);
  for (const e of activeEffects(ctx, 'heroMultiplier')) if (e.target === p.id) v *= e.amount ?? 1;
  return v;
}

/**
 * Posy and Osric: when the hero's stat swap is used (the hero's Mental / Guile beats the hero's stat in this
 * challenge), the companion that provides it gains `heroSubBonus` for the encounter. If both are in play, the
 * one providing the better swap gets it. A silenced companion contributes nothing, bonus included.
 */
function addSwapBonus(ctx: Ctx, p: PlayerState, stat: Stat, companions: Contribution[]): void {
  const hero = getDef(ctx.defId(p.hero)) as HeroDef;
  let best: Contribution | null = null;
  let bestSub = hero.stats[stat];
  let bonus = 0;
  for (const c of companions) {
    const a = activeAbility(ctx, c.source);
    if (!a?.heroStatSub || !a.heroSubBonus) continue;
    if (activeEffects(ctx, 'silenceCompanion').some((e) => e.target === c.source)) continue;
    const sub = hero.stats[a.heroStatSub];
    if (sub > bestSub) { best = c; bestSub = sub; bonus = a.heroSubBonus; }
  }
  if (best) best.value += bonus;
}

function companionValue(ctx: Ctx, p: PlayerState, card: CardId, stat: Stat): number {
  if (activeEffects(ctx, 'silenceCompanion').some((e) => e.target === card && hostileApplies(ctx, p, e.owner))) return 0;
  const d = getDef(ctx.defId(card)) as CompanionDef;
  let v = d.stats[stat];
  const sub = activeAbility(ctx, card)?.selfStatSub;
  if (sub) v = Math.max(v, d.stats[sub]);
  const forced = activeEffects(ctx, 'forceCompanionStat').filter((e) => e.target === card).at(-1);
  return applyForced(ctx, p, v, forced ? d.stats[forced.stat as Stat] : null);
}

/** Value of one resource for its owner in the current context. */
export function resourceValue(ctx: Ctx, owner: PlayerState, card: CardId): number {
  const d = getDef(ctx.defId(card)) as ResourceDef;
  let v = abilityOf(d.id)?.resourceValue?.(ctx, owner, d.value) ?? d.value;
  if (d.wand) {
    if (ctx.s.turn.wandsDisabled) return 0;
    for (const c of owner.companions) v += activeAbility(ctx, c)?.wandBonus ?? 0;
  }
  // Oskar: "any numeric bonus it grants counts as zero instead".
  if (v > 0 && activeEffects(ctx, 'negateBid').some((e) => e.target === card && hostileApplies(ctx, owner, e.owner))) v = 0;
  return v;
}

export function totalFor(ctx: Ctx, p: PlayerState, visible: Visible, statOverride?: Stat): TotalBreakdown | null {
  const stat = statOverride ?? challengeStat(ctx, p);
  if (!stat) return null;
  const hero = heroValue(ctx, p, stat);
  const companions = p.companions.map((c) => ({ source: c, value: companionValue(ctx, p, c, stat) }));
  addSwapBonus(ctx, p, stat, companions);
  if (companions.length > 2 && activeAbility(ctx, p.hero)?.extraCompanionHalf) {
    const weakest = companions.reduce((a, b) => (b.value < a.value ? b : a));
    weakest.value = Math.floor(weakest.value / 2);
  }
  const council = p.councilHeroes.map((h) => ({ source: h, value: (getDef(ctx.defId(h)) as HeroDef).stats[stat] }));
  const counted = p.bids.filter((b) => visible(p, b));
  const resources = counted.map((b) => ({ source: b.card, value: resourceValue(ctx, p, b.card) }));
  let bonus = 0;
  for (const c of p.companions) {
    const mb = activeAbility(ctx, c)?.multiBidBonus;
    if (mb && bidsBeingRevealed(ctx) && counted.length >= mb.cards) bonus += mb.bonus * counted.length;
  }
  for (const e of activeEffects(ctx, 'statBonus')) {
    if (e.target === p.id && (e.stat === 'all' || e.stat === stat)) bonus += e.amount ?? 0;
  }
  bonus += activeAbility(ctx, p.hero)?.flatBonus ?? 0;
  const sum = (xs: Contribution[]) => xs.reduce((a, x) => a + x.value, 0);
  return {
    stat, hero, companions, council, resources, bonus,
    total: hero + sum(companions) + sum(council) + sum(resources) + bonus,
    hiddenBids: p.bids.length - counted.length,
  };
}

/** Raw hero + companion strength in a stat (used for "may change the stat" choices). */
export function baseStrength(ctx: Ctx, p: PlayerState, stat: Stat): number {
  return heroValue(ctx, p, stat) + p.companions.reduce((a, c) => a + companionValue(ctx, p, c, stat), 0);
}
