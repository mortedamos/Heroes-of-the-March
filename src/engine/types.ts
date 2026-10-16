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

export type DeckName = 'hero' | 'location' | 'encounter' | 'resource';
export const DECKS: readonly DeckName[] = ['hero', 'location', 'encounter', 'resource'];

export interface Bid {
  card: CardId;
  /** Played face up (first bid) or revealed later. */
  visible: boolean;
  /** True once the card's reveal effects have been applied. */
  resolved: boolean;
  /** Played face up rather than face down. */
  playedFaceUp: boolean;
  /** Turned face down again after the reveal (Brisa): it still counts, but as a flat 3, and no longer as a face-up card. */
  flipped?: boolean;
  /** Set when an opponent's curse was placed here: the player who placed it (so it is not "your bid"). */
  placedBy?: PlayerId;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  /** The adventuring party: face-up heroes in play. */
  party: CardId[];
  /** Heroes turned face down by a location: no stats, no abilities. */
  inactive: CardId[];
  /** Heroes resting by their own ability (Tova): no stats, no abilities, back next turn. */
  resting: CardId[];
  hand: CardId[];
  claimed: CardId[];
  renown: number;
  bids: Bid[];
  /** Face-down bids of other players this player has looked at this turn (Goldie): visible to them only. */
  seen: CardId[];
  /** Heroes borrowed through Council resources for this encounter. */
  borrowed: CardId[];
  /** Per-player challenge stat override set by resources (Arangil's Vision Glass, Blasting Powder). */
  statOverride: Stat | null;
  /** Persistent markers: once-per-game usage, pending card effects (e.g. "hallOfRest"). */
  used: Record<string, number>;
  /** Penalty to this player's total in the current encounter (the Grudge Book, The Book of Grudges). */
  penalty: number;
  /** Penalty that starts with the next encounter. */
  penaltyNext: number;
}

// ---------------------------------------------------------------------------
// Turn effects: temporary modifiers created by abilities, cleared at the end
// of the turn. Each remembers its source so it can be countered (Aldric).

export type EffectKind =
  | 'silenceHero'        // target hero contributes no stats (no card creates it now)
  | 'forceStat'          // target hero contributes `stat` instead (Liriel, Thessaly, Kesh, Ilvena)
  | 'statBonus'          // target player gains `amount` to `stat` ('all' = every stat) (Vaelis, geese)
  | 'negateBid'          // target bid's value counts as zero (no card uses it now)
  | 'grudge'             // target player: if they win this encounter they have -`amount` in the next (Oskar)
  | 'disableAbilities'   // target hero's abilities are off this turn (no card creates it now)
  | 'bidValue'           // target bid contributes `amount` instead of its value (Brisa)
  | 'facedown'           // target hero is turned face down this turn: no stats, no abilities, no Allied for its friends (Immobilizing Word)
  | 'autoWin';           // target player wins this encounter (Dagny)

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
export type AbilityWindow = 'turnStart' | 'afterLocation' | 'beforeBidding' | 'bidding' | 'beforeReveal' | 'endOfBidding';

/** Presentation checkpoints (see flow.ts). */
export type HoldReason = 'location' | 'encounter' | 'reveal' | 'resolve';

export type Step =
  | 'partyDraft'
  | 'turnStart'
  | 'winTurnStart'
  | 'recruit'
  | 'location'
  | 'winAfterLocation'
  | 'encounter'
  | 'challenge'
  | 'winBeforeBidding'
  | 'bidding'
  | 'winBeforeReveal'
  | 'reveal'
  | 'winEndOfBidding'
  | 'resolve'
  | 'turnEnd'
  | 'gameOver';

/** One line of a player's total at the end of an encounter: what each card added. */
export interface ResultPart {
  kind: 'hero' | 'council' | 'resource' | 'bonus' | 'penalty';
  /** The card it came from (so it can be pointed at on the table), if there is one. */
  card: CardRef | null;
  label: string;
  value: number;
}

export interface TurnResult {
  stat: Stat;
  rows: { player: PlayerId; total: number; difficulty: number; survived: boolean; stat: Stat; parts: ResultPart[] }[];
  winner: PlayerId | null;
  margin: number | null;
  locations: CardId[];
  /** Survivors level on the highest total: the location is discarded and each draws a new one at random. */
  tied?: PlayerId[];
  /** The winner took the location by a card effect (Mira) rather than by total. */
  byEffect?: string;
}

