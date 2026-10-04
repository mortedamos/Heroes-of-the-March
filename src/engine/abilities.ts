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
  abilityRoll, addEffect, cardOption, companionsInPlay, councilHeroes, discardCompanion, drawResources, extraReveals, fire, hasGroup, kingdomsOf,
  ownerOf, peekOption, revealTop, sharesKingdom, statName,
} from './effects';
import { nextInt } from './rng';
import { baseStrength, challengeStat } from './totals';
import type { AbilityWindow, CardId, DeckName, PlayerId, PlayerState } from './types';
import { DECKS } from './types';

export interface Source { card: CardId; owner: PlayerId | null; kind: CardKind }
export interface OwnedSource extends Source { owner: PlayerId }

export type TriggerName = 'die' | 'challengeFaced' | 'encounterReplaced' | 'locationEntered' | 'encounterEntered' | 'companionEntered' | 'heroFell' | 'locationWon' | 'statForced' | 'turnStart'
  | 'minionDrawn' | 'locationReplaced' | 'companionLeft';
export interface TriggerPayload {
  die: { value: number; player: PlayerId | null };
  /** The turn's encounter challenge was announced (stat as modified by the location); player is the active player. */
  challengeFaced: { stat: Stat; player: PlayerId };
  encounterReplaced: { player: PlayerId };
  locationEntered: { card: CardId };
  encounterEntered: { card: CardId; asMinion: boolean };
  companionEntered: { card: CardId; player: PlayerId };
  heroFell: { player: PlayerId };
  locationWon: { player: PlayerId; margin: number };
  statForced: { player: PlayerId; target: CardId };
  /** The start of `player`'s turn (after resting companions return and cards are drawn). */
  turnStart: { player: PlayerId };
  /** A minion was drawn for the encounter. */
  minionDrawn: { card: CardId };
  /** The location was replaced by another (Wayfinder's Die, Mine Now...). */
  locationReplaced: { from: CardId; to: CardId };
  /** A companion was replaced or discarded; `player` controlled it. */
  companionLeft: { card: CardId; player: PlayerId };
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
  /** This card itself enters play (companions, locations). */
  onEnter?: (ctx: Ctx, self: Source) => void;
  /** A resource is revealed or played face up. */
  onReveal?: (ctx: Ctx, self: Source) => void;
  activations?: Activation[];

  // Static modifiers read by totals.ts / flow.ts -----------------------------
  maxCompanions?: number;
  /** May use the hero's X stat in place of the challenge stat (applied when higher). */
  heroStatSub?: Stat;
  /** This companion may contribute its X stat in place of another (applied when higher). */
  selfStatSub?: Stat;
  /** Corvin: draw one more whenever you draw ('ownTurn': only on your own turn). */
  extraDrawOnDraw?: boolean | 'ownTurn';
  /** Aldric: may counter another player's activated ability as it is used (once per turn, shared with Shield of the Dawn). */
  counter?: boolean;
  /** Flat bonus to your total in every challenge (balance option). */
  flatBonus?: number;
  /** Pip: a claimed face-down card is replaced by a random card from your hand (balance option). */
  claimSwapsCard?: boolean;
  /** Opponents' silences, forced stats and negations don't affect your cards (balance option). */
  ignoreHostileEffects?: boolean;
  /** With more than two companions, your weakest one (in the tested stat) counts half (balance option). */
  extraCompanionHalf?: boolean;
  ignorePositiveMinionBonus?: boolean;
  /** If you would not survive, gain this much (Thorgar). */
  failSave?: number;
  /** If you play at least `cards` resources, each gains `bonus`. */
  multiBidBonus?: { cards: number; bonus: number };
  /** Override a resource's value in context. */
  resourceValue?: (ctx: Ctx, owner: PlayerState, base: number) => number;
  /** Mogra: roll ability dice twice on your turn and keep either. */
  rerollAbilityDice?: boolean;
  /** Sigrun: once per turn, a draw may instead take one of three random discarded cards. */
  drawFromDiscardChoice?: boolean;
  /** Mogra: abilities of yours that reveal cards from a stack to see whether they work reveal one extra. */
  extraReveal?: boolean;
  /** Posy, Osric: when the hero's stat swap (heroStatSub) is used, this companion gains this much for the encounter. */
  heroSubBonus?: number;
  /** Brunna: forced-stat effects on your cards apply only if they help you. */
  ignoreForcedStat?: boolean;
  /** Hobby: your first bid may be face down too. */
  mayBidFaceDown?: boolean;
  /** Hesk: one extra use per turn of another companion's once-per-turn ability. */
  reuseCompanionAbility?: boolean;
  /** Heroes' Kin bonus: A (+1 per kin companion), B (draw when a kin companion enters play), C (opposing kin companions get -1). */
  kin?: 'A' | 'B' | 'C';
  /** Bonus pair (Varg and Moss, Goldie and Gimlet): with both in the party the companion limit is one higher. */
  pair?: string;
  /** +amount to every stat while the named companion is in the same party (Varg and Sigrun). */
  partnerBonus?: { with: string; amount: number };
  /** +amount to every stat while the named encounter card is part of the encounter (Gimlet and Destiny). */
  encounterBonus?: { def: string; amount: number };
  /** Hedda: once per turn, an opponent's ability that would affect one of your companions is cancelled. */
  holdTheLine?: boolean;
  /** Encounter: worth `value` as a minion of an encounter in this group (Destiny with Skarra). */
  minionValueWith?: { group: string; value: number };
  /** Encounter: shuffled back into the encounter stack when it ends its turn as a minion (Destiny). */
  shuffleBackAsMinion?: boolean;
  /** Encounter: its difficulty when the challenge is on these stats (the Runeforged Titan). */
  difficultyByStat?: Partial<Record<Stat, number>>;
  /** Encounter: when defeated (someone survived), with the survivors. */
  onDefeated?: (ctx: Ctx, self: Source, survivors: PlayerId[]) => void;
  /** Location: if the encounter is in this group it draws one extra minion of that group (Barrowdeep). */
  extraMinion?: string;
  /** Tova: when this resting companion returns, draw a resource. */
  restReturnDraw?: boolean;
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
    if (hasGroup(ctx.def(e.card), group)) drawFor(ctx, self);
  };
}

