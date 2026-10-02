// Per-player views and event redaction.
//
// SECURITY: views are built by ALLOWLIST. Each field below is copied on
// purpose; a new field in GameState is never exposed unless it's added here.
// Hidden cards (other hands, face-down bids, deck contents, the drawn-but-
// undecided companion, face-down bonus locations) are represented by counts
// or placeholders WITHOUT ids, so ids can't be used to track them.
// Peeked cards (Grukka, Barnaby, Wren, The Hall of Rest) are shown only to
// the chooser, by definition, never by instance id. A choice's `data` holds
// secret context and is never copied. The RNG state and the instance->card
// map never leave the engine.

import { cardStatus } from './abilities';
import type { Stat } from './cardTypes';
import { Ctx } from './context';
import { isIgnored, maxCompanions } from './effects';
import { challengeStat, currentChallenge, difficultyFor, resourceValue, totalFor, visibleTo, type DifficultyBreakdown } from './totals';
import {
  DECKS, type AbilityWindow, type CardId, type CardRef, type ChoiceOption, type ChoosePurpose, type DeckName, type EffectKind,
  type GameEvent, type GameState, type HoldReason, type PlayerId, type Step, type TurnResult,
} from './types';

export type BidView = { hidden: true } | { hidden: false; card: CardRef; faceUp: boolean };

export interface PlayerPublicView {
  id: PlayerId;
  name: string;
  seat: number;
  /** Null only during the opening hero draft. */
  hero: CardRef | null;
  companions: CardRef[];
  inactiveCompanions: CardRef[];
  resting: CardRef[];
  maxCompanions: number;
  handCount: number;
  claimed: CardRef[];
  renown: number;
  bids: BidView[];
  councilHeroes: CardRef[];
  statOverride: Stat | null;
  /** Total computed only from what the viewer can see. */
  projection: { stat: Stat; total: number; difficulty: number; hiddenBids: number } | null;
}

export interface EffectView {
  id: number;
  kind: EffectKind;
  source: CardRef;
  owner: PlayerId;
  /** Player the effect applies to (for card targets, the card's controller). */
  targetPlayer: PlayerId | null;
  targetCard: CardRef | null;
  stat: Stat | 'all' | null;
  amount: number | null;
  /** False if its source has been disabled (Aldric). */
  active: boolean;
  /** True if the target's hero shrugs it off (Brunna). */
  ignored: boolean;
}

export interface AbilityOptionView { source: CardRef; ability: string; label: string }

export interface PendingView {
  id: number;
  player: PlayerId;
  kind: 'companion.offer' | 'companion.place' | 'bid' | 'activate' | 'choose';
  /** Present only for the deciding player. */
  detail?:
    | { kind: 'companion.offer' }
    | { kind: 'companion.place'; drawn: CardRef; mustReplace: boolean }
    | { kind: 'bid'; faceUp: boolean; canFaceDown: boolean; abilities: AbilityOptionView[] }
    | { kind: 'activate'; window: AbilityWindow; abilities: AbilityOptionView[] }
    | { kind: 'choose'; purpose: ChoosePurpose; source: string; prompt: string; options: ChoiceOption[]; min: number; max: number };
}

/** House rules every player may know. */
export interface PublicRules {
  renownToWin: number;
  fallCost: boolean;
  heroDraft: number;
  handModel: 'refill' | 'steady';
  activeDraw: number;
  othersDraw: number;
  handLimit: number;
  drawSize: number;
}

export interface GameView {
  you: PlayerId | null;
  version: number;
  rules: PublicRules;
  players: PlayerPublicView[];
  turn: {
    number: number;
    active: PlayerId;
    step: Step;
    location: CardRef | null;
    extraLocations: number;
    encounter: CardRef | null;
    minions: CardRef[];
    companionMinions: CardRef[];
    setAside: CardRef[];
    challenge: { stat: Stat; difficulty: DifficultyBreakdown } | null;
    bidder: PlayerId | null;
    wandsDisabled: boolean;
    effects: EffectView[];
    result: TurnResult | null;
  };
  decks: Record<DeckName, number>;
  discards: Record<DeckName, { count: number; top: CardRef | null }>;
  pending: PendingView | null;
  /** Your hand, with each card's value if you bid it now. Empty for spectators. */
  hand: { card: CardRef; value: number }[];
  winner: PlayerId | null;
  /** Paused at a presentation checkpoint. */
  hold: HoldReason | null;
}

function ownerOfCard(state: GameState, card: CardId): PlayerId | null {
  for (const p of state.players) {
    if (p.hero === card || p.companions.includes(card) || p.inactiveCompanions.includes(card) || p.resting.includes(card) || p.bids.some((b) => b.card === card)) return p.id;
  }
  return null;
}

