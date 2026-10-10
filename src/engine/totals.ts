// Stat totals, difficulties and projections.
//
// SECURITY: every function that sums bids takes a `Visible` predicate. The
// engine resolves with ALL_VISIBLE (by then every card is revealed), but any
// number computed for a client's view must use visibleTo(viewer). Otherwise
// an opponent's face-down card would leak through a total, a card value or
// a "wands disabled" flag.

import { abilityOf } from './abilities';
import { getDef } from './cards';
import type { Challenge, HeroDef, ResourceDef, Stat } from './cardTypes';
import type { Ctx } from './context';
import { activeAbility, activeEffects, bidsBeingRevealed, hasGroup, playerHas } from './effects';
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

/** Brunna: forced stats only apply to her player's cards if they help. */
function applyForced(ctx: Ctx, p: PlayerState, normal: number, forced: number | null): number {
  if (forced === null) return normal;
  return playerHas(ctx, p, (a) => a.ignoreForcedStat || a.ignoreHostileEffects) ? Math.max(normal, forced) : forced;
}

/** Does this effect count against `p`? (Ignored when one of their heroes shrugs off opponents' effects.) */
function hostileApplies(ctx: Ctx, p: PlayerState, effectOwner: string): boolean {
  return effectOwner === p.id || !playerHas(ctx, p, (a) => a.ignoreHostileEffects);
}

function heroValue(ctx: Ctx, p: PlayerState, card: CardId, stat: Stat): number {
  if (activeEffects(ctx, 'silenceHero').some((e) => e.target === card && hostileApplies(ctx, p, e.owner))) return 0;
  const d = getDef(ctx.defId(card)) as HeroDef;
  let v = d.stats[stat];
  const sub = activeAbility(ctx, card)?.selfStatSub;
  if (sub) v = Math.max(v, d.stats[sub]);
  const forced = activeEffects(ctx, 'forceStat').filter((e) => e.target === card).at(-1);
  v = applyForced(ctx, p, v, forced ? d.stats[forced.stat as Stat] : null);
  const a = activeAbility(ctx, card);
  // Varg and Sigrun: +2 while the other is in the party.
  if (a?.partnerBonus && p.party.some((c) => ctx.defId(c) === a.partnerBonus!.with)) v += a.partnerBonus.amount;
  // Gimlet: +1 while Destiny the Frog is part of the encounter.
  if (a?.encounterBonus) {
    const t = ctx.s.turn;
    if ([t.encounter, ...t.minions].some((e) => e && ctx.defId(e) === a.encounterBonus!.def)) v += a.encounterBonus.amount;
  }
  return Math.max(0, v);
}

/** Value of one resource for its owner in the current context. */
export function resourceValue(ctx: Ctx, owner: PlayerState, card: CardId): number {
  const d = getDef(ctx.defId(card)) as ResourceDef;
  let v = abilityOf(d.id)?.resourceValue?.(ctx, owner, d.value) ?? d.value;
  if (d.wand) {
    if (ctx.s.turn.wandsDisabled) return 0;
  }
  // Kazra: every Dwarf resource he bids is worth one more (a curse placed in front of him is not his bid).
  if (d.groups.includes('Dwarf') && d.value >= 0) {
    const kazra = playerHas(ctx, owner, (a) => a.bidBonus !== undefined);
    if (kazra) v += abilityOf(ctx.defId(kazra))!.bidBonus!;
  }
  // Oskar: "any numeric bonus it grants counts as zero instead".
  if (v > 0 && activeEffects(ctx, 'negateBid').some((e) => e.target === card && hostileApplies(ctx, owner, e.owner))) v = 0;
  return v;
}

export function totalFor(ctx: Ctx, p: PlayerState, visible: Visible, statOverride?: Stat): TotalBreakdown | null {
  const stat = statOverride ?? challengeStat(ctx, p);
  if (!stat) return null;
  const party = p.party.map((c) => ({ source: c, value: heroValue(ctx, p, c, stat) }));
  const council = p.borrowed.map((h) => ({ source: h, value: (getDef(ctx.defId(h)) as HeroDef).stats[stat] }));
  const counted = p.bids.filter((b) => visible(p, b));
  const resources = counted.map((b) => ({ source: b.card, value: resourceValue(ctx, p, b.card) }));
  let bonus = 0;
  const bonuses: TotalBreakdown['bonuses'] = [];
  const add = (source: CardId | null, label: string, amount: number) => { if (amount === 0) return; bonus += amount; bonuses.push({ source, label, amount }); };
  for (const c of p.party) {
    const mb = activeAbility(ctx, c)?.multiBidBonus;
    if (mb && bidsBeingRevealed(ctx) && counted.length >= mb.cards) add(c, ctx.def(c).name.split(',')[0]!, mb.bonus * counted.length);
  }
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
  return p.party.reduce((a, c) => a + heroValue(ctx, p, c, stat), 0);
}
