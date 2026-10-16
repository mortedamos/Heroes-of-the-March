// What a bot knows: card values and a model of the table built only from
// its own GameView (never the secret state).

import { alliedTargets, CARDS, companionsOf, getDef, matchesTarget, nemesisTargets } from '../engine/cards';
import type { HeroDef, LocationDef, Stat } from '../engine/cardTypes';
import type { CardRef } from '../engine/types';
import type { GameView, PlayerPublicView } from '../engine/view';
import type { BotLevel } from './heuristic';

/** What a normal bot assumes every unseen card of an opponent's is worth (measured in bot games: face-down bids average 2.9). */
export const HIDDEN_BID_ESTIMATE = 3.1;
/**
 * What a hard bot assumes for a face-down bid by the order it was played in that turn (the first bid is face up, so index 0 is only
 * for a player who hides it; measured over bot games: the second bid averages 3.0, later ones 2.7 to 2.9).
 */
export const HIDDEN_BID_BY_ORDER = [2.2, 3.0, 2.9, 2.75, 2.7, 2.8];
/** An easy bot guesses every unseen card of an opponent's is worth somewhere between these two (the real average is 2.9): it undervalues them. */
export const EASY_GUESS_RANGE = [2, 3] as const;
/** Average hero stat, used to value Council cards. */
export const AVG_HERO_STAT = 3.5;

/** Bot-side estimates for resources whose printed value understates them. */
export const SPECIAL_VALUE: Record<string, number> = {
  'shoulder-to-shoulder': AVG_HERO_STAT,
  'three-banners-raised': AVG_HERO_STAT * 3,
  'the-gathering-of-heroes': AVG_HERO_STAT,
  'crossed-paths': AVG_HERO_STAT - 2,
  'an-apple-for-the-road': 3,
};

/** How much a hero's ability is worth on top of its stats (rough, in stat points). Allied, Nemesis and Companion To are priced separately (synergy). */
const HERO_ABILITY: Record<string, number> = {
  'warchief-grukka-ironjaw': 1.5, 'thorgar-twice-buried': 4, 'aelthir-moonveil': 1, 'lord-vaelis-nightbloom': 3,
  'pip-wanderfoot': 0.5, 'kazra-emberdeep': 1, 'ysolde-of-the-wellspring': 5, 'mayor-hobby-trickgrin': 2,
  'lord-paladin-aldric-ashcroft': 2.5, 'high-thane-brunna-stonefast': 2.5, 'loremaster-oskar-grimgate': 2,
  'queen-maren-ashcroft': 3, 'archmage-corvin-varro': 4, 'professor-barnaby-pickwort': 3, 'urzha-half-tusk': 2,
  'liriel-nightbloom': 2, 'thessaly-of-the-grove': 2, 'kesh-the-bog-huntress': 0.5,
  'nettle-burrows-trouble-maker': 1.2, 'sister-aurelie-dane-physician': 1, 'gnash-the-butcher-of-bloodmire': 1.2, 'pell-quillon-collegium-prodigy': 1.2,
  'elder-ilvena-of-the-conclave': 3, 'hesk-of-two-homes': 2,
  'dagny-coldhearth-the-grudge-bearer': 2, 'torvi-cinderkeg-master-gunner': 3, 'moss-dire-wolf': 1, 'gimlet-a-very-good-dog': 1.5,
  'goldie-trickgrin-keeper-of-the-goose-and-kettle': 2,
  'seraphine-moonveil-warden-scholar': 1, 'varg-ironjaw': 1.5, 'tansy-brambleby-barmaid-and-volunteer': 1.5,
  'fennick-puffcap-mycomancer': 1, 'captain-rook-halloran-skyship-captain': 1, 'marshal-hedda-ironvow': 1.5,
  'elowen-leafwatch-treetop-warden': 1, 'mogra-swiftfoot-goblin-runner': 2, 'tova-emberdeep-keeper-of-the-underway-door': 1,
  'sigrun-stonefast-metal-singer': 1.5, 'tobin-quill-goose-keeper': 1.5,
  'honk-the-goose-rout-veteran': 1, 'duchess-the-pub-goose': 1.2, 'sergeant-waddle': 1.2, 'cobra-chicken': 0.5,
  'caelan-halfelven': 1, 'brisa-blastcap-bombardier': 2, 'grumma-ladlejaw-camp-cook': 1, 'aelder-mossleaf-awakened-oak': 2.5,
  'farmer-hobart-thimblewick': 1.5,
};

