// Heuristic bot. It decides from its own redacted GameView only (exactly
// what a remote human client would receive), so bots can't cheat and they
// double as a test that views carry enough information to play.
//
// Strategy, by level:
//   easy   - plays straightforwardly, uses abilities some of the time, random-ish targets.
//   normal - treats bidding as a trade (decideBid): the location's renown now
//            against the cards it costs, keeping a reserve for next turn's
//            challenge; protects a good hero; sabotages the player it is
//            actually competing with.
//   hard   - as normal, plus threat-weighted sabotage (who could win the GAME with
//            this location), bluffing and tighter survival math.

import { allDefs, getDef } from '../engine/cards';
import type { Stat } from '../engine/cardTypes';
import type { Command } from '../engine/types';
import type { AbilityOptionView, GameView, PendingView, PlayerPublicView } from '../engine/view';
import {
  AVG_COMPANION_SCORE, AVG_HERO_STAT, HIDDEN_BID_ESTIMATE, Table, companionDef, companionScore, heroDef, heroValue, locationRenown,
} from './knowledge';

export type BotLevel = 'easy' | 'normal' | 'hard';
export { companionScore };

/** Forced-stat abilities: which stat they force, and on what. */
const FORCE: Record<string, { stat: Stat; on: 'companion' | 'hero' }> = {
  'liriel-nightbloom': { stat: 'G', on: 'companion' },
  'thessaly-of-the-grove': { stat: 'M', on: 'companion' },
  'kesh-the-bog-huntress': { stat: 'P', on: 'companion' },
  'sir-hugo-pellam-marchguard-surgeon': { stat: 'G', on: 'hero' },
  'caelan-the-exile': { stat: 'M', on: 'hero' },
  'brisa-blastcap-bombardier': { stat: 'P', on: 'hero' },
  'clemence-fairbrook-temple-cook': { stat: 'P', on: 'hero' },
};

/** A hero worth protecting (stats + ability above the table average). */
const KEEP_HERO = 23;

type Rand = () => number;

export function botDecide(view: GameView, level: BotLevel, rand: Rand = Math.random): Command | null {
  const d = view.pending;
  if (!d || d.player !== view.you || !d.detail) return null;
  const t = new Table(view);
  const decision = d.id;
  const detail = d.detail;

  switch (detail.kind) {
    case 'companion.offer': {
      if (level === 'easy' && rand() < 0.3) return { type: 'companion.skip', decision };
      // Looking at three and keeping the best is never worse than skipping (the pick can still be let go).
      return { type: 'companion.draw', decision };
    }

    case 'companion.place': {
      if (!detail.mustReplace) return { type: 'companion.keep', decision, replace: null };
      const all = [...t.me.companions, ...t.me.inactiveCompanions, ...t.me.resting];
      const weakest = all.reduce((a, b) => (companionScore(a.def) <= companionScore(b.def) ? a : b));
      return companionScore(detail.drawn.def) > companionScore(weakest.def)
        ? { type: 'companion.keep', decision, replace: weakest.id }
        : { type: 'companion.discard', decision };
    }

    case 'activate': {
      const use = detail.abilities.find((a) => wantsAbility(t, a, level, rand));
      return use ? { type: 'ability.use', decision, source: use.source.id, ability: use.ability } : { type: 'ability.done', decision };
    }

    case 'bid':
      return decideBid(t, d, level, rand);

    case 'choose':
      return { type: 'choose', decision, picks: choose(t, detail, level, rand) };
  }
}

// --- abilities -------------------------------------------------------------------

