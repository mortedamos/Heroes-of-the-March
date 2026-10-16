// Card ability registry.
//
// Each card id maps to an Ability describing its static modifiers, triggers
// and activated abilities. `status` records how complete the implementation is:
//   full    - behaves as printed (interpretations are listed in rules.ts)
//   partial - some of the text works (see `note`)
//   todo    - not implemented yet; the card still contributes its numbers
// Cards with no rules text are "vanilla" and need no entry.
//
// Hooks run inside the authoritative engine only. They must use ctx helpers
// and never read from anything but the GameState, so they stay deterministic.

import { CARDS, getDef } from './cards';
import type { CardKind, EncounterDef, ResourceDef, Stat } from './cardTypes';
import type { Ctx } from './context';
import {
  addEffect, cardOption, councilHeroes, drawMinionNow, drawResources, fire, hasGroup, heroesInPlay, isOfGroup, kingdomsOf, locationAbility,
  peekOption, revealTop, ridingHeroes, statName,
} from './effects';
import { baseStrength, challengeStat } from './totals';
import type { AbilityWindow, CardId, DeckName, PlayerId, PlayerState } from './types';
import { DECKS } from './types';

export interface Source { card: CardId; owner: PlayerId | null; kind: CardKind }
export interface OwnedSource extends Source { owner: PlayerId }

export type TriggerName = 'challengeFaced' | 'encounterReplaced' | 'locationEntered' | 'encounterEntered' | 'heroEntered' | 'locationWon' | 'statForced' | 'turnStart'
  | 'minionDrawn' | 'locationReplaced' | 'heroLeft' | 'resourceEntered' | 'statChanged' | 'bidLost' | 'endOfBidding';
export interface TriggerPayload {
  /** The turn's encounter challenge was announced (stat as modified by the location); player is the active player. */
  challengeFaced: { stat: Stat; player: PlayerId };
  encounterReplaced: { player: PlayerId };
  locationEntered: { card: CardId };
  encounterEntered: { card: CardId; asMinion: boolean };
  heroEntered: { card: CardId; player: PlayerId };
  locationWon: { player: PlayerId; margin: number };
  statForced: { player: PlayerId; target: CardId };
  /** The start of `player`'s turn (after resting heroes return and cards are drawn). */
  turnStart: { player: PlayerId };
  /** A minion was drawn for the encounter. */
  minionDrawn: { card: CardId };
  /** The location was replaced by another (Wayfinder's Die, Mine Now...). */
  locationReplaced: { from: CardId; to: CardId };
  /** A hero was replaced, discarded or fell; `player` controlled it. */
  heroLeft: { card: CardId; player: PlayerId };
  /** A resource was revealed or played face up under `player`'s control (face-down bids do not count until then). */
  resourceEntered: { card: CardId; player: PlayerId };
  /** A card changed the stat needed to beat the challenge (a resource, or a location that changes the challenge type). */
  statChanged: { stat: Stat };
  /** `player` did not win the encounter: they fell, or survived without taking the location. */
  bidLost: { player: PlayerId };
  /** Bidding is over and every card is revealed; the totals are about to be counted. */
  endOfBidding: { turn: number };
}

export type ImplStatus = 'full' | 'partial' | 'todo';

/** An ability a player chooses to use during one of the turn's windows. */
export interface Activation {
  /** Stable id, unique on its card (sent by clients in `ability.use`). */
  id: string;
  label: string;
  windows: AbilityWindow[];
  /** Only on its controller's own turn, or only on other players' turns. */
  turn?: 'own' | 'others';
  per: 'turn' | 'game';
  canUse?: (ctx: Ctx, self: OwnedSource) => boolean;
  use: (ctx: Ctx, self: OwnedSource) => void;
}

export interface Ability {
  status: ImplStatus;
  note?: string;
  on?: { [K in TriggerName]?: (ctx: Ctx, self: Source, e: TriggerPayload[K]) => void };
  /** This card itself enters play (heroes, locations). */
  onEnter?: (ctx: Ctx, self: Source) => void;
  /** A resource is revealed or played face up. */
  onReveal?: (ctx: Ctx, self: Source) => void;
  activations?: Activation[];

  // Static modifiers read by totals.ts / flow.ts -----------------------------
  /** Ysolde (and The Goose & Kettle while it is in play): the party limit is this much higher. */
  partyBonus?: number;
  /** Corvin: draw one more whenever you draw ('ownTurn': only on your own turn). */
  extraDrawOnDraw?: boolean | 'ownTurn' | 'oncePerTurn';
  /** Once per turn, counter an ability that would affect your heroes (Aldric) or your resources or the location (Brunna). */
  counter?: 'heroes' | 'resources';
  /** Hedda: once per turn, an ability that targets one of your heroes may target this hero instead (and you draw a resource). */
  redirect?: boolean;
  /** Goldie: when you draw a new hero in the recruit phase, draw three and keep one. */
  tavern?: boolean;
  /** Once per game, a fall of this hero's player is prevented and they draw 3 resources (Thorgar). */
  unburied?: boolean;
  /** Override a resource's value in context. */
  resourceValue?: (ctx: Ctx, owner: PlayerState, base: number) => number;
  /** Sigrun: once per turn, a draw may instead take one of three random discarded cards. */
  drawFromDiscardChoice?: boolean;
  /** Hobby: your first bid may be face down too. */
  mayBidFaceDown?: boolean;
  /** Hesk: one extra use per turn of another hero's once-per-turn ability. */
  reuseHeroAbility?: boolean;
  /** Encounter: when it comes into play as the encounter, an encounter of this group is drawn instead and this card becomes its minion (Destiny). */
  fetchesGroup?: string;
  /** Encounter: its difficulty when the challenge is on these stats (the Runeforged Titan). */
  difficultyByStat?: Partial<Record<Stat, number>>;
  /** Encounter: when defeated (someone survived), with the survivors. */
  onDefeated?: (ctx: Ctx, self: Source, survivors: PlayerId[]) => void;
  /** Location: face-down resource cards stay hidden until the reveal step; no ability may look at or reveal them (The Hollow Hills). */
  hidesFaceDown?: boolean;
  /** Location: every resource is played face up and none can be turned face down (The Mirror Mire). */
  facesUp?: boolean;
  /** Location: the encounter draws one extra minion (Barrowdeep). */
  extraMinion?: boolean;
  /** Location: every encounter and minion counts as this group (Barrowdeep: Undead). */
  encountersCountAs?: string;
  /** Tova: when this resting hero returns, draw a resource. */
  restReturnDraw?: boolean;
  /** Oskar: once per turn, when an opponent's ability lands on its player's heroes or resources, its player draws a resource. */
  drawWhenTargeted?: boolean;
  // Location statics
  challengeStat?: Stat;
  groupBoost?: { group: string; amount: number };
  minionBonus?: number;
}

// --- helpers ---------------------------------------------------------------

