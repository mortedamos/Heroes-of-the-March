import { describe, expect, it } from 'vitest';
import { seats, seed } from '../engine/testUtils';
import { GameHost, RateLimiter } from './GameHost';
import { BotSeat, LocalTransport } from './local';
import type { ServerMessage } from './protocol';

function collector() {
  const msgs: ServerMessage[] = [];
  return { msgs, conn: { send: (m: ServerMessage) => msgs.push(JSON.parse(JSON.stringify(m)) as ServerMessage) } };
}

describe('GameHost', () => {
  it('sends each seat its own redacted view on attach', () => {
    const host = new GameHost({ players: seats(3), seed: seed(1) });
    const a = collector();
    host.attach('p0', a.conn);
    const state = a.msgs.find((m) => m.t === 'state');
    expect(state && state.t === 'state' && state.view.you).toBe('p0');
  });

  it('rejects oversized, malformed and unknown frames', () => {
    const host = new GameHost({ players: seats(2), seed: seed(2) });
    const a = collector();
    host.attach('p0', a.conn);
    host.receive('p0', 'x'.repeat(10_000));
    host.receive('p0', '{not json');
    host.receive('p0', JSON.stringify({ t: 'cmd', cmd: {}, extra: 1 }));
    host.receive('p0', 12345);
    const errors = a.msgs.filter((m) => m.t === 'error');
    expect(errors).toHaveLength(4);
  });

  it('ignores frames from seats with no attached connection', () => {
    const rejects: string[] = [];
    const host = new GameHost({ players: seats(2), seed: seed(3) }, { onReject: (_s, code) => rejects.push(code) });
    host.receive('p1', JSON.stringify({ t: 'sync' }));
    expect(rejects).toEqual(['not_attached']);
  });

  it('rate-limits a flooding client', () => {
    const host = new GameHost({ players: seats(2), seed: seed(4) });
    const a = collector();
    host.attach('p0', a.conn);
    for (let i = 0; i < 100; i++) host.receive('p0', JSON.stringify({ t: 'sync' }));
    expect(a.msgs.some((m) => m.t === 'error' && m.code === 'rate_limited')).toBe(true);
  });

  it('token bucket refills over time', () => {
    let now = 0;
    const rl = new RateLimiter(2, 1, () => now);
    expect(rl.take()).toBe(true);
    expect(rl.take()).toBe(true);
    expect(rl.take()).toBe(false);
    now += 1000;
    expect(rl.take()).toBe(true);
  });

  it('plays a complete game of bots over the local JSON transport', async () => {
    const host = new GameHost({ players: seats(4), seed: seed(5) });
    const immediate = (fn: () => void) => queueMicrotask(fn);
    const bots = host.seatIds.map((id) => new BotSeat(host, id, 'normal', () => 0, immediate));
    const spectator = collector();
    host.attachSpectator(spectator.conn);
    for (let i = 0; i < 2000 && !host.isOver; i++) await new Promise((r) => setTimeout(r, 0));
    expect(host.isOver).toBe(true);
    const last = spectator.msgs.at(-1)!;
    expect(last.t === 'state' && last.view.winner).toBeTruthy();
    // Spectators never see any hand.
    expect(spectator.msgs.every((m) => m.t !== 'state' || m.view.hand.length === 0)).toBe(true);
    bots.forEach((b) => b.close());
  });

  it('paces through presentation checkpoints and still finishes', async () => {
    const immediate = (fn: () => void) => queueMicrotask(fn);
    const host = new GameHost({ players: seats(3), seed: seed(8), autoPause: true }, {}, { schedule: immediate });
    const bots = host.seatIds.map((id) => new BotSeat(host, id, 'normal', () => 0, immediate));
    const spectator = collector();
    host.attachSpectator(spectator.conn);
    for (let i = 0; i < 4000 && !host.isOver; i++) await new Promise((r) => setTimeout(r, 0));
    expect(host.isOver).toBe(true);
    const holds = spectator.msgs.filter((m) => m.t === 'state' && m.view.hold).map((m) => m.t === 'state' && m.view.hold);
    expect(new Set(holds)).toEqual(new Set(['location', 'encounter', 'reveal', 'resolve']));
    bots.forEach((b) => b.close());
  });

  it('clients cannot act while the game is paused', () => {
    const host = new GameHost({ players: seats(2), seed: seed(10), autoPause: true }, {}, { schedule: () => {} });
    const state = host.unsafeStateForTests();
    // Drive to a checkpoint by answering decisions directly.
    const a = collector();
    host.attach('p0', a.conn);
    host.attach('p1', collector().conn);
    for (let i = 0; i < 50 && !host.unsafeStateForTests().hold; i++) {
      const s = host.unsafeStateForTests();
      const d = s.pending!;
      const cmd = d.kind === 'companion.offer' ? { type: 'companion.skip', decision: d.id }
        : d.kind === 'choose' ? { type: 'choose', decision: d.id, picks: d.options.slice(0, d.min).map((o) => o.value) }
        : d.kind === 'activate' ? { type: 'ability.done', decision: d.id }
        : { type: 'bid.pass', decision: d.id };
      host.receive(d.player, JSON.stringify({ t: 'cmd', cmd }));
    }
    expect(host.unsafeStateForTests().hold).not.toBeNull();
    expect(state).toBeDefined();
    host.receive('p0', JSON.stringify({ t: 'cmd', cmd: { type: 'bid.pass', decision: 1 } }));
    expect(a.msgs.at(-1)).toEqual({ t: 'error', code: 'paused' });
  });

  it('local transport delivers JSON copies, not shared references', async () => {
    const host = new GameHost({ players: seats(2), seed: seed(6) });
    const t = new LocalTransport(host, 'p0');
    const got: ServerMessage[] = [];
    t.onMessage((m) => got.push(m));
    await new Promise((r) => setTimeout(r, 0));
    const st = got.find((m) => m.t === 'state');
    expect(st).toBeDefined();
    if (st?.t === 'state') {
      st.view.players[0]!.renown = 999;
      expect(host.unsafeStateForTests().players[0]!.renown).toBe(0);
    }
  });
});