function wantsAbility(t: Table, a: AbilityOptionView, level: BotLevel, rand: Rand): boolean {
  if (level === 'easy' && rand() < 0.45) return false;
  const stat = t.stat;
  switch (a.ability) {
    // Before bidding the bots hold back until the situation calls for it.
    case 'torch': return torchWorthIt(t, level);
    case 'mineNow': case 'maps': return locationWorthChecking(t, level);
    // Costs a card: only worth it with a spare one, against a real threat.
    case 'ruling': return level !== 'easy' && t.view.hand.length >= 4 && Boolean(t.biggestThreat());
    // Pure information: worth a look now and then, always for a hard bot.
    case 'readAhead': return level === 'hard' || (level === 'normal' && rand() < 0.4);
    case 'shadowsteeds': {
      // The minion bonus is about +2 to every stat: only spend it when it could matter.
      const handSum = t.view.hand.reduce((sum, h) => sum + t.handValue(h.card.id), 0);
      return t.myEstimate() + handSum < Math.max(t.difficultyFor(t.me), t.bestRivalEstimate()) + 4;
    }
    case 'requisition': {
      const worst = Math.min(...t.view.hand.map((h) => t.handValue(h.card.id)));
      return worst <= 2 && t.others.some((p) => p.handCount >= 2);
    }
    case 'rest': {
      if (!stat) return false;
      const tova = t.me.companions.find((c) => c.id === a.source.id);
      const tovaStat = tova ? companionDef(tova).stats[stat] : 0;
      const handSum = t.view.hand.reduce((s, h) => s + t.handValue(h.card.id), 0);
      const mine = t.myEstimate();
      return mine + handSum < t.bestRivalEstimate() - 2 && mine - tovaStat >= t.difficultyFor(t.me);
    }
    // End of bidding: everything is revealed, so the numbers are exact.
    case 'honk': return gooseWorthIt(t, a);
    case 'queen': return magsWorthIt(t);
    case 'stonetouched': return miraWorthIt(t, level);
    // During bidding.
    case 'force': return bestForce(t, a.source.def, level).gain >= (level === 'hard' ? 1.5 : 2);
    case 'pockets': return t.others.some((p) => p.bids.some((b) => b.hidden));
    case 'shield': return harmfulEffectsOnMe(t).length > 0;
    case 'notThisFight': {
      const mine = t.myEstimate();
      const handSum = t.view.hand.reduce((s, h) => s + t.handValue(h.card.id), 0);
      const doomed = mine + handSum < t.difficultyFor(t.me) && !t.me.fallPending;
      const hopeless = mine + handSum < t.bestRivalEstimate() - 4;
      return doomed || (level === 'hard' && hopeless && t.prize >= 4);
    }
    default: return false;
  }
}

/**
 * Aelthir's silence: worth using when a rival who is actually in the running has a companion
 * that is giving them something in this challenge (and more so if it would sink them).
 */
function torchWorthIt(t: Table, level: BotLevel): boolean {
  const stat = t.stat;
  if (!stat) return false;
  const mine = t.myEstimate();
  let best = 0;
  for (const p of t.others) {
    if (!p.projection || p.hero?.def === 'high-thane-brunna-stonefast') continue; // Brunna ignores silences
    const est = t.estimate(p);
    const diff = t.difficultyFor(p);
    if (!(est >= mine - 4 && est >= diff - 2)) continue; // not a rival this turn
    const top = Math.max(0, ...p.companions.map((c) => companionDef(c).stats[stat]));
    let gain = top;
    if (est >= diff && est - top < diff && !p.fallPending) gain += 3; // it would make their hero fall
    best = Math.max(best, gain);
  }
  return best >= (level === 'hard' ? 3 : 4);
}

/** Grukka and Barnaby look at upcoming locations: worth doing when this one is not much of a prize. */
function locationWorthChecking(t: Table, level: BotLevel): boolean {
  const loc = t.view.turn.location;
  if (!loc) return false;
  return locationRenown({ def: loc.def }) <= (level === 'hard' ? 3 : 2);
}

function standing(t: Table): { mine: number; best: number; diff: number; winning: boolean } {
  const mine = t.me.projection?.total ?? 0;
  const best = Math.max(-Infinity, ...t.others.filter((p) => p.projection && p.projection.total >= p.projection.difficulty).map((p) => p.projection!.total));
  const diff = t.difficultyFor(t.me);
  return { mine, best, diff, winning: mine >= diff && mine > best };
}

function gooseWorthIt(t: Table, a: AbilityOptionView): boolean {
  if (t.stat !== 'P') return false; // +3 Physical is useless off-stat, and failing costs the goose's stats
  const { mine, best, diff, winning } = standing(t);
  const gooseP = companionDef(a.source).stats.P;
  if (winning && mine - gooseP > best && mine - gooseP >= diff) return false; // safe already
  if (!winning && mine + 3 > best && mine + 3 >= diff) return true; // a 2-in-3 shot at the location
  return mine < diff && mine + 3 >= diff && !t.me.fallPending; // a shot at survival
}

