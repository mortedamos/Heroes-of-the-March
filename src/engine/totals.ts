// Stat totals, difficulties and projections.
//
// SECURITY: every function that sums bids takes a `Visible` predicate. The
// engine resolves with ALL_VISIBLE (by then every card is revealed), but any
// number computed for a client's view must use visibleTo(viewer). Otherwise
// an opponent's face-down card would leak through a total, a card value or
// a "wands disabled" flag.

import { abilityOf } from './abilities';
import { alliedTargets, getDef, matchesTarget, nemesisTargets } from './cards';
import type { Challenge, HeroDef, ResourceDef, Stat } from './cardTypes';
import type { Ctx } from './context';
import { activeEffects, hasGroup, isOfGroup } from './effects';
import type { Bid, CardId, PlayerId, PlayerState } from './types';

export type Visible = (owner: PlayerState, bid: Bid) => boolean;
/** Engine-only: sees every card. Never use for anything sent to a client. */
export const ALL_VISIBLE: Visible = () => true;
/** What a viewer may see: visible bids plus their own. A null viewer (spectator) sees only visible bids. */
export const visibleTo = (viewer: PlayerId | null, seen: readonly CardId[] = []): Visible =>
  (owner, bid) => bid.visible || (viewer !== null && owner.id === viewer) || seen.includes(bid.card);

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
export interface DifficultyBreakdown { base: number; boost: number; minions: number; total: number }

export function difficultyFor(ctx: Ctx, _p: PlayerState | null): DifficultyBreakdown | null {
  const ch = currentChallenge(ctx);
  const t = ctx.s.turn;
  if (!ch || !t.encounter) return null;
  const boost = locationBoost(ctx, t.encounter);
  const perMinion = (ctx.location ? abilityOf(ctx.location.id)?.minionBonus : 0) ?? 0;
  const main = ctx.def(t.encounter);
  let minions = 0;
  for (const m of t.minions) {
    const d = ctx.def(m);
    if (d.kind !== 'encounter') continue;
    minions += d.minionValue + locationBoost(ctx, m) + perMinion;
  }
  // Heroes pressed into service as minions (Infectious Zombie) add their stat for the challenge.
  const chStat = challengeStat(ctx, null) ?? ch.stat;
  for (const c of t.heroMinions) {
    const d = ctx.def(c);
    if (d.kind === 'hero') minions += d.stats[chStat];
  }
  // The Runeforged Titan is far easier if the challenge is not Physical.
  const stat = challengeStat(ctx, _p) ?? ch.stat;
  const base = abilityOf(main.id)?.difficultyByStat?.[stat] ?? ch.difficulty;
  return { base, boost, minions, total: base + boost + minions };
}

// --- player totals ---------------------------------------------------------

export interface Contribution { source: CardId; value: number }
export interface TotalBreakdown {
  stat: Stat;
  /** What each hero in the party adds in the tested stat. */
  party: Contribution[];
  council: Contribution[];
  resources: Contribution[];
  bonus: number;
  /** Where `bonus` came from (cards' bonuses, penalties), for the result breakdown. */
  bonuses: { source: CardId | null; label: string; amount: number }[];
  total: number;
  /** Bids not counted because the viewer can't see them. */
  hiddenBids: number;
}

/**
 * Allied: +1 to all stats for every other card on the owner's board that matches one of the hero's targets: the
 * owner's other heroes (face up, in the party) and the owner's resources that are face up (or that the viewer may
 * see: your own bids, and the ones everyone can see; a curse placed on the owner is theirs). A card counts once
 * even if it matches several targets.
 */
export function alliedBonus(ctx: Ctx, p: PlayerState, hero: CardId, visible: Visible): number {
  const targets = alliedTargets(ctx.defId(hero));
  if (!targets.length) return 0;
  const cards = [
    ...p.party.filter((c) => c !== hero).map((c) => ctx.def(c)),
    ...p.bids.filter((b) => visible(p, b) && !b.flipped).map((b) => ctx.def(b.card)),
  ];
  return cards.filter((d) => targets.some((t) => matchesTarget(d, t))).length;
}