function locationEntered(group: string) {
  return (ctx: Ctx, self: Source, e: TriggerPayload['locationEntered']) => {
    if (hasGroup(ctx.def(e.card), group)) drawFor(ctx, self);
  };
}

/** "When a <stat> challenge is faced, draw a resource" (on any turn; also when another effect changes the challenge to that stat). */
const onChallenge = (stat: Stat) => (ctx: Ctx, self: Source, e: TriggerPayload['challengeFaced']) => {
  if (e.stat === stat) drawFor(ctx, self);
};

/** Once a turn per card, "the first time anyone is forced to use a different stat". */
const firstForcedStat = (key: string) => (ctx: Ctx, self: Source) => {
  const used = ctx.s.turn.used;
  const k = `${self.card}:${key}`;
  if (used[k]) return;
  used[k] = 1;
  drawFor(ctx, self);
};

/**
 * A location or encounter that searches the top of the encounter stack (The Frostfells, Wreck of the Skyship
 * Gallant): look at the top 5; a card in `group` becomes this turn's encounter, otherwise they are all discarded.
 */
function searchForEncounter(ctx: Ctx, group: string): void {
  const t = ctx.s.turn;
  if (t.encounter) return; // the encounter is already out: nothing to find
  if (t.chosenEncounter) { ctx.s.decks.encounter.push(t.chosenEncounter); t.chosenEncounter = null; } // an earlier find goes back
  const top = peekTop(ctx, 'encounter', 5);
  for (const c of top) ctx.emit({ type: 'cardShown', player: null, card: ctx.ref(c), reason: nameOf(ctx, ctx.s.turn.location ?? top[0]!) });
  const hit = top.find((c) => hasGroup(ctx.def(c), group));
  const pile = ctx.s.decks.encounter;
  if (hit) {
    pile.splice(pile.indexOf(hit), 1);
    t.chosenEncounter = hit;
    return;
  }
  for (const c of top) {
    pile.splice(pile.indexOf(c), 1);
    ctx.discard('encounter', c);
  }
}

/** A location drawing a resource per companion of one kingdom in each player's party (the capitals). */
const drawPerKin = (kingdom: string): Ability => drawPerOwn((ctx, p) => p.companions.filter((c) => kingdomsOf(ctx.def(c)).includes(kingdom)).length);

/** Location: all players draw one resource per matching card they have in play. */
function drawPerOwn(pred: (ctx: Ctx, p: PlayerState) => number): Ability {
  return {
    status: 'full',
    onEnter: (ctx, self) => {
      for (const p of ctx.clockwise()) drawResources(ctx, p.id, pred(ctx, p), nameOf(ctx, self.card));
    },
  };
}

const groupBoost = (group: string): Ability => ({ status: 'full', groupBoost: { group, amount: 2 } });
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
      }
    },
  };
}

const others = (ctx: Ctx, self: OwnedSource) => ctx.s.players.filter((p) => p.id !== self.owner);

/** Companions of other players that are in play (and not resting). */
const opposingCompanions = (ctx: Ctx, self: OwnedSource) => others(ctx, self).flatMap((p) => p.companions.map((c) => ({ c, p })));

/**
 * How much a companion would lose if forced onto `stat` ('weakest': its lowest stat) in the
 * current challenge (what it gives now in the challenge stat, less what it would give).
 */
function forceLoss(ctx: Ctx, card: CardId, owner: PlayerState, stat: Stat | 'weakest'): number {
  const cs = challengeStat(ctx, owner);
  const d = ctx.def(card);
  if (!cs || d.kind !== 'companion') return 0;
  const forced = stat === 'weakest' ? Math.min(d.stats.P, d.stats.M, d.stats.G) : d.stats[stat];
  return d.stats[cs] - forced;
}

/** Mark the options that would hurt the most (when any hurts at all) so the player can spot them. */
function highlightWorst<T extends object>(options: T[], losses: number[]): (T & { highlight?: boolean })[] {
  const best = Math.max(0, ...losses);
  return options.map((o, i) => (best > 0 && losses[i] === best ? { ...o, highlight: true } : o));
}

/** Liriel / Thessaly / Kesh: force another player's companion to contribute a stat. */
function forceCompanion(stat: Stat): Ability {
  return {
    status: 'full',
    activations: [{
      id: 'force', label: `Force a companion to use ${statName(stat)}`, windows: ['bidding'], per: 'turn',
      canUse: (ctx, self) => opposingCompanions(ctx, self).length > 0,
      use: (ctx, self) => ctx.queueFirst({
        t: 'choose', purpose: 'forceCompanion', player: self.owner, source: nameOf(ctx, self.card),
        prompt: `${shortName(ctx, self.card)}: choose another player's companion to contribute ${statName(stat)}`,
        options: (() => {
          const list = opposingCompanions(ctx, self);
          return highlightWorst(list.map(({ c, p }) => cardOption(ctx, c, `${shortName(ctx, c)} (${p.name})`)), list.map(({ c, p }) => forceLoss(ctx, c, p, stat)));
        })(),
        min: 1, max: 1, data: { stat, source: self.card },
      }),
    }],
  };
}