const nameOf = (ctx: Ctx, card: CardId) => ctx.def(card).name;
const shortName = (ctx: Ctx, card: CardId) => nameOf(ctx, card).split(',')[0]!;

function drawFor(ctx: Ctx, self: Source, n = 1): void {
  if (!self.owner || n <= 0) return;
  drawResources(ctx, self.owner, n, nameOf(ctx, self.card));
}

function encounterEntered(group: string) {
  return (ctx: Ctx, self: Source, e: TriggerPayload['encounterEntered']) => {
    if (e.asMinion && !ctx.s.rules.minionsTriggerEntersPlay) return;
    if (isOfGroup(ctx, e.card, group)) drawFor(ctx, self);
  };
}

/** Draw a resource, but only the first time each turn this card's trigger `key` fires. */
const oncePerTurn = (key: string) => (ctx: Ctx, self: Source) => {
  const used = ctx.s.turn.used;
  const k = `${self.card}:${key}`;
  if (used[k]) return;
  used[k] = 1;
  drawFor(ctx, self);
};

/**
 * "When a card of one of these groups enters play, draw a resource." Every kind of card enters play: heroes,
 * locations, encounters, minions and resources (when they are revealed or played face up). Some are once per turn.
 */
function entersPlay(groups: string[], once = false): NonNullable<Ability['on']> {
  const hit = (ctx: Ctx, self: Source, card: CardId) => {
    if (!groups.some((g) => isOfGroup(ctx, card, g))) return;
    if (once) oncePerTurn('enters')(ctx, self);
    else drawFor(ctx, self);
  };
  return {
    heroEntered: (ctx, self, e) => hit(ctx, self, e.card),
    locationEntered: (ctx, self, e) => hit(ctx, self, e.card),
    encounterEntered: (ctx, self, e) => { if (!e.asMinion || ctx.s.rules.minionsTriggerEntersPlay) hit(ctx, self, e.card); },
    resourceEntered: (ctx, self, e) => hit(ctx, self, e.card),
  };
}

/** Pell, Nettle, Gnash: "When a <stat> challenge is faced, draw a resource." */
const challengeDraw = (stat: Stat) => (ctx: Ctx, self: Source, e: TriggerPayload['challengeFaced']) => {
  if (e.stat === stat) drawFor(ctx, self);
};

/** A location drawing a resource per hero of one kingdom in each player's party (the capitals). */
const drawPerKin = (kingdom: string): Ability => drawPerOwn((ctx, p) => p.party.filter((c) => kingdomsOf(ctx.def(c)).includes(kingdom)).length);

/** Location: all players draw one resource per matching card they have in play. */
function drawPerOwn(pred: (ctx: Ctx, p: PlayerState) => number): Ability {
  return {
    status: 'full',
    onEnter: (ctx, self) => {
      for (const p of ctx.clockwise()) drawResources(ctx, p.id, pred(ctx, p), nameOf(ctx, self.card));
    },
  };
}

const groupBoost = (group: string, amount = 2): Ability => ({ status: 'full', groupBoost: { group, amount } });
const valueAgainst = (groups: string[], value: number): Ability => ({
  status: 'full',
  resourceValue: (ctx, _owner, base) => {
    const enc = ctx.encounter;
    return enc && groups.some((g) => hasGroup(enc, g)) ? value : base;
  },
});

const council = (n: number): Ability => ({
  status: 'full',
  onReveal: (ctx, self) => councilHeroes(ctx, self.owner!, n, nameOf(ctx, self.card)),
});

const swapLocation = (mode: 'shuffleBack' | 'discard'): Ability => ({
  status: 'full',
  onReveal: (ctx, self) => ctx.queue({ t: 'replaceLocation', mode, source: nameOf(ctx, self.card) }),
});

function statChange(stat: Stat): Ability {
  return {
    status: 'full',
    onReveal: (ctx, self) => {
      const p = ctx.player(self.owner!);
      // "You may change the stat": take it only if we're stronger there.
      const cur = challengeStat(ctx, p);
      if (cur && cur !== stat && baseStrength(ctx, p, stat) > baseStrength(ctx, p, cur)) {
        p.statOverride = stat;
        ctx.log(p.id, nameOf(ctx, self.card), `now faces the challenge with ${stat}`);
        fire(ctx, 'statChanged', { stat });
      }
    },
  };
}

/** A curse resource: revealed or played face up, its owner places it in front of an opposing player, where its negative value counts toward that player's bid. */
const curse = (): Ability => ({
  status: 'full',
  onReveal: (ctx, self) => {
    const targets = ctx.s.players.filter((p) => p.id !== self.owner);
    if (!targets.length) return;
    ctx.queue({
      t: 'choose', purpose: 'curseTarget', player: self.owner!, source: nameOf(ctx, self.card),
      prompt: `${nameOf(ctx, self.card)}: place it in front of an opposing player. Its value counts toward their bid.`,
      options: targets.map((p) => ({ value: p.id, label: p.name })), min: 1, max: 1, data: { card: self.card },
    });
  },
});

const others = (ctx: Ctx, self: OwnedSource) => ctx.s.players.filter((p) => p.id !== self.owner);

/** Heroes of other players that are in play (and not resting). */
const opposingHeroes = (ctx: Ctx, self: OwnedSource) => others(ctx, self).flatMap((p) => p.party.map((c) => ({ c, p })));

/**
 * How much a hero would lose if forced onto `stat` ('weakest': its lowest stat) in the
 * current challenge (what it gives now in the challenge stat, less what it would give).
 */
function forceLoss(ctx: Ctx, card: CardId, owner: PlayerState, stat: Stat | 'weakest'): number {
  const cs = challengeStat(ctx, owner);
  const d = ctx.def(card);
  if (!cs || d.kind !== 'hero') return 0;
  const forced = stat === 'weakest' ? Math.min(d.stats.P, d.stats.M, d.stats.G) : d.stats[stat];
  return d.stats[cs] - forced;
}

/** Mark the options that would hurt the most (when any hurts at all) so the player can spot them. */
function highlightWorst<T extends object>(options: T[], losses: number[]): (T & { highlight?: boolean })[] {
  const best = Math.max(0, ...losses);
  return options.map((o, i) => (best > 0 && losses[i] === best ? { ...o, highlight: true } : o));
}

/** Liriel / Thessaly / Kesh: force another player's hero to contribute a stat. */
function forceHero(stat: Stat): Ability {
  return {
    status: 'full',
    activations: [{
      id: 'force', label: `Force a hero to use ${statName(stat)}`, windows: ['bidding'], per: 'turn',
      canUse: (ctx, self) => opposingHeroes(ctx, self).length > 0,
      use: (ctx, self) => ctx.queueFirst({
        t: 'choose', purpose: 'forceHero', player: self.owner, source: nameOf(ctx, self.card),
        prompt: `${shortName(ctx, self.card)}: choose another player's hero to contribute ${statName(stat)}`,
        options: (() => {
          const list = opposingHeroes(ctx, self);
          return highlightWorst(list.map(({ c, p }) => cardOption(ctx, c, `${shortName(ctx, c)} (${p.name})`)), list.map(({ c, p }) => forceLoss(ctx, c, p, stat)));
        })(),
        min: 1, max: 1, data: { stat, source: self.card },
      }),
    }],
  };
}

