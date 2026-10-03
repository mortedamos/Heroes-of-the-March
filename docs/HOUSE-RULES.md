# House rules: rulings for review

These are the calls the engine makes where the v0.3 rules are silent or
ambiguous. The source of truth is `RULE_NOTES` in `src/engine/rules.ts`, which
the in-game **Rules & status** panel also shows. Tell me which to change;
several are one-line toggles in `DEFAULT_RULES`.

| # | Topic | Ruling | Toggle |
|---|---|---|---|
| 1 | End of bidding | Bidding ends when every player passes in a row. A player who passed may bid again if someone else bids after them. | |
| 2 | Empty hand | A player with no resource cards passes automatically. | |
| 3 | Reveal order | Face-down bids are revealed round-robin, one card per player at a time, starting with the player who would have bid next. | |
| 4 | Face-up bids | Playing a card face up counts as revealing it, so "when revealed" effects happen immediately. | |
| 5 | Who faces the encounter | **Every** player is measured against the challenge, bid or not, so non-bidders can fall (the rules total "each player"). | `allPlayersFaceEncounter` |
| 6 | No survivors | Nobody claims the location; it's discarded. | |
| 7 | Ties | If survivors are level on the highest total, the location is discarded. Each tied player draws a location at random and claims it for its Renown only; its abilities and conditions do not trigger. | |
| 8 | Falling | Costs no Renown. The new hero is drawn *before* the fallen one is shuffled back, so you never redraw the same hero. | |
| 9 | Fall timing | Everyone who fails the encounter falls at the end of that turn, whoever's turn it is. Several players falling at once choose their replacements one after another. | |
| 10 | Companion phase | Starting with the current player, each player may draw one companion, then keep it (replacing one at the limit) or discard it. | `companionPhase: 'everyone' \| 'activeOnly'` |
| 11 | Draw size | Counts every seat, bots included. | `drawSize` |
| 12 | Empty stacks | Reshuffle the discard pile; if both are empty, nothing is drawn. | |
| 13 | Minions & triggers | Minions count as encounters entering play for hero triggers (e.g. Pip). | `minionsTriggerEntersPlay` |
| 14 | Minion search | Take the top-most matching card from the encounter stack, then its discard. None: no minion. | |
| 15 | Location group boosts | "+2 to X encounters" applies to the main encounter if it's X and to each X minion. | |
| 16 | "5 against X" | The higher value applies when the *main* encounter is X. | |
| 17 | Winning margin (Thorgar) | Winner's total minus the runner-up survivor's, or minus the difficulty if they were the only survivor. | |
| 18 | Always-good "may" effects | Applied automatically in the player's favour: stat substitutions (Osric, Posy, Nettle, Aurelie, Gnash), Corvin's extra draw, Council heroes, Kazra ignoring *positive* minion bonuses, Arangil / Blasting Powder (only if your stat there is higher), The Rosepearl (best companion Mental). | |
| 19 | Setup | Triggers don't fire during setup; they start on turn 1. | |
| 20 | Unclaimed bonus location | The face-down extra location from The Endless Road / The Pirate Fens goes back into the stack unseen if nobody wins. | |
| 21 | Running out | If locations run out entirely, highest Renown wins. Safety cap: `maxTurns` (200). | `maxTurns` |
| 23 | **Hero draft** (new house rule, always on) | Whenever you get a hero, at the start and when your hero is replaced after a fall, look at the top 3 heroes, keep one, and shuffle the rest back unseen. At the start, everyone chooses their hero first; companions and hands are dealt after. The Hall of Rest still offers the whole stack. | `heroDraft` (3; 1 = blind) |
| 23b | **Replacement heroes** | The draft of three is only for the start of the game. When your hero falls you draw the top hero and may keep them or send them back and take the next (which you must keep). Setting `draftOnReplace` (a checkbox under House rules) restores a draft of three every time. | `draftOnReplace` (false) |
| 24 | **Tavern** (new house rule, on by default) | Three companions lie face up. In the companion phase you may recruit one instead of drawing blind; the tavern refills at once. Recruiting one and letting them go denies them to others, at the cost of your recruit. | `tavernSize` (3; 0 = off, also a switch on the new-game screen) |
| 25 | **Steady draws** (new house rule, default) | Replaces "refill to the draw size on your turn". At the start of every turn the current player draws 2 resources and everyone else draws 1; routine draws stop at a hand of 6. Opening hands are still the player count. Draws from card abilities can exceed 6. | `handModel` 'steady' / 'refill', `activeDraw` 2, `othersDraw` 1, `handLimit` 6 (choose on the new-game screen) |
| 26 | **Harder challenges** (new house rule, built into the cards) | Each encounter card is printed 1 to 3 harder than the original (easier cards get more; cards that already draw minions or have a condition get one less). Numbers live in `data/encounter-difficulty.json` and are applied by `npm run cards`; there is no separate "house +N" line in the game any more. Average bump is about +2. | `data/encounter-difficulty.json` |
| 27 | **Falling costs** (new house rule, on by default) | When your hero falls you also discard one of your companions, your choice, before the new hero arrives. Your hand is not affected. Nothing is discarded if you have no companion. | `fallCost` (true) |
| 28 | **One stat per encounter** (new house rule) | No challenge roll. Each encounter is faced on a single stat: its highest printed difficulty. Encounters that tied for highest were assigned a stat in `data/encounter-stats.json` so Physical, Magic and Guile each come up on 19 of 57 encounters. Cards show only that one stat. Heroes whose triggers were about die rolls now draw when their stat is faced on another player's turn (Aelthir Guile, Ysolde Magic, Brunna Physical); Urzha draws when an encounter is replaced. Ilvena's new ability, Ruling of the Conclave: discard a resource to force an opposing companion onto its lowest stat (before bidding, once per turn). | |
| 30 | **Opening companion draft** (with the tavern) | Nobody is dealt companions. In turn order each player sees a private pool of five, fills two empty slots by clicking (click a filled slot to put the companion back) and confirms. There is no blind draw and no first-turn companion phase; enter-play effects happen when everyone has chosen. Without the tavern, two companions are dealt at random as before. | `companionDraft` (5 with the tavern, 0 without) |
| 29 | **Opening companion phase** (new house rule) | On turn 1 no hero or companion ability can be used or triggered until every player has picked their companions. Companions recruited then enter play (draws and other enter-play effects) when that phase ends, in turn order; start-of-turn abilities come after. Static effects (e.g. a higher companion limit) still apply. | |