/** Hugo / Caelan / Brisa / Clemence: force another player's hero to contribute a stat. */
function forceHero(stat: Stat, turn?: 'own'): Ability {
  return {
    status: 'full',
    activations: [{
      id: 'force', label: `Force a hero to use ${statName(stat)}`, windows: ['bidding'], per: 'turn', ...(turn ? { turn } : {}),
      canUse: (ctx, self) => others(ctx, self).length > 0,
      use: (ctx, self) => ctx.queueFirst({
        t: 'choose', purpose: 'forceHero', player: self.owner, source: nameOf(ctx, self.card),
        prompt: `${shortName(ctx, self.card)}: choose a player whose hero must contribute ${statName(stat)}`,
        options: others(ctx, self).map((p) => ({ value: p.id, label: `${p.name}: ${shortName(ctx, p.hero)} (${stat} ${(getDef(ctx.defId(p.hero)) as { stats: Record<Stat, number> }).stats[stat]})`, card: { def: ctx.defId(p.hero), id: p.hero } })),
        min: 1, max: 1, data: { stat, source: self.card },
      }),
    }],
  };
}

/**
 * The four geese: at the end of bidding, reveal the top resource card; if it is the goose's kind of card,
 * gain a bonus in the goose's stat. The card is discarded either way and the goose keeps its stats.
 */
function flipBonus(o: { id: 'honk' | 'hiss'; stat: Stat; bonus: number; test: (d: ResourceDef) => boolean; when: string }): Ability {
  const word = o.id === 'honk' ? 'HONK!' : 'Hiss';
  return {
    status: 'full',
    activations: [{
      id: o.id, label: `${word} Reveal the top resource card: ${o.when} gains +${o.bonus} ${statName(o.stat)}`, windows: ['endOfBidding'], per: 'turn',
      canUse: (ctx) => ctx.s.decks.resource.length + ctx.s.discards.resource.length > 0,
      use: (ctx, self) => {
        const cards = revealTop(ctx, self.owner, 'resource', 1 + extraReveals(ctx, self.owner), nameOf(ctx, self.card));
        const hit = cards.some((c) => o.test(ctx.def(c) as ResourceDef));
        for (const c of cards) {
          ctx.discard('resource', c);
          ctx.emit({ type: 'resourceDiscarded', player: self.owner, card: ctx.ref(c), reason: nameOf(ctx, self.card) });
        }
        if (hit) {
          addEffect(ctx, { kind: 'statBonus', source: self.card, owner: self.owner, target: self.owner, stat: o.stat, amount: o.bonus });
          ctx.log(self.owner, nameOf(ctx, self.card), `${word} +${o.bonus} ${statName(o.stat)}`);
        } else ctx.log(self.owner, nameOf(ctx, self.card), `${word} Nothing this time`);
      },
    }],
  };
}

