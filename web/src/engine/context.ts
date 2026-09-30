// Ctx wraps a (cloned) GameState while a command is being applied. All state
// changes go through here so events are emitted consistently.

import { getDef } from './cards';
import type { CardDef, EncounterDef, LocationDef } from './cardTypes';
import { nextId, rollDie, shuffleInPlace } from './rng';
import type {
  CardId, CardRef, DeckName, Decision, GameEvent, GameState, PlayerId, PlayerState, Task,
} from './types';

/** Thrown for a rules violation caused by the command (safe to report to the client). */
export class IllegalMove extends Error {
  constructor(public readonly code: string) { super(code); }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewDecision = DistributiveOmit<Decision, 'id'>;

export class Ctx {
  readonly events: GameEvent[] = [];
  /** Set while dispatching triggers so hooks can't recurse forever. */
  triggerDepth = 0;

  constructor(readonly s: GameState) {}

  // --- lookup -------------------------------------------------------------

  def(card: CardId): CardDef {
    const defId = this.s.cards[card];
    if (defId === undefined) throw new Error(`unknown card instance ${card}`);
    return getDef(defId);
  }

  ref(card: CardId): CardRef {
    return { id: card, def: this.defId(card) };
  }

  defId(card: CardId): string {
    const defId = this.s.cards[card];
    if (defId === undefined) throw new Error(`unknown card instance ${card}`);
    return defId;
  }

  player(id: PlayerId): PlayerState {
    const p = this.s.players.find((x) => x.id === id);
    if (!p) throw new Error(`unknown player ${id}`);
    return p;
  }

  get active(): PlayerState {
    return this.s.players[this.s.turn.active]!;
  }

  seatOf(id: PlayerId): number {
    return this.s.players.findIndex((p) => p.id === id);
  }

  /** Players in clockwise order starting from the given seat (default: current player). */
  clockwise(fromSeat = this.s.turn.active): PlayerState[] {
    const n = this.s.players.length;
    return Array.from({ length: n }, (_, i) => this.s.players[(fromSeat + i) % n]!);
  }

  get location(): LocationDef | null {
    return this.s.turn.location ? (this.def(this.s.turn.location) as LocationDef) : null;
  }

  get encounter(): EncounterDef | null {
    return this.s.turn.encounter ? (this.def(this.s.turn.encounter) as EncounterDef) : null;
  }

  // --- events & flow -------------------------------------------------------

  emit(e: GameEvent): void {
    this.events.push(e);
  }

  log(player: PlayerId | null, source: string, text: string): void {
    this.emit({ type: 'ability', player, source, text });
  }

  decide(d: NewDecision): void {
    if (this.s.pending) throw new Error('decision already pending');
    this.s.decisionSeq += 1;
    this.s.pending = { ...d, id: this.s.decisionSeq } as Decision;
  }

  queue(task: Task): void {
    this.s.tasks.push(task);
  }

  /** Run a task before anything already queued. */
  queueFirst(task: Task): void {
    this.s.tasks.unshift(task);
  }

  roll(player: PlayerId | null, reason: 'tiebreak' | 'ability' | 'effect'): number {
    const v = rollDie(this.s.rng);
    this.emit({ type: 'dieRolled', player, value: v, reason });
    return v;
  }

  // --- cards ---------------------------------------------------------------

  /** Register a new card instance with an opaque random id. */
  mint(defId: string): CardId {
    let id: string;
    do { id = nextId(this.s.rng); } while (this.s.cards[id] !== undefined);
    this.s.cards[id] = defId;
    return id;
  }

  shuffle(deck: DeckName): void {
    shuffleInPlace(this.s.rng, this.s.decks[deck]);
    this.emit({ type: 'shuffled', deck });
  }

  /** Take the top card of a stack, refilling it from the discard pile if empty. */
  take(deck: DeckName): CardId | null {
    if (this.s.decks[deck].length === 0 && this.s.discards[deck].length > 0) {
      this.s.decks[deck] = this.s.discards[deck];
      this.s.discards[deck] = [];
      this.shuffle(deck);
    }
    return this.s.decks[deck].pop() ?? null;
  }

  /** Remove a specific card from a stack or its discard (for searches). */
  takeMatching(deck: DeckName, pred: (c: CardId) => boolean): CardId | null {
    for (const pile of [this.s.decks[deck], this.s.discards[deck]]) {
      for (let i = pile.length - 1; i >= 0; i--) {
        if (pred(pile[i]!)) return pile.splice(i, 1)[0]!;
      }
    }
    return null;
  }

  discard(deck: DeckName, card: CardId): void {
    this.s.discards[deck].push(card);
  }

  /** Put a card back into a stack and shuffle it. */
  returnToDeck(deck: DeckName, cards: CardId[]): void {
    if (cards.length === 0) return;
    this.s.decks[deck].push(...cards);
    this.shuffle(deck);
  }

  /** Remove a card from wherever it is in a player's play area / hand. */
  removeFromPlayer(p: PlayerState, card: CardId): void {
    for (const key of ['hand', 'companions', 'inactiveCompanions', 'resting', 'claimed', 'councilHeroes'] as const) {
      const i = p[key].indexOf(card);
      if (i >= 0) p[key].splice(i, 1);
    }
    const b = p.bids.findIndex((x) => x.card === card);
    if (b >= 0) p.bids.splice(b, 1);
  }
}