/**
 * The four geese: at the end of bidding, reveal the top resource card and discard it; if it is the goose's
 * kind of card, something good (or odd) happens. The goose keeps its stats either way.
 */
function flipBonus(o: { id: 'honk' | 'hiss' | 'wark'; word: string; test: (d: ResourceDef) => boolean; when: string; result: string; hit: (ctx: Ctx, self: OwnedSource) => void }): Ability {
  return {
    status: 'full',
    activations: [{
      id: o.id, label: `${o.word} Reveal the top resource card: ${o.when}, ${o.result}`, windows: ['endOfBidding'], per: 'turn',
      canUse: (ctx) => ctx.s.decks.resource.length + ctx.s.discards.resource.length > 0,
      use: (ctx, self) => {
        const cards = revealTop(ctx, self.owner, 'resource', 1, nameOf(ctx, self.card));
        const hit = cards.some((c) => o.test(ctx.def(c) as ResourceDef));
        for (const c of cards) {
          ctx.discard('resource', c);
          ctx.emit({ type: 'resourceDiscarded', player: self.owner, card: ctx.ref(c), reason: nameOf(ctx, self.card) });
        }
        if (hit) {
          o.hit(ctx, self);
          ctx.log(self.owner, nameOf(ctx, self.card), `${o.word} ${o.result}`);
        } else ctx.log(self.owner, nameOf(ctx, self.card), `${o.word} Nothing this time`);
      },
    }],
  };
}

/** +2 to all stats for the rest of the encounter (Honk, Duchess, Waddle). */
const plusTwo = (ctx: Ctx, self: OwnedSource) => { addEffect(ctx, { kind: 'statBonus', source: self.card, owner: self.owner, target: self.owner, stat: 'all', amount: 2 }); };
const honk = flipBonus({ id: 'honk', word: 'HONK!', when: 'a value of 3 or more', result: '+2 to all stats', test: (d) => d.value >= 3, hit: plusTwo });
const waddle = flipBonus({ id: 'honk', word: 'HONK!', when: 'an odd value', result: '+2 to all stats', test: (d) => Math.abs(d.value) % 2 === 1, hit: plusTwo });
const duchess = flipBonus({ id: 'hiss', word: 'Hiss', when: 'an even value', result: '+2 to all stats', test: (d) => Math.abs(d.value) % 2 === 0, hit: plusTwo });
const cobra = flipBonus({ id: 'wark', word: 'WARK!', when: 'a Wand', result: 'wands give no bonuses this turn', test: (d) => d.wand, hit: (ctx) => { ctx.s.turn.wandsDisabled = true; } });

/** Brisa: the revealed resources she may turn face down (not ones already turned). */
const brisaTargets = (ctx: Ctx, p: PlayerState): CardId[] => p.bids.filter((b) => b.visible && !b.flipped).map((b) => b.card);

/** Top `n` cards of a stack without removing them (refills from the discard if empty). */
export function peekTop(ctx: Ctx, deck: DeckName, n: number): CardId[] {
  if (ctx.s.decks[deck].length === 0) {
    const c = ctx.take(deck);
    if (c) ctx.s.decks[deck].push(c);
  }
  const pile = ctx.s.decks[deck];
  return pile.slice(Math.max(0, pile.length - n)).reverse();
}

const hasLocationsToPeek = (ctx: Ctx) => ctx.s.decks.location.length + ctx.s.discards.location.length > 0;

const TODO = (note?: string): Ability => ({ status: 'todo', ...(note ? { note } : {}) });

// --- registry ---------------------------------------------------------------