function magsWorthIt(t: Table): boolean {
  if (!t.stat) return false;
  const { mine, best, diff, winning } = standing(t);
  const boost = heroDef(t.me.hero).stats[t.stat];
  const after = mine + boost;
  if (!winning && after > best && after >= diff && t.prize >= 3) return true;
  return mine < diff && after >= diff && !t.me.fallPending && heroValue(t.me.hero?.def) >= KEEP_HERO;
}

function miraWorthIt(t: Table, level: BotLevel): boolean {
  const { winning } = standing(t);
  if (winning) return false;
  if (t.me.renown + t.prize >= t.target) return true; // wins the game outright
  if (level !== 'hard') return t.prize >= 6;
  return t.prize >= 5 && heroValue(t.me.hero?.def) < KEEP_HERO && t.view.hand.length <= 2;
}

/** Active effects hurting us whose source we could switch off (Aldric). */
function harmfulEffectsOnMe(t: Table) {
  return t.view.turn.effects.filter((e) => e.active && e.owner !== t.me.id && e.targetPlayer === t.me.id
    && (e.kind === 'forceCompanionStat' || e.kind === 'forceHeroStat' || e.kind === 'silenceCompanion' || e.kind === 'negateBid'));
}

interface ForceChoice { value: string; gain: number }

/** The best target for a forced-stat ability, and how much it helps us. */
function bestForce(t: Table, sourceDef: string, level: BotLevel): ForceChoice {
  const f = FORCE[sourceDef];
  const stat = t.stat;
  if (!f || !stat) return { value: '', gain: 0 };
  const mine = t.myEstimate();
  let best: ForceChoice = { value: '', gain: 0 };
  // Targets already forced this turn gain nothing from being forced again.
  const forced = new Set(t.view.turn.effects.filter((e) => e.active && (e.kind === 'forceHeroStat' || e.kind === 'forceCompanionStat'))
    .map((e) => (e.kind === 'forceHeroStat' ? e.targetPlayer : e.targetCard?.id)));
  for (const p of t.others) {
    if (!p.projection) continue;
    if (p.hero?.def === 'high-thane-brunna-stonefast') continue; // Brunna ignores harmful forcing
    const est = t.estimate(p);
    const candidates = f.on === 'hero'
      ? [{ value: p.id, reduction: heroDef(p.hero).stats[stat] - heroDef(p.hero).stats[f.stat] }]
      : p.companions.map((c) => ({ value: c.id, reduction: companionDef(c).stats[stat] - companionDef(c).stats[f.stat] }));
    for (const c of candidates) {
      if (c.reduction <= 0 || forced.has(c.value)) continue;
      let gain = 0;
      // Mayor Hobby draws a card whenever anyone is forced: it costs us a little.
      if (t.view.players.some((x) => x.hero?.def === 'mayor-hobby-trickgrin' && x.id !== t.me.id)) gain -= 1;
      const competing = est >= mine - 4 && est >= t.difficultyFor(p) - 2;
      if (competing) gain += c.reduction;
      // Knocking a rival below the difficulty makes their hero fall: real sabotage.
      if (est >= t.difficultyFor(p) && est - c.reduction < t.difficultyFor(p) && !p.fallPending) gain += level === 'hard' ? 4 : 2;
      if (level === 'hard') gain *= 1 + Math.max(0, t.threat(p)) / 20;
      if (gain > best.gain) best = { value: c.value, gain };
    }
  }
  return best;
}

// --- bidding ---------------------------------------------------------------------

/**
 * How often each stat is tested and its usual difficulty (bot games, see
 * docs/HERO-BALANCE.md). Used to judge whether next turn's challenge will
 * need cards from the hand.
 */
const CHALLENGE_ODDS: Record<Stat, { chance: number; difficulty: number }> = {
  P: { chance: 0.36, difficulty: 10.8 }, M: { chance: 0.31, difficulty: 10.5 }, G: { chance: 0.34, difficulty: 11.7 },
};

interface HandCard { id: string; worth: number }