/**
 * Nemesis: +1 to all stats for every location, encounter or minion in play that matches one of the hero's targets
 * (a tag, or the card itself). Only shared, face-up cards count. Barrowdeep makes every encounter and minion Undead.
 */
export function nemesisBonus(ctx: Ctx, hero: CardId): number {
  const targets = nemesisTargets(ctx.defId(hero));
  if (!targets.length) return 0;
  const t = ctx.s.turn;
  const cards = [...(t.location ? [t.location] : []), ...(t.encounter ? [t.encounter] : []), ...t.minions, ...t.heroMinions];
  return cards.filter((c) => targets.some((tg) => ('tag' in tg ? isOfGroup(ctx, c, tg.tag) : ctx.defId(c) === tg.def))).length;
}

function heroValue(ctx: Ctx, p: PlayerState, card: CardId, stat: Stat, visible: Visible): number {
  if (activeEffects(ctx, 'silenceHero').some((e) => e.target === card)) return 0;
  const d = getDef(ctx.defId(card)) as HeroDef;
  let v = d.stats[stat];
  const forced = activeEffects(ctx, 'forceStat').filter((e) => e.target === card).at(-1);
  if (forced) v = d.stats[forced.stat as Stat];
  v += alliedBonus(ctx, p, card, visible) + nemesisBonus(ctx, card);
  return Math.max(0, v);
}

/** Value of one resource for its owner in the current context. */
export function resourceValue(ctx: Ctx, owner: PlayerState, card: CardId): number {
  const d = getDef(ctx.defId(card)) as ResourceDef;
  // Brisa: a resource she turned face down contributes 3 whatever it says.
  const set = activeEffects(ctx, 'bidValue').filter((e) => e.target === card).at(-1);
  if (set) return set.amount ?? 3;
  let v = abilityOf(d.id)?.resourceValue?.(ctx, owner, d.value) ?? d.value;
  if (d.wand) {
    if (ctx.s.turn.wandsDisabled) return 0;
  }
  // "Any numeric bonus it grants counts as zero instead."
  if (v > 0 && activeEffects(ctx, 'negateBid').some((e) => e.target === card)) v = 0;
  return v;
}

export function totalFor(ctx: Ctx, p: PlayerState, visible: Visible, statOverride?: Stat): TotalBreakdown | null {
  const stat = statOverride ?? challengeStat(ctx, p);
  if (!stat) return null;
  const party = p.party.map((c) => ({ source: c, value: heroValue(ctx, p, c, stat, visible) }));
  const council = p.borrowed.map((h) => ({ source: h, value: (getDef(ctx.defId(h)) as HeroDef).stats[stat] }));
  const counted = p.bids.filter((b) => visible(p, b));
  const resources = counted.map((b) => ({ source: b.card, value: resourceValue(ctx, p, b.card) }));
  let bonus = 0;
  const bonuses: TotalBreakdown['bonuses'] = [];
  const add = (source: CardId | null, label: string, amount: number) => { if (amount === 0) return; bonus += amount; bonuses.push({ source, label, amount }); };
  for (const e of activeEffects(ctx, 'statBonus')) {
    if (e.target === p.id && (e.stat === 'all' || e.stat === stat)) add(e.source, ctx.def(e.source).name.split(',')[0]!, e.amount ?? 0);
  }
  // The Grudge Book / The Book of Grudges: -3 in this encounter.
  add(null, 'Grudge', -p.penalty);
  const sum = (xs: Contribution[]) => xs.reduce((a, x) => a + x.value, 0);
  return {
    stat, party, council, resources, bonus, bonuses,
    total: sum(party) + sum(council) + sum(resources) + bonus,
    hiddenBids: p.bids.length - counted.length,
  };
}

/** Raw party strength in a stat (used for "may change the stat" choices). */
export function baseStrength(ctx: Ctx, p: PlayerState, stat: Stat): number {
  return p.party.reduce((a, c) => a + heroValue(ctx, p, c, stat, ALL_VISIBLE), 0);
}