export function heroDef(ref: { def: string }): HeroDef { return getDef(ref.def) as HeroDef; }

/** A hero's worth to its party: stat total plus a rough price for its ability. */
export function heroValue(defId: string | undefined): number {
  if (!defId) return 0;
  const d = getDef(defId) as HeroDef;
  return d.stats.P + d.stats.M + d.stats.G + (HERO_ABILITY[defId] ?? 0);
}

/** What a blind hero draw is worth on average. */
export const AVG_HERO_VALUE = CARDS.heroes.reduce((a, c) => a + heroValue(c.id), 0) / CARDS.heroes.length;

/**
 * A party's score: the heroes' value, plus a premium for having no weak stat (every stat comes up as the
 * challenge about a third of the time, so a lopsided party fails the ones it is bad at).
 */
export function partyScore(defIds: string[]): number {
  const t = { P: 0, M: 0, G: 0 };
  let value = 0;
  for (const id of defIds) {
    const s = (getDef(id) as HeroDef).stats;
    t.P += s.P; t.M += s.M; t.G += s.G;
    value += heroValue(id);
  }
  return value + 0.6 * Math.min(t.P, t.M, t.G) + synergy(defIds);
}

/** Resources bid in a typical encounter, and how many of the deck's resources carry each tag (for Allied). */
const BIDS_PER_ENCOUNTER = 2.5;
const RESOURCE_COUNT = CARDS.resources.length;
const resourceShare = (t: ReturnType<typeof alliedTargets>[number]): number =>
  CARDS.resources.filter((r) => matchesTarget(r, t)).length / RESOURCE_COUNT;
/** How often a Nemesis target is on the table (a shared card in play), measured over the real decks. */
const NEMESIS_RATE = 0.35;

/**
 * What the named abilities add to a party, in stat points: Allied is +1 to all three stats for each other matching
 * hero (and for the matching resources it will usually bid), Nemesis a little for a target that is on the table
 * about a third of the time, and a Companion To a hero whose partner is in the party rides for free, which is
 * worth about half an extra hero.
 */
export function synergy(defIds: string[]): number {
  let v = 0;
  for (const id of defIds) {
    const allied = alliedTargets(id);
    if (allied.length) {
      const heroes = defIds.filter((o) => o !== id && allied.some((t) => matchesTarget(getDef(o), t))).length;
      const resources = allied.reduce((a, t) => a + resourceShare(t), 0) * BIDS_PER_ENCOUNTER;
      v += 3 * (heroes + resources);
    }
    if (nemesisTargets(id).length) v += 3 * NEMESIS_RATE;
    if (companionsOf(id).some((d) => defIds.includes(d))) v += AVG_HERO_VALUE * 0.5;
  }
  return v;
}

export function locationRenown(ref: CardRef | { def: string } | null): number {
  if (!ref) return 0;
  const d = getDef(ref.def);
  return d.kind === 'location' ? (d as LocationDef).renown : 0;
}

/** A read-only model of the table from one bot's point of view. */
export class Table {
  readonly me: PlayerPublicView;
  readonly others: PlayerPublicView[];

  /** Easy bots' guesses are noisy; each is drawn once per decision so the bot is consistent with itself within it. */
  private readonly noisy = new Map<string, number>();

  constructor(readonly view: GameView, readonly level: BotLevel = 'normal', private readonly rand: () => number = Math.random) {
    this.me = view.players.find((p) => p.id === view.you)!;
    this.others = view.players.filter((p) => p.id !== view.you);
  }

  /** One easy-bot guess at an unseen card, remembered under `key`. */
  private noisyGuess(key: string): number {
    let v = this.noisy.get(key);
    if (v === undefined) {
      v = EASY_GUESS_RANGE[0] + this.rand() * (EASY_GUESS_RANGE[1] - EASY_GUESS_RANGE[0]);
      this.noisy.set(key, v);
    }
    return v;
  }

  get stat(): Stat | null { return this.view.turn.challenge?.stat ?? null; }
  get isMyTurn(): boolean { return this.view.turn.active === this.me.id; }
  /** Whether the next turn is ours (turns pass clockwise, in seat order). */
  get nextTurnIsMine(): boolean {
    const ps = this.view.players;
    const i = ps.findIndex((p) => p.id === this.view.turn.active);
    return ps[(i + 1) % ps.length]?.id === this.me.id;
  }
  get target(): number { return this.view.rules.renownToWin; }