export const ABILITIES: Record<string, Ability> = {
  // Heroes. Allied, Nemesis and Companion To are data on the card (src/data/cards.json); everything else is here.
  'warchief-grukka-ironjaw': {
    status: 'full',
    activations: [{
      id: 'mineNow', label: 'Look at the next location; a Capital you may put into play', windows: ['afterLocation'], per: 'turn',
      canUse: (ctx) => Boolean(ctx.s.turn.location) && hasLocationsToPeek(ctx),
      use: (ctx, self) => {
        const [next] = peekTop(ctx, 'location', 1);
        if (!next) return;
        ctx.emit({ type: 'peeked', player: self.owner, deck: 'location', count: 1 });
        const d = ctx.def(next);
        // Only a Capital may be put into play (and draws two resources); anything else is looked at and shuffled back.
        const capital = hasGroup(d, 'Capital');
        ctx.queueFirst({
          t: 'choose', purpose: 'peekReplace', player: self.owner, source: nameOf(ctx, self.card),
          prompt: capital
            ? `Strike the Heart: the next location is ${d.name}, a Capital. Put it into play instead of ${ctx.location?.name ?? 'the current one'}, and draw 2 resources?`
            : `Strike the Heart: the next location is ${d.name}. It is not a Capital, so it is shuffled back.`,
          options: capital
            ? [
              { value: 'replace', label: `Put ${d.name} into play and draw 2 resources (Renown ${d.kind === 'location' ? d.renown : '?'})`, card: { def: d.id } },
              { value: 'keep', label: 'Keep the current location' },
            ]
            : [{ value: 'keep', label: `Shuffle ${d.name} back`, card: { def: d.id } }],
          min: capital ? 1 : 0, max: 1, data: { card: next, player: self.owner },
        });
      },
    }],
  },
  'thorgar-twice-buried': { status: 'full', unburied: true },
  'aelthir-moonveil': { status: 'full', on: entersPlay(['Human'], true) },
  'lord-vaelis-nightbloom': {
    status: 'full',
    activations: [{
      id: 'shadowsteeds', label: 'Draw the next encounter; use its minion bonus or give it to another player', windows: ['beforeBidding'], per: 'turn',
      canUse: (ctx) => ctx.s.decks.encounter.length + ctx.s.discards.encounter.length > 0,
      use: (ctx, self) => {
        const c = ctx.take('encounter');
        if (!c) return;
        ctx.s.turn.setAside.push(c);
        ctx.emit({ type: 'cardShown', player: self.owner, card: ctx.ref(c), reason: 'Master of Shadowsteeds' });
        const mv = (ctx.def(c) as EncounterDef).minionValue;
        const sign = mv > 0 ? '+' : '';
        ctx.queueFirst({
          t: 'choose', purpose: 'vaelisGive', player: self.owner, source: nameOf(ctx, self.card),
          prompt: `Master Manipulator: ${nameOf(ctx, c)} has a minion bonus of ${sign}${mv}. Use it yourself, or give it to another player?`,
          options: [{ value: 'self', label: `Use it myself (${sign}${mv} to all stats)` }, ...others(ctx, self).map((o) => ({ value: o.id, label: `Give it to ${o.name}` }))],
          min: 1, max: 1, data: { amount: mv, card: self.card },
        });
      },
    }],
  },
  'pip-wanderfoot': { status: 'full', on: { locationReplaced: oncePerTurn('wander') } },
  'kazra-emberdeep': { status: 'full', on: entersPlay(['Ironbound']) },
  'ysolde-of-the-wellspring': { status: 'full', partyBonus: 1 },
  'mayor-hobby-trickgrin': {
    status: 'full', mayBidFaceDown: true,
    note: 'Face-down cards still reveal in the normal reveal step.',
  },
  'lord-paladin-aldric-ashcroft': { status: 'full', counter: 'heroes' },
  'high-thane-brunna-stonefast': { status: 'full', counter: 'resources' },
  'queen-maren-ashcroft': {
    status: 'full',
    activations: [{
      id: 'requisition', label: 'Trade a card from your hand for a random card from another hand', windows: ['beforeBidding'], turn: 'own', per: 'turn',
      canUse: (ctx, self) => ctx.player(self.owner).hand.length > 0 && others(ctx, self).some((p) => p.hand.length > 0),
      use: (ctx, self) => ctx.queueFirst({
        t: 'choose', purpose: 'marenTarget', player: self.owner, source: nameOf(ctx, self.card),
        prompt: 'Royal Requisition: whose hand do you requisition from?',
        options: others(ctx, self).filter((p) => p.hand.length > 0).map((p) => ({ value: p.id, label: `${p.name} (${p.hand.length} cards)` })),
        min: 1, max: 1,
      }),
    }],
  },
  'archmage-corvin-varro': { status: 'full', extraDrawOnDraw: 'oncePerTurn' },
  'professor-barnaby-pickwort': {
    status: 'full',
    activations: [{
      id: 'maps', label: 'Look at the next two locations; you may swap one in', windows: ['bidding'], per: 'turn',
      canUse: (ctx) => Boolean(ctx.s.turn.location) && hasLocationsToPeek(ctx),
      use: (ctx, self) => {
        const next = peekTop(ctx, 'location', 2);
        if (!next.length) return;
        ctx.emit({ type: 'peeked', player: self.owner, deck: 'location', count: next.length });
        ctx.queueFirst({
          t: 'choose', purpose: 'pickLocation', player: self.owner, source: nameOf(ctx, self.card),
          prompt: "The Society's Maps: swap the current location for one of these?",
          // A location with rules text can also be swapped in with its text ignored (the value ends in "x").
          options: [
            ...next.flatMap((c, i) => {
              const d = ctx.def(c);
              const renown = d.kind === 'location' ? d.renown : '?';
              const hasEffect = d.kind === 'location' && Boolean(d.conditionText);
              return [
                { value: `n${i}`, label: `Swap in ${d.name} (Renown ${renown})`, card: { def: d.id } },
                ...(hasEffect ? [{ value: `n${i}x`, label: `Swap in ${d.name} and ignore its effect (Renown ${renown})`, card: { def: d.id } }] : []),
              ];
            }),
            { value: 'keep', label: `Keep ${ctx.location?.name ?? 'the current location'}` },
          ],
          min: 1, max: 1, data: Object.fromEntries(next.map((c, i) => [`n${i}`, c])),
        });
      },
    }],
  },
  'urzha-half-tusk': {
    status: 'full',
    activations: [{
      id: 'pickFight', label: 'Look at the next encounter; you may replace this one with it', windows: ['beforeBidding'], per: 'turn',
      canUse: (ctx) => Boolean(ctx.s.turn.encounter) && ctx.s.decks.encounter.length + ctx.s.discards.encounter.length > 0,
      use: (ctx, self) => {
        const [next] = peekTop(ctx, 'encounter', 1);
        if (!next) return;
        ctx.emit({ type: 'peeked', player: self.owner, deck: 'encounter', count: 1 });
        const cur = ctx.encounter;
        ctx.queueFirst({
          t: 'choose', purpose: 'pickFight', player: self.owner, source: nameOf(ctx, self.card),
          prompt: `Pick Your Fight: the next encounter is ${nameOf(ctx, next)}. Replace ${cur?.name ?? 'this one'} with it?`,
          options: [
            peekOption(ctx, 'replace', next, `Replace it with ${nameOf(ctx, next)}`),
            { value: 'keep', label: `Keep ${cur?.name ?? 'this encounter'}` },
          ],
          min: 1, max: 1, data: { card: next },
        });
      },
    }],
  },
  // Oskar: before bidding, name an opponent; whenever they use an ability against his player's heroes this turn, he draws a resource.
  // Oskar: once per turn, when an opponent's ability lands on his player's heroes or resources, a resource (effects.ts: hostileTo).
  'loremaster-oskar-grimgate': { status: 'full', drawWhenTargeted: true },

  // Goldie: when you draw a new hero in the recruit phase you draw three and keep one (commands.ts).
  'goldie-trickgrin-keeper-of-the-goose-and-kettle': { status: 'full', tavern: true },
  // Tansy: once per turn, during bidding, look at all of one other player's face-down bids.
  'tansy-brambleby-barmaid-and-volunteer': {
    status: 'full',
    activations: [{
      id: 'rumour', label: "Look at all the face-down cards another player has bid", windows: ['bidding'], per: 'turn',
      canUse: (ctx, self) => !locationAbility(ctx)?.hidesFaceDown && others(ctx, self).some((p) => p.bids.some((b) => !b.visible)),
      use: (ctx, self) => {
        const targets = others(ctx, self).filter((p) => p.bids.some((b) => !b.visible));
        if (!targets.length) return;
        ctx.queueFirst({
          t: 'choose', purpose: 'rumourTarget', player: self.owner, source: nameOf(ctx, self.card),
          prompt: 'Rumour Mill: whose face-down cards do you look at?',
          options: targets.map((p) => ({ value: p.id, label: `${p.name} (${p.bids.filter((b) => !b.visible).length} face down)` })),
          min: 1, max: 1, data: { source: shortName(ctx, self.card) },
        });
      },
    }],
  },
  // Gimlet: swap a card from your hand with the top card of the resource discard pile.
  'gimlet-a-very-good-dog': {
    status: 'full',
    activations: [{
      id: 'fetch', label: 'Swap a card from your hand with the top card of the resource discard stack', windows: ['beforeBidding'], per: 'turn',
      canUse: (ctx, self) => ctx.player(self.owner).hand.length > 0 && ctx.s.discards.resource.length > 0,
      use: (ctx, self) => {
        const p = ctx.player(self.owner);
        const pile = ctx.s.discards.resource;
        const top = pile[pile.length - 1];
        if (!top) return;
        ctx.queueFirst({
          t: 'choose', purpose: 'fetch', player: p.id, source: nameOf(ctx, self.card),
          prompt: `Fetch: swap a card from your hand for ${nameOf(ctx, top)} (the top of the discard stack)?`,
          options: [...p.hand.map((c) => cardOption(ctx, c)), { value: 'skip', label: 'Keep your hand' }], min: 1, max: 1, data: { source: self.card },
        });
      },
    }],
  },
  // Torvi: a one-shot. At the end of bidding, discard a resource and Torvi, and every opponent has -6.
  'torvi-cinderkeg-master-gunner': {
    status: 'full',
    activations: [{
      id: 'fire', label: 'Discard a resource and Torvi: every opponent has -6 this encounter', windows: ['endOfBidding'], per: 'turn',
      canUse: (ctx, self) => others(ctx, self).length > 0 && ctx.player(self.owner).hand.length > 0,
      use: (ctx, self) => ctx.queueFirst({
        t: 'choose', purpose: 'torviFire', player: self.owner, source: nameOf(ctx, self.card),
        prompt: 'Uncontrolled Explosion: discard a resource from your hand (and Torvi). Every opponent has -6 this encounter.',
        options: ctx.player(self.owner).hand.map((c) => cardOption(ctx, c)), min: 1, max: 1, data: { source: self.card },
      }),
    }],
  },
  // Moss: whenever a minion is drawn for an encounter, a resource.
  'moss-dire-wolf': { status: 'full', on: { minionDrawn: (ctx, self) => drawFor(ctx, self) } },
  'hesk-of-two-homes': { status: 'full', reuseHeroAbility: true },
  'tova-emberdeep-keeper-of-the-underway-door': {
    status: 'full', restReturnDraw: true,
    activations: [{
      id: 'rest', label: 'Rest this turn (no stats); draw two extra cards on your next turn', windows: ['beforeBidding'], per: 'turn',
      use: (ctx, self) => {
        const p = ctx.player(self.owner);
        p.party = p.party.filter((c) => c !== self.card);
        p.resting.push(self.card);
        ctx.emit({ type: 'heroFaceDown', player: p.id, card: ctx.ref(self.card), faceDown: true });
      },
    }],
  },
  'varg-ironjaw': { status: 'full', on: entersPlay(['Orc'], true) },
  // Farmer Hobart: at the start of his controller's turn, a resource if there is a Goose in play anywhere.
  'farmer-hobart-thimblewick': {
    status: 'full',
    on: {
      turnStart: (ctx, self, e) => {
        if (e.player !== self.owner) return;
        const t = ctx.s.turn;
        const cards = [...heroesInPlay(ctx).map((c) => c.card), ...(t.encounter ? [t.encounter] : []), ...t.minions];
        if (cards.some((c) => isOfGroup(ctx, c, 'Goose'))) drawFor(ctx, self);
      },
    },
  },
  'fennick-puffcap-mycomancer': { status: 'full', on: { statForced: oncePerTurn('spore') } },
  // Rook: discard a resource, draw a resource.
  'captain-rook-halloran-skyship-captain': {
    status: 'full',
    activations: [{
      id: 'manifest', label: 'Discard a resource card and draw a resource card', windows: ['beforeBidding'], per: 'turn',
      canUse: (ctx, self) => ctx.player(self.owner).hand.length > 0 && ctx.s.decks.resource.length + ctx.s.discards.resource.length > 0,
      use: (ctx, self) => {
        const p = ctx.player(self.owner);
        ctx.queueFirst({ t: 'draw', player: p.id, n: 1, source: nameOf(ctx, self.card) });
        ctx.queueFirst({
          t: 'choose', purpose: 'discardResource', player: p.id, source: nameOf(ctx, self.card),
          prompt: 'Skyship Manifest: discard a resource card, then draw one', options: p.hand.map((c) => cardOption(ctx, c)), min: 1, max: 1,
          data: { reason: 'Skyship Manifest' },
        });
      },
    }],
  },
  'marshal-hedda-ironvow': { status: 'full', redirect: true },
  'pell-quillon-collegium-prodigy': { status: 'full', on: { challengeFaced: challengeDraw('M') } },
  'nettle-burrows-trouble-maker': { status: 'full', on: { challengeFaced: challengeDraw('G') } },
  'gnash-the-butcher-of-bloodmire': { status: 'full', on: { challengeFaced: challengeDraw('P') } },
  // Aurelie: the first time each turn anyone is forced onto another stat, or the stat needed to beat the challenge is changed.
  'sister-aurelie-dane-physician': { status: 'full', on: { statForced: oncePerTurn('adapt'), statChanged: oncePerTurn('adapt') } },
  'sigrun-stonefast-metal-singer': { status: 'full', drawFromDiscardChoice: true },
  'liriel-nightbloom': forceHero('G'),
  'thessaly-of-the-grove': forceHero('M'),
  'kesh-the-bog-huntress': { status: 'full', on: { encounterEntered: encounterEntered('Beast') } },
  'elowen-leafwatch-treetop-warden': {
    status: 'full',
    activations: [{
      id: 'readAhead', label: 'Look at the top card of any stack; you may bottom it', windows: ['turnStart', 'afterLocation', 'beforeBidding', 'bidding', 'beforeReveal', 'endOfBidding'], turn: 'own', per: 'turn',
      canUse: (ctx) => DECKS.some((d) => ctx.s.decks[d].length > 0),
      use: (ctx, self) => ctx.queueFirst({
        t: 'choose', purpose: 'wrenStack', player: self.owner, source: nameOf(ctx, self.card),
        prompt: "I've Read Ahead: which stack do you look at?",
        options: DECKS.filter((d) => ctx.s.decks[d].length > 0).map((d) => ({ value: d, label: `${d[0]!.toUpperCase()}${d.slice(1)} stack` })),
        min: 1, max: 1,
      }),
    }],
  },
  'dagny-coldhearth-the-grudge-bearer': {
    status: 'full',
    activations: [{
      id: 'stonetouched', label: 'Win this location outright; discard your hand and one of your heroes falls (once per game)', windows: ['endOfBidding'], per: 'game',
      canUse: (ctx) => Boolean(ctx.s.turn.location),
      use: (ctx, self) => addEffect(ctx, { kind: 'autoWin', source: self.card, owner: self.owner, target: self.owner }),
    }],
  },
  // Seraphine: when one of your heroes is replaced or discarded, draw a resource.
  'seraphine-moonveil-warden-scholar': {
    status: 'full',
    on: { heroLeft: (ctx, self, e) => { if (e.player === self.owner && e.card !== self.card) drawFor(ctx, self); } },
  },
  'honk-the-goose-rout-veteran': honk,
  'duchess-the-pub-goose': duchess,
  'sergeant-waddle': waddle,
  'cobra-chicken': cobra,
  'elder-ilvena-of-the-conclave': {
    status: 'full',
    activations: [{
      id: 'ruling', label: 'Force an opposing hero to use its weakest stat', windows: ['beforeBidding'], per: 'turn',
      canUse: (ctx, self) => opposingHeroes(ctx, self).length > 0,
      use: (ctx, self) => {
        const p = ctx.player(self.owner);
        ctx.queueFirst({
          t: 'choose', purpose: 'rulingHero', player: p.id, source: nameOf(ctx, self.card),
          prompt: "Ruling of the Conclave: choose another player's hero to use its weakest stat",
          options: (() => {
            const list = opposingHeroes(ctx, self);
            return highlightWorst(list.map(({ c, p: o }) => cardOption(ctx, c, `${shortName(ctx, c)} (${o.name})`)), list.map(({ c, p: o }) => forceLoss(ctx, c, o, 'weakest')));
          })(),
          min: 1, max: 1, data: { source: self.card },
        });
      },
    }],
  },
  // Mogra: when you do not win the encounter (you fell, or survived without the location), take a random resource from an opponent.
  'mogra-swiftfoot-goblin-runner': {
    status: 'full',
    on: {
      bidLost: (ctx, self, e) => {
        if (e.player !== self.owner) return;
        const victims = others(ctx, self as OwnedSource).filter((p) => p.hand.length > 0);
        if (!victims.length) return;
        ctx.queue({
          t: 'choose', purpose: 'mograSteal', player: self.owner!, source: nameOf(ctx, self.card),
          prompt: 'Smash and Grab: take a random resource card from which opponent?',
          options: victims.map((p) => ({ value: p.id, label: `${p.name} (${p.hand.length} cards)` })), min: 1, max: 1, data: { source: self.card },
        });
      },
    },
  },
  // Tobin: once per turn before bidding, reveal three heroes; a Goose among them may join you, the rest are discarded.
  'tobin-quill-goose-keeper': {
    status: 'full',
    activations: [{
      id: 'flock', label: 'Reveal the top 3 heroes; you may put a Goose among them into play, the rest are discarded', windows: ['beforeBidding'], per: 'turn',
      canUse: (ctx) => ctx.s.decks.hero.length + ctx.s.discards.hero.length > 0,
      use: (ctx, self) => {
        const t = ctx.s.turn;
        const revealed = revealTop(ctx, self.owner, 'hero', 3, nameOf(ctx, self.card));
        const geese = revealed.filter((c) => hasGroup(ctx.def(c), 'Goose'));
        if (!geese.length) {
          for (const c of revealed) ctx.discard('hero', c);
          ctx.log(self.owner, nameOf(ctx, self.card), 'No Goose among them; all discarded');
          return;
        }
        t.setAside.push(...revealed);
        ctx.queueFirst({
          t: 'choose', purpose: 'tobinPick', player: self.owner, source: nameOf(ctx, self.card),
          prompt: 'Keeper of the Flock: put a Goose into play (the others are discarded)?',
          options: [...geese.map((c) => cardOption(ctx, c)), { value: 'none', label: 'Put none into play' }],
          min: 1, max: 1, data: { revealed: revealed.join(',') },
        });
      },
    }],
  },
  // Caelan: once per turn, when a Warden or Marchguard card enters play, a resource.
  'caelan-halfelven': { status: 'full', on: entersPlay(['Warden', 'Marchguard'], true) },
  // Brisa: at the end of bidding, turn one of your revealed resources face down; it counts for 3.
  'brisa-blastcap-bombardier': {
    status: 'full',
    activations: [{
      id: 'flip', label: 'Turn one of your revealed resources face down: it contributes 3', windows: ['endOfBidding'], per: 'turn',
      canUse: (ctx, self) => !locationAbility(ctx)?.facesUp && brisaTargets(ctx, ctx.player(self.owner)).length > 0,
      use: (ctx, self) => ctx.queueFirst({
        t: 'choose', purpose: 'brisaFlip', player: self.owner, source: nameOf(ctx, self.card),
        prompt: 'Improvised Explosives: turn one of your revealed resources face down. It contributes 3 instead of its value.',
        options: brisaTargets(ctx, ctx.player(self.owner)).map((c) => cardOption(ctx, c)), min: 1, max: 1, data: { source: self.card },
      }),
    }],
  },
  // Grumma: at the end of bidding, if you bid at least 3 resources, a resource.
  'grumma-ladlejaw-camp-cook': {
    status: 'full',
    on: {
      endOfBidding: (ctx, self) => {
        const p = ctx.player(self.owner!);
        if (p.bids.filter((b) => !b.placedBy).length >= 3) drawFor(ctx, self);
      },
    },
  },
  // Aelder: once per turn, at the end of bidding, discard a resource and gain +3 until the end of the encounter.
  'aelder-mossleaf-awakened-oak': {
    status: 'full',
    activations: [{
      id: 'roots', label: 'Discard a resource: this hero gains +3 until the end of the encounter', windows: ['endOfBidding'], per: 'turn',
      canUse: (ctx, self) => ctx.player(self.owner).hand.length > 0,
      use: (ctx, self) => ctx.queueFirst({
        t: 'choose', purpose: 'aelderRoots', player: self.owner, source: nameOf(ctx, self.card),
        prompt: 'Inexorable Roots: discard a resource from your hand. This hero gains +3 until the end of the encounter.',
        options: ctx.player(self.owner).hand.map((c) => cardOption(ctx, c)), min: 1, max: 1, data: { source: self.card },
      }),
    }],
  },
  // Locations
  'the-goose-and-kettle': {
    status: 'full', partyBonus: 1,
    onEnter: (ctx, self) => {
      if (ctx.s.decks.hero.length + ctx.s.discards.hero.length === 0) return;
      for (const p of ctx.clockwise()) {
        ctx.queue({
          t: 'choose', purpose: 'waystoneDraw', player: p.id, source: nameOf(ctx, self.card),
          prompt: 'The Goose & Kettle: draw a hero into play? (Your party may have one more hero while this place is in play.)',
          options: [{ value: 'draw', label: 'Draw a hero' }, { value: 'skip', label: 'No thanks' }], min: 1, max: 1,
        });
      }
    },
  },
  'kingsford': drawPerOwn((ctx, p) => p.party.filter((c) => hasGroup(ctx.def(c), 'Human')).length),
  'the-barrowlands': groupBoost('Undead', 3),
  'the-deep-forge-of-karrak': groupBoost('Ironbound'),
  'the-mirror-marches': { status: 'full', facesUp: true }, // The Mirror Mire
  'tomb-of-the-first-wardens': { status: 'full', challengeStat: 'G' },
  'the-silverwood-hunt': { status: 'full', challengeStat: 'P' },
  'the-sealed-archive': { status: 'full', challengeStat: 'M' },
  'the-speaking-stones': { status: 'full', minionBonus: 2 },
  'the-old-quarry': { status: 'full' }, // "All" group handled by hasGroup()
  'the-storybook-glade': {
    status: 'full',
    onEnter: (ctx, self) => {
      for (const p of ctx.clockwise()) {
        if (p.party.length === 0) continue;
        ctx.queue({ t: 'choose', purpose: 'faceDownHero', player: p.id, prompt: 'The Storybook Glade: choose a hero to turn face down', options: p.party.map((c) => cardOption(ctx, c)), min: 1, max: 1, source: nameOf(ctx, self.card), data: { counter: 'heroes' } });
      }
    },
  },
  'the-endless-road': { status: 'full', onEnter: (ctx) => addExtraLocation(ctx) },
  'sylvaneth': drawPerKin('Elf'),
  'grimgate': drawPerKin('Dwarf'),
  'gorewatch': drawPerKin('Orc'),
  'hearthmeadow': drawPerKin('Halfellow'),
  'barrowdeep': { status: 'full', extraMinion: true, encountersCountAs: 'Undead' },
  'the-crack-in-the-marchstone': {
    status: 'full',
    onEnter: (ctx, self) => {
      for (const p of ctx.clockwise()) {
        if (p.party.length === 0) continue;
        ctx.queue({ t: 'choose', purpose: 'discardHero', player: p.id, prompt: 'The Crack in the Marchstone: discard a hero', options: p.party.map((c) => cardOption(ctx, c)), min: 1, max: 1, source: nameOf(ctx, self.card), data: { counter: 'heroes' } });
      }
      ctx.queue({ t: 'replaceLocation', mode: 'shuffleBack', source: nameOf(ctx, self.card) });
    },
  },
  'the-wardens-hall': drawPerOwn((ctx, p) => p.party.filter((c) => hasGroup(ctx.def(c), 'Warden')).length),
  'the-mage-college-vaults': drawPerOwn((ctx, p) => p.party.filter((c) => hasGroup(ctx.def(c), 'Collegium')).length),
  'marchguard-keep': drawPerOwn((ctx, p) => p.party.filter((c) => hasGroup(ctx.def(c), 'Marchguard')).length),
  'the-hollow-hills': { status: 'full', hidesFaceDown: true }, // Fog of the Fey
  'parting-strand': {
    status: 'full',
    on: {
      locationWon: (ctx, self, e) => {
        if (ctx.s.turn.location !== self.card) return;
        const p = ctx.player(e.player);
        if (p.party.length === 0) return;
        ctx.queue({ t: 'choose', purpose: 'discardHero', player: p.id, prompt: 'Parting Strand: discard a hero', options: p.party.map((c) => cardOption(ctx, c)), min: 1, max: 1, source: nameOf(ctx, self.card), data: { counter: 'heroes' } });
      },
    },
  },
  'the-hollow-between': {
    status: 'full',
    onEnter: (ctx, self) => {
      for (const p of ctx.clockwise()) {
        if (p.hand.length === 0) continue;
        ctx.queue({ t: 'choose', purpose: 'discardResource', player: p.id, prompt: 'The Hollow Between: discard a resource card', options: p.hand.map((c) => cardOption(ctx, c)), min: 1, max: 1, source: nameOf(ctx, self.card), data: { counter: 'resources' } });
      }
    },
  },

  // Encounters
  'the-treasure-trow': {
    status: 'full',
    on: {
      encounterEntered: (ctx, self, e) => {
        if (e.card !== self.card) return;
        for (const p of ctx.clockwise()) drawResources(ctx, p.id, 1, nameOf(ctx, self.card));
      },
    },
    onDefeated: (ctx, self, survivors) => {
      for (const pid of survivors) drawResources(ctx, pid, 1, nameOf(ctx, self.card));
    },
  },
  'destiny-the-frog': { status: 'full', fetchesGroup: 'Skarra' },
  'runeforged-titan': { status: 'full', difficultyByStat: { M: 5, G: 5 } },
  'iron-mites': {
    status: 'full',
    note: 'The player whose resource card is lowest gives up one of their own heroes as a minion.',
    on: {
      encounterEntered: (ctx, self, e) => {
        if (e.card !== self.card) return;
        // Every player with a hero turns up the top resource card; the lowest value gives up a hero
        // (ties draw again). The cards turned up are discarded.
        let rollers = ctx.clockwise().filter((p) => p.party.length > 0);
        let guard = 0;
        while (rollers.length > 1 && guard++ < 20) {
          const draws = rollers.map((p) => {
            const c = revealTop(ctx, p.id, 'resource', 1, 'Infectious Zombie')[0] ?? null;
            const d = c ? ctx.def(c) : null;
            return { p, c, v: d && d.kind === 'resource' ? d.value : 0 };
          });
          for (const x of draws) if (x.c) ctx.discard('resource', x.c);
          const low = Math.min(...draws.map((x) => x.v));
          rollers = draws.filter((x) => x.v === low).map((x) => x.p);
        }
        const loser = rollers[0];
        if (!loser) return;
        ctx.queue({
          t: 'choose', purpose: 'heroMinion', player: loser.id, source: 'Infectious Zombie',
          prompt: 'Infectious Zombie: choose one of your heroes to join the encounter as a minion',
          options: loser.party.map((c) => cardOption(ctx, c)), min: 1, max: 1, data: { counter: 'heroes' },
        });
      },
    },
  },

  // Resources
  'an-apple-for-the-road': {
    status: 'full',
    onReveal: (ctx, self) => {
      const options = ctx.s.players.flatMap((p) => p.bids.filter((b) => b.visible && b.card !== self.card)
        .map((b) => cardOption(ctx, b.card, `${p.name}'s ${nameOf(ctx, b.card)}`)));
      if (!options.length) return;
      ctx.queueFirst({
        t: 'choose', purpose: 'appleSwap', player: self.owner!, source: nameOf(ctx, self.card),
        prompt: 'An Apple for the Road: exchange the Apple with another resource in play', options, min: 1, max: 1,
        data: { apple: self.card },
      });
    },
  },
  'three-banners-raised': council(3),
  'shoulder-to-shoulder': council(1),
  'crossed-paths': {
    status: 'full',
    onReveal: (ctx, self) => {
      const p = ctx.player(self.owner!);
      if (p.hand.length === 0) return;
      ctx.queue({ t: 'choose', purpose: 'discardForCouncil', player: p.id, prompt: 'Crossed Paths: discard a resource to call a hero (or skip)', options: p.hand.map((c) => cardOption(ctx, c)), min: 0, max: 1, source: nameOf(ctx, self.card) });
    },
  },
  'the-hall-of-rest': { status: 'full' }, // flow.ts: resolve marks, the fallHero choice lets you pick a replacement
  'the-gathering-of-heroes': {
    status: 'full',
    onReveal: (ctx, self) => {
      for (const p of ctx.clockwise()) if (p.bids.length > 0) councilHeroes(ctx, p.id, 1, nameOf(ctx, self.card));
    },
  },
  'gold-filings': valueAgainst(['Ironbound'], 5),
  'rune-of-unmaking': valueAgainst(['Ironbound'], 5),
  'warding-nail': valueAgainst(['Ironbound'], 5),
  'cold-iron-barrier': { status: 'full', onReveal: (ctx) => { ctx.s.turn.wandsDisabled = true; } },
  'null-rune-seal': { status: 'full', onReveal: (ctx) => { ctx.s.turn.wandsDisabled = true; } },
  'the-amulet-of-aesia': { status: 'full' }, // handled in flow.ts at resolution
  // Pariapt of Peace: nobody's Allied or Nemesis bonus counts this turn (totals.ts reads the flag).
  'pariapt-of-peace': { status: 'full', onReveal: (ctx) => { ctx.s.turn.namedDisabled = true; } },
  // The Tome of Nethrak: an Undead minion joins this encounter, for everyone.
  'the-tome-of-nethrak': { status: 'full', onReveal: (ctx) => { drawMinionNow(ctx, 'Undead'); } },
  // Immobilizing Word: its player picks an opponent whose Companion heroes (those riding free with a hero they are Companion To) are turned face down for this encounter.
  'immobilizing-word': {
    status: 'full',
    onReveal: (ctx, self) => {
      const targets = ctx.s.players.filter((p) => { const riding = ridingHeroes(ctx, p); return p.id !== self.owner && p.party.some((c) => riding.has(c)); });
      if (!targets.length) return;
      ctx.queue({
        t: 'choose', purpose: 'immobilizeTarget', player: self.owner!, source: nameOf(ctx, self.card),
        prompt: `${nameOf(ctx, self.card)}: choose an opponent. Their Companion heroes are turned face down this encounter.`,
        options: targets.map((p) => ({ value: p.id, label: p.name })), min: 1, max: 1, data: { card: self.card },
      });
    },
  },
  'shield-of-xorthalos': { status: 'full', onReveal: (ctx) => { ctx.s.turn.noFalls = true; } },
  'wayfinders-die': swapLocation('shuffleBack'),
  'portal-rune': swapLocation('shuffleBack'),
  'the-umbral-ring': swapLocation('discard'),
  'the-wardens-horn': {
    status: 'full',
    onReveal: (ctx, self) => {
      // Optional; The Wardens' Hall has the highest Renown in the game, so take it
      // unless we're already there.
      if (ctx.location?.id === 'the-wardens-hall') return;
      ctx.queue({ t: 'setLocation', defId: 'the-wardens-hall', source: nameOf(ctx, self.card) });
    },
  },
  'gauntlet-of-returning': { status: 'full' }, // flow.ts: end of turn
  'arangils-vision-glass': statChange('M'),
  'blasting-powder': statChange('P'),
  // The Golden Egg: +1, and +2 for every Goose in play anywhere this encounter.
  'the-golden-egg': {
    status: 'full',
    resourceValue: (ctx, _owner, base) => base + 2 * (heroesInPlay(ctx).map((c) => c.card).concat(ctx.s.turn.encounter ? [ctx.s.turn.encounter] : [], ctx.s.turn.minions)).filter((c) => hasGroup(ctx.def(c), 'Goose')).length,
  },
  'the-rosepearl': {
    status: 'full',
    resourceValue: (ctx) => Math.max(0, ...heroesInPlay(ctx).map((c) => {
      const d = ctx.def(c.card);
      return d.kind === 'hero' ? d.stats.M : 0;
    })),
  },
  'hourglass-of-undoing': {
    status: 'full',
    onReveal: (ctx, self) => {
      const c = ctx.s.discards.resource.pop();
      if (!c) return;
      ctx.player(self.owner!).hand.push(c);
      ctx.emit({ type: 'drew', player: self.owner!, deck: 'resource', cards: [ctx.ref(c)], reason: nameOf(ctx, self.card) });
    },
  },
  // The Book of Grudges: +1 for Oskar's player; the grudge itself is applied when the encounter is resolved (flow.ts).
  'the-book-of-grudges': {
    status: 'full',
    resourceValue: (ctx, owner, base) => base + (owner.party.some((c) => ctx.defId(c) === 'loremaster-oskar-grimgate') ? 1 : 0),
  },
  'skarras-hexwand': { status: 'full' },
  'rotten-apple': curse(), 'misdirecting-missive': curse(), 'grudge-marker': curse(),
  'apprentices-exploding-wand': curse(), 'cursed-locket': curse(), 'marked-for-the-hunt': curse(),
  'wrens-silver-wand': { status: 'full' },
};

