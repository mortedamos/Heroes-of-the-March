# Security model

The game is built to be **server-authoritative from day one**. Today the
"server" (`GameHost`) runs inside the browser for local games against bots.
Later it moves to a real server with no change to the rules engine, so the
security properties below are already exercised and tested now.

## Architecture

```
 client (browser)                         host (browser today, server later)
┌──────────────────────┐   JSON only    ┌──────────────────────────────────┐
│ GameClient + three.js │ ─ ClientMessage→│ GameHost                         │
│  sees: GameView only  │ ←ServerMessage─ │  owns: GameState (secret)        │
└──────────────────────┘                 │  engine: applyCommand / viewFor  │
                                          │  bots: BotSeat (same path)       │
                                          └──────────────────────────────────┘
```

| Layer | File | Responsibility |
|---|---|---|
| Engine | `src/engine/*` | Pure rules. No DOM, no network, deterministic from a seed. |
| Trust boundary | `src/engine/commands.ts` | Strict schema validation, decision/seat checks, atomic apply. |
| Information hiding | `src/engine/view.ts`, `src/engine/totals.ts` | Allowlisted per-player views; per-player event redaction. |
| Host | `src/net/GameHost.ts` | Binds seats to connections, rate-limits, parses frames, broadcasts. |
| Transport | `src/net/protocol.ts`, `src/net/local.ts` | Message types, size caps; JSON round-trip even locally. |
| UI | `src/client/ui/dom.ts` | DOM built with `textContent` only. There is no `innerHTML` anywhere. |

## Threats and mitigations

| Threat (multiplayer) | Mitigation | Tested in |
|---|---|---|
| Client claims to be another player | The seat comes from the connection (`receive(seat, data)`), never from the message | `security.test.ts` ("only the deciding seat") |
| Replayed / stale / out-of-order commands | Each decision has a monotonic id; commands must echo the current id | `security.test.ts` ("stale or replayed") |
| Malformed or hostile JSON (prototype pollution, huge payloads, wrong types, extra keys) | Size cap before parse; strict allowlist schema; unknown keys rejected; command rebuilt from validated fields | `security.test.ts` (25 malformed cases), `host.test.ts` |
| Playing cards you don't own / illegal moves | Engine checks ownership and legality of every move | `security.test.ts` |
| Half-applied commands corrupting state | Commands apply to a `structuredClone`; any error discards the clone | `security.test.ts` ("state untouched") |
| Peeking at hidden information (hands, face-down bids, deck order, the undecided companion draw, face-down bonus locations) | Views are **allowlisted**; hidden cards carry no ids (they can't be tracked); totals and card values are computed with a visibility predicate so hidden cards can't leak through numbers | `security.test.ts` ("views never contain hidden card ids", "Null-Rune Seal does not leak") |
| Private card effects (peeks by Grukka, Barnaby and Wren; the hero stack for The Hall of Rest; Queen Maren's trades; Pip's claimed card) | Peeked cards are shown only in the chooser's decision, by definition and never by instance id. A choice's `data` (secret context) is never copied into a view. Trades are redacted for everyone except the two players involved. | `mechanics.test.ts` ("peeks stay private", "Queen Maren"), `security.test.ts` (hidden-id sweep over full bot games) |
| Using abilities you don't have, out of their window, or twice | `ability.use` is checked against the abilities the engine itself offers for that seat, window and turn | `mechanics.test.ts` ("abilities cannot be used outside their window or twice") |
| Predicting shuffles and dice | Seed comes from `crypto.getRandomValues`; RNG state never leaves the engine; card instance ids are random per game | `security.test.ts` |
| Event stream leaks | Each event type must be classified public/redacted (compiler-enforced); unknown events are dropped (fail closed) | `security.test.ts` ("events") |
| Flooding / DoS | Per-seat token-bucket rate limiter; inbound frame size cap; bounded arrays in commands; engine loop guards | `host.test.ts` |
| Acting during paced pauses | Commands are rejected while the host holds at a presentation checkpoint; only the host can resume | `host.test.ts` |
| XSS via names/card text | Names sanitized (control + bidi-override characters stripped, length cap); UI renders text with `textContent` only | `security.test.ts` ("player names") |
| Script injection / third-party code | CSP: `script-src 'self'`, no inline scripts, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`; no CDNs, no external fonts; `referrer: no-referrer` | `vite.config.ts` |
| Bots cheating (and a check that views are sufficient) | Bots receive only their own redacted view through the same transport | `simulation.test.ts` |
| Supply chain | Lockfile committed; one runtime dependency (`three`); `npm audit` clean (a transitive `uuid` advisory in the build-only xlsx reader is pinned via `overrides`); install scripts not run by default under npm 11 | `npm run audit` |

## Checklist for the future server

The engine and host are ready; a server still needs:

- [ ] **TLS only** (`wss://`), HSTS, and the CSP sent as an HTTP header plus `frame-ancestors 'none'`.
- [ ] **Authentication**, mapping an authenticated session to a seat before `host.attach()`. Use short-lived signed tokens rather than seat ids in URLs.
- [ ] **Origin check** on the WebSocket upgrade (`Origin` must be ours).
- [ ] Enforce `MAX_CLIENT_MESSAGE_BYTES` at the socket layer (`maxPayload`) as well as in `parseClientMessage`.
- [ ] Per-IP connection limits, plus the per-seat `RateLimiter` already in `GameHost`.
- [ ] Idle and turn timeouts (auto-pass for disconnected players).
- [ ] Reconnect: re-attach an authenticated session to its seat and send `sync`.
- [ ] Persist `GameState` server-side only; never log it to places clients can read. `HostHooks.onCommit` is the persistence hook.
- [ ] Abuse monitoring via `HostHooks.onReject` (without secret state).
- [ ] Lobby and chat: sanitize names with `sanitizeName` and render with `textContent` (dom.ts).
- [ ] Keep `npm audit` in CI and pin dependency versions.

## Rules for contributors

1. Never send `GameState` to a client. Build what clients need in `view.ts` (allowlist).
2. Any number shown to a player that depends on bids must use `visibleTo(viewer)`, never `ALL_VISIBLE`.
3. New event types must be classified in `EVENT_POLICY` (the compiler will insist).
4. New command types need a schema entry in `commands.ts` and a malformed-input test.
5. UI text goes through `h()` / `textContent`. No `innerHTML`, `insertAdjacentHTML` or `eval`.