  /** Renown at stake this turn (hidden bonus locations counted at the average). */
  get prize(): number { return locationRenown(this.view.turn.location) + this.view.turn.extraLocations * 3.8; }

  /**
   * What a player's face-down bids are guessed to add. The values are never in the view, only how many there are:
   * an easy bot guesses each wildly, a normal bot uses one average for all, a hard bot knows later bids run a little cheaper.
   */
  hiddenValue(p: PlayerPublicView): number {
    const n = p.projection?.hiddenBids ?? 0;
    if (!n) return 0;
    if (this.level === 'easy') { let sum = 0; for (let i = 0; i < n; i++) sum += this.noisyGuess(`${p.id}:bid${i}`); return sum; }
    if (this.level === 'hard') {
      let sum = 0, found = 0;
      p.bids.forEach((b, i) => { if (b.hidden) { sum += HIDDEN_BID_BY_ORDER[Math.min(i, HIDDEN_BID_BY_ORDER.length - 1)]!; found++; } });
      return sum + (n - found) * HIDDEN_BID_ESTIMATE;
    }
    return n * HIDDEN_BID_ESTIMATE;
  }

  /** What up to three cards an opponent still holds could add if they played them (an easy bot's guess is noisy too). */
  handReach(p: PlayerPublicView): number {
    const n = Math.min(p.handCount, 3);
    if (this.level !== 'easy') return n * HIDDEN_BID_ESTIMATE;
    let sum = 0; for (let i = 0; i < n; i++) sum += this.noisyGuess(`${p.id}:hand${i}`); return sum;
  }

  /** Best guess at a player's final total: visible total + hidden bids at the level's guess. */
  estimate(p: PlayerPublicView): number {
    if (!p.projection) return 0;
    return p.projection.total + this.hiddenValue(p);
  }

  difficultyFor(p: PlayerPublicView): number { return p.projection?.difficulty ?? this.view.turn.challenge?.difficulty.total ?? 0; }

  myEstimate(): number {
    // Our own face-down Council cards count 0 until revealed; add what we expect them to bring.
    const pending = this.me.bids.reduce((a, b) => a + (!b.hidden && !b.faceUp ? SPECIAL_VALUE[b.card.def] ?? 0 : 0), 0);
    return (this.me.projection?.total ?? 0) + pending;
  }

  /** How dangerous an opponent is right now: this encounter, and the race to win. */
  threat(p: PlayerPublicView): number {
    const encounter = this.stat ? (this.estimate(p) - this.myEstimate()) * 0.6 : 0;
    const race = (p.renown / this.target) * 10;
    const closing = p.renown + Math.max(3.8, this.prize) >= this.target ? 12 : 0;
    const activeEdge = this.view.turn.active === p.id ? 2 : 0;
    return encounter + race + closing + activeEdge;
  }

  biggestThreat(pool = this.others): PlayerPublicView | null {
    let best: PlayerPublicView | null = null;
    for (const p of pool) if (!best || this.threat(p) > this.threat(best)) best = p;
    return best;
  }

  /** Opponents who look able to beat the difficulty (they compete for the location). */
  rivals(slack = 0): PlayerPublicView[] {
    return this.others.filter((p) => p.projection && this.estimate(p) >= this.difficultyFor(p) - slack);
  }

  bestRivalEstimate(slack = 0): number {
    const r = this.rivals(slack);
    return r.length ? Math.max(...r.map((p) => this.estimate(p))) : -Infinity;
  }

  owner(cardId: string): PlayerPublicView | null {
    return this.view.players.find((p) =>
      p.party.some((c) => c.id === cardId) || p.inactive.some((c) => c.id === cardId)
      || p.resting.some((c) => c.id === cardId) || p.bids.some((b) => !b.hidden && b.card.id === cardId)) ?? null;
  }

  /** A hero's printed contribution in `stat` (approximate: ignores forced/silence effects). */
  heroIn(ref: { def: string }, stat: Stat): number {
    return heroDef(ref).stats[stat];
  }

  /** Base (party) strength of a player in a stat. */
  base(p: PlayerPublicView, stat: Stat): number {
    return p.party.reduce((a, c) => a + this.heroIn(c, stat), 0);
  }

  /** Every hero in a player's party, face up or not. */
  heroesOf(p: PlayerPublicView): CardRef[] {
    return [...p.party, ...p.inactive, ...p.resting];
  }

  handValue(cardId: string): number {
    const h = this.view.hand.find((x) => x.card.id === cardId);
    return h ? SPECIAL_VALUE[h.card.def] ?? h.value : 0;
  }
}