for (const n of ['i', 'ii', 'iii', 'iv', 'v', 'vi']) {
  ABILITIES[`shard-of-the-marchstone-${n}`] = {
    status: 'full',
    onReveal: (ctx, self) => {
      let count = 0;
      for (const p of ctx.s.players) {
        for (const b of p.bids) {
          if (b.card !== self.card && b.visible && ctx.defId(b.card).startsWith('shard-of-the-marchstone-')) count++;
        }
      }
      drawFor(ctx, self, count);
    },
  };
}

function addExtraLocation(ctx: Ctx): void {
  const extra = ctx.take('location');
  if (!extra) return;
  ctx.s.turn.extraLocations.push(extra);
  ctx.emit({ type: 'extraLocation', count: ctx.s.turn.extraLocations.length });
}

// Sanity: every registry key must be a real card, and activation ids unique per card.
for (const [id, a] of Object.entries(ABILITIES)) {
  try { getDef(id); } catch { throw new Error(`abilities.ts: unknown card id ${id}`); }
  const ids = (a.activations ?? []).map((x) => x.id);
  if (new Set(ids).size !== ids.length) throw new Error(`abilities.ts: duplicate activation id on ${id}`);
}

void TODO;

export function abilityOf(defId: string): Ability | undefined {
  return Object.prototype.hasOwnProperty.call(ABILITIES, defId) ? ABILITIES[defId] : undefined;
}

export type CardStatus = ImplStatus | 'vanilla';

/** How complete a card's implementation is (shown on cards and in the dev report). */
export function cardStatus(defId: string): CardStatus {
  const a = abilityOf(defId);
  if (a) return a.status;
  const d = getDef(defId);
  const hasText = d.kind === 'hero' ? Boolean(d.abilityText)
    : d.kind === 'location' || d.kind === 'encounter' || d.kind === 'resource' ? Boolean(d.conditionText)
    : false;
  if (d.kind === 'encounter' && d.minions.count > 0 && /minion/.test(d.conditionText ?? '')) return 'full';
  return hasText ? 'todo' : 'vanilla';
}

export function statusReport(): Record<CardStatus, string[]> {
  const out: Record<CardStatus, string[]> = { full: [], partial: [], todo: [], vanilla: [] };
  for (const list of [CARDS.heroes, CARDS.locations, CARDS.encounters, CARDS.resources]) {
    for (const c of list) out[cardStatus(c.id)].push(c.id);
  }
  return out;
}