/** Cards to play to add at least `need`: the smallest single card that does it, else the biggest and go on. */
function planSpend(hand: HandCard[], need: number): HandCard[] | null {
  if (need <= 0) return [];
  const sorted = [...hand].sort((a, b) => a.worth - b.worth);
  const one = sorted.find((h) => h.worth >= need);
  if (one) return [one];
  const big = sorted[sorted.length - 1];
  if (!big) return null;
  const rest = planSpend(sorted.slice(0, -1), need - big.worth);
  return rest ? [big, ...rest] : null;
}

/**
 * What keeping our hero is worth (renown-equivalent). A fall just means
 * drafting a new hero (look at three, keep one), so a weak hero is nearly
 * free to lose; a strong one is the plan.
 */
function heroKeepValue(t: Table): number {
  const v = heroValue(t.me.hero?.def);
  return v >= KEEP_HERO ? 2.5 : v >= KEEP_HERO - 3 ? 1.2 : 0.3;
}

/**
 * Everything a fall costs us (renown-equivalent): the hero, and with the
 * fall-cost rule our weakest companion (back to full strength only after a
 * companion phase) and our least useful resource card.
 */
function fallPrice(t: Table): number {
  let price = heroKeepValue(t);
  if (!t.view.rules.fallCost) return price;
  const mine = [...t.me.companions, ...t.me.inactiveCompanions, ...t.me.resting];
  if (mine.length) {
    const weakest = Math.min(...mine.map((c) => companionScore(c.def)));
    price += Math.max(0.5, 1 + (weakest - AVG_COMPANION_SCORE) * 0.1);
  }
  const worths = t.view.hand.map((h) => t.handValue(h.card.id));
  if (worths.length) price += 0.4 + Math.min(...worths) * 0.33;
  return price;
}

/**
 * Cards worth keeping in hand for next turn: enough to cover the shortfall
 * our hero and companions would likely have in a typical challenge, less
 * what we'll draw before bidding next turn.
 */
function reserveCards(t: Table): number {
  let expected = 0;
  for (const s of ['P', 'M', 'G'] as const) {
    const short = CHALLENGE_ODDS[s].difficulty + 1 - t.base(t.me, s);
    if (short > 0) expected += CHALLENGE_ODDS[s].chance * Math.ceil(short / HIDDEN_BID_ESTIMATE);
  }
  const r = t.view.rules;
  const nextDraw = r.handModel === 'steady' ? (t.nextTurnIsMine ? r.activeDraw : r.othersDraw) : (t.nextTurnIsMine ? r.drawSize : 0);
  return Math.max(0, Math.min(3, Math.round(expected + 0.4)) - nextDraw);
}

/**
 * The price of playing `cards` (renown-equivalent). Every card spent is one we
 * won't have for a later location (a little for the card, more for its points),
 * and dipping below the reserve risks failing next turn and losing the hero.
 */
function spendCost(t: Table, cards: HandCard[], level: BotLevel): number {
  const r = t.view.rules;
  const held = t.view.hand.length;
  // At (or next to) the hand limit, routine draws would be wasted: spending is nearly free.
  const flush = r.handModel === 'steady' ? held >= r.handLimit - 1 : held > r.drawSize;
  // Under the v0.3 refill rule spent cards come back on our turn; with steady draws they're gone.
  const steady = r.handModel === 'steady';
  const perPoint = flush ? 0.1 : steady ? (level === 'easy' ? 0.25 : level === 'hard' ? 0.3 : 0.33) : (t.isMyTurn ? 0.12 : 0.25);
  const perCard = flush ? 0 : steady ? 0.4 : 0.15;
  let cost = cards.reduce((a, c) => a + c.worth * perPoint + perCard, 0);
  if (level !== 'easy') {
    const reserve = reserveCards(t);
    const belowAfter = Math.max(0, reserve - (held - cards.length));
    const belowNow = Math.max(0, reserve - held);
    cost += (belowAfter - belowNow) * (0.4 + fallPrice(t) * 0.3);
  }
  return cost;
}

