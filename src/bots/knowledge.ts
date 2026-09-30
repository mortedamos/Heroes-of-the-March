// What a bot knows: card values and a model of the table built only from
// its own GameView (never the secret state).

import { CARDS, getDef } from '../engine/cards';
import type { CompanionDef, HeroDef, LocationDef, Stat } from '../engine/cardTypes';
import type { CardRef } from '../engine/types';
import type { GameView, PlayerPublicView } from '../engine/view';

/** Average value of an unseen face-down bid (from the card data: ~3.1). */
export const HIDDEN_BID_ESTIMATE = 3.1;
/** Average hero stat, used to value Council cards. */
export const AVG_HERO_STAT = 6.8;

/** Bot-side estimates for resources whose printed value understates them. */
export const SPECIAL_VALUE: Record<string, number> = {
  'shoulder-to-shoulder': AVG_HERO_STAT,
  'three-banners-raised': AVG_HERO_STAT * 3,
  'call-the-five-crowns': AVG_HERO_STAT * 5,
  'the-gathering-of-heroes': AVG_HERO_STAT,
  'crossed-paths': AVG_HERO_STAT - 2,
  'an-apple-for-the-road': 3,
};

/** How much a hero's ability is worth on top of its stats (rough, in stat points). */
const HERO_ABILITY: Record<string, number> = {
  'warchief-grukka-ironjaw': 3, 'thorgar-twice-buried': 4, 'aelthir-moonveil': 4, 'lord-vaelis-nightbloom': 3,
  'pip-wanderfoot': 4, 'kazra-emberdeep': 2, 'ysolde-of-the-wellspring': 5, 'mayor-hobby-trickgrin': 2,
  'lord-paladin-aldric-ashcroft': 3, 'high-thane-brunna-stonefast': 1, 'hesk-of-two-homes': 1,
  'queen-maren-ashcroft': 3, 'archmage-corvin-varro': 5, 'professor-barnaby-pickwort': 3, 'urzha-half-tusk': 2,
};

/** How much a companion's ability is worth on top of its stats. */
const COMPANION_ABILITY: Record<string, number> = {
  'liriel-nightbloom': 2, 'thessaly-of-the-grove': 2, 'kesh-the-bog-huntress': 2,
  'sir-hugo-pellam-marchguard-surgeon': 2, 'caelan-the-exile': 2, 'brisa-blastcap-bombardier': 2, 'clemence-fairbrook-temple-cook': 1.5,
  'nettle-burrows-trouble-maker': 2, 'sister-aurelie-dane-physician': 2, 'gnash-the-butcher-of-bloodmire': 2,
  'sir-osric-vane-marshal-of-the-old-guard': 2, 'posy-marchbank-marchguard-clerk': 2,
  'elder-ilvena-of-the-conclave': 3, 'loremaster-oskar-grimgate': 2, 'mags-tolliver-market-trader': 2,
  'mira-coldwater-the-stonetouched': 2, 'goldie-trickgrin-keeper-of-the-goose-and-kettle': 1, 'pell-quillon-collegium-prodigy': 1,
  'seraphine-moonveil-warden-scholar': 1, 'varg-ironjaw': 1, 'tansy-brambleby-barmaid-and-volunteer': 1,
  'fennick-puffcap-mycomancer': 1, 'captain-rook-halloran-skyship-captain': 1, 'marshal-hedda-ironvow': 1,
  'wren-nightingale-relic-hunter': 1, 'mogra-swiftfoot-goblin-runner': 0.5, 'tova-emberdeep-keeper-of-the-underway-door': 0.5,
  'sigrun-stonefast-metal-singer': 0.5, 'tobin-quill-goose-keeper': 0.5,
  'honk-the-goose-rout-veteran': 0.5, 'duchess-the-pub-goose': 0.5, 'sergeant-waddle': 0.5, 'cobra-chicken': 0.5,
};

/** Stand-in for an empty hero slot (only during the opening hero draft). */
const NO_HERO_DEF = { stats: { P: 0, M: 0, G: 0 }, abilityText: '', triggerText: '' } as unknown as HeroDef;

export function heroDef(ref: { def: string } | null): HeroDef { return ref ? getDef(ref.def) as HeroDef : NO_HERO_DEF; }
export function companionDef(ref: { def: string }): CompanionDef { return getDef(ref.def) as CompanionDef; }

export function heroValue(defId: string | undefined): number {
  if (!defId) return 0;
  const d = getDef(defId) as HeroDef;
  return d.stats.P + d.stats.M + d.stats.G + (HERO_ABILITY[defId] ?? 0);
}

export function companionScore(defId: string): number {
  const d = getDef(defId) as CompanionDef;
  return d.stats.P + d.stats.M + d.stats.G + (COMPANION_ABILITY[defId] ?? 0);
}

/** What a blind companion draw is worth on average. */
export const AVG_COMPANION_SCORE = CARDS.companions.reduce((a, c) => a + companionScore(c.id), 0) / CARDS.companions.length;

export function locationRenown(ref: CardRef | { def: string } | null): number {
  if (!ref) return 0;
  const d = getDef(ref.def);
  return d.kind === 'location' ? (d as LocationDef).renown : 0;
}

/** A read-only model of the table from one bot's point of view. */
export class Table {
  readonly me: PlayerPublicView;
  readonly others: PlayerPublicView[];

  constructor(readonly view: GameView) {
    this.me = view.players.find((p) => p.id === view.you)!;
    this.others = view.players.filter((p) => p.id !== view.you);
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

  /** Best guess at a player's final total: visible total + hidden bids at the average. */
  estimate(p: PlayerPublicView): number {
    if (!p.projection) return 0;
    return p.projection.total + p.projection.hiddenBids * HIDDEN_BID_ESTIMATE;
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
      p.hero?.id === cardId || p.companions.some((c) => c.id === cardId) || p.inactiveCompanions.some((c) => c.id === cardId)
      || p.resting.some((c) => c.id === cardId) || p.bids.some((b) => !b.hidden && b.card.id === cardId)) ?? null;
  }

  /** A companion's current contribution in `stat` (approximate: ignores forced/silence effects). */
  companionIn(ref: { def: string }, stat: Stat): number {
    return companionDef(ref).stats[stat];
  }

  /** Base (hero + companions) strength of a player in a stat. */
  base(p: PlayerPublicView, stat: Stat): number {
    return heroDef(p.hero).stats[stat] + p.companions.reduce((a, c) => a + this.companionIn(c, stat), 0);
  }

  handValue(cardId: string): number {
    const h = this.view.hand.find((x) => x.card.id === cardId);
    return h ? SPECIAL_VALUE[h.card.def] ?? h.value : 0;
  }
}