export function viewFor(state: GameState, viewer: PlayerId | null): GameView {
  const ctx = new Ctx(state);
  const ref = (c: CardId): CardRef => ctx.ref(c);
  const vis = visibleTo(viewer);
  const t = state.turn;
  const me = viewer ? state.players.find((p) => p.id === viewer) ?? null : null;

  const players: PlayerPublicView[] = state.players.map((p, seat) => {
    const tb = t.encounter !== null ? totalFor(ctx, p, vis) : null;
    const diff = t.encounter !== null ? difficultyFor(ctx, p) : null;
    return {
      id: p.id,
      name: p.name,
      seat,
      hero: p.hero ? ref(p.hero) : null,
      companions: p.companions.map(ref),
      inactiveCompanions: p.inactiveCompanions.map(ref),
      resting: p.resting.map(ref),
      maxCompanions: maxCompanions(ctx, p),
      handCount: p.hand.length,
      claimed: p.claimed.map(ref),
      renown: p.renown,
      bids: p.bids.map((b): BidView => (vis(p, b) ? { hidden: false, card: ref(b.card), faceUp: b.visible } : { hidden: true })),
      councilHeroes: p.councilHeroes.map(ref),
      statOverride: p.statOverride,
      projection: tb && diff ? { stat: tb.stat, total: tb.total, difficulty: diff.total, hiddenBids: tb.hiddenBids } : null,
    };
  });

  const disabled = new Set(t.effects.filter((e) => e.kind === 'disableAbilities').map((e) => e.target));
  const effects: EffectView[] = t.effects.map((e) => {
    const cardTarget = e.kind === 'forceHeroStat' || e.kind === 'statBonus' || e.kind === 'heroMultiplier' || e.kind === 'autoWin' ? null : e.target;
    return {
      id: e.id, kind: e.kind, source: ref(e.source), owner: e.owner,
      targetPlayer: cardTarget ? ownerOfCard(state, cardTarget) : e.target,
      targetCard: cardTarget && state.cards[cardTarget] !== undefined ? ref(cardTarget) : null,
      stat: e.stat ?? null, amount: e.amount ?? null,
      active: e.kind === 'disableAbilities' || !disabled.has(e.source),
      ignored: isIgnored(ctx, e),
    };
  });

  const abilityViews = (xs: { source: CardId; ability: string; label: string }[]): AbilityOptionView[] =>
    xs.map((a) => ({ source: ref(a.source), ability: a.ability, label: a.label }));

  const ch = currentChallenge(ctx);
  const d = state.pending;
  let pending: PendingView | null = null;
  if (d) {
    pending = { id: d.id, player: d.player, kind: d.kind };
    if (d.player === viewer) {
      switch (d.kind) {
        case 'companion.offer': pending.detail = { kind: d.kind }; break;
        case 'companion.place': pending.detail = { kind: d.kind, drawn: ref(d.drawn), mustReplace: d.mustReplace }; break;
        case 'bid': pending.detail = { kind: d.kind, faceUp: d.faceUp, canFaceDown: d.canFaceDown, abilities: abilityViews(d.abilities) }; break;
        case 'activate': pending.detail = { kind: d.kind, window: d.window, abilities: abilityViews(d.abilities) }; break;
        case 'choose':
          pending.detail = {
            kind: d.kind, purpose: d.purpose, source: d.source, prompt: d.prompt, min: d.min, max: d.max,
            // Copy options field by field: `value`, `label` and an optional card (def + id only if the engine included one).
            options: d.options.map((o) => ({
              value: o.value, label: o.label, ...(o.highlight ? { highlight: true } : {}),
              ...(o.card ? { card: { def: o.card.def, ...(o.card.id ? { id: o.card.id } : {}) } } : {}),
            })),
          };
          break;
      }
    }
  }

  const decks = {} as Record<DeckName, number>;
  const discards = {} as GameView['discards'];
  for (const k of DECKS) {
    decks[k] = state.decks[k].length;
    const pile = state.discards[k];
    discards[k] = { count: pile.length, top: pile.length ? ref(pile[pile.length - 1]!) : null };
  }

  return {
    you: me ? me.id : null,
    version: state.version,
    rules: {
      renownToWin: state.rules.renownToWin, fallCost: state.rules.fallCost, heroDraft: state.rules.heroDraft,
      handModel: state.rules.handModel, activeDraw: state.rules.activeDraw,
      othersDraw: state.rules.othersDraw, handLimit: state.rules.handLimit,
      drawSize: state.rules.drawSize === 'playerCount' ? state.players.length : state.rules.drawSize,
    },
    players,
    turn: {
      number: t.number,
      active: state.players[t.active]!.id,
      step: t.step,
      location: t.location ? ref(t.location) : null,
      extraLocations: t.extraLocations.length,
      encounter: t.encounter ? ref(t.encounter) : null,
      minions: t.minions.map(ref),
      companionMinions: t.companionMinions.map(ref),
      setAside: t.setAside.map(ref),
      challenge: ch ? { stat: challengeStat(ctx, null) ?? ch.stat, difficulty: difficultyFor(ctx, null)! } : null,
      bidder: t.step === 'bidding' ? state.players[t.bidder]?.id ?? null : null,
      wandsDisabled: t.wandsDisabled,
      effects,
      result: t.result ? structuredClone(t.result) : null,
    },
    decks,
    discards,
    pending,
    hand: me ? me.hand.map((c) => ({ card: ref(c), value: resourceValue(ctx, me, c) })) : [],
    winner: state.winner,
    hold: state.hold,
  };
}

