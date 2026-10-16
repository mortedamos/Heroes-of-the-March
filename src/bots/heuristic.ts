// Heuristic bot. It decides from its own redacted GameView only (exactly
// what a remote human client would receive), so bots can't cheat and they
// double as a test that views carry enough information to play.
//
// Strategy, by level:
//   easy   - plays straightforwardly, uses abilities some of the time, random-ish targets.
//   normal - treats bidding as a trade (decideBid): the location's renown now
//            against the cards it costs, keeping a reserve for next turn's
//            challenge; protects a good party; sabotages the player it is
//            actually competing with.
//   hard   - as normal, plus threat-weighted sabotage (who could win the GAME with
//            this location), bluffing and tighter survival math.

import { allDefs, companionsOf, getDef, nemesisTargets } from '../engine/cards';
import type { Stat } from '../engine/cardTypes';
import type { Command } from '../engine/types';
import type { AbilityOptionView, GameView, PendingView, PlayerPublicView } from '../engine/view';
import {
  AVG_HERO_STAT, AVG_HERO_VALUE, HIDDEN_BID_ESTIMATE, SPECIAL_VALUE, Table, heroDef, heroValue, locationRenown, partyScore,
} from './knowledge';

export type BotLevel = 'easy' | 'normal' | 'hard';

/** How often an easy bot plays a random card when it is behind, and when it is not. */
const EASY_BID_WHEN_BEHIND = 0.75;
const EASY_BID_WHEN_AHEAD = 0.15;

/** Forced-stat abilities: which stat they force. */
const FORCE: Record<string, Stat> = {
  'liriel-nightbloom': 'G',
  'thessaly-of-the-grove': 'M',
};

/** The def ids of a party (face up, face down and resting). */
const partyDefs = (t: Table, p = t.me) => t.heroesOf(p).map((c) => c.def);

/** Which of `party` to give up for `incoming` (or just to lose, if null): the one whose removal leaves the best party. */
function weakestFor(party: { id: string; def: string }[], incoming: string | null): { id: string; def: string; after: number } {
  let best = { ...party[0]!, after: -Infinity };
  for (const c of party) {
    const rest = party.filter((x) => x.id !== c.id).map((x) => x.def);
    const after = partyScore(incoming ? [...rest, incoming] : rest);
    if (after > best.after) best = { ...c, after };
  }
  return best;
}

type Rand = () => number;

