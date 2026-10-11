# House rules: rulings for review

These are the calls the engine makes where the v0.3 rules are silent or ambiguous, and the rules this edition adds (the adventuring party, the fall rule, steady draws, one stat per encounter).
The source of truth is `RULE_NOTES` in `src/engine/rules.ts`, which the in-game **Rules & status** panel also shows; this file is generated from it (`npm run rules-doc`), so edit the notes, not this file.
Tunable numbers live in `DEFAULT_RULES` (same file).

| Topic | Ruling |
|---|---|
| The adventuring party (house rule) | There is no separate hero and companions: every player leads a party of three heroes, and their stats add together. The old heroes were halved (rounded up) and joined the old companions in one hero stack. The old heroes' triggers and Kin bonuses are set aside for now (data/set-aside.json). |
| The opening party draft (house rule) | At the start of the game each player, in turn order, privately looks at the top 6 heroes and picks 3; the rest are shuffled back unseen. Nobody can use or trigger any hero ability until every player has picked. The picked heroes "enter play" (draws and other enter-play effects) when that phase ends, in turn order; start-of-turn abilities follow. |
| Recruit phase | From turn 2, starting with the current player and going clockwise, each player may draw one hero at random and decide whether to keep it. If keeping it would take you past your party size, you must replace one of your heroes. Toggle: recruitPhase. |
| Steady draws (house rule) | Replaces "refill to the draw size on your turn": at the start of every turn every player draws 2 resources, but routine draws stop at a hand of 6. Opening hands are still the player count. Draws from card abilities can go past 6. (With the old hero triggers set aside, one card for the other players left too few cards to bid; the balance simulation put it back.) The v0.3 refill rule can be chosen when starting a game. |
| One stat per encounter (house rule) | There is no challenge roll. Each encounter is faced on one stat, its highest printed difficulty (ties were settled by the designers so each stat comes up equally often). There are no dice in the game. |
| Challenge levels (house rule) | A party of three heroes is weaker than the old hero and two companions, so every encounter is printed 5 or 6 lower than in the earlier house rules (Physical -5, Mental -6, Guile -5). The amount was set with the balance simulation so that surviving, falling and the length of a game match the old game. The numbers on the cards are the ones that count. |
| Falling (house rule) | Every player who fails the encounter loses a hero at the end of that turn, whoever's turn it is: they choose which of their heroes falls, and it goes to the hero discard pile. Players who fall at once choose one after another. Falling costs no Renown and nothing else; the party refills in the recruit phase (or at once with The Hall of Rest). A player with no heroes loses nothing. |
| End of bidding | Bidding ends when every player passes in a row. A player who passed may bid again if someone else bids after them. |
| Empty hand | A player with no resource cards passes automatically. |
| Reveal order | Face-down bids are revealed round-robin, one card per player at a time, starting with the player after the last one to pass (the player who would have bid next). |
| Face-up bids | Playing a card face up counts as revealing it, so "when revealed" effects happen immediately. |
| Who faces the encounter | Every player is measured against the challenge, whether or not they bid (the rules total "each player"). Non-bidders can fall. Toggle: allPlayersFaceEncounter. |
| No survivors | If nobody survives, nobody claims the location and it is discarded. |
| Ties | If survivors are level on the highest total, nobody takes the current location: it is discarded. Each tied player instead draws a location at random and claims it, scoring its Renown only. The abilities and conditions of that card do not trigger, and win triggers (such as Mogra) do not fire. If the stack is empty, a tied player gets nothing. |
| Draw size | Draw size counts every seat, bots included. |
| Empty stacks | An empty stack is refilled by shuffling its discard pile. If both are empty, nothing is drawn. |
| Minions entering play | Minions count as encounters entering play for "enters play" triggers (e.g. Kesh's Beast trigger). Toggle: minionsTriggerEntersPlay. |
| Minion search | A minion of a named group is taken from the top-most matching card of the encounter stack, then its discard pile. If neither has one, no minion is drawn. |
| Location group boosts | "Challenges and minion bonuses of X encounters are increased by 2" applies to the main encounter if it is X, and to each X minion. |
| "5 against X" resources | The higher value applies when the main encounter belongs to group X. |
| Winning margin | Margin = winner's total minus the next-highest survivor's total, or minus the difficulty if the winner was the only survivor. |
| Always-beneficial "may" effects | Optional effects that can only help (stat substitutions, drawing extra resources, council heroes) are applied automatically in the player's favour. |
| Unclaimed bonus location | The face-down extra location from The Endless Road or The Pirate Fens is shuffled back into the location stack unseen if nobody wins. |
| Setup | Triggers do not fire during setup; they start with turn 1. |
| When abilities can be used | Any time on your turn: Elowen, Barnaby (after the location, before bidding, on your bidding decision, end of bidding). After the location: Grukka. Before bidding: Aelthir, Vaelis, Maren, Urzha, Oskar, Ilvena, Tova, Rook, Gimlet, Tobin. On your bidding decision: Liriel, Thessaly, Kesh, Aldric, Goldie. Before the reveal: Pip. End of bidding (after all reveals): geese, Torvi, Dagny. Activated abilities are once per turn unless the card says once per game. |
| Only one legal choice | A choice with exactly one legal option resolves by itself (e.g. forcing a hero when there is only one opponent hero, or losing your only hero). |
| Shield of the Dawn (Aldric) | Disables one opposing hero's abilities for the rest of the turn and cancels every effect it created this turn. It cannot undo something already done (a claimed card stays claimed). |
| Forced stats | A forced hero contributes the forced stat instead of any other (including its own substitutions). Brunna's player takes whichever is higher. Mayor Hobby's player draws each time anyone is forced. |
| Infectious Zombie | Players with heroes each turn up the top resource card; the lowest value (ties turn up again) gives one of their own heroes to the encounter as a minion. It adds its stat for the challenge to the difficulty and is discarded at the end of the turn. The resource cards turned up are discarded. |
| Loremaster Oskar (Entered in the Book of Grudges) | Before bidding, once per turn, name an opponent. Each time that opponent uses an ability against Oskar's player's heroes this turn (silencing, forcing a stat, disabling, or a negative bonus), Oskar's player draws a resource. Aldric can counter the naming; if Oskar's ability is disabled the grudge is void. |
| Elder Ilvena (Ruling of the Conclave) | Before bidding, once per turn, choose another player's hero. It contributes its lowest stat this turn instead of its usual one. Aldric, Brunna and Hedda can still cancel it like any forcing effect. |
| Dagny Coldhearth (Grudge Paid in Full) | Used at the end of bidding: her player takes the location whatever the totals, discards their hand and loses a hero of their choice. Shield of Xorthalos and Thorgar's Unburied still prevent that fall; the Amulet of Aesia does not. |
| Mayor Hobby | He may play every resource face down, not only the first. Face-down cards reveal in the normal reveal step. |
| Pip Wanderfoot | The claimed card becomes Pip's bid, stays face down until the reveal step, and Pip may look at it. |
| When abilities can be used | The game stops to offer abilities at six moments: the start of your turn, after the location is revealed, before bidding, during bidding (on your own turn to bid), before the reveal, and at the end of bidding (after every card is revealed). "Whenever abilities can be used" means any of these. Each moment is offered to every player in turn, clockwise from the active player, unless the card says "on your turn". Abilities worded "when" or "if you would" happen by themselves and are not offered: where a card says "if that is better" or "when it is higher" the game picks for you. |
| The geese | "Gain 3 physical" adds 3 to your Physical total this turn; it only helps on a Physical challenge. A failed roll means that goose contributes nothing this turn. |
| Lord Vaelis | The drawn encounter is set aside and discarded at the end of the turn. Its minion bonus goes to all of the stats of the player who uses it or of another player of their choice; a negative bonus counts against whoever receives it. |
| Goldie (Rumour Mill) | Choose one opponent and look at all of their face-down bids. You keep seeing those cards for the rest of the turn (your totals for them are exact); other players do not. |
| Thorgar (Unburied) | Once per game, when his player would lose a hero at the end of the turn, they don't, and draw 3 resources. Other effects that make a player fall are prevented the same way. |
| Kazra (The Right Tools) | Each Dwarf resource card the Kazra player bids is worth 1 more. A curse placed in front of him is not his bid and gets no bonus. |
| The Goose & Kettle | Drawing is optional. If you draw, the hero enters play and you then discard one of your heroes (possibly the new one). |
| Sigrun Stonefast | The choice (stack or random cards from the discard pile) is made once per draw, for all cards in it. |
| Tova Emberdeep | Resting still counts toward your party size. She returns face up at the start of her controller's next turn with one extra resource. |
| An Apple for the Road | Swaps with any other face-up (or already revealed) bid; the two cards change owners. |
| The Hall of Rest | If you fall after playing it this turn, you also choose any hero from the hero stack to fill the place of the one who fell, instead of waiting for the recruit phase. |
| Hesk of Two Homes | Hesk counts as both an Orc and a Human. Once per turn he gives one extra use of another hero's once-per-turn ability. |
| Running out of locations | If the location stack and its discard are both empty, the game ends and the highest Renown wins (ties: earliest seat after the current player). A safety cap of maxTurns also ends the game. |
| Bonus heroes (Varg and Moss, Goldie and Gimlet, Ysolde) | With both members of a pair in your party your party size is one higher (Ysolde adds one more of her own: with both pairs, six). A pair member drawn while its partner is in play may be kept above the normal size. If the pair is broken (one leaves play) or Ysolde leaves, and you are over your party size, you immediately choose heroes to discard down to it. |
| "When a challenge is faced" | Fires when the encounter's challenge is announced, on every player's turn, and again if a later location changes the challenge type. |
| Skarra and Destiny the Frog | A Skarra encounter's minion can be anything except another Skarra. When Destiny the Frog would be the encounter, a Skarra encounter is drawn from the stack instead: that card becomes the encounter and Destiny becomes its minion (worth her printed 1), standing in for one of its minion draws. If no Skarra is left in the stack, Destiny is the encounter herself. Everything is discarded at the end of the turn. |
| Curses (Rotten Apple and friends) | A curse is bid like any resource, face up or face down. When it is revealed or played face up, its owner places it in front of an opposing player of their choice; its negative value counts toward that player's bid. It is discarded with the rest at the end of the turn. |
| The Book of Grudges | If its owner loses the encounter (and so loses a hero) and someone else wins, the winner has -3 in the next encounter. It is worth +1 for a player whose party includes Oskar. Penalties from several grudges add up. |
| Marshal Hedda (Hold the Line) | Once per turn, the first opposing ability that would silence, force the stat of, or disable one of her controller's heroes has no effect (including a counter by Aldric). Abilities aimed at resources are not covered. |
| Torvi Cinderkeg (Fire in the Hole) | Used at the end of bidding, before the winner is declared. Torvi is discarded (so his own stat no longer counts) and every opponent has -4 to their total this encounter, or -6 if the player controls a revealed Mhorgrim's Hunt. Torvi's replacement is drawn in the normal recruit phase. |
| The Treasure Trow | Every player draws a resource when it enters play (as the encounter or as a minion). When someone survives its challenge, each survivor draws a resource. |
| The Hollow Hills (Fog of the Fey) | While it is the location, face-down resource cards stay hidden until the reveal step: Goldie's Rumour Mill cannot be used, and no ability can reveal or look at a face-down card early. |

## Default values

| Setting | Value |
|---|---|
| `renownToWin` | 20 |
| `partySize` | 3 |
| `drawSize` | playerCount |
| `recruitPhase` | everyone |
| `allPlayersFaceEncounter` | true |
| `minionsTriggerEntersPlay` | true |
| `maxTurns` | 200 |
| `draftPool` | 6 |
| `handModel` | steady |
| `activeDraw` | 2 |
| `othersDraw` | 2 |
| `handLimit` | 6 |

How the numbers were set (encounter difficulty, steady draws) and how the new game compares with the old one: [BALANCE-party.md](BALANCE-party.md).
