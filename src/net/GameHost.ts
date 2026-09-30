// Authoritative game host. It owns the secret GameState and is the only thing
// that can change it. Today it runs in the browser for local vs-bot games;
// for multiplayer the same class runs on a server behind WebSockets.
//
// SECURITY
// - The acting seat comes from the connection a message arrived on
//   (`receive(seat, data)`), never from the message body.
// - Inbound frames are size-capped, JSON-parsed defensively and rate-limited.
// - Each seat receives only viewFor(seat) + redactEvents(seat).
// - Errors sent to clients are short codes.

import { applyCommand, createGame, redactEvents, resume, viewFor, type NewGameOptions } from '../engine';
import type { GameEvent, GameState, HoldReason, PlayerId } from '../engine/types';
import { parseClientMessage, PROTOCOL_VERSION, type SeatConnection, type ServerMessage } from './protocol';

/** Token bucket: `burst` messages, refilled at `perSecond`. */
export class RateLimiter {
  private tokens: number;
  private last: number;
  constructor(private readonly burst = 20, private readonly perSecond = 5, private readonly now = () => Date.now()) {
    this.tokens = burst;
    this.last = now();
  }
  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.perSecond);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** How long to linger at each presentation checkpoint before resuming (ms). */
export const DEFAULT_PACING: Record<HoldReason, number> = {
  encounter: 1100,
  reveal: 800,
  resolve: 3200,
};

export interface HostOptions {
  pacing?: Partial<Record<HoldReason, number>>;
  schedule?: (fn: () => void, ms: number) => void;
}

export interface HostHooks {
  /** Called after every accepted command (persistence, replays, analytics). */
  onCommit?(state: GameState, events: GameEvent[]): void;
  /** Rejected/malformed input, for abuse monitoring. Never includes secret state. */
  onReject?(seat: PlayerId | null, code: string): void;
}

export class GameHost {
  private state: GameState;
  private readonly seats = new Map<PlayerId, { conn: SeatConnection; limiter: RateLimiter }>();
  private readonly spectators = new Set<SeatConnection>();
  private readonly pacing: Record<HoldReason, number>;
  private readonly schedule: (fn: () => void, ms: number) => void;
  private resumeScheduled = false;
  private closed = false;

  /** Setup events, replayed (redacted) to connections that attach before the first command. */
  private readonly setupEvents: GameEvent[];

  constructor(opts: NewGameOptions, private readonly hooks: HostHooks = {}, hostOpts: HostOptions = {}) {
    const { state, events } = createGame(opts);
    this.state = state;
    this.setupEvents = events;
    this.pacing = { ...DEFAULT_PACING, ...hostOpts.pacing };
    this.schedule = hostOpts.schedule ?? ((fn, ms) => { setTimeout(fn, ms); });
    this.maybeResume();
  }

  /** Stop scheduling work (e.g. when leaving the game). */
  close(): void {
    this.closed = true;
  }

  private maybeResume(): void {
    const hold = this.state.hold;
    if (!hold || this.resumeScheduled || this.closed) return;
    this.resumeScheduled = true;
    this.schedule(() => {
      this.resumeScheduled = false;
      if (this.closed) return;
      const res = resume(this.state);
      if (!res.ok) return;
      this.commit(res.state, res.events);
    }, this.pacing[hold]);
  }

  private commit(state: GameState, events: GameEvent[]): void {
    this.state = state;
    this.hooks.onCommit?.(this.state, events);
    this.broadcast(events);
    this.maybeResume();
  }

  get seatIds(): PlayerId[] {
    return this.state.players.map((p) => p.id);
  }

  get isOver(): boolean {
    return this.state.winner !== null || this.state.turn.step === 'gameOver';
  }

  /**
   * Bind a connection to a seat. The caller (server auth layer) decides who
   * may take which seat. `limiter` defaults to a human-paced token bucket.
   */
  attach(seat: PlayerId, conn: SeatConnection, limiter: RateLimiter = new RateLimiter()): void {
    if (!this.seatIds.includes(seat)) throw new Error('unknown seat');
    this.seats.set(seat, { conn, limiter });
    conn.send({ t: 'hello', protocol: PROTOCOL_VERSION, seat });
    conn.send({ t: 'state', view: viewFor(this.state, seat), events: this.openingEvents(seat) });
  }

  attachSpectator(conn: SeatConnection): void {
    this.spectators.add(conn);
    conn.send({ t: 'hello', protocol: PROTOCOL_VERSION, seat: null });
    conn.send({ t: 'state', view: viewFor(this.state, null), events: this.openingEvents(null) });
  }

  private openingEvents(seat: PlayerId | null) {
    return this.state.version === 0 ? redactEvents(this.setupEvents, seat) : [];
  }

  detach(seat: PlayerId): void {
    this.seats.delete(seat);
  }

  detachSpectator(conn: SeatConnection): void {
    this.spectators.delete(conn);
  }

  /** Handle a raw frame from the connection bound to `seat`. */
  receive(seat: PlayerId, data: unknown): void {
    const entry = this.seats.get(seat);
    if (!entry) return this.hooks.onReject?.(seat, 'not_attached');
    if (!entry.limiter.take()) return this.reject(entry.conn, seat, 'rate_limited');
    const msg = parseClientMessage(data);
    if (!msg) return this.reject(entry.conn, seat, 'bad_message');
    if (msg.t === 'sync') {
      entry.conn.send({ t: 'state', view: viewFor(this.state, seat), events: [] });
      return;
    }
    const res = applyCommand(this.state, seat, msg.cmd);
    if (!res.ok) return this.reject(entry.conn, seat, res.error);
    this.commit(res.state, res.events);
  }

  private reject(conn: SeatConnection, seat: PlayerId, code: string): void {
    this.hooks.onReject?.(seat, code);
    conn.send({ t: 'error', code });
  }

  private broadcast(events: GameEvent[]): void {
    for (const [seat, { conn }] of this.seats) {
      conn.send({ t: 'state', view: viewFor(this.state, seat), events: redactEvents(events, seat) });
    }
    if (this.spectators.size) {
      const msg: ServerMessage = { t: 'state', view: viewFor(this.state, null), events: redactEvents(events, null) };
      for (const s of this.spectators) s.send(msg);
    }
  }

  /** Test/debug only: the secret state. Never expose this over the network. */
  unsafeStateForTests(): GameState {
    return this.state;
  }
}
