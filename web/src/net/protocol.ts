// Wire protocol shared by the host and clients. Everything that crosses it is
// JSON. Local games use the same protocol through LocalTransport, so the
// multiplayer path is exercised from day one.

import type { ClientEvent, GameView } from '../engine/view';

export const PROTOCOL_VERSION = 1;
/** Hard cap on inbound (client -> host) message size. */
export const MAX_CLIENT_MESSAGE_BYTES = 4096;

export type ClientMessage =
  | { t: 'cmd'; cmd: unknown }
  | { t: 'sync' };

export type ServerMessage =
  | { t: 'hello'; protocol: number; seat: string | null }
  | { t: 'state'; view: GameView; events: ClientEvent[] }
  | { t: 'error'; code: string };

/** Client-side transport. A WebSocket implementation will satisfy the same interface. */
export interface ClientTransport {
  send(msg: ClientMessage): void;
  onMessage(cb: (msg: ServerMessage) => void): void;
  close(): void;
}

/** Host-side handle for one connected seat or spectator. */
export interface SeatConnection {
  send(msg: ServerMessage): void;
}

/**
 * Parse an inbound client frame defensively. Returns null for anything that
 * isn't a well-formed ClientMessage; the command body is validated later by
 * the engine's parseCommand.
 */
export function parseClientMessage(data: unknown): ClientMessage | null {
  if (typeof data !== 'string') return null;
  // Rough byte bound before parsing (UTF-16 length <= UTF-8 byte length for our purposes).
  if (data.length > MAX_CLIENT_MESSAGE_BYTES) return null;
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o['t'] === 'sync' && Object.keys(o).length === 1) return { t: 'sync' };
  if (o['t'] === 'cmd' && Object.keys(o).length === 2 && 'cmd' in o) return { t: 'cmd', cmd: o['cmd'] };
  return null;
}
