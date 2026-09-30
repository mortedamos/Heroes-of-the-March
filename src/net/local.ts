// In-process transport and bot seats.
//
// LocalTransport round-trips every message through JSON exactly like a
// network would, so local play can't accidentally depend on sharing object
// references with the host (and the redacted views are what the UI really gets).

import { botDecide, type BotLevel } from '../bots/heuristic';
import { RateLimiter, type GameHost } from './GameHost';
import type { ClientMessage, ClientTransport, ServerMessage } from './protocol';

export type Scheduler = (fn: () => void, ms: number) => void;
const defaultScheduler: Scheduler = (fn, ms) => { setTimeout(fn, ms); };

export class LocalTransport implements ClientTransport {
  private listeners: ((m: ServerMessage) => void)[] = [];
  private closed = false;

  constructor(private readonly host: GameHost, private readonly seat: string, limiter?: RateLimiter) {
    host.attach(seat, {
      send: (m) => {
        const wire = JSON.stringify(m);
        queueMicrotask(() => {
          if (this.closed) return;
          const parsed = JSON.parse(wire) as ServerMessage;
          for (const l of this.listeners) l(parsed);
        });
      },
    }, limiter);
  }

  send(msg: ClientMessage): void {
    if (this.closed) return;
    const wire = JSON.stringify(msg);
    queueMicrotask(() => this.host.receive(this.seat, wire));
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.listeners.push(cb);
  }

  close(): void {
    this.closed = true;
    this.host.detach(this.seat);
  }
}

/**
 * A bot occupying a seat. It sees only its own redacted view (through a
 * LocalTransport) and answers decisions after a short, human-readable delay.
 */
export class BotSeat {
  private readonly transport: LocalTransport;
  private lastDecision = 0;
  private errorStreak = 0;

  constructor(
    host: GameHost,
    seat: string,
    private readonly level: BotLevel,
    private readonly delayMs: () => number = () => 700 + Math.random() * 600,
    private readonly schedule: Scheduler = defaultScheduler,
  ) {
    // In-process bots are paced by their own delay, not by the network limiter.
    this.transport = new LocalTransport(host, seat, new RateLimiter(10_000, 10_000));
    this.transport.onMessage((m) => this.onMessage(m));
  }

  private onMessage(m: ServerMessage): void {
    if (m.t === 'error') {
      // Our command was rejected (e.g. raced a state change): resync and decide
      // again, but give up after a few tries rather than spin.
      if (++this.errorStreak > 3) {
        console.warn(`[bot] giving up after repeated rejections (${m.code})`);
        return;
      }
      this.lastDecision = 0;
      this.transport.send({ t: 'sync' });
      return;
    }
    if (m.t !== 'state') return;
    if (m.events.length) this.errorStreak = 0;
    const d = m.view.pending;
    if (!d || d.player !== m.view.you || d.id <= this.lastDecision) return;
    this.lastDecision = d.id;
    const cmd = botDecide(m.view, this.level);
    if (!cmd) return;
    this.schedule(() => this.transport.send({ t: 'cmd', cmd }), this.delayMs());
  }

  close(): void {
    this.transport.close();
  }
}
