// House rules: every interpretation the engine makes where the v0.3 rules are
// silent or ambiguous. Tunable values live in HouseRules; the reasoning for
// each call is in RULE_NOTES (also rendered in docs/HOUSE-RULES.md).

export interface HouseRules {
  renownToWin: number;
  /** Heroes in a party. (Ysolde, companions and The Goose & Kettle raise it for their player.) */
  partySize: number;
  /** The most heroes of one party that may ride for free as companions. 9 means no cap (the card rules as written); a balance lever. */
  companionCap: number;
  /** 'playerCount' follows the rules; a number overrides it. */
  drawSize: 'playerCount' | number;
  /** Every player gets a recruit decision each turn ('everyone') or only the current player. */
  recruitPhase: 'everyone' | 'activeOnly';
  /** Non-bidders still face the encounter (and lose a hero) when true. */
  allPlayersFaceEncounter: boolean;
  /** Minions count as "an encounter entering play" for enter-play triggers (Kesh). */
  minionsTriggerEntersPlay: boolean;
  /** Hard cap on turns so a pathological game always ends. */
  maxTurns: number;
  /** Opening party draft: each player privately looks at this many heroes and keeps `partySize` of them. */
  draftPool: number;
  /**
   * How resource cards come in.
   *  'refill' (v0.3): the current player refills to the draw size at the start of their turn.
   *  'steady': at the start of every turn the current player draws `activeDraw` and every
   *            other player draws `othersDraw`, never beyond `handLimit`.
   */
  handModel: 'refill' | 'steady';
  activeDraw: number;
  othersDraw: number;
  handLimit: number;
}

