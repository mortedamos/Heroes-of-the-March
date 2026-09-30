# Heroes of the March: web edition

A three.js tabletop version of *Heroes of the March* (rules v0.3). You play
against 1–5 bots now, and the code is structured for online multiplayer later.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine, security and host tests
npm run typecheck
npm run build      # production bundle in dist/
```

Card data is generated from the design spreadsheet:

```bash
npm run cards      # source-docs/Heroes-of-the-March-card-data.xlsx -> src/data/cards.json
```

Card art comes from `_build/art`. Which art goes on which card is set in
`data/art-map.json` (by card name); unmapped cards get a drawn emblem.
Edit the spreadsheet or the art map, re-run `npm run cards`, and reload.

## Layout

```
src/
  engine/        Pure rules engine: no DOM, no three.js. Runs in browser or Node.
    setup.ts       createGame(): decks, heroes, companions, hands
    flow.ts        turn state machine + queued card-effect tasks
    commands.ts    trust boundary: validate + apply player commands, resume()
    view.ts        per-player redacted views and events
    totals.ts      stat totals, difficulty, visibility-aware projections
    abilities.ts   per-card ability registry (status: full / partial / todo)
    rules.ts       house rules + the rulings list shown in-game
  bots/          Heuristic bot (sees only its own view)
  net/           GameHost (authoritative), protocol, local JSON transport, bot seats
  client/        three.js table, card face renderer, HTML HUD
data/art-map.json  card name -> art file
scripts/build-cards.ts  xlsx -> JSON (validates the sheet)
```

## Screens and input

The table adapts to three screen shapes (`src/client/viewport.ts`):

- **Wide** (desktop, tablet landscape): the action dock sits over the bottom of the table.
- **Tall** (portrait phones and tablets): opponents sit in rows above the centre and the dock is a fixed band below the table.
- **Short** (phone landscape): the dock is a column on the right.

On compact shapes the camera fits the whole play area to the space the dock leaves (`TableScene.fit`).

Cards are shown as large as the space allows, and their text is repeated as plain text only when the card comes out too small to read (`Hud.inspect`, using the print size from `rulesTextSize`).

Choosing a card works the same everywhere: a bid, a tavern recruit or a one-card choice happens on click. On touch screens there's no hover, so the first tap shows the card full size with its action button, and a second tap (or the button) confirms. Holding an ability button opens its card without using it.

## Multiplayer hooks

Everything already goes through the path a networked game will use:

`GameClient` ⇄ `ClientTransport` (JSON) ⇄ `GameHost` ⇄ engine

- Swap `LocalTransport` for a WebSocket transport; `GameHost` moves to Node unchanged.
- The seat is bound to the connection (`host.attach(seat, conn)`), so auth plugs in there.
- `HostHooks.onCommit` is for persistence and replays; games are deterministic from seed + commands.
- Server-side pacing (`hold` / `resume`) keeps every client in step at key moments.

See [SECURITY.md](SECURITY.md) for the threat model and the server checklist.

## Card abilities

Every card with rules text is implemented (`src/engine/abilities.ts`). Each
card declares its static modifiers, triggers and **activated abilities**,
which name the turn window they can be used in (start of turn, after the
location, before bidding, on your bidding decision, end of
bidding). Temporary effects such as forced stats, silences, bonuses and
negated bids are recorded with their source, which is how Aldric can cancel
them. `src/engine/mechanics.test.ts` has a rigged scenario for each ability family.

A new card needs an entry in `abilities.ts` with `status: 'full'`. A card
without one still counts its numbers; `statusReport()` lists any such cards
(there are none today).

## House rules

Where the v0.3 rules leave gaps, the rulings live in `src/engine/rules.ts`
(`RULE_NOTES`); they're also shown in-game and in [docs/HOUSE-RULES.md](docs/HOUSE-RULES.md).