export interface TurnState {
  number: number;
  /** Seat index of the current player. */
  active: number;
  step: Step;
  /** Seat offset (from active) used while walking players in the recruit phase and ability windows. */
  cursor: number;
  location: CardId | null;
  /** Face-down bonus locations (The Endless Road, The Pirate Fens). */
  extraLocations: CardId[];
  encounter: CardId | null;
  minions: CardId[];
  /** Heroes put into play as minions (Infectious Zombie). */
  heroMinions: CardId[];
  /** Cards set aside by effects this turn, discarded at the end (Vaelis's encounter card). */
  setAside: CardId[];
  /** A location waiting for a player to answer a counter (Walls First): it replaces the current one unless it is countered. */
  pendingLocation: CardId | null;
  /** The location's own rules text is being ignored this turn (Barnaby's maps): its Renown and tags still count. */
  locationIgnored: boolean;
  /** An encounter found by a location's search (The Frostfells, Wreck of the Skyship Gallant): it is this turn's encounter. */
  chosenEncounter: CardId | null;
  /** Heroes chosen in the opening party draft; their enter-play effects wait for the end of the opening phase. */
  openingEntrants: { player: PlayerId; card: CardId }[];
  /** Seat index whose bidding decision is next. */
  bidder: number;
  passesInARow: number;
  /** Seat index where the reveal round-robin continues. */
  revealCursor: number;
  wandsDisabled: boolean;
  /** Pariapt of Peace: Allied and Nemesis give no bonuses this turn. */
  namedDisabled: boolean;
  noFalls: boolean;
  /** Players who must lose a hero at the end of this turn (whoever's turn it is). */
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

export interface RecruitOfferDecision extends DecisionBase { kind: 'recruit.offer' }
export interface RecruitPlaceDecision extends DecisionBase {
  kind: 'recruit.place';
  drawn: CardId;
  /** At the party size, keeping the drawn hero means replacing one. */
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
  | 'discardHero' | 'discardResource' | 'faceDownHero' | 'discardForCouncil' | 'fallHero'
  | 'forceHero' | 'rulingHero'
  | 'marenTarget' | 'marenGive'
  | 'peekReplace' | 'pickLocation' | 'wrenStack' | 'wrenBottom'
  | 'counterAbility' | 'rumourMill' | 'fetch' | 'pickFight' | 'appleSwap'
  | 'curseTarget' | 'vaelisGive' | 'rumourTarget' | 'hallOfRest' | 'gauntlet' | 'sigrunPick' | 'tobinPick' | 'waystoneDraw' | 'heroMinion'
  | 'partyDraft' | 'redirectHero' | 'goldiePick' | 'torviFire' | 'aelderRoots' | 'brisaFlip' | 'mograSteal' | 'immobilizeTarget';

export type Decision = RecruitOfferDecision | RecruitPlaceDecision | BidDecision | ActivateDecision | ChooseDecision;

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
  /** A player loses a hero of their choice (run one at a time, so each faller finishes before the next starts). */
  | { t: 'heroFalls'; player: PlayerId }
  /** Draw resources (queued so it can follow a choice, e.g. Skyship Manifest). */
  | { t: 'draw'; player: PlayerId; n: number; source: string }
  /** A hostile effect on a hero on its way to the table: its player may redirect it (Hedda) or counter it (Aldric) first. */
  | { t: 'defend'; effect: DefendedEffect; stage: 'redirect' | 'counter' | 'apply'; then?: 'statForced' };

/** An effect waiting for the defences of the player it would land on. */
export interface DefendedEffect { kind: EffectKind; source: CardId; owner: PlayerId; target: string; stat?: Stat | 'all'; amount?: number }

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
  | { type: 'recruit.draw'; decision: number }
  | { type: 'recruit.skip'; decision: number }
  | { type: 'recruit.keep'; decision: number; replace: CardId | null }
  | { type: 'recruit.discard'; decision: number }
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
  | { type: 'heroJoined'; player: PlayerId; card: CardRef; replaced: CardRef | null }
  | { type: 'heroLeft'; player: PlayerId; card: CardRef; reason: string }
  | { type: 'heroDeclined'; player: PlayerId; card: CardRef }
  | { type: 'recruitSkipped'; player: PlayerId }
  | { type: 'heroFaceDown'; player: PlayerId; card: CardRef; faceDown: boolean }
  | { type: 'heroMinion'; player: PlayerId; card: CardRef }
  | { type: 'locationRevealed'; card: CardRef; reason: string }
  | { type: 'locationReplaced'; from: CardRef; to: CardRef; reason: string }
  | { type: 'extraLocation'; count: number }
  | { type: 'encounterRevealed'; card: CardRef }
  | { type: 'encounterReplaced'; from: CardRef; reason: string }
  | { type: 'minionDrawn'; card: CardRef }
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
  /** A curse resource, revealed or played face up by `from`, is placed in front of `to`, where its negative value counts against them. */
  | { type: 'cursePlaced'; from: PlayerId; to: PlayerId; card: CardRef }
  | { type: 'bidsSwapped'; a: PlayerId; aCard: CardRef; b: PlayerId; bCard: CardRef }
  | { type: 'cardsTraded'; from: PlayerId; to: PlayerId; gave: CardRef; got: CardRef }
  | { type: 'outcome'; result: TurnResult }
  | { type: 'renownGained'; player: PlayerId; amount: number; total: number; locations: CardRef[] }
  | { type: 'fallPrevented'; player: PlayerId; source: string }
  /** The player failed (or paid for) the encounter and will lose a hero at the end of the turn (a `heroLeft` with reason "Fell" follows). */
  | { type: 'heroFalls'; player: PlayerId }
  | { type: 'turnEnded'; player: PlayerId }
  | { type: 'gameOver'; winner: PlayerId | null };

export type GameEventType = GameEvent['type'];
