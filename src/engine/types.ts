// Core engine types.
//
// SECURITY MODEL
// - GameState is the authoritative, SECRET server state (it includes the RNG
//   state and every hidden card). It must never be sent to a client.
// - Clients receive a PlayerView built by view.ts, which uses an allowlist:
//   a field only reaches a client if view.ts explicitly copies it.
// - Clients send Commands. They are untrusted JSON and are validated by
//   commands.ts before the engine looks at them. The acting seat is never
//   taken from the command; the host supplies it from the authenticated
//   connection.

import type { Stat } from './cardTypes';
import type { RngState } from './rng';
import type { HouseRules } from './rules';

/** Seat identifier assigned by the host (e.g. "p0"). Never chosen by a client. */
export type PlayerId = string;
/** Opaque per-game card instance id. Hidden cards are never shown to clients with their id. */
export type CardId = string;

/** A player's hero slot before the opening hero draft has filled it. */
export const NO_HERO: CardId = '';

export type DeckName = 'hero' | 'companion' | 'location' | 'encounter' | 'resource';
export const DECKS: readonly DeckName[] = ['hero', 'companion', 'location', 'encounter', 'resource'];

export interface Bid {
  card: CardId;
  /** Played face up (first bid) or revealed later. */
  visible: boolean;
  /** True once the card's reveal effects have been applied. */
  resolved: boolean;
  /** Played face up rather than face down. */
  playedFaceUp: boolean;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  hero: CardId;
  companions: CardId[];
  /** Companions turned face down by a location: no stats, no abilities. */
  inactiveCompanions: CardId[];
  /** Companions resting by their own ability (Tova): no stats, no abilities, back next turn. */
  resting: CardId[];
  hand: CardId[];
  claimed: CardId[];
  renown: number;
  bids: Bid[];
  /** Heroes borrowed through Council resources for this encounter. */
  councilHeroes: CardId[];
  /** Per-player challenge stat override set by resources (Arangil's Vision Glass, Blasting Powder). */
  statOverride: Stat | null;
  /** Persistent markers: once-per-game usage, pending card effects (e.g. "hallOfRest"). */
  used: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Turn effects: temporary modifiers created by abilities, cleared at the end
// of the turn. Each remembers its source so it can be countered (Aldric).

export type EffectKind =
  | 'silenceCompanion'   // target companion contributes no stats (Aelthir, failed goose roll)
  | 'forceCompanionStat' // target companion contributes `stat` instead (Liriel, Thessaly, Kesh)
  | 'forceHeroStat'      // target player's hero contributes `stat` instead (Hugo, Caelan, Brisa, Clemence)
  | 'statBonus'          // target player gains `amount` to `stat` ('all' = every stat) (Vaelis, geese)
  | 'heroMultiplier'     // target player's hero stats x `amount` (Mags)
  | 'negateBid'          // target bid's value counts negative (Oskar)
  | 'disableAbilities'   // target hero/companion's abilities are off this turn (Aldric)
  | 'autoWin';           // target player wins this encounter (Mira)

export interface TurnEffect {
  id: number;
  kind: EffectKind;
  /** Card whose ability created the effect. */
  source: CardId;
  /** Player controlling the source. */
  owner: PlayerId;
  /** Card id or player id, depending on kind. */
  target: string;
  stat?: Stat | 'all';
  amount?: number;
}

/** Points in the turn where players may use activated abilities. */
export type AbilityWindow = 'turnStart' | 'afterLocation' | 'beforeBidding' | 'bidding' | 'endOfBidding';

/** Presentation checkpoints (see flow.ts). */
export type HoldReason = 'encounter' | 'reveal' | 'resolve';

export type Step =
  | 'draft'
  | 'companionDraft'
  | 'turnStart'
  | 'winTurnStart'
  | 'companions'
  | 'location'
  | 'winAfterLocation'
  | 'encounter'
  | 'challenge'
  | 'winBeforeBidding'
  | 'bidding'
  | 'reveal'
  | 'winEndOfBidding'
  | 'resolve'
  | 'turnEnd'
  | 'gameOver';

export interface TurnResult {
  stat: Stat;
  rows: { player: PlayerId; total: number; difficulty: number; survived: boolean; stat: Stat }[];
  winner: PlayerId | null;
  margin: number | null;
  locations: CardId[];
  /** The winner took the location by a card effect (Mira) rather than by total. */
  byEffect?: string;
}

export interface TurnState {
  number: number;
  /** Seat index of the current player. */
  active: number;
  step: Step;
  /** Seat offset (from active) used while walking players in the companion phase and ability windows. */
  cursor: number;
  location: CardId | null;
  /** Face-down bonus locations (The Endless Road, The Pirate Fens). */
  extraLocations: CardId[];
  encounter: CardId | null;
  minions: CardId[];
  /** Companions put into play as minions (Iron Mites). */
  companionMinions: CardId[];
  /** Cards set aside by effects this turn, discarded at the end (Vaelis's encounter card). */
  setAside: CardId[];
  /** Companions recruited during the opening (turn 1) companion phase; their enter-play effects wait for its end. */
  openingEntrants: { player: PlayerId; card: CardId }[];
  /** Seat index whose bidding decision is next. */
  bidder: number;
  passesInARow: number;
  /** Seat index where the reveal round-robin continues. */
  revealCursor: number;
  wandsDisabled: boolean;
  noFalls: boolean;
  /** Players whose hero must fall at the end of this (their own) turn. */
  failed: PlayerId[];
  result: TurnResult | null;
  effects: TurnEffect[];
  effectSeq: number;
  /** Activated-ability uses this turn, keyed "cardId:abilityId". */
  used: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Decisions: the only points where the engine waits for a player.

interface DecisionBase {
  /** Monotonic id. A command must echo it, which rejects stale or replayed commands. */
  id: number;
  player: PlayerId;
}

/** An activated ability a player may use right now. */
export interface AbilityOption { source: CardId; ability: string; label: string }

export interface CompanionOfferDecision extends DecisionBase { kind: 'companion.offer' }
export interface CompanionPlaceDecision extends DecisionBase {
  kind: 'companion.place';
  drawn: CardId;
  /** At the companion limit, keeping the drawn card means replacing one. */
  mustReplace: boolean;
}
export interface BidDecision extends DecisionBase {
  kind: 'bid';
  faceUp: boolean;
  /** May play this (first) card face down anyway (Mayor Hobby). */
  canFaceDown: boolean;
  abilities: AbilityOption[];
}
export interface ActivateDecision extends DecisionBase {
  kind: 'activate';
  window: AbilityWindow;
  abilities: AbilityOption[];
}

/**
 * An option in a choice. `card` shows a card to the chooser; hidden cards
 * (peeks, the hero stack) are shown by definition only, never by instance id.
 */
export interface ChoiceOption {
  value: string;
  label: string;
  card?: { def: string; id?: CardId };
  /** Drawn attention to in the interface (e.g. the target an effect would hurt most). */
  highlight?: boolean;
}

export interface ChooseDecision extends DecisionBase {
  kind: 'choose';
  /** Which handler resolves this choice (see flow.ts applyChoice). */
  purpose: ChoosePurpose;
  /** Public name of the card or rule asking (e.g. "Liriel Nightbloom"). */
  source: string;
  prompt: string;
  options: ChoiceOption[];
  min: number;
  max: number;
  /** SECRET purpose-specific context. Never sent to clients. */
  data: Record<string, string | number>;
}

export type ChoosePurpose =
  | 'discardCompanion' | 'discardResource' | 'faceDownCompanion' | 'discardForCouncil'
  | 'silenceCompanion' | 'forceCompanion' | 'rulingCompanion' | 'forceHero' | 'disableAbility'
  | 'marenTarget' | 'marenGive' | 'pipClaim'
  | 'peekReplace' | 'pickLocation' | 'wrenStack' | 'wrenBottom'
  | 'counterAbility' | 'oskarNegate' | 'appleSwap'
  | 'hallOfRest' | 'gauntlet' | 'sigrunPick' | 'tobinPick' | 'waystoneDraw' | 'companionMinion'
  | 'heroDraft' | 'heroKeep' | 'companionDraft' | 'companionPick';

export type Decision = CompanionOfferDecision | CompanionPlaceDecision | BidDecision | ActivateDecision | ChooseDecision;

// ---------------------------------------------------------------------------
// Tasks: queued, serializable units of work (usually card effects that may
// need a player choice). Keeping them as data lets a server persist or
// replay a game mid-effect.

export type ChooseTask = {
  t: 'choose'; purpose: ChoosePurpose; player: PlayerId; prompt: string;
  options: ChoiceOption[]; min: number; max: number; source: string;
  data?: Record<string, string | number>;
};

export type Task =
  | ChooseTask
  | { t: 'replaceLocation'; mode: 'shuffleBack' | 'discard'; source: string }
  | { t: 'setLocation'; defId: string; source: string }
  /** A hero falls (run one at a time, so each new hero is drawn after the previous faller has chosen). */
  | { t: 'heroFalls'; player: PlayerId };

// ---------------------------------------------------------------------------

export interface GameState {
  schema: 1;
  rules: HouseRules;
  players: PlayerState[];
  decks: Record<DeckName, CardId[]>;
  discards: Record<DeckName, CardId[]>;
  /** Card instance id -> card definition id. SECRET: reveals hidden cards. */
  cards: Record<CardId, string>;
  turn: TurnState;
  tasks: Task[];
  pending: Decision | null;
  decisionSeq: number;
  /** Incremented after every accepted command; lets clients drop out-of-order updates. */
  version: number;
  /** When true, the flow pauses at presentation checkpoints so clients can follow along. */
  autoPause: boolean;
  /** Set while paused at a checkpoint; the host calls resume() to continue. */
  hold: HoldReason | null;
  winner: PlayerId | null;
  /** SECRET: never serialize to clients. */
  rng: RngState;
}

// ---------------------------------------------------------------------------
// Commands: untrusted client intents. Validated in commands.ts.

export type Command =
  | { type: 'companion.draw'; decision: number }
  | { type: 'companion.skip'; decision: number }
  | { type: 'companion.keep'; decision: number; replace: CardId | null }
  | { type: 'companion.discard'; decision: number }
  | { type: 'bid.play'; decision: number; card: CardId; faceDown?: boolean }
  | { type: 'bid.pass'; decision: number }
  | { type: 'ability.use'; decision: number; source: CardId; ability: string }
  | { type: 'ability.done'; decision: number }
  | { type: 'choose'; decision: number; picks: string[] };

export type CommandType = Command['type'];

// ---------------------------------------------------------------------------
// Events: what happened, for logs and animation. Each event is redacted per
// viewer by view.ts before leaving the engine.

export interface CardRef { id: CardId; def: string }

export type GameEvent =
  | { type: 'gameStarted'; players: PlayerId[] }
  | { type: 'turnStarted'; player: PlayerId; turn: number }
  | { type: 'drew'; player: PlayerId; deck: DeckName; cards: CardRef[]; reason: string }
  | { type: 'shuffled'; deck: DeckName }
  | { type: 'heroChanged'; player: PlayerId; from: CardRef | null; to: CardRef; reason: 'setup' | 'fell' }
  | { type: 'companionPlayed'; player: PlayerId; card: CardRef; replaced: CardRef | null }
  | { type: 'companionDiscarded'; player: PlayerId; card: CardRef; reason: string }
  | { type: 'companionDeclined'; player: PlayerId; card: CardRef }
  | { type: 'companionSkipped'; player: PlayerId }
  | { type: 'companionFaceDown'; player: PlayerId; card: CardRef; faceDown: boolean }
  | { type: 'companionMinion'; player: PlayerId; card: CardRef }
  | { type: 'locationRevealed'; card: CardRef; reason: string }
  | { type: 'locationReplaced'; from: CardRef; to: CardRef; reason: string }
  | { type: 'extraLocation'; count: number }
  | { type: 'encounterRevealed'; card: CardRef }
  | { type: 'encounterReplaced'; from: CardRef; reason: string }
  | { type: 'minionDrawn'; card: CardRef }
  | { type: 'dieRolled'; player: PlayerId | null; value: number; reason: 'tiebreak' | 'ability' | 'effect' }
  | { type: 'challengeSelected'; stat: Stat; difficulty: number }
  | { type: 'bid'; player: PlayerId; card: CardRef; faceUp: boolean }
  | { type: 'passed'; player: PlayerId; auto: boolean }
  | { type: 'revealed'; player: PlayerId; card: CardRef }
  | { type: 'resourceDiscarded'; player: PlayerId; card: CardRef; reason: string }
  | { type: 'councilHero'; player: PlayerId; card: CardRef }
  | { type: 'ability'; player: PlayerId | null; source: string; text: string }
  | { type: 'abilityUsed'; player: PlayerId; source: CardRef; ability: string; label: string }
  | { type: 'abilityCountered'; player: PlayerId; source: CardRef; by: CardRef }
  /** A card's ability reaches into a deck (or a discard pile) without being "used": Corvin's extra draw, Sigrun's choice. */
  | { type: 'abilityZap'; player: PlayerId; source: CardRef; deck: DeckName; pile: 'deck' | 'discard' }
  /** A hero's ability shrugged off an opponent's effect (Brunna). */
  | { type: 'abilityIgnored'; player: PlayerId; by: CardRef; source: CardRef; targetCard: CardRef | null }
  | { type: 'effect'; effect: TurnEffect; source: CardRef; targetCard: CardRef | null; targetPlayer: PlayerId | null }
  | { type: 'effectCancelled'; effectId: number }
  | { type: 'cardShown'; player: PlayerId | null; card: CardRef; reason: string }
  | { type: 'peeked'; player: PlayerId; deck: DeckName; count: number }
  | { type: 'bottomed'; player: PlayerId; deck: DeckName }
  | { type: 'bidClaimed'; from: PlayerId; to: PlayerId }
  | { type: 'bidsSwapped'; a: PlayerId; aCard: CardRef; b: PlayerId; bCard: CardRef }
  | { type: 'cardsTraded'; from: PlayerId; to: PlayerId; gave: CardRef; got: CardRef }
  | { type: 'outcome'; result: TurnResult }
  | { type: 'renownGained'; player: PlayerId; amount: number; total: number; locations: CardRef[] }
  | { type: 'fallPrevented'; player: PlayerId; source: string }
  | { type: 'heroFalls'; player: PlayerId }
  | { type: 'turnEnded'; player: PlayerId }
  | { type: 'gameOver'; winner: PlayerId | null };

export type GameEventType = GameEvent['type'];