const honk = flipBonus({ id: 'honk', stat: 'P', bonus: 3, when: 'a value of 3 or more', test: (d) => d.value >= 3 });
const waddle = flipBonus({ id: 'honk', stat: 'P', bonus: 2, when: 'an odd value', test: (d) => d.value % 2 === 1 });
const duchess = flipBonus({ id: 'hiss', stat: 'G', bonus: 5, when: 'a value of 4 or more', test: (d) => d.value >= 4 });
const cobra = flipBonus({ id: 'hiss', stat: 'G', bonus: 3, when: 'a Wand', test: (d) => d.wand });

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
  // Heroes
  'warchief-grukka-ironjaw': {
    status: 'full',
    on: { locationEntered: locationEntered('Capital') },
    activations: [{
      id: 'mineNow', label: 'Look at the next location; you may swap it in', windows: ['afterLocation'], per: 'turn',
      canUse: (ctx) => Boolean(ctx.s.turn.location) && hasLocationsToPeek(ctx),
      use: (ctx, self) => {
        const [next] = peekTop(ctx, 'location', 1);
        if (!next) return;
        ctx.emit({ type: 'peeked', player: self.owner, deck: 'location', count: 1 });
        const d = ctx.def(next);
        ctx.queueFirst({
          t: 'choose', purpose: 'peekReplace', player: self.owner, source: nameOf(ctx, self.card),
          prompt: `Mine Now: the next location is ${d.name}. Swap it for ${ctx.location?.name ?? 'the current one'}?`,
          options: [
            { value: 'replace', label: `Swap in ${d.name} (Renown ${d.kind === 'location' ? d.renown : '?'})`, card: { def: d.id } },
            { value: 'keep', label: 'Keep the current location' },
          ],
          min: 1, max: 1, data: { card: next },
        });
      },
    }],
  },
  'thorgar-twice-buried': { status: 'full', flatBonus: 1, failSave: 4, on: { locationWon: (ctx, self, e) => { if (e.margin <= 3) drawFor(ctx, self); } } },
  'aelthir-moonveil': {
    status: 'full',
    on: { challengeFaced: onChallenge('G') },
    activations: [{
      id: 'torch', label: "Silence an opponent's companion this turn", windows: ['beforeBidding'], per: 'turn',
      canUse: (ctx, self) => opposingCompanions(ctx, self).length > 0,
      use: (ctx, self) => ctx.queueFirst({
        t: 'choose', purpose: 'silenceCompanion', player: self.owner, source: nameOf(ctx, self.card),
        prompt: 'I Held the Torch: choose an opponent\'s companion. It contributes no stats this turn.',
        options: opposingCompanions(ctx, self).map(({ c, p }) => cardOption(ctx, c, `${shortName(ctx, c)} (${p.name})`)),
        min: 1, max: 1, data: { source: self.card },
      }),
    }],
  },
  'lord-vaelis-nightbloom': {
    status: 'full',
    on: { heroFell: (ctx, self) => drawFor(ctx, self, 2) },
    activations: [{
      id: 'shadowsteeds', label: 'Draw the next encounter; its minion bonus goes to all your stats', windows: ['beforeBidding'], per: 'turn',
      canUse: (ctx) => ctx.s.decks.encounter.length + ctx.s.discards.encounter.length > 0,
      use: (ctx, self) => {
        const c = ctx.take('encounter');
        if (!c) return;
        ctx.s.turn.setAside.push(c);
        ctx.emit({ type: 'cardShown', player: self.owner, card: ctx.ref(c), reason: 'Master of Shadowsteeds' });
        const mv = (ctx.def(c) as EncounterDef).minionValue;
        addEffect(ctx, { kind: 'statBonus', source: self.card, owner: self.owner, target: self.owner, stat: 'all', amount: mv });
      },
    }],
  },
  'pip-wanderfoot': {
    status: 'full', claimSwapsCard: true,
    on: { locationReplaced: (ctx, self) => drawFor(ctx, self) },
    activations: [{
      id: 'pockets', label: "Claim another player's face-down bid", windows: ['bidding'], turn: 'others', per: 'turn',
      canUse: (ctx, self) => others(ctx, self).some((p) => p.bids.some((b) => !b.visible)),
      use: (ctx, self) => {
        const options = others(ctx, self).flatMap((p) => p.bids.flatMap((b, i) => (b.visible ? [] : [{
          value: `${p.id}:${i}`, label: `${p.name}'s face-down card #${p.bids.slice(0, i + 1).filter((x) => !x.visible).length}`,
        }])));
        ctx.queueFirst({
          t: 'choose', purpose: 'pipClaim', player: self.owner, source: nameOf(ctx, self.card),
          prompt: 'Pockets Full of Everything: claim a face-down card as your own bid', options, min: 1, max: 1,
        });
      },
    }],
  },
  'kazra-emberdeep': { status: 'full', ignorePositiveMinionBonus: true, on: { encounterEntered: encounterEntered('Ironbound') } },
  'ysolde-of-the-wellspring': { status: 'full', maxCompanions: 3, on: { challengeFaced: onChallenge('M') } },
  'mayor-hobby-trickgrin': {
    status: 'full', mayBidFaceDown: true,
    note: 'Face-down cards still reveal in the normal reveal step.',
    on: { statForced: firstForcedStat('hobby') },
  },
  'lord-paladin-aldric-ashcroft': {
    status: 'full', counter: true,
    on: {
      locationEntered: locationEntered('Marchguard'),
      // Only the order's own recruits: Marchguard companions entering under his control.
      companionEntered: (ctx, self, e) => { if (e.player === self.owner && hasGroup(ctx.def(e.card), 'Marchguard')) drawFor(ctx, self); },
    },
    activations: [{
      id: 'shield', label: "Disable another player's hero or companion ability this turn", windows: ['bidding'], per: 'turn',
      use: (ctx, self) => ctx.queueFirst({
        t: 'choose', purpose: 'disableAbility', player: self.owner, source: nameOf(ctx, self.card),
        prompt: "Shield of the Dawn: disable a hero's or companion's ability for the rest of the turn (cancels its effects)",
        options: others(ctx, self).flatMap((p) => [p.hero, ...p.companions].map((c) => cardOption(ctx, c, `${shortName(ctx, c)} (${p.name})`))),
        min: 1, max: 1, data: { source: self.card },
      }),
    }],
  },
  'high-thane-brunna-stonefast': { status: 'full', ignoreForcedStat: true, ignoreHostileEffects: true, on: { challengeFaced: onChallenge('P') } },
  'queen-maren-ashcroft': {
    status: 'full',
    on: { locationEntered: locationEntered('Wardhouse') },
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
  'archmage-corvin-varro': { status: 'full', extraDrawOnDraw: 'ownTurn', on: { encounterEntered: encounterEntered('Undead') } },
  'professor-barnaby-pickwort': {
    status: 'full',
    on: { locationEntered: locationEntered('Accord') },
    activations: [{
      id: 'maps', label: 'Look at the next two locations; you may swap one in', windows: ['afterLocation', 'beforeBidding', 'bidding', 'endOfBidding'], turn: 'own', per: 'turn',
      canUse: (ctx) => Boolean(ctx.s.turn.location) && hasLocationsToPeek(ctx),
      use: (ctx, self) => {
        const next = peekTop(ctx, 'location', 2);
        if (!next.length) return;
        ctx.emit({ type: 'peeked', player: self.owner, deck: 'location', count: next.length });
        ctx.queueFirst({
          t: 'choose', purpose: 'pickLocation', player: self.owner, source: nameOf(ctx, self.card),
          prompt: "The Society's Maps: swap the current location for one of these?",
          options: [
            ...next.map((c, i) => {
              const d = ctx.def(c);
              return { value: `n${i}`, label: `Swap in ${d.name} (Renown ${d.kind === 'location' ? d.renown : '?'})`, card: { def: d.id } };
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
    on: { minionDrawn: (ctx, self) => drawFor(ctx, self) },
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
  // Oskar: at the start of bidding, name an opponent; if they win this encounter they carry -3 into the next one.
  'loremaster-oskar-grimgate': {
    status: 'full',
    on: { encounterEntered: encounterEntered('Oathbreaker') },
    activations: [{
      id: 'grudge', label: 'Name an opponent: if they win this encounter they have -3 in the next', windows: ['beforeBidding'], per: 'turn',
      canUse: (ctx, self) => others(ctx, self).length > 0,
      use: (ctx, self) => ctx.queueFirst({
        t: 'choose', purpose: 'oskarGrudge', player: self.owner, source: nameOf(ctx, self.card),
        prompt: 'Entered in the Grudge Book: choose an opponent. If they win this encounter they have -3 during the next one.',
        options: others(ctx, self).map((p) => ({ value: p.id, label: p.name })), min: 1, max: 1, data: { source: self.card },
      }),
    }],
  },

  // Companions
  // Goldie: once per turn, look at one of another player's face-down bids at random.
  'goldie-trickgrin-keeper-of-the-goose-and-kettle': {
    status: 'full', pair: 'gimlet-a-very-good-dog',
    activations: [{
      id: 'rumour', label: "Look at a random face-down card another player has bid", windows: ['bidding'], per: 'turn',
      canUse: (ctx, self) => others(ctx, self).some((p) => p.bids.some((b) => !b.visible)),
      use: (ctx, self) => {
        const hidden = others(ctx, self).flatMap((p) => p.bids.filter((b) => !b.visible).map((b) => ({ p, b })));
        if (!hidden.length) return;
        const { p, b } = hidden[nextInt(ctx.s.rng, hidden.length)]!;
        ctx.queueFirst({
          t: 'choose', purpose: 'rumourMill', player: self.owner, source: nameOf(ctx, self.card),
          prompt: `Rumour Mill: one of ${p.name}'s face-down cards is ${nameOf(ctx, b.card)}.`,
          options: [peekOption(ctx, 'seen', b.card, `${p.name}'s card is ${nameOf(ctx, b.card)}`), { value: 'done', label: 'Got it' }],
          min: 1, max: 1,
        });
      },
    }],
  },
  // Gimlet: swap a card from your hand with the top card of the resource discard pile.
  'gimlet-a-very-good-dog': {
    status: 'full', pair: 'goldie-trickgrin-keeper-of-the-goose-and-kettle', encounterBonus: { def: 'destiny-the-frog', amount: 1 },
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
  // Torvi: a one-shot. Discard him at the end of bidding and every opponent loses 4 (5 with Mhorgrim's Hunt).
  'torvi-cinderkeg-master-gunner': {
    status: 'full',
    activations: [{
      id: 'fire', label: 'Discard Torvi: every opponent has -4 (-5 with Mhorgrim\'s Hunt) this encounter', windows: ['endOfBidding'], per: 'turn',
      canUse: (ctx, self) => others(ctx, self).length > 0,
      use: (ctx, self) => {
        const p = ctx.player(self.owner);
        const hunt = p.bids.some((b) => b.visible && ctx.defId(b.card) === 'mhorgrims-hunt');
        const amount = hunt ? 5 : 4;
        discardCompanion(ctx, p, self.card, 'Fire in the Hole');
        for (const o of others(ctx, self)) addEffect(ctx, { kind: 'statBonus', source: self.card, owner: p.id, target: o.id, stat: 'all', amount: -amount });
        ctx.log(p.id, nameOf(ctx, self.card), `Fire in the Hole! Every opponent has -${amount}`);
      },
    }],
  },
  'moss-dire-wolf': { status: 'full', pair: 'varg-ironjaw' },
  'hesk-of-two-homes': { status: 'full', reuseCompanionAbility: true },
  'tova-emberdeep-keeper-of-the-underway-door': {
    status: 'full', restReturnDraw: true,
    activations: [{
      id: 'rest', label: 'Rest this turn (no stats); draw two extra cards on your next turn', windows: ['beforeBidding'], per: 'turn',
      use: (ctx, self) => {
        const p = ctx.player(self.owner);
        p.companions = p.companions.filter((c) => c !== self.card);
        p.resting.push(self.card);
        ctx.emit({ type: 'companionFaceDown', player: p.id, card: ctx.ref(self.card), faceDown: true });
      },
    }],
  },
  // Varg: at the start of your turn, a resource for every other Orc in your party.
  'varg-ironjaw': {
    status: 'full', pair: 'moss-dire-wolf', partnerBonus: { with: 'sigrun-stonefast-metal-singer', amount: 1 },
    on: {
      turnStart: (ctx, self, e) => {
        if (e.player !== self.owner) return;
        const orcs = ctx.player(self.owner).companions.filter((c) => c !== self.card && kingdomsOf(ctx.def(c)).includes('Orc')).length;
        if (orcs > 0) drawFor(ctx, self, orcs);
      },
    },
  },
  // Tansy: at the start of her controller's turn, a resource for every Goose in play anywhere.
  'tansy-brambleby-barmaid-and-volunteer': {
    status: 'full',
    on: {
      turnStart: (ctx, self, e) => {
        if (e.player !== self.owner) return;
        const geese = companionsInPlay(ctx).filter((c) => hasGroup(ctx.def(c.card), 'Goose')).length;
        if (geese > 0) drawFor(ctx, self, geese);
      },
    },
  },
  'fennick-puffcap-mycomancer': { status: 'full', on: { statForced: firstForcedStat('spore') } },
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
  'marshal-hedda-ironvow': { status: 'full', holdTheLine: true },
  'pell-quillon-collegium-prodigy': { status: 'full', multiBidBonus: { cards: 2, bonus: 2 } },
  'nettle-burrows-trouble-maker': { status: 'full', selfStatSub: 'G' },
  'sister-aurelie-dane-physician': { status: 'full', selfStatSub: 'M' },
  'gnash-the-butcher-of-bloodmire': { status: 'full', selfStatSub: 'P' },
  'sigrun-stonefast-metal-singer': { status: 'full', drawFromDiscardChoice: true, partnerBonus: { with: 'varg-ironjaw', amount: 1 } },
  'liriel-nightbloom': forceCompanion('G'),
  'thessaly-of-the-grove': forceCompanion('M'),
  'kesh-the-bog-huntress': { ...forceCompanion('P'), on: { encounterEntered: encounterEntered('Beast') } },
  'mags-tolliver-market-trader': {
    status: 'full',
    activations: [{
      id: 'queen', label: "Double your hero's stats this encounter (Mags is then discarded)", windows: ['endOfBidding'], per: 'turn',
      use: (ctx, self) => addEffect(ctx, { kind: 'heroMultiplier', source: self.card, owner: self.owner, target: self.owner, amount: 2 }),
    }],
  },
  'hobart-thimblewick-moot-surgeon': forceHero('G'),
  'caelan-the-exile': forceHero('M'),
  'elowen-leafwatch-treetop-warden': {
    status: 'full',
    activations: [{
      id: 'readAhead', label: 'Look at the top card of any stack; you may bottom it', windows: ['turnStart', 'afterLocation', 'beforeBidding', 'bidding'], per: 'turn',
      canUse: (ctx) => DECKS.some((d) => ctx.s.decks[d].length > 0),
      use: (ctx, self) => ctx.queueFirst({
        t: 'choose', purpose: 'wrenStack', player: self.owner, source: nameOf(ctx, self.card),
        prompt: "I've Read Ahead: which stack do you look at?",
        options: DECKS.filter((d) => ctx.s.decks[d].length > 0).map((d) => ({ value: d, label: `${d[0]!.toUpperCase()}${d.slice(1)} stack` })),
        min: 1, max: 1,
      }),
    }],
  },
  'sir-osric-vane-marshal-of-the-old-guard': { status: 'full', heroStatSub: 'G', heroSubBonus: 1 },
  'rosalind-marchwell-marchguard-clerk': { status: 'full', heroStatSub: 'M', heroSubBonus: 1 },
  'brisa-blastcap-bombardier': forceHero('P'),
  'dagny-coldhearth-the-grudge-bearer': {
    status: 'full',
    activations: [{
      id: 'stonetouched', label: 'Win this location outright; discard your hand and your hero falls (once per game)', windows: ['endOfBidding'], per: 'game',
      canUse: (ctx) => Boolean(ctx.s.turn.location),
      use: (ctx, self) => addEffect(ctx, { kind: 'autoWin', source: self.card, owner: self.owner, target: self.owner }),
    }],
  },
  // Seraphine: when one of your companions is replaced or discarded, draw a resource.
  'seraphine-moonveil-warden-scholar': {
    status: 'full',
    on: { companionLeft: (ctx, self, e) => { if (e.player === self.owner && e.card !== self.card) drawFor(ctx, self); } },
  },
  'honk-the-goose-rout-veteran': honk,
  'duchess-the-pub-goose': duchess,
  'sergeant-waddle': waddle,
  'cobra-chicken': cobra,
  'elder-ilvena-of-the-conclave': {
    status: 'full',
    activations: [{
      id: 'ruling', label: 'Force an opposing companion to use its weakest stat', windows: ['beforeBidding'], per: 'turn',
      canUse: (ctx, self) => opposingCompanions(ctx, self).length > 0,
      use: (ctx, self) => {
        const p = ctx.player(self.owner);
        ctx.queueFirst({
          t: 'choose', purpose: 'rulingCompanion', player: p.id, source: nameOf(ctx, self.card),
          prompt: "Ruling of the Conclave: choose another player's companion to use its weakest stat",
          options: (() => {
            const list = opposingCompanions(ctx, self);
            return highlightWorst(list.map(({ c, p: o }) => cardOption(ctx, c, `${shortName(ctx, c)} (${o.name})`)), list.map(({ c, p: o }) => forceLoss(ctx, c, o, 'weakest')));
          })(),
          min: 1, max: 1, data: { source: self.card },
        });
      },
    }],
  },
  // Mogra: when you win a location, draw a resource.
  'mogra-swiftfoot-goblin-runner': {
    status: 'full',
    on: { locationWon: (ctx, self, e) => { if (e.player === self.owner) drawFor(ctx, self); } },
  },
  // Tobin: once per turn before bidding, reveal three companions; a Goose among them may join you, the rest are discarded.
  'tobin-quill-goose-keeper': {
    status: 'full',
    activations: [{
      id: 'flock', label: 'Reveal the top 3 companions; you may put a Goose among them into play, the rest are discarded', windows: ['beforeBidding'], per: 'turn',
      canUse: (ctx) => ctx.s.decks.companion.length + ctx.s.discards.companion.length > 0,
      use: (ctx, self) => {
        const t = ctx.s.turn;
        const revealed = revealTop(ctx, self.owner, 'companion', 3 + extraReveals(ctx, self.owner), nameOf(ctx, self.card));
        const geese = revealed.filter((c) => hasGroup(ctx.def(c), 'Goose'));
        if (!geese.length) {
          for (const c of revealed) ctx.discard('companion', c);
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
  'grumma-ladlejaw-camp-cook': forceHero('P', 'own'),

  // Locations
  'the-waystone-inn-rivermeet': {
    status: 'full',
    onEnter: (ctx, self) => {
      if (ctx.s.decks.companion.length + ctx.s.discards.companion.length === 0) return;
      for (const p of ctx.clockwise()) {
        ctx.queue({
          t: 'choose', purpose: 'waystoneDraw', player: p.id, source: nameOf(ctx, self.card),
          prompt: 'The Waystone Inn: draw a companion into play (then discard one of your companions)?',
          options: [{ value: 'draw', label: 'Draw a companion' }, { value: 'skip', label: 'No thanks' }], min: 1, max: 1,
        });
      }
    },
  },
  'the-frostfells': { status: 'full', groupBoost: { group: 'Frostborn', amount: 2 }, onEnter: (ctx) => searchForEncounter(ctx, 'Frostborn') },
  'the-barrowlands': groupBoost('Undead'),
  'the-heart-of-the-marchstone': groupBoost('Oathbreaker'),
  'the-mirror-marches': groupBoost('Ironbound'),
  'wreck-of-the-skyship-gallant': { status: 'full', groupBoost: { group: 'Gargoyle', amount: 2 }, onEnter: (ctx) => searchForEncounter(ctx, 'Gargoyle') },
  'tomb-of-the-first-wardens': { status: 'full', challengeStat: 'G' },
  'the-silverwood-hunt': { status: 'full', challengeStat: 'P' },
  'the-memory-of-the-heartwood': { status: 'full', challengeStat: 'M' },
  'the-speaking-stones': { status: 'full', minionBonus: 1 },
  'the-old-quarry': { status: 'full' }, // "All" group handled by hasGroup()
  'the-storybook-glade': {
    status: 'full',
    onEnter: (ctx, self) => {
      for (const p of ctx.clockwise()) {
        if (p.companions.length === 0) continue;
        ctx.queue({ t: 'choose', purpose: 'faceDownCompanion', player: p.id, prompt: 'The Storybook Glade: choose a companion to turn face down', options: p.companions.map((c) => cardOption(ctx, c)), min: 1, max: 1, source: nameOf(ctx, self.card) });
      }
    },
  },
  'the-endless-road': { status: 'full', onEnter: (ctx) => addExtraLocation(ctx) },
  'sylvaneth': drawPerKin('Elf'),
  'grimgate': drawPerKin('Dwarf'),
  'gorewatch': drawPerKin('Orc'),
  'hearthmeadow': drawPerKin('Halfellow'),
  'barrowdeep': { status: 'full', extraMinion: 'Undead' },
  'the-crack-in-the-marchstone': {
    status: 'full',
    onEnter: (ctx, self) => {
      for (const p of ctx.clockwise()) {
        if (p.companions.length === 0) continue;
        ctx.queue({ t: 'choose', purpose: 'discardCompanion', player: p.id, prompt: 'The Crack in the Marchstone: discard a companion', options: p.companions.map((c) => cardOption(ctx, c)), min: 1, max: 1, source: nameOf(ctx, self.card) });
      }
      ctx.queue({ t: 'replaceLocation', mode: 'shuffleBack', source: nameOf(ctx, self.card) });
    },
  },
  'the-wardens-hall': drawPerOwn((ctx, p) =>
    (hasGroup(ctx.def(p.hero), 'Warden') ? 1 : 0) + p.companions.filter((c) => hasGroup(ctx.def(c), 'Warden')).length),
  'the-mage-college-vaults': drawPerOwn((ctx, p) => p.companions.filter((c) => hasGroup(ctx.def(c), 'Collegium')).length),
  'marchguard-keep': drawPerOwn((ctx, p) => p.companions.filter((c) => hasGroup(ctx.def(c), 'Marchguard')).length),
  'the-goose-and-kettle': drawPerOwn((ctx, p) => p.companions.filter((c) => ctx.defId(c) === 'goldie-trickgrin-keeper-of-the-goose-and-kettle').length),
  'the-hollow-hills': { status: 'full' }, // ability die inversion handled in effects.abilityRoll
  'parting-strand': {
    status: 'full',
    on: {
      locationWon: (ctx, self, e) => {
        if (ctx.s.turn.location !== self.card) return;
        const p = ctx.player(e.player);
        if (p.companions.length === 0) return;
        ctx.queue({ t: 'choose', purpose: 'discardCompanion', player: p.id, prompt: 'Parting Strand: discard a companion', options: p.companions.map((c) => cardOption(ctx, c)), min: 1, max: 1, source: nameOf(ctx, self.card) });
      },
    },
  },
  'the-last-field': {
    status: 'full',
    onEnter: (ctx, self) => {
      for (const p of ctx.clockwise()) {
        if (p.hand.length === 0) continue;
        ctx.queue({ t: 'choose', purpose: 'discardResource', player: p.id, prompt: 'The Last Field: discard a resource card', options: p.hand.map((c) => cardOption(ctx, c)), min: 1, max: 1, source: nameOf(ctx, self.card) });
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
  'destiny-the-frog': { status: 'full', minionValueWith: { group: 'Skarra', value: 3 }, shuffleBackAsMinion: true },
  'runeforged-titan': { status: 'full', difficultyByStat: { M: 10, G: 10 } },
  'iron-mites': {
    status: 'full',
    note: 'The player whose resource card is lowest gives up one of their own companions as a minion.',
    on: {
      encounterEntered: (ctx, self, e) => {
        if (e.card !== self.card) return;
        // Every player with a companion turns up the top resource card; the lowest value gives up a companion
        // (ties draw again). The cards turned up are discarded.
        let rollers = ctx.clockwise().filter((p) => p.companions.length > 0);
        let guard = 0;
        while (rollers.length > 1 && guard++ < 20) {
          const draws = rollers.map((p) => {
            const c = revealTop(ctx, p.id, 'resource', 1, 'Iron Mites')[0] ?? null;
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
          t: 'choose', purpose: 'companionMinion', player: loser.id, source: 'Iron Mites',
          prompt: 'Iron Mites: choose one of your companions to join the encounter as a minion',
          options: loser.companions.map((c) => cardOption(ctx, c)), min: 1, max: 1,
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
  'call-the-five-crowns': council(5),
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
  'the-hall-of-rest': { status: 'full' }, // flow.ts: resolve marks, heroFalls lets you choose
  'the-gathering-of-heroes': {
    status: 'full',
    onReveal: (ctx, self) => {
      for (const p of ctx.clockwise()) if (p.bids.length > 0) councilHeroes(ctx, p.id, 1, nameOf(ctx, self.card));
    },
  },
  'torch-and-tinder': valueAgainst(['Wicker'], 5),
  'gold-filings': valueAgainst(['Ironbound'], 5),
  'rune-of-unmaking': valueAgainst(['Construct', 'Ironbound'], 5),
  'warding-nail': valueAgainst(['Ironbound'], 5),
  'cold-iron-barrier': { status: 'full', onReveal: (ctx) => { ctx.s.turn.wandsDisabled = true; } },
  'null-rune-seal': { status: 'full', onReveal: (ctx) => { ctx.s.turn.wandsDisabled = true; } },
  'the-amulet-of-aesia': { status: 'full' }, // handled in flow.ts at resolution
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
    resourceValue: (ctx, _owner, base) => base + 2 * companionsInPlay(ctx).filter((c) => hasGroup(ctx.def(c.card), 'Goose')).length,
  },
  'the-rosepearl': {
    status: 'full',
    resourceValue: (ctx) => Math.max(0, ...companionsInPlay(ctx).map((c) => {
      const d = ctx.def(c.card);
      return d.kind === 'companion' ? d.stats.M : 0;
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
    resourceValue: (ctx, owner, base) => base + (owner.hero && ctx.defId(owner.hero) === 'loremaster-oskar-grimgate' ? 1 : 0),
  },
  'skarras-hexwand': { status: 'full' },
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

// --- Kin bonuses (see docs/KINGDOM-REDESIGN.md) --------------------------------------
//   A: +1 to all your hero's stats for each companion of its kingdom you control (totals.ts)
//   B: when a companion of its kingdom enters play under any player's control, draw a resource
//   C: while an opponent controls a companion of its kingdom, that companion gets -1 to all stats (totals.ts)
export const KIN: Record<string, 'A' | 'B' | 'C'> = {
  'queen-maren-ashcroft': 'B', 'lord-paladin-aldric-ashcroft': 'A', 'archmage-corvin-varro': 'B',
  'aelthir-moonveil': 'B', 'ysolde-of-the-wellspring': 'A', 'lord-vaelis-nightbloom': 'C',
  'high-thane-brunna-stonefast': 'A', 'kazra-emberdeep': 'B', 'thorgar-twice-buried': 'C', 'loremaster-oskar-grimgate': 'C',
  'warchief-grukka-ironjaw': 'A', 'urzha-half-tusk': 'C',
  'professor-barnaby-pickwort': 'B', 'mayor-hobby-trickgrin': 'C', 'pip-wanderfoot': 'A',
};
for (const [id, kin] of Object.entries(KIN)) {
  const a = ABILITIES[id];
  if (!a) throw new Error(`abilities.ts: no ability for kin hero ${id}`);
  a.kin = kin;
  if (kin === 'B') {
    const prev = a.on?.companionEntered;
    a.on = {
      ...a.on,
      companionEntered: (ctx, self, e) => {
        prev?.(ctx, self, e);
        if (self.owner && sharesKingdom(ctx.def(self.card), ctx.def(e.card))) drawFor(ctx, self);
      },
    };
  }
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
  const hasText = d.kind === 'hero' || d.kind === 'companion' ? Boolean(d.abilityText)
    : d.kind === 'location' || d.kind === 'encounter' || d.kind === 'resource' ? Boolean(d.conditionText)
    : false;
  if (d.kind === 'encounter' && d.minions.count > 0 && /minion/.test(d.conditionText ?? '')) return 'full';
  return hasText ? 'todo' : 'vanilla';
}

export function statusReport(): Record<CardStatus, string[]> {
  const out: Record<CardStatus, string[]> = { full: [], partial: [], todo: [], vanilla: [] };
  for (const list of [CARDS.heroes, CARDS.companions, CARDS.locations, CARDS.encounters, CARDS.resources]) {
    for (const c of list) out[cardStatus(c.id)].push(c.id);
  }
  return out;
}
