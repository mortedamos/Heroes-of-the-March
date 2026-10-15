# House rules: rulings for review

These are the calls the engine makes where the v0.3 rules are silent or ambiguous, and the rules this edition adds (the adventuring party, the fall rule, steady draws, one stat per encounter).
The source of truth is `RULE_NOTES` in `src/engine/rules.ts`, which the in-game **Rules & status** panel also shows; this file is generated from it (`npm run rules-doc`), so edit the notes, not this file.
Tunable numbers live in `DEFAULT_RULES` (same file).

| Topic | Ruling |
|---|---|
| The adventuring party (house rule) | There is no separate hero and companions: every player leads a party of three heroes, and their stats add together. The old heroes were halved (rounded up) and joined the old companions in one hero stack (49 heroes with the three new ones). Allied, Nemesis and Companion To are abilities named on the card; see their notes. |
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
| When abilities can be used | Any time on your turn: Elowen, Barnaby. After the location: Grukka. Before bidding: Vaelis, Maren, Urzha, Oskar, Ilvena, Tova, Rook, Gimlet, Tobin. On your bidding decision: Liriel, Thessaly, Tansy. End of bidding (after all reveals): geese, Torvi, Dagny, Brisa, Aelder. Activated abilities are once per turn unless the card says once per game. |
| Only one legal choice | A choice with exactly one legal option resolves by itself (e.g. forcing a hero when there is only one opponent hero, or losing your only hero). |
| Counters (Aldric and Brunna) | Once per turn each, the player who holds the hero is asked before an ability lands. Aldric (Shield of the Dawn) counters any ability that would affect that player's heroes: a forced stat (after Hedda's redirect, if she takes it), and the effects of a location or encounter on their heroes (The Storybook Glade, The Crack in the Marchstone, Parting Strand, the Infectious Zombie). Brunna (Walls First) counters any ability that would affect that player's resources or the current location: a curse placed in front of them, Royal Requisition and Smash and Grab on their hand, The Hollow Between, and any change of the current location (the card that would have replaced it goes back unseen). A countered ability does nothing. Only the first player clockwise who can counter a change of location is asked. |
| Forced stats | A forced hero contributes the forced stat instead of its own (Allied and Nemesis bonuses still add on top). Fennick and Aurelie's players draw the first time each turn anyone is forced. Hedda may take a forced stat meant for another of her player's hero, and Aldric may counter it: see the notes on each. |
| Infectious Zombie | Each player turns up the top resource card; the lowest value (ties turn up again) gives one of their own heroes to the encounter as a zombified hero. It adds its stat for the challenge to the difficulty, counts as Undead while it is there, and is discarded at the end of the turn. The resource cards turned up are discarded. Aldric's player may counter it. |
| Loremaster Oskar (Entered in the Book of Grudges) | Before bidding, once per turn, name an opponent. Each time that opponent uses an ability against Oskar's player's heroes this turn (forcing a stat, or a negative bonus), Oskar's player draws a resource. If Oskar's ability is disabled the grudge is void. |
| Elder Ilvena (Ruling of the Conclave) | Before bidding, once per turn, choose another player's hero. It contributes its lowest stat this turn instead of its usual one. Hedda may take it and Aldric may counter it, like any forcing effect. |
| Dagny Coldhearth (Grudge Paid in Full) | Used at the end of bidding: her player takes the location whatever the totals, discards their hand and loses a hero of their choice. Shield of Xorthalos and Thorgar's Unburied still prevent that fall; the Amulet of Aesia does not. |
| Mayor Hobby | He may play every resource face down, not only the first. Face-down cards reveal in the normal reveal step. |
| Pip Wanderfoot (Wanderlust) | Once per turn, when an ability replaces the location (a resource, Grukka, Barnaby), Pip's player draws a resource. |
| When abilities can be used | The game stops to offer abilities at six moments: the start of your turn, after the location is revealed, before bidding, during bidding (on your own turn to bid), before the reveal, and at the end of bidding (after every card is revealed). "Whenever abilities can be used" means any of these. Each moment is offered to every player in turn, clockwise from the active player, unless the card says "on your turn". Abilities worded "when" or "if you would" happen by themselves and are not offered: where a card says "if that is better" or "when it is higher" the game picks for you. |
| The geese | At the end of bidding the goose reveals the top resource card and discards it. Honk needs a value of 3 or more, Duchess an even value, Waddle an odd one: the goose's player gets +2 to all stats for the rest of the encounter. Cobra Chicken needs a Wand: wands give no bonuses this turn, for everyone. The goose keeps its own stats either way. |
| Lord Vaelis | The drawn encounter is set aside and discarded at the end of the turn. Its minion bonus goes to all of the stats of the player who uses it or of another player of their choice; a negative bonus counts against whoever receives it. |
| Tansy (Rumour Mill) | Choose one opponent and look at all of their face-down bids. You keep seeing those cards for the rest of the turn (your totals for them are exact); other players do not. |
| Thorgar (Unburied) | Once per game, when his player would lose a hero at the end of the turn, they don't, and draw 3 resources. Other effects that make a player fall are prevented the same way. |
| Kazra (Master Golemsmith) | When an Ironbound card enters play (a location, encounter, minion, hero or resource), Kazra's player draws a resource. His Allied: Dwarf bonus covers the Dwarf resources and heroes beside him. |
| The Goose & Kettle | Every player may draw a hero and put it into play. While this place is in play every party may have one more hero. When it leaves, a player with too many heroes discards down at once, their choice. |
| Sigrun Stonefast | The choice (stack or random cards from the discard pile) is made once per draw, for all cards in it. |
| Tova Emberdeep | Resting still counts toward your party size. She returns face up at the start of her controller's next turn with one extra resource. |
| An Apple for the Road | Swaps with any other face-up (or already revealed) bid; the two cards change owners. |
| The Hall of Rest | If you fall after playing it this turn, you also choose any hero from the hero stack to fill the place of the one who fell, instead of waiting for the recruit phase. |
| Hesk of Two Homes | Hesk counts as both an Orc and a Human. Once per turn he gives one extra use of another hero's once-per-turn ability. |
| Grukka (Strike the Heart) | Once per turn, after the location is revealed, the player with Grukka looks at the next location. Only a Capital may be put into play (it replaces the current location, which is shuffled back, and they draw 2 resources); anything else is shuffled back with the rest. If the swap is countered (Brunna) no resources are drawn. The Old Quarry counts as a Capital. |
| Farmer Hobart (Goose & Company) | At the start of the turn of the player who controls him they draw one resource if any Goose card is in play anywhere (a hero in any party, the encounter or a minion). Several geese still give one. |
| Pariapt of Peace | When it is revealed or played face up, Allied and Nemesis give no bonuses to anyone for the rest of the turn. Companion To is not a bonus and is unaffected. |
| The Tome of Nethrak | When revealed or played face up, an Undead minion is drawn from the encounter stack and joins the current encounter until the end of the turn. Its bonus raises the difficulty for every player (including the player of the Tome), and its own "comes into play" text applies. If there is no Undead card left in the stack nothing is drawn. |
| Immobilizing Word | When revealed or played face up, its player chooses an opponent with at least one Companion hero, a hero riding free beside a hero it is Companion To (it does not use a party place). Those heroes are turned face down for the encounter: no stats, no abilities, and they do not count for the Allied bonus of the heroes beside them. They still count toward party size. Aldric may counter it (Shield of the Dawn, for the player it targets). |
| Running out of locations | If the location stack and its discard are both empty, the game ends and the highest Renown wins (ties: earliest seat after the current player). A safety cap of maxTurns also ends the game. |
| Companion To | A hero that is a Companion To other heroes does not count against its player's party size while any one of them is in the party (face down and resting heroes still count as in the party). It can be played on its own, as an ordinary member, when they are away; either one may arrive last. Companions chain: Moss rides with Varg, who rides with Sigrun. If the hero a companion rode with leaves and the party is now over its size, the companions that lost their place leave on their own (no choice); a companion stays if there is room. Ysolde and The Goose & Kettle raise the size as before. |
| "When a challenge is faced" | Fires when the encounter's challenge is announced, on every player's turn, and again if a later location changes the challenge type. |
| Skarra and Destiny the Frog | A Skarra encounter's minion can be anything except another Skarra. When Destiny the Frog would be the encounter, a Skarra encounter is drawn from the stack instead: that card becomes the encounter and Destiny becomes its minion (worth her printed 1), standing in for one of its minion draws. If no Skarra is left in the stack, Destiny is the encounter herself. Everything is discarded at the end of the turn. |
| Curses (Rotten Apple and friends) | A curse is bid like any resource, face up or face down. When it is revealed or played face up, its owner places it in front of an opposing player of their choice; its negative value counts toward that player's bid. It is discarded with the rest at the end of the turn. |
| The Book of Grudges | If its owner loses the encounter (and so loses a hero) and someone else wins, the winner has -3 in the next encounter. It is worth +1 for a player whose party includes Oskar. Penalties from several grudges add up. |
| Marshal Hedda (Self Sacrifice) | Once per turn, when an ability would target one of her player's other heroes (forcing a stat), her player may have it target Hedda instead and draws a resource. Aldric may still counter it. |
| Torvi Cinderkeg (Uncontrolled Explosion) | At the end of bidding, before the winner is declared, Torvi's player may discard a resource from their hand and Torvi himself: every opponent has -6 to their total this encounter. Torvi's replacement is drawn in the normal recruit phase. |
| The Treasure Trow | Every player draws a resource when it enters play (as the encounter or as a minion). When someone survives its challenge, each survivor draws a resource. |
| The Hollow Hills (Fog of the Fey) | While it is the location, face-down resource cards stay hidden until the reveal step: Tansy's Rumour Mill cannot be used, and no ability can reveal or look at a face-down card early. |
| Allied | A hero with Allied gets +1 to all its stats for every other card on its player's board that matches one of its entries: their other heroes in the party (face up) and their resources (face up, and a curse placed in front of them is theirs). An entry is a tag or a single card; a card counts once even if it matches several entries. A face-down bid counts once it is revealed, and never for a player who cannot see it. Heroes borrowed with a Council resource do not count. |
| Nemesis | A hero with Nemesis gets +1 to all its stats for every location, encounter or minion in play that matches one of its entries (a tag, or a single card). A zombified hero counts as an Undead minion. Barrowdeep makes every encounter and minion Undead. Heroes and resources of other players do not count (yet). |
| "When a card enters play" | Any kind of card enters play: a location, an encounter or a minion when it is revealed, a hero when it joins a party (the opening party enters play when everyone has chosen), and a resource when it is revealed or played face up. Once-per-turn triggers (Aelthir, Varg, Caelan, Pip) fire for the first matching card each turn. A hero's own arrival counts. |
| Mogra (Smash and Grab) | When Mogra's player does not win the encounter (they fell, or survived without taking the location) they take a random resource card from an opponent of their choice. Brunna's player may counter it. |
| Goldie (Tavern Keeper) | In the recruit phase Goldie's player draws three heroes instead of one, looks at them privately and chooses one to consider; the other two are discarded. Keeping it follows the usual rules. |
| Brisa (Improvised Explosives) | At the end of bidding she turns one of her player's revealed resources face down (a curse placed in front of them too): it contributes 3 instead of its value, and no longer counts as a face-up card. It cannot be used while The Mirror Mire is the location. |
| Aelder Mossleaf (Inexorable Roots) | At the end of bidding, once per turn, discard a resource from your hand: Aelder gains +3 until the end of the encounter. |
| The Mirror Mire | Every resource is played face up and no ability can turn one face down (not Mayor Hobby's A Little Plan, not Brisa). |
| Barrowdeep | The encounter draws one extra minion (of its minion group, if it has one), and every encounter and minion counts as Undead while it is the location. |
| Grumma (Well Fed Army) | At the end of bidding, if her player bid at least three resources of their own (curses placed in front of them do not count), they draw a resource. |

## Default values

| Setting | Value |
|---|---|
| `renownToWin` | 20 |
| `partySize` | 3 |
| `companionCap` | 9 |
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