// --- events -----------------------------------------------------------------

/** Events as a particular viewer may see them. */
export type ClientEvent =
  | Exclude<GameEvent, { type: 'drew' } | { type: 'bid' } | { type: 'cardsTraded' }>
  | { type: 'drew'; player: PlayerId; deck: DeckName; count: number; cards?: CardRef[]; reason: string }
  | { type: 'bid'; player: PlayerId; faceUp: boolean; card?: CardRef }
  | { type: 'cardsTraded'; from: PlayerId; to: PlayerId; gave?: CardRef; got?: CardRef };

/**
 * Every event type must be classified. The compiler rejects a new event type
 * until someone decides whether it is public, so nothing leaks by default.
 */
const EVENT_POLICY: Record<GameEvent['type'], 'public' | 'redact'> = {
  gameStarted: 'public', turnStarted: 'public', shuffled: 'public', heroChanged: 'public',
  companionPlayed: 'public', companionDiscarded: 'public', companionDeclined: 'public',
  companionSkipped: 'public', companionFaceDown: 'public', companionMinion: 'public', locationRevealed: 'public',
  locationReplaced: 'public', extraLocation: 'public', encounterRevealed: 'public', encounterReplaced: 'public',
  minionDrawn: 'public', dieRolled: 'public', challengeSelected: 'public', passed: 'public',
  revealed: 'public', resourceDiscarded: 'public', councilHero: 'public', ability: 'public',
  abilityUsed: 'public', abilityCountered: 'public', abilityZap: 'public', abilityIgnored: 'public', effect: 'public', effectCancelled: 'public', cardShown: 'public',
  peeked: 'public', bottomed: 'public', bidClaimed: 'public', bidsSwapped: 'public',
  outcome: 'public', renownGained: 'public', fallPrevented: 'public', heroFalls: 'public',
  turnEnded: 'public', gameOver: 'public',
  drew: 'redact', bid: 'redact', cardsTraded: 'redact',
};

export function redactEvents(events: GameEvent[], viewer: PlayerId | null): ClientEvent[] {
  const out: ClientEvent[] = [];
  for (const e of events) {
    const policy = Object.prototype.hasOwnProperty.call(EVENT_POLICY, e.type) ? EVENT_POLICY[e.type] : undefined;
    if (policy === 'public') {
      // Copy so callers can't mutate engine-owned objects.
      out.push(structuredClone(e) as ClientEvent);
      continue;
    }
    if (e.type === 'drew') {
      out.push(e.player === viewer
        ? { type: 'drew', player: e.player, deck: e.deck, count: e.cards.length, cards: structuredClone(e.cards), reason: e.reason }
        : { type: 'drew', player: e.player, deck: e.deck, count: e.cards.length, reason: e.reason });
    } else if (e.type === 'bid') {
      out.push(e.faceUp || e.player === viewer
        ? { type: 'bid', player: e.player, faceUp: e.faceUp, card: { ...e.card } }
        : { type: 'bid', player: e.player, faceUp: false });
    } else if (e.type === 'cardsTraded') {
      // Only the two players involved see which cards changed hands.
      out.push(viewer === e.from || viewer === e.to
        ? { type: 'cardsTraded', from: e.from, to: e.to, gave: { ...e.gave }, got: { ...e.got } }
        : { type: 'cardsTraded', from: e.from, to: e.to });
    }
    // Anything else is dropped (fail closed).
  }
  return out;
}

/** Implementation status per card, for the "not yet implemented" badge. */
export { cardStatus };