/** What taking this location is worth (renown-equivalent). */
function prizeValue(t: Table, level: BotLevel): number {
  let v = t.prize;
  const toGo = t.target - t.me.renown;
  if (t.prize >= toGo) v += 12; // it wins us the game
  else if (t.prize >= toGo - 3) v += 1.5; // it puts us one location away
  if (level !== 'easy') {
    // Denial: the rival most likely to take it instead, if it would win (or nearly win) them the game.
    const rivals = t.rivals(1);
    const r = rivals.length ? rivals.reduce((a, b) => (t.estimate(b) > t.estimate(a) ? b : a)) : null;
    if (r) {
      const rToGo = t.target - r.renown;
      if (t.prize >= rToGo) v += 8;
      else if (t.prize >= rToGo - 3) v += 1;
    }
  }
  return v;
}

/** Chance a total holds up: rivals still holding cards can answer it. */
function holdChance(t: Table, total: number, level: BotLevel): number {
  if (level === 'easy') return 1;
  let p = 0.92;
  for (const r of t.others) {
    if (!r.projection || r.handCount === 0) continue;
    const now = t.estimate(r);
    if (now + (level === 'hard' ? 4 : 6) < t.difficultyFor(r)) continue; // they can't realistically make it
    const reach = now + Math.min(r.handCount, 3) * HIDDEN_BID_ESTIMATE;
    if (reach >= total) p *= reach >= total + 3 ? 0.6 : 0.8;
  }
  return p;
}

/**
 * Bidding is a trade: renown now against cards later. Compare three plans:
 * pass; bid just enough to survive (and keep the hero); bid to take the
 * location. Each plan's gain is weighed against the price of the cards it
 * needs (spendCost), and the best plan's next card is played.
 */
function decideBid(t: Table, d: PendingView, level: BotLevel, rand: Rand): Command {
  const detail = d.detail as Extract<NonNullable<PendingView['detail']>, { kind: 'bid' }>;
  const decision = d.id;
  const pass: Command = { type: 'bid.pass', decision };

  // Sabotage or tricks first; bidding decision comes back to us afterwards.
  const ability = detail.abilities.find((a) => wantsAbility(t, a, level, rand));
  if (ability) return { type: 'ability.use', decision, source: ability.source.id, ability: ability.ability };

  const proj = t.me.projection;
  if (!proj || t.view.hand.length === 0) return pass;
  if (level === 'easy' && rand() < 0.25) return pass;

  const mine = t.myEstimate();
  const difficulty = proj.difficulty;
  const bestRival = t.bestRivalEstimate(level === 'hard' ? 1 : 0);
  const buffer = level === 'easy' ? 0 : 1;
  const targetWin = Math.max(difficulty, bestRival + 1 + buffer);
  if (mine >= targetWin) return pass;
  const hand: HandCard[] = t.view.hand.map((h) => ({ id: h.card.id, worth: t.handValue(h.card.id) })).filter((h) => h.worth > 0);

  const surviving = mine >= difficulty || t.me.fallPending;
  const avoidFall = surviving ? 0 : fallPrice(t);
  const plans: { cards: HandCard[]; score: number }[] = [];
  const win = planSpend(hand, targetWin - mine);
  if (win) plans.push({ cards: win, score: holdChance(t, targetWin, level) * prizeValue(t, level) + avoidFall - spendCost(t, win, level) });
  if (!surviving && level !== 'easy') {
    const live = planSpend(hand, difficulty - mine);
    if (live) plans.push({ cards: live, score: avoidFall - spendCost(t, live, level) });
  }
  const best = plans.filter((p) => p.cards.length && p.score > 0).sort((a, b) => b.score - a.score)[0];
  if (!best) return pass;

  const pick = best.cards[0]!;
  // Mayor Hobby: keep the first bid hidden to bluff (normal/hard).
  const faceDown = detail.canFaceDown && level !== 'easy';
  return faceDown ? { type: 'bid.play', decision, card: pick.id, faceDown: true } : { type: 'bid.play', decision, card: pick.id };
}

// --- choices ---------------------------------------------------------------------

type ChooseDetail = Extract<NonNullable<PendingView['detail']>, { kind: 'choose' }>;