export const DEFAULT_RULES: HouseRules = {
  renownToWin: 20,
  partySize: 3,
  companionCap: 9,
  drawSize: 'playerCount',
  recruitPhase: 'everyone',
  allPlayersFaceEncounter: true,
  minionsTriggerEntersPlay: true,
  maxTurns: 200,
  draftPool: 6,
  handModel: 'steady',
  activeDraw: 2,
  othersDraw: 2,
  handLimit: 6,
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export interface RuleNote { id: string; topic: string; ruling: string }

export const RULE_NOTES: RuleNote[] = [
  { id: 'party', topic: 'The adventuring party (house rule)',
    ruling: 'There is no separate hero and companions: every player leads a party of three heroes, and their stats add together. The old heroes were halved (rounded up) and joined the old companions in one hero stack (49 heroes with the three new ones). Allied, Nemesis and Companion To are abilities named on the card; see their notes.' },
  { id: 'party-draft', topic: 'The opening party draft (house rule)',
    ruling: 'At the start of the game each player, in turn order, privately looks at the top 6 heroes and picks 3; the rest are shuffled back unseen. Nobody can use or trigger any hero ability until every player has picked. The picked heroes "enter play" (draws and other enter-play effects) when that phase ends, in turn order; start-of-turn abilities follow.' },
  { id: 'recruit-phase', topic: 'Recruit phase',
    ruling: 'From turn 2, starting with the current player and going clockwise, each player may draw one hero at random and decide whether to keep it. If keeping it would take you past your party size, you must replace one of your heroes. Toggle: recruitPhase.' },
  { id: 'hand-model', topic: 'Steady draws (house rule)',
    ruling: 'Replaces "refill to the draw size on your turn": at the start of every turn every player draws 2 resources, but routine draws stop at a hand of 6. Opening hands are still the player count. Draws from card abilities can go past 6. (With the old hero triggers set aside, one card for the other players left too few cards to bid; the balance simulation put it back.) The v0.3 refill rule can be chosen when starting a game.' },
  { id: 'one-stat', topic: 'One stat per encounter (house rule)',
    ruling: 'There is no challenge roll. Each encounter is faced on one stat, its highest printed difficulty (ties were settled by the designers so each stat comes up equally often). There are no dice in the game.' },
  { id: 'difficulty', topic: 'Challenge levels (house rule)',
    ruling: 'A party of three heroes is weaker than the old hero and two companions, so every encounter is printed 5 or 6 lower than in the earlier house rules (Physical -5, Mental -6, Guile -5). The amount was set with the balance simulation so that surviving, falling and the length of a game match the old game. The numbers on the cards are the ones that count.' },
  { id: 'fall', topic: 'Falling (house rule)',
    ruling: 'Every player who fails the encounter loses a hero at the end of that turn, whoever\'s turn it is: they choose which of their heroes falls, and it goes to the hero discard pile. Players who fall at once choose one after another. Falling costs no Renown and nothing else; the party refills in the recruit phase (or at once with The Hall of Rest). A player with no heroes loses nothing.' },
  { id: 'bidding-end', topic: 'End of bidding',
    ruling: 'Bidding ends when every player passes in a row. A player who passed may bid again if someone else bids after them.' },
  { id: 'bidding-empty-hand', topic: 'Empty hand',
    ruling: 'A player with no resource cards passes automatically.' },
  { id: 'reveal-order', topic: 'Reveal order',
    ruling: 'Face-down bids are revealed round-robin, one card per player at a time, starting with the player after the last one to pass (the player who would have bid next).' },
  { id: 'face-up-is-reveal', topic: 'Face-up bids',
    ruling: 'Playing a card face up counts as revealing it, so "when revealed" effects happen immediately.' },
  { id: 'everyone-faces', topic: 'Who faces the encounter',
    ruling: 'Every player is measured against the challenge, whether or not they bid (the rules total "each player"). Non-bidders can fall. Toggle: allPlayersFaceEncounter.' },
  { id: 'no-survivors', topic: 'No survivors',
    ruling: 'If nobody survives, nobody claims the location and it is discarded.' },
  { id: 'ties', topic: 'Ties',
    ruling: 'If survivors are level on the highest total, nobody takes the current location: it is discarded. Each tied player instead draws a location at random and claims it, scoring its Renown only. The abilities and conditions of that card do not trigger, and win triggers (such as Mogra) do not fire. If the stack is empty, a tied player gets nothing.' },
  { id: 'draw-size', topic: 'Draw size',
    ruling: 'Draw size counts every seat, bots included.' },
  { id: 'empty-decks', topic: 'Empty stacks',
    ruling: 'An empty stack is refilled by shuffling its discard pile. If both are empty, nothing is drawn.' },
  { id: 'minion-triggers', topic: 'Minions entering play',
    ruling: 'Minions count as encounters entering play for "enters play" triggers (e.g. Kesh\'s Beast trigger). Toggle: minionsTriggerEntersPlay.' },
  { id: 'minion-search', topic: 'Minion search',
    ruling: 'A minion of a named group is taken from the top-most matching card of the encounter stack, then its discard pile. If neither has one, no minion is drawn.' },
  { id: 'group-boost', topic: 'Location group boosts',
    ruling: '"Challenges and minion bonuses of X encounters are increased by 2" applies to the main encounter if it is X, and to each X minion.' },
  { id: 'resource-against', topic: '"5 against X" resources',
    ruling: 'The higher value applies when the main encounter belongs to group X.' },
  { id: 'thorgar-margin', topic: 'Winning margin',
    ruling: 'Margin = winner\'s total minus the next-highest survivor\'s total, or minus the difficulty if the winner was the only survivor.' },
  { id: 'optional-auto', topic: 'Always-beneficial "may" effects',
    ruling: 'Optional effects that can only help (stat substitutions, drawing extra resources, council heroes) are applied automatically in the player\'s favour.' },
  { id: 'bonus-location', topic: 'Unclaimed bonus location',
    ruling: 'The face-down extra location from The Endless Road or The Pirate Fens is shuffled back into the location stack unseen if nobody wins.' },
  { id: 'setup-triggers', topic: 'Setup',
    ruling: 'Triggers do not fire during setup; they start with turn 1.' },
  { id: 'ability-windows', topic: 'When abilities can be used',
    ruling: 'Any time on your turn: Elowen, Barnaby. After the location: Grukka. Before bidding: Vaelis, Maren, Urzha, Oskar, Ilvena, Tova, Rook, Gimlet, Tobin. On your bidding decision: Liriel, Thessaly, Tansy. End of bidding (after all reveals): geese, Torvi, Dagny, Brisa, Aelder. Activated abilities are once per turn unless the card says once per game.' },
  { id: 'single-option', topic: 'Only one legal choice',
    ruling: 'A choice with exactly one legal option resolves by itself (e.g. forcing a hero when there is only one opponent hero, or losing your only hero).' },
  { id: 'aldric', topic: 'Counters (Aldric and Brunna)',
    ruling: 'Once per turn each, the player who holds the hero is asked before an ability lands. Aldric (Shield of the Dawn) counters any ability that would affect that player\'s heroes: a forced stat (after Hedda\'s redirect, if she takes it), and the effects of a location or encounter on their heroes (The Storybook Glade, The Crack in the Marchstone, Parting Strand, the Infectious Zombie). Brunna (Walls First) counters any ability that would affect that player\'s resources or the current location: a curse placed in front of them, Royal Requisition and Smash and Grab on their hand, The Hollow Between, and any change of the current location (the card that would have replaced it goes back unseen). A countered ability does nothing. Only the first player clockwise who can counter a change of location is asked.' },
  { id: 'forced-stats', topic: 'Forced stats',
    ruling: 'A forced hero contributes the forced stat instead of its own (Allied and Nemesis bonuses still add on top). Fennick and Aurelie\'s players draw the first time each turn anyone is forced. Hedda may take a forced stat meant for another of her player\'s hero, and Aldric may counter it: see the notes on each.' },
  { id: 'iron-mites', topic: 'Infectious Zombie',
    ruling: 'Each player turns up the top resource card; the lowest value (ties turn up again) gives one of their own heroes to the encounter as a zombified hero. It adds its stat for the challenge to the difficulty, counts as Undead while it is there, and is discarded at the end of the turn. The resource cards turned up are discarded. Aldric\'s player may counter it.' },
  { id: 'oskar', topic: 'Loremaster Oskar (Entered in the Book of Grudges)',
    ruling: 'Before bidding, once per turn, name an opponent. Each time that opponent uses an ability against Oskar\'s player\'s heroes this turn (forcing a stat, or a negative bonus), Oskar\'s player draws a resource. If Oskar\'s ability is disabled the grudge is void.' },
  { id: 'ilvena', topic: 'Elder Ilvena (Ruling of the Conclave)',
    ruling: 'Before bidding, once per turn, choose another player\'s hero. It contributes its lowest stat this turn instead of its usual one. Hedda may take it and Aldric may counter it, like any forcing effect.' },
  { id: 'dagny', topic: 'Dagny Coldhearth (Grudge Paid in Full)',
    ruling: 'Used at the end of bidding: her player takes the location whatever the totals, discards their hand and loses a hero of their choice. Shield of Xorthalos and Thorgar\'s Unburied still prevent that fall; the Amulet of Aesia does not.' },
  { id: 'hobby', topic: 'Mayor Hobby',
    ruling: 'He may play every resource face down, not only the first. Face-down cards reveal in the normal reveal step.' },
  { id: 'pip', topic: 'Pip Wanderfoot (Wanderlust)',
    ruling: 'Once per turn, when an ability replaces the location (a resource, Grukka, Barnaby), Pip\'s player draws a resource.' },
  { id: 'moments', topic: 'When abilities can be used',
    ruling: 'The game stops to offer abilities at six moments: the start of your turn, after the location is revealed, before bidding, during bidding (on your own turn to bid), before the reveal, and at the end of bidding (after every card is revealed). "Whenever abilities can be used" means any of these. Each moment is offered to every player in turn, clockwise from the active player, unless the card says "on your turn". Abilities worded "when" or "if you would" happen by themselves and are not offered: where a card says "if that is better" or "when it is higher" the game picks for you.' },
  { id: 'geese', topic: 'The geese',
    ruling: 'At the end of bidding the goose reveals the top resource card and discards it. Honk needs a value of 3 or more, Duchess an even value, Waddle an odd one: the goose\'s player gets +2 to all stats for the rest of the encounter. Cobra Chicken needs a Wand: wands give no bonuses this turn, for everyone. The goose keeps its own stats either way.' },
  { id: 'vaelis', topic: 'Lord Vaelis',
    ruling: 'The drawn encounter is set aside and discarded at the end of the turn. Its minion bonus goes to all of the stats of the player who uses it or of another player of their choice; a negative bonus counts against whoever receives it.' },
  { id: 'rumour', topic: 'Tansy (Rumour Mill)',
    ruling: 'Choose one opponent and look at all of their face-down bids. You keep seeing those cards for the rest of the turn (your totals for them are exact); other players do not.' },
  { id: 'thorgar', topic: 'Thorgar (Unburied)',
    ruling: 'Once per game, when his player would lose a hero at the end of the turn, they don\'t, and draw 3 resources. Other effects that make a player fall are prevented the same way.' },
  { id: 'kazra', topic: 'Kazra (Master Golemsmith)',
    ruling: 'When an Ironbound card enters play (a location, encounter, minion, hero or resource), Kazra\'s player draws a resource. His Allied: Dwarf bonus covers the Dwarf resources and heroes beside him.' },
  { id: 'waystone', topic: 'The Goose & Kettle',
    ruling: 'Every player may draw a hero and put it into play. While this place is in play every party may have one more hero. When it leaves, a player with too many heroes discards down at once, their choice.' },
  { id: 'sigrun', topic: 'Sigrun Stonefast',
    ruling: 'The choice (stack or random cards from the discard pile) is made once per draw, for all cards in it.' },
  { id: 'tova', topic: 'Tova Emberdeep',
    ruling: 'Resting still counts toward your party size. She returns face up at the start of her controller\'s next turn with one extra resource.' },
  { id: 'apple', topic: 'An Apple for the Road',
    ruling: 'Swaps with any other face-up (or already revealed) bid; the two cards change owners.' },
  { id: 'hall-of-rest', topic: 'The Hall of Rest',
    ruling: 'If you fall after playing it this turn, you also choose any hero from the hero stack to fill the place of the one who fell, instead of waiting for the recruit phase.' },
  { id: 'hesk', topic: 'Hesk of Two Homes',
    ruling: "Hesk counts as both an Orc and a Human. Once per turn he gives one extra use of another hero's once-per-turn ability." },
  { id: 'game-end', topic: 'Running out of locations',
    ruling: 'If the location stack and its discard are both empty, the game ends and the highest Renown wins (ties: earliest seat after the current player). A safety cap of maxTurns also ends the game.' },
  { id: 'bonus-pairs', topic: 'Companion To',
    ruling: 'A hero that is a Companion To other heroes does not count against its player\'s party size while any one of them is in the party (face down and resting heroes still count as in the party). It can be played on its own, as an ordinary member, when they are away; either one may arrive last. Companions chain: Moss rides with Varg, who rides with Sigrun. If the hero a companion rode with leaves and the party is now over its size, the companions that lost their place leave on their own (no choice); a companion stays if there is room. Ysolde and The Goose & Kettle raise the size as before.' },
  { id: 'challenge-faced', topic: '"When a challenge is faced"',
    ruling: 'Fires when the encounter\'s challenge is announced, on every player\'s turn, and again if a later location changes the challenge type.' },
  { id: 'skarra-destiny', topic: 'Skarra and Destiny the Frog',
    ruling: 'A Skarra encounter\'s minion can be anything except another Skarra. When Destiny the Frog would be the encounter, a Skarra encounter is drawn from the stack instead: that card becomes the encounter and Destiny becomes its minion (worth her printed 1), standing in for one of its minion draws. If no Skarra is left in the stack, Destiny is the encounter herself. Everything is discarded at the end of the turn.' },
  { id: 'curses', topic: 'Curses (Rotten Apple and friends)',
    ruling: 'A curse is bid like any resource, face up or face down. When it is revealed or played face up, its owner places it in front of an opposing player of their choice; its negative value counts toward that player\'s bid. It is discarded with the rest at the end of the turn.' },
  { id: 'grudges', topic: 'The Book of Grudges',
    ruling: 'If its owner loses the encounter (and so loses a hero) and someone else wins, the winner has -3 in the next encounter. It is worth +1 for a player whose party includes Oskar. Penalties from several grudges add up.' },
  { id: 'hedda', topic: 'Marshal Hedda (Self Sacrifice)',
    ruling: 'Once per turn, when an ability would target one of her player\'s other heroes (forcing a stat), her player may have it target Hedda instead and draws a resource. Aldric may still counter it.' },
  { id: 'torvi', topic: 'Torvi Cinderkeg (Uncontrolled Explosion)',
    ruling: 'At the end of bidding, before the winner is declared, Torvi\'s player may discard a resource from their hand and Torvi himself: every opponent has -6 to their total this encounter. Torvi\'s replacement is drawn in the normal recruit phase.' },
  { id: 'treasure-trow', topic: 'The Treasure Trow',
    ruling: 'Every player draws a resource when it enters play (as the encounter or as a minion). When someone survives its challenge, each survivor draws a resource.' },
  { id: 'fog-of-the-fey', topic: 'The Hollow Hills (Fog of the Fey)',
    ruling: 'While it is the location, face-down resource cards stay hidden until the reveal step: Tansy\'s Rumour Mill cannot be used, and no ability can reveal or look at a face-down card early.' },
  { id: 'allied', topic: 'Allied',
    ruling: 'A hero with Allied gets +1 to all its stats for every other card on its player\'s board that matches one of its entries: their other heroes in the party (face up) and their resources (face up, and a curse placed in front of them is theirs). An entry is a tag or a single card; a card counts once even if it matches several entries. A face-down bid counts once it is revealed, and never for a player who cannot see it. Heroes borrowed with a Council resource do not count.' },
  { id: 'nemesis', topic: 'Nemesis',
    ruling: 'A hero with Nemesis gets +1 to all its stats for every location, encounter or minion in play that matches one of its entries (a tag, or a single card). A zombified hero counts as an Undead minion. Barrowdeep makes every encounter and minion Undead. Heroes and resources of other players do not count (yet).' },
  { id: 'enters-play', topic: '"When a card enters play"',
    ruling: 'Any kind of card enters play: a location, an encounter or a minion when it is revealed, a hero when it joins a party (the opening party enters play when everyone has chosen), and a resource when it is revealed or played face up. Once-per-turn triggers (Aelthir, Varg, Caelan, Pip) fire for the first matching card each turn. A hero\'s own arrival counts.' },
  { id: 'mogra', topic: 'Mogra (Smash and Grab)',
    ruling: 'When Mogra\'s player does not win the encounter (they fell, or survived without taking the location) they take a random resource card from an opponent of their choice. Brunna\'s player may counter it.' },
  { id: 'tavern', topic: 'Goldie (Tavern Keeper)',
    ruling: 'In the recruit phase Goldie\'s player draws three heroes instead of one, looks at them privately and chooses one to consider; the other two are discarded. Keeping it follows the usual rules.' },
  { id: 'brisa', topic: 'Brisa (Improvised Explosives)',
    ruling: 'At the end of bidding she turns one of her player\'s revealed resources face down (a curse placed in front of them too): it contributes 3 instead of its value, and no longer counts as a face-up card. It cannot be used while The Mirror Mire is the location.' },
  { id: 'aelder', topic: 'Aelder Mossleaf (Inexorable Roots)',
    ruling: 'At the end of bidding, once per turn, discard a resource from your hand: Aelder gains +3 until the end of the encounter.' },
  { id: 'mirror-mire', topic: 'The Mirror Mire',
    ruling: 'Every resource is played face up and no ability can turn one face down (not Mayor Hobby\'s A Little Plan, not Brisa).' },
  { id: 'barrowdeep', topic: 'Barrowdeep',
    ruling: 'The encounter draws one extra minion (of its minion group, if it has one), and every encounter and minion counts as Undead while it is the location.' },
  { id: 'grumma', topic: 'Grumma (Well Fed Army)',
    ruling: 'At the end of bidding, if her player bid at least three resources of their own (curses placed in front of them do not count), they draw a resource.' },
];