export function botDecide(view: GameView, level: BotLevel, rand: Rand = Math.random): Command | null {
  const d = view.pending;
  if (!d || d.player !== view.you || !d.detail) return null;
  const t = new Table(view, level, rand);
  const decision = d.id;
  const detail = d.detail;

  switch (detail.kind) {
    case 'recruit.offer': {
      if (level === 'easy' && rand() < 0.5) return { type: 'recruit.skip', decision };
      // A random draw can still be let go, so drawing is never worse than skipping.
      return { type: 'recruit.draw', decision };
    }

    case 'recruit.place': {
      if (!detail.mustReplace) return { type: 'recruit.keep', decision, replace: null };
      const all = t.heroesOf(t.me);
      const swap = weakestFor(all, detail.drawn.def);
      return swap.after > partyScore(all.map((c) => c.def))
        ? { type: 'recruit.keep', decision, replace: swap.id }
        : { type: 'recruit.discard', decision };
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

/** How often a bot uses Vaelis's Master Manipulator when it can: the bonus is worth having (or handing out) nearly every turn. */
const VAELIS_USE: Record<BotLevel, number> = { easy: 0.5, normal: 0.75, hard: 1 };

function wantsAbility(t: Table, a: AbilityOptionView, level: BotLevel, rand: Rand): boolean {
  if (a.ability === 'shadowsteeds') return rand() < VAELIS_USE[level];
  // Looking at the next locations costs nothing: Grukka and Barnaby do it every time (easy bots half the time).
  if (a.ability === 'mineNow' || a.ability === 'maps') return level !== 'easy' || rand() < 0.5;
  if (level === 'easy' && rand() < 0.75) return false;
  const stat = t.stat;
  switch (a.ability) {
    // Free, but only worth aiming at a real threat.
    case 'ruling': return level !== 'easy' && Boolean(t.biggestThreat());
    // Urzha: look for an easier fight when this one is a stretch.
    case 'pickFight': return level !== 'easy' && t.difficultyFor(t.me) - t.myEstimate() > 2;
    // Rook: swap the worst card in hand for a fresh one.
    case 'manifest': return level !== 'easy' && t.view.hand.length > 0 && Math.min(...t.view.hand.map((h) => t.handValue(h.card.id))) <= 2;
    // Gimlet: only when the top of the discard is better than the worst card in hand.
    case 'fetch': return fetchWorthIt(t);
    // Torvi, at the end of bidding when the numbers are exact.
    case 'fire': return fireWorthIt(t, a, level);
    // Brisa: any revealed resource of ours that is worth less than 3 (a curse placed on us most of all).
    case 'flip': return level !== 'easy' && brisaTarget(t) !== null;
    // Aelder: a spare card for +3, unless the encounter is already settled.
    case 'roots': return level !== 'easy' && t.view.hand.length > 0 && Math.min(...t.view.hand.map((h) => t.handValue(h.card.id))) <= 3 && !standing(t).safe;
    // Cobra Chicken: wands give no bonuses; worth it when opponents hold more of them than we do.
    case 'wark': return level !== 'easy' && wandsBid(t, t.others) > wandsBid(t, [t.me]);
    // Goldie: easy bots look at random; the others wait until a few cards are down, so there is something worth knowing.
    case 'rumour': {
      if (!t.others.some((p) => p.bids.some((b) => b.hidden))) return false;
      if (level === 'easy') return rand() < 0.3;
      return t.view.players.reduce((n, p) => n + p.bids.length, 0) >= 3;
    }
    // Pure information: worth a look now and then, always for a hard bot.
    case 'readAhead': return level === 'hard' || (level === 'normal' && rand() < 0.4);
    case 'requisition': {
      const worst = Math.min(...t.view.hand.map((h) => t.handValue(h.card.id)));
      return worst <= 2 && t.others.some((p) => p.handCount >= 2);
    }
    case 'rest': return restWorthIt(t, a, level);
    // End of bidding: everything is revealed, so the numbers are exact.
    case 'honk': case 'hiss': return flipWorthIt(t);
    // Free to use: the cards it turns up are only discarded.
    case 'flock': return level !== 'easy' || rand() < 0.6;
    case 'stonetouched': return miraWorthIt(t, level);
    // During bidding.
    case 'force': return bestForce(t, a.source.def, level).gain >= (level === 'hard' ? 1.5 : 2);
    default: return false;
  }
}

function topDiscardValue(t: Table): number {
  const top = t.view.discards.resource.top;
  if (!top) return 0;
  const d = getDef(top.def);
  return d.kind === 'resource' ? SPECIAL_VALUE[d.id] ?? d.value : 0;
}

function fetchWorthIt(t: Table): boolean {
  if (!t.view.hand.length) return false;
  return topDiscardValue(t) >= Math.min(...t.view.hand.map((h) => t.handValue(h.card.id))) + 2;
}

/**
 * Torvi's Uncontrolled Explosion: discard him (and a card) to take 6 off every opponent. Worth it when it turns a loss into a win
 * (or saves our hero) even without Torvi's own stat, or sinks a rival who would otherwise take the location.
 */
function fireWorthIt(t: Table, a: AbilityOptionView, level: BotLevel): boolean {
  const proj = t.me.projection;
  if (!proj || level === 'easy' || t.view.hand.length === 0) return false;
  const torvi = proj.contributions.find((c) => c.card === a.source.id)?.value ?? 0;
  const cut = 6;
  const mine = proj.total - torvi;
  const diff = proj.difficulty;
  const rivals = t.others.filter((p) => p.projection);
  const rivalBest = Math.max(-Infinity, ...rivals.filter((p) => p.projection!.total - cut >= p.projection!.difficulty).map((p) => p.projection!.total - cut));
  const winningNow = proj.total >= diff && proj.total > Math.max(-Infinity, ...rivals.filter((p) => p.projection!.total >= p.projection!.difficulty).map((p) => p.projection!.total));
  if (winningNow) return false;
  if (mine < diff) return false; // without Torvi we would fall anyway
  return mine > rivalBest && t.prize >= 2;
}

/** The revealed resource Brisa would turn over: the one that gains most from counting as 3 (null if none gains). */
function brisaTarget(t: Table): string | null {
  let best: { id: string; gain: number } | null = null;
  for (const b of t.me.bids) {
    if (b.hidden || !b.faceUp) continue;
    const d = getDef(b.card.def);
    const value = d.kind === 'resource' ? d.value : 0;
    const gain = 3 - value;
    if (gain > 0 && (!best || gain > best.gain)) best = { id: b.card.id, gain };
  }
  return best ? best.id : null;
}

/** How many wands the given players have revealed. */
function wandsBid(t: Table, players: PlayerPublicView[]): number {
  return players.reduce((n, p) => n + p.bids.filter((b) => !b.hidden && b.faceUp && (getDef(b.card.def) as { wand?: boolean }).wand).length, 0);
}

function standing(t: Table): { mine: number; best: number; diff: number; winning: boolean; safe: boolean } {
  const mine = t.me.projection?.total ?? 0;
  const best = Math.max(-Infinity, ...t.others.filter((p) => p.projection && p.projection.total >= p.projection.difficulty).map((p) => p.projection!.total));
  const diff = t.difficultyFor(t.me);
  const winning = mine >= diff && mine > best;
  return { mine, best, diff, winning, safe: winning && mine >= diff + 5 && mine > best + 5 };
}

/** Honk, Duchess and Waddle reveal a card for +2 to all stats; the stats are theirs to keep, so it costs nothing to try when it matters. */
function flipWorthIt(t: Table): boolean {
  return !standing(t).safe;
}

/**
 * Tova rests for a turn (no stats from her) to draw two extra cards on her next turn. Worth it when her stat
 * isn't needed to survive, or one card from the hand covers it, or the turn is lost anyway.
 */
function restWorthIt(t: Table, a: AbilityOptionView, level: BotLevel): boolean {
  const stat = t.stat;
  if (!stat || level === 'easy') return false;
  const tova = t.me.party.find((c) => c.id === a.source.id);
  if (!tova) return false;
  const gives = heroDef(tova).stats[stat];
  if (gives >= 4 || t.me.renown + t.prize >= t.target) return false;
  const mine = t.myEstimate();
  const diff = t.difficultyFor(t.me);
  const hand = t.view.hand.map((h) => t.handValue(h.card.id)).sort((x, y) => y - x);
  const handSum = hand.reduce((sum, v) => sum + Math.max(0, v), 0);
  if (mine + handSum < diff) return true; // the turn is lost either way; Tova's stat changes nothing
  const without = mine - gives;
  // A prize worth fighting for: don't fall clearly behind the strongest rival by sitting out.
  const rival = Math.max(-Infinity, ...t.others.map((p) => t.estimate(p)));
  const holdsLead = t.prize < 4 || without + 2 >= rival;
  const gap = diff - without;
  const margin = level === 'hard' ? 0 : 1;
  if (gap <= -margin) return holdsLead; // she isn't needed to survive
  return hand.length >= 3 && (hand[0] ?? 0) >= gap && holdsLead; // one card makes up for her; she returns with two
}

function miraWorthIt(t: Table, level: BotLevel): boolean {
  const { winning } = standing(t);
  if (winning) return false;
  if (t.me.renown + t.prize >= t.target) return true; // wins the game outright
  if (level !== 'hard') return t.prize >= 6;
  return t.prize >= 5 && t.view.hand.length <= 2;
}

interface ForceChoice { value: string; gain: number }

/** The best target for a forced-stat ability, and how much it helps us. */
function bestForce(t: Table, sourceDef: string, level: BotLevel): ForceChoice {
  const forceTo = FORCE[sourceDef];
  const stat = t.stat;
  if (!forceTo || !stat) return { value: '', gain: 0 };
  const mine = t.myEstimate();
  let best: ForceChoice = { value: '', gain: 0 };
  // Targets already forced this turn gain nothing from being forced again.
  const forced = new Set(t.view.turn.effects.filter((e) => e.active && e.kind === 'forceStat').map((e) => e.targetCard?.id));
  // Fennick and Aurelie draw a card when anyone is forced onto another stat: it costs us a little.
  const hobbyCosts = t.view.players.some((x) => x.id !== t.me.id && x.party.some((c) => c.def === 'fennick-puffcap-mycomancer' || c.def === 'sister-aurelie-dane-physician'));
  for (const p of t.others) {
    if (!p.projection) continue;
    const est = t.estimate(p);
    const candidates = p.party.map((c) => ({ value: c.id, reduction: heroDef(c).stats[stat] - heroDef(c).stats[forceTo] }));
    for (const c of candidates) {
      if (c.reduction <= 0 || forced.has(c.value)) continue;
      let gain = 0;
      if (hobbyCosts) gain -= 1;
      const competing = est >= mine - 4 && est >= t.difficultyFor(p) - 2;
      if (competing) gain += c.reduction;
      // Knocking a rival below the difficulty makes them lose a hero: real sabotage.
      if (est >= t.difficultyFor(p) && est - c.reduction < t.difficultyFor(p)) gain += level === 'hard' ? 4 : 2;
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
  P: { chance: 0.33, difficulty: 9.8 }, M: { chance: 0.33, difficulty: 8.6 }, G: { chance: 0.33, difficulty: 8.8 },
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
 * Everything a fall costs us (renown-equivalent): we give up our least useful hero (back to full strength only
 * after a recruit phase, and the replacement is a blind draw) and, losing, miss the location.
 */
function fallPrice(t: Table): number {
  const heroes = t.heroesOf(t.me);
  if (!heroes.length) return 0;
  const weakest = Math.min(...heroes.map((c) => heroValue(c.def)));
  return Math.max(0.4, 1 + (weakest - AVG_HERO_VALUE) * 0.1);
}

/**
 * Cards worth keeping in hand for next turn: enough to cover the shortfall
 * our party would likely have in a typical challenge, less
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
 * and dipping below the reserve risks failing next turn and losing a hero.
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
    const reach = now + t.handReach(r);
    if (reach >= total) p *= reach >= total + 3 ? 0.6 : 0.8;
  }
  return p;
}

/**
 * Bidding is a trade: renown now against cards later. Compare three plans:
 * pass; bid just enough to survive (and keep the party); bid to take the
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
  if (level === 'easy') {
    // Easy bots don't do the sums: when behind they often play a card, any card, and otherwise they mostly sit still.
    const behind = t.myEstimate() < Math.max(proj.difficulty, t.bestRivalEstimate(0));
    if (rand() >= (behind ? EASY_BID_WHEN_BEHIND : EASY_BID_WHEN_AHEAD)) return pass;
    const any = t.view.hand[Math.floor(rand() * t.view.hand.length)]!;
    return { type: 'bid.play', decision, card: any.card.id };
  }

  const mine = t.myEstimate();
  const difficulty = proj.difficulty;
  const bestRival = t.bestRivalEstimate(level === 'hard' ? 1 : 0);
  const curse = pickCurse(t, mine, bestRival, level, rand);
  if (curse) return { type: 'bid.play', decision, card: curse };
  const targetWin = Math.max(difficulty, bestRival + 2);
  if (mine >= targetWin) return pass;
  const hand: HandCard[] = t.view.hand.map((h) => ({ id: h.card.id, worth: t.handValue(h.card.id) })).filter((h) => h.worth > 0);

  const surviving = mine >= difficulty;
  const avoidFall = surviving ? 0 : fallPrice(t);
  const plans: { cards: HandCard[]; score: number }[] = [];
  const win = planSpend(hand, targetWin - mine);
  if (win) plans.push({ cards: win, score: holdChance(t, targetWin, level) * prizeValue(t, level) + avoidFall - spendCost(t, win, level) });
  if (!surviving) {
    const live = planSpend(hand, difficulty - mine);
    if (live) plans.push({ cards: live, score: avoidFall - spendCost(t, live, level) });
  }
  const best = plans.filter((p) => p.cards.length && p.score > 0).sort((a, b) => b.score - a.score)[0];
  if (!best) return pass;

  const pick = best.cards[0]!;
  // Mayor Hobby: keep the first bid hidden to bluff.
  const faceDown = detail.canFaceDown;
  return faceDown ? { type: 'bid.play', decision, card: pick.id, faceDown: true } : { type: 'bid.play', decision, card: pick.id };
}

/**
 * A curse (a resource with a negative value) is played at the player who is ahead of us: it lands in their bid and
 * counts against them. Play the smallest one that drops them below us, or the biggest if none does.
 */
function pickCurse(t: Table, mine: number, bestRival: number, level: BotLevel, rand: Rand): string | null {
  if (level === 'easy' && rand() < 0.5) return null;
  if (bestRival < mine) return null; // nobody is beating us: no need
  const curses = t.view.hand.flatMap((h) => { const d = getDef(h.card.def); return d.kind === 'resource' && d.value < 0 ? [{ id: h.card.id, cut: -d.value }] : []; });
  if (!curses.length) return null;
  curses.sort((a, b) => a.cut - b.cut);
  return (curses.find((c) => bestRival - c.cut < mine) ?? curses[curses.length - 1]!).id;
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
      // Counter what would hurt us; a location swap only if it lowers the Renown on offer.
      if (level === 'easy') return [rand() < 0.5 ? 'counter' : 'allow'];
      // (The place that would replace the location is not shown: the bot only knows what is at stake.)
      if (/would change the location/.test(c.prompt)) return [locationRenown(t.view.turn.location) >= 4 ? 'counter' : 'allow'];
      return ['counter'];
    }
    case 'redirectHero':
      // Hedda takes the hit and draws us a resource.
      return [level === 'easy' ? 'allow' : 'redirect'];
    case 'goldiePick': {
      // The best of the three for the party we have (the keep-or-let-go decision comes next).
      const mine = partyDefs(t);
      return [pickMax((v) => partyScore([...mine, optionCard(v)?.def ?? v]))];
    }
    case 'mograSteal':
      return [pickMax((v) => t.view.players.find((x) => x.id === v)?.handCount ?? 0)];
    case 'torviFire':
    case 'aelderRoots':
      return [pickMin((v) => t.handValue(v))];
    case 'brisaFlip': {
      const target = brisaTarget(t);
      return [target && values.includes(target) ? target : values[0]!];
    }
    case 'partyDraft': {
      // Pick the best party of the pool (easy bots pick at random).
      if (level === 'easy') return [...values].sort(() => rand() - 0.5).slice(0, c.max);
      return bestParty(values.map((v) => ({ value: v, def: optionCard(v)?.def ?? v })), c.max, t);
    }
    case 'discardHero': case 'faceDownHero': case 'heroMinion': case 'fallHero': {
      // Give up the hero whose absence leaves the best party.
      const mine = t.heroesOf(t.me);
      const picks = values.map((v) => ({ v }));
      const rest = (id: string) => partyScore(mine.filter((x) => x.id !== id).map((x) => x.def));
      return [picks.sort((a, b) => rest(b.v) - rest(a.v))[0]?.v ?? values[0]!];
    }
    case 'discardResource':
    case 'marenGive':
      return [pickMin((v) => t.handValue(v))];
    case 'discardForCouncil': {
      const cheapest = pickMin((v) => t.handValue(v));
      return t.handValue(cheapest) < AVG_HERO_STAT ? [cheapest] : [];
    }
    case 'rulingHero': {
      // Hit the biggest threat's strongest hero: in the challenge stat if it's
      // known yet, otherwise overall.
      if (level === 'easy') return [random()];
      return [pickMax((v) => {
        const owner = t.owner(v);
        const def = optionCard(v)?.def;
        const stats = def ? heroDef({ def }).stats : { P: 0, M: 0, G: 0 };
        const worth = t.stat ? stats[t.stat] * 3 : stats.P + stats.M + stats.G;
        return worth + (owner ? Math.max(0, t.threat(owner)) * 0.3 : 0);
      })];
    }
    case 'forceHero': {
      if (level === 'easy') return [random()];
      // Recompute with the same logic used to decide to activate.
      const best = bestForce(t, defByName(c.source), level);
      return [values.includes(best.value) ? best.value : random()];
    }
    case 'marenTarget':
      return [pickMax((v) => {
        const p = t.view.players.find((x) => x.id === v);
        return (p?.handCount ?? 0) + (level === 'hard' && p ? t.threat(p) * 0.2 : 0);
      })];
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
      // Barnaby's maps. Each option is worth the Renown if the location is likely ours (the other way round when someone else is the
      // favourite), whose Nemesis bonuses it switches on, and what its own text does to us against the others. A location that hurts
      // the others more than us is swapped in with its text; one that hurts us (or helps them) is swapped in with its text ignored.
      const w = renownWeight(t);
      const keepDef = t.view.turn.location?.def ?? null;
      const scored = c.options.map((o) => {
        const keep = o.value === 'keep';
        const def = keep ? keepDef : o.card?.def ?? null;
        const ignore = !keep && o.value.endsWith('x');
        const effect = ignore ? 0 : locationEffectValue(t, def, keep, w);
        return { v: o.value, s: w * locationRenown(def ? { def } : null) * (!ignore && def === 'the-crack-in-the-marchstone' ? 3.9 / 6 : 1) + NEMESIS_WEIGHT * nemesisSwing(t, def) + effect };
      });
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
    case 'rumourMill':
      return one(values[0]);
    case 'rumourTarget': {
      // Look at whoever has the most hidden cards (the biggest unknown); ties go to the stronger rival.
      const hidden = (v: string) => t.view.players.find((x) => x.id === v)?.bids.filter((b) => b.hidden).length ?? 0;
      if (level === 'easy') return [random()];
      return [pickMax((v) => { const p = t.view.players.find((x) => x.id === v); return hidden(v) * 10 + (p ? t.estimate(p) : 0); })];
    }
    case 'vaelisGive': {
      // A positive minion bonus helps whoever holds it; a negative one hurts them. Keep the good, hand out the bad.
      const mv = Number(/([+-]?\d+) to all stats/.exec(c.options.find((o) => o.value === 'self')?.label ?? '')?.[1] ?? 0);
      if (mv >= 0 || level === 'easy') return ['self'];
      return [pickMax((v) => { const p = t.view.players.find((x) => x.id === v); return p ? t.estimate(p) : -99; })];
    }
    case 'fetch': {
      const worst = pickMin((v) => (v === 'skip' ? 99 : t.handValue(v)));
      return [worst !== 'skip' && topDiscardValue(t) >= t.handValue(worst) + 2 ? worst : 'skip'];
    }
    case 'pickFight': {
      const next = optionCard('replace');
      const cur = t.view.turn.encounter;
      if (!next || !cur) return ['keep'];
      const nd = getDef(next.def) as { stat: Stat; difficulty: number; minionValue: number };
      // Compare how far each fight is from our reach: our strength in the stat against its difficulty.
      const nextGap = nd.difficulty + nd.minionValue - t.base(t.me, nd.stat);
      const curGap = t.difficultyFor(t.me) - (t.stat ? t.base(t.me, t.stat) : 0);
      return [nextGap < curGap - 1 ? 'replace' : 'keep'];
    }
    case 'hallOfRest':
      return [pickMax((v) => heroValue(v))];
    case 'gauntlet': {
      if (!values.length) return [];
      const best = pickMax((v) => heroValue(optionCard(v)?.def));
      const mineAll = t.heroesOf(t.me);
      const room = mineAll.length < t.me.partySize;
      const weakest = mineAll.length ? Math.min(...mineAll.map((x) => heroValue(x.def))) : 0;
      return room || heroValue(optionCard(best)?.def) > weakest ? [best] : [];
    }
    case 'sigrunPick': {
      // Take the best of the discarded cards if it beats an average draw (about 3), otherwise draw as usual.
      const cards = values.filter((v) => v !== 'deck');
      const worth = (v: string) => { const d = optionCard(v) ? getDef(optionCard(v)!.def) : null; return d && d.kind === 'resource' ? SPECIAL_VALUE[d.id] ?? d.value : 0; };
      if (level === 'easy' || !cards.length) return ['deck'];
      const best = cards.reduce((x, y) => (worth(y) > worth(x) ? y : x));
      return [worth(best) >= 4 ? best : 'deck'];
    }
    case 'tobinPick': {
      const geese = values.filter((v) => v !== 'none');
      if (!geese.length) return ['none'];
      const best = pickMax((v) => (v === 'none' ? -1 : heroValue(optionCard(v)?.def)));
      const mineAll = t.heroesOf(t.me);
      const room = mineAll.length < t.me.partySize;
      const weakest = mineAll.length ? Math.min(...mineAll.map((x) => heroValue(x.def))) : 0;
      return room || heroValue(optionCard(best)?.def) > weakest ? [best] : ['none'];
    }
    case 'waystoneDraw':
      return ['draw'];
    case 'curseTarget':
      return [pickMax((v) => { const o = t.view.players.find((x) => x.id === v); return o ? t.estimate(o) + t.threat(o) * 0.1 : 0; })];
    case 'immobilizeTarget':
      // Immobilizing Word: the opponent whose Companion heroes give the most in this challenge, then the bigger threat.
      return [pickMax((v) => {
        const o = t.view.players.find((x) => x.id === v);
        if (!o) return -99;
        const stat = t.stat;
        // A Companion rides free while a hero it is Companion To is in the party (face down or resting heroes count as present).
        const present = new Set([...o.party, ...o.inactive, ...o.resting].map((h) => h.def));
        const riding = o.party.filter((h) => companionsOf(h.def).some((d) => present.has(d)));
        const lost = stat ? riding.reduce((a, h) => a + t.heroIn(h, stat), 0) : 0;
        return lost + t.threat(o) * 0.1;
      })];
  }
  return one(values[0]);
}

/** The best `n` of the offered heroes as a party (scored together, so the stats cover each other). */
function bestParty(options: { value: string; def: string }[], n: number, t: Table): string[] {
  const have = partyDefs(t);
  let best: { picks: string[]; score: number } = { picks: options.slice(0, n).map((o) => o.value), score: -Infinity };
  const walk = (from: number, chosen: { value: string; def: string }[]): void => {
    if (chosen.length === n || from === options.length) {
      if (chosen.length < n) return;
      const score = partyScore([...have, ...chosen.map((o) => o.def)]);
      if (score > best.score) best = { picks: chosen.map((o) => o.value), score };
      return;
    }
    for (let i = from; i < options.length; i++) walk(i + 1, [...chosen, options[i]!]);
  };
  walk(0, []);
  return best.picks;
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
  // Capitals and the like draw a card for every hero of one kind in the party.
  const per = d.kind === 'location' ? /every (\w+) hero they have in play/.exec(d.conditionText ?? '')?.[1] : undefined;
  if (per) s += 0.7 * t.heroesOf(t.me).filter((c) => getDef(c.def).groups.includes(per)).length;
  return s;
}

/**
 * Whether more Renown on the table helps us: only if we are the one likely to take it. +1 as the favourite, a little under zero as the
 * underdog (better to hand the winner less), and a touch positive when it is close. Strength is the bids so far plus what each hand could add.
 */
function renownWeight(t: Table): number {
  const top3 = t.view.hand.map((h) => t.handValue(h.card.id)).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
  const mine = t.myEstimate() + top3;
  const rival = Math.max(-Infinity, ...t.others.map((p) => t.estimate(p) + Math.min(p.handCount, 3) * 2));
  if (!Number.isFinite(rival)) return 1;
  const lead = mine - rival;
  return lead > 1.5 ? 1 : lead < -1.5 ? -0.7 : 0.1;
}

/**
 * What a location's own text is worth to us from here on, in Renown, against the others (harm to them counts for us; what it
 * gives them counts against us). `current` is the location already in play: what it did on entering is over. Rough, on purpose.
 */
function locationEffectValue(t: Table, def: string | null, current: boolean, w: number): number {
  if (!def) return 0;
  const d = getDef(def);
  if (d.kind !== 'location' || !d.conditionText) return 0;
  const text = d.conditionText;
  const enc = t.view.turn.encounter ? getDef(t.view.turn.encounter.def) : null;
  const stat: Stat | null = t.stat ?? (enc?.kind === 'encounter' ? enc.stat : null);
  const others = t.others;
  const avgOthers = (f: (p: PlayerPublicView) => number) => (others.length ? others.reduce((s, p) => s + f(p), 0) / others.length : 0);
  let v = 0;

  // Cards for every hero of one kind in play: ours against the average rival's.
  const per = /every (\w+)(?: hero)? they have in play/.exec(text)?.[1];
  if (per && !current) {
    const count = (p: PlayerPublicView) => t.heroesOf(p).filter((h) => (getDef(h.def).groups as string[]).includes(per)).length;
    v += 0.7 * (count(t.me) - avgOthers(count));
  }

  // The challenge moves to another stat: who is stronger in it?
  const changed = /changed to (guile|mental|physical)/i.exec(text)?.[1];
  if (changed && enc?.kind === 'encounter') {
    const to = ({ physical: 'P', mental: 'M', guile: 'G' } as const)[changed.toLowerCase() as 'physical' | 'mental' | 'guile'];
    const lead = (s: Stat) => t.base(t.me, s) - Math.max(-Infinity, ...others.map((p) => t.base(p, s)));
    v += 0.35 * (lead(to) - lead(enc.stat));
  }

  // The encounter gets harder for everyone: bad for whoever is close to the line, harmless to those far above or below it.
  const closeness = (p: PlayerPublicView, hand: number) => {
    if (!p.projection) return 0.5;
    const margin = t.estimate(p) + hand - t.difficultyFor(p);
    return Math.abs(margin) < 4 ? 1 : Math.abs(margin) < 8 ? 0.5 : 0.1;
  };
  const myHand = t.view.hand.map((h) => t.handValue(h.card.id)).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
  const harder = (amount: number) => { v -= 0.25 * amount * (closeness(t.me, myHand) - avgOthers((p) => closeness(p, Math.min(p.handCount, 3) * HIDDEN_BID_ESTIMATE))); };
  const boost = /of (\w+) encounters are increased by (\d+)/.exec(text);
  if (boost) {
    const hit = [t.view.turn.encounter, ...t.view.turn.minions].some((c) => c && (getDef(c.def).groups as string[]).includes(boost[1]!));
    if (hit) harder(Number(boost[2]));
  }
  const minions = /minions are in play at this location, their bonus is increased by (\d+)/.exec(text);
  if (minions && t.view.turn.minions.length) harder(Number(minions[1]) * t.view.turn.minions.length);
  if (def === 'barrowdeep') harder(2.4);

  switch (def) {
    case 'the-storybook-glade': { // everyone turns their least useful hero face down
      if (stat) { const loss = (p: PlayerPublicView) => Math.min(...t.heroesOf(p).map((h) => t.heroIn(h, stat))); v += 0.35 * (avgOthers(loss) - loss(t.me)); }
      break;
    }
    case 'the-hollow-between': { // everyone discards a resource
      const loss = (hand: number) => (hand > 0 ? 0.6 : 0);
      v += avgOthers((p) => loss(p.handCount)) - loss(t.view.hand.length);
      break;
    }
    case 'the-crack-in-the-marchstone': { // everyone discards a hero (their worst), and the location is swapped away
      const worst = (p: PlayerPublicView) => Math.min(...t.heroesOf(p).map((h) => heroValue(h.def)));
      v += 0.2 * (avgOthers(worst) - worst(t.me));
      break;
    }
    case 'parting-strand': // whoever wins it discards a hero
      v += w > 0.5 ? -2 : w < -0.3 ? 1 : 0;
      break;
    case 'the-endless-road': // the winner claims a second location as well
      v += 1.5 * w;
      break;
    case 'the-goose-and-kettle': // everyone may draw a hero; one more place in every party
      v += 0.5;
      break;
    default:
      break;
  }
  return v;
}

/** One Nemesis bonus is +1 to every stat of a hero: worth a bit under a point of Renown in a close fight. */
const NEMESIS_WEIGHT = 0.8;

/** How many more of our heroes than of anyone else's get their Nemesis bonus from this location (a hero counts once per matching entry). */
function nemesisSwing(t: Table, def: string | null): number {
  if (!def) return 0;
  const groups = getDef(def).groups as string[];
  const matches = (heroDef: string) => nemesisTargets(heroDef).some((tg) => ('tag' in tg ? groups.includes(tg.tag) || groups.includes('All') : tg.def === def)) ? 1 : 0;
  let swing = 0;
  for (const p of t.view.players) {
    const n = t.heroesOf(p).reduce((sum, h) => sum + matches(h.def), 0);
    swing += p.id === t.me.id ? n : -n * 0.75; // a rival's bonus counts a little less: they may not be in the running
  }
  return swing;
}

/** Grukka: swap in the peeked location? High Renown if we expect to win it, low if a threat would. */
function keepOrSwapLocation(t: Table, peekedDef: string | null, _hero: string): boolean {
  if (!peekedDef) return false;
  const cur = locationScore(t, t.view.turn.location?.def ?? null);
  const next = locationScore(t, peekedDef);
  // Strike the Heart also draws two resources with the new Capital.
  return renownWeight(t) * (next - cur) + 1.5 > 0;
}

export type { PlayerPublicView };