function choose(t: Table, c: ChooseDetail, level: BotLevel, rand: Rand): string[] {
  const values = c.options.map((o) => o.value);
  const pickMax = (score: (v: string) => number) => [...values].sort((a, b) => score(b) - score(a))[0]!;
  const pickMin = (score: (v: string) => number) => [...values].sort((a, b) => score(a) - score(b))[0]!;
  const random = () => values[Math.floor(rand() * values.length)]!;
  const optionCard = (v: string) => c.options.find((o) => o.value === v)?.card;
  const one = (v: string | undefined) => (v === undefined ? [] : [v]);

  switch (c.purpose) {
    case 'counterAbility': {
      // The prompt opens with the name of whoever used the ability: counter the players in front.
      const user = t.others.find((p) => c.prompt.startsWith(p.name));
      const worth = level !== 'easy' && user && (user === t.biggestThreat() || t.threat(user) > 8);
      return [worth ? 'counter' : 'allow'];
    }
    case 'companionDraft': case 'companionPick': {
      // Choose the strongest companions (easy bots pick at random).
      const sorted = level === 'easy' ? [...values].sort(() => rand() - 0.5) : [...values].sort((a, b) => companionScore(optionCard(b)?.def ?? '') - companionScore(optionCard(a)?.def ?? ''));
      return sorted.slice(0, c.max);
    }
    case 'heroKeep': {
      // One hero on offer: keep them unless they are clearly weaker than the average hero (then take the gamble).
      const offered = c.options.find((o) => o.card)?.value;
      const heroes = values.filter((v) => v !== 'redraw');
      return [level !== 'easy' && offered && heroes.length && heroValue(offered) + teamFit(t, offered) < 21 ? 'redraw' : (offered ?? values[0]!)];
    }
    case 'heroDraft':
      // Look at three, keep one: the strongest (easy bots pick at random).
      return [level === 'easy' ? random() : pickMax((v) => heroValue(v) + teamFit(t, v))];
    case 'discardCompanion': case 'faceDownCompanion': case 'companionMinion':
      return [pickMin((v) => companionScore(optionCard(v)?.def ?? ''))];
    case 'discardResource':
    case 'marenGive':
      return [pickMin((v) => t.handValue(v))];
    case 'discardForCouncil': {
      const cheapest = pickMin((v) => t.handValue(v));
      return t.handValue(cheapest) < AVG_HERO_STAT ? [cheapest] : [];
    }
    case 'rulingCompanion':
    case 'silenceCompanion': {
      // Hit the biggest threat's strongest companion: in the challenge stat if it's
      // known yet, otherwise overall.
      if (level === 'easy') return [random()];
      return [pickMax((v) => {
        const owner = t.owner(v);
        const def = optionCard(v)?.def;
        const stats = def ? companionDef({ def }).stats : { P: 0, M: 0, G: 0 };
        const worth = t.stat ? stats[t.stat] * 3 : stats.P + stats.M + stats.G;
        return worth + (owner ? Math.max(0, t.threat(owner)) * 0.3 : 0);
      })];
    }
    case 'forceCompanion': case 'forceHero': {
      if (level === 'easy') return [random()];
      // Recompute with the same logic used to decide to activate.
      const best = bestForce(t, defByName(c.source), level);
      return [values.includes(best.value) ? best.value : random()];
    }
    case 'disableAbility': {
      const harmful = harmfulEffectsOnMe(t).map((e) => e.source.id);
      const cancel = values.find((v) => harmful.includes(v));
      if (cancel) return [cancel];
      const threat = t.biggestThreat();
      return [values.find((v) => v === threat?.hero?.id) ?? values[0]!];
    }
    case 'marenTarget':
      return [pickMax((v) => {
        const p = t.view.players.find((x) => x.id === v);
        return (p?.handCount ?? 0) + (level === 'hard' && p ? t.threat(p) * 0.2 : 0);
      })];
    case 'pipClaim': {
      const threat = (v: string) => {
        const p = t.view.players.find((x) => x.id === v.split(':')[0]);
        return p ? t.threat(p) : 0;
      };
      return [level === 'easy' ? random() : pickMax(threat)];
    }
    case 'appleSwap':
      return [pickMax((v) => {
        const owner = t.owner(v);
        const def = optionCard(v)?.def;
        const value = def ? (getDef(def) as { value?: number }).value ?? 0 : 0;
        return value + (owner && owner.id !== t.me.id ? 2 + Math.max(0, t.threat(owner)) * 0.1 : -10);
      })];
    case 'peekReplace': {
      const card = optionCard('replace');
      return [keepOrSwapLocation(t, card?.def ?? null, 'warchief-grukka-ironjaw') ? 'replace' : 'keep'];
    }
    case 'pickLocation': {
      const scored = c.options.map((o) => ({ v: o.value, s: o.value === 'keep' ? locationScore(t, t.view.turn.location?.def ?? null) : locationScore(t, o.card?.def ?? null) }));
      return [scored.sort((a, b) => b.s - a.s)[0]!.v];
    }
    case 'wrenStack':
      return [values.includes('location') ? 'location' : values.includes('encounter') ? 'encounter' : values[0]!];
    case 'wrenBottom': {
      const card = optionCard('bottom');
      const d = card ? getDef(card.def) : null;
      if (!d || d.kind !== 'location') return ['keep'];
      const renown = locationRenown({ def: d.id });
      const active = t.view.players.find((p) => p.id === t.view.turn.active);
      const mineNext = t.isMyTurn;
      if (mineNext) return [renown <= 3 ? 'bottom' : 'keep'];
      return [active && t.threat(active) > 8 && renown >= 4 ? 'bottom' : 'keep'];
    }
    case 'oskarNegate': {
      const cardId = optionCard('negate')?.id;
      const owner = cardId ? t.owner(cardId) : null;
      if (!owner || owner.id === t.me.id) return ['keep'];
      const rival = t.estimate(owner) >= t.myEstimate() - 5 || t.threat(owner) > 10;
      return [rival ? 'negate' : 'keep'];
    }
    case 'hallOfRest':
      return [pickMax((v) => heroValue(v))];
    case 'gauntlet': {
      if (!values.length) return [];
      const best = pickMax((v) => companionScore(optionCard(v)?.def ?? ''));
      const mineAll = [...t.me.companions, ...t.me.inactiveCompanions, ...t.me.resting];
      const room = mineAll.length < t.me.maxCompanions;
      const weakest = mineAll.length ? Math.min(...mineAll.map((x) => companionScore(x.def))) : 0;
      return room || companionScore(optionCard(best)?.def ?? '') > weakest ? [best] : [];
    }
    case 'sigrunDraw':
      return [level === 'hard' && t.view.discards.resource.count >= 8 ? 'discard' : 'deck'];
    case 'waystoneDraw':
      return ['draw'];
  }
  return one(values[0]);
}