## Card-ability rulings

Every card ability is now implemented. These are the calls made where the
card text left room for interpretation:

| Topic | Ruling |
|---|---|
| Ability timing | Start of turn: Aelthir, Wren. After the location: Grukka (any turn, once per turn), Barnaby (your turn). Before bidding: Vaelis, Maren, Tova, Ilvena. On your bidding decision: forced-stat companions, Aldric, Pip (others' turns only), Urzha. End of bidding: geese, Mags, Mira. Once per turn unless the card says once per game. |
| One legal choice | Resolves by itself (e.g. forcing a hero with only one opponent). |
| Aldric (Shield of the Dawn) | Disables one opposing hero's or companion's abilities for the rest of the turn and cancels effects it made this turn; can't undo completed actions. |
| Forced stats | The forced stat replaces the card's own substitutions. Brunna's player takes the higher value. Hobby's player draws whenever anyone is forced. |
| Iron Mites | Players with companions roll; the lowest (ties re-roll) gives one of their *own* companions as a minion, adding its challenge stat; discarded at end of turn. |
| Oskar | Once per turn, on any turn, a face-down card with a positive value may be made to count as zero as it's revealed. |
| Mira | End of bidding: take the location regardless of totals; discard your hand; your hero falls (Shield of Xorthalos prevents it, the Amulet doesn't). |
| Mags | Discarded at end of turn only if used. |
| Hobby | First bid may be face down; cards still reveal in the normal reveal step. |
| Pip | The claimed card becomes Pip's bid, stays face down, and Pip may look at it. |
| Geese | "+3 physical" only helps on Physical challenges; a failed roll silences that goose for the turn. |
| Vaelis | The drawn encounter is set aside; negative minion values hurt. |
| Waystone Inn | Drawing is optional; if you draw, discard one companion afterwards (possibly the new one). |
| Sigrun | Stack-or-discard choice is per draw action. |
| Tova | Resting counts toward the companion limit; returns on her controller's next turn with +2 resources. |
| Apple for the Road | Swaps with any face-up/revealed bid; the cards change owners. |
| Hall of Rest | Choose any hero from the hero stack when this turn's fall happens. |
| Hesk | One extra use per turn of one companion's once-per-turn ability. |
| Ability dice | Hollow Hills: an ability roll of r counts as 7 − r. Mogra (own turn): roll twice, keep either. Challenge and tiebreak rolls aren't ability rolls. |

## Observations from simulations (not changes)

Bot games, 300 per row, normal bots, all card abilities in play (3 players / 4 players):

| | Turns | Survival | Falls per player per game | Hero lasts (share of game) | Close games (≤4 Renown) | Game winner's share of locations | Turns with sabotage |
|---|---|---|---|---|---|---|---|
| v0.3 rules | 9.4 / 11.4 | 94% / 94% | 0.43 / 0.51 | 70% / 66% | 16% / 22% | 58% / 47% | 64% / 79% |
| + catch-up draw, Renown 31 − 2×players | 13.6 / 15.0 | 95% / 95% | 0.53 / 0.58 | 66% / 63% | 20% / 25% | 49% / 41% | 67% / 82% |
| + 8 "hex" resources (see below) | 13.9 / 15.0 | 93% / 93% | 0.79 / 0.77 | 56% / 57% | 25% / 24% | 48% / 41% | 76% / 86% |
| + difficulty +2 on top | 14.0 / 15.1 | 88% / 88% | 1.35 / 1.22 | 43% / 45% | 29% / 25% | 48% / 41% | 75% / 86% |

- **Catch-up draw** (since removed: resource scarcity is part of the game): at the start of each turn, the player(s) with the lowest Renown drew one resource.
- **Hex resources (experiment):** eight vanilla resources (Jester's Cap, Tin Whistle, Glamour Rouge, Draught of Forgetting, Mask of Many Faces, Blank Writ, Pickled Eggs and Treacle, Cloak of Hiding) instead subtract their value from the strongest opponent when revealed. The v0.3 rules text describes resources that "subtract from someone else's" total, but no card in the data does this.
- Raising difficulty shortens how long a hero lasts, which cuts against keeping a hero as a long-term plan.