/** A small bonus for heroes whose best stats match the companions we already have. */
function teamFit(t: Table, heroDefId: string): number {
  const h = heroDef({ def: heroDefId }).stats;
  const team = { P: 0, M: 0, G: 0 };
  for (const c of t.me.companions) { const s = companionDef(c).stats; team.P += s.P; team.M += s.M; team.G += s.G; }
  const total = team.P + team.M + team.G || 1;
  return ((h.P * team.P + h.M * team.M + h.G * team.G) / total - (h.P + h.M + h.G) / 3) * 0.5;
}

const DEF_BY_NAME = new Map(allDefs().map((d) => [d.name, d.id]));
function defByName(name: string): string {
  return DEF_BY_NAME.get(name) ?? '';
}

/** How much we like a location being the prize this turn. */
function locationScore(t: Table, def: string | null): number {
  if (!def) return 0;
  const d = getDef(def);
  let s = locationRenown({ def });
  // Hero goals: Barnaby draws when an Accord location enters, Grukka on Capitals, etc.
  const heroTrigger = (heroDef(t.me.hero).abilityText + ' ' + heroDef(t.me.hero).triggerText);
  for (const g of d.groups) if (heroTrigger.includes(`${g} location`)) s += 1;
  return s;
}

/** Grukka: swap in the peeked location? High Renown if we expect to win it, low if a threat would. */
function keepOrSwapLocation(t: Table, peekedDef: string | null, _hero: string): boolean {
  if (!peekedDef) return false;
  const cur = locationScore(t, t.view.turn.location?.def ?? null);
  const next = locationScore(t, peekedDef);
  const active = t.view.players.find((p) => p.id === t.view.turn.active);
  const denying = !t.isMyTurn && active && t.threat(active) > 8;
  return denying ? next < cur : next > cur;
}

export type { PlayerPublicView };
