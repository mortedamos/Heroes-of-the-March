// House rules: every interpretation the engine makes where the v0.3 rules are
// silent or ambiguous. Tunable values live in HouseRules; the reasoning for
// each call is in RULE_NOTES (also rendered in docs/HOUSE-RULES.md).

export interface HouseRules {
  renownToWin: number;
  maxCompanions: number;
  startingCompanions: number;
  /** 'playerCount' follows the rules; a number overrides it. */
  drawSize: 'playerCount' | number;
  /** Every player gets a companion decision each turn ('everyone') or only the current player. */
  companionPhase: 'everyone' | 'activeOnly';
  /** Non-bidders still face the encounter (and can fall) when true. */
  allPlayersFaceEncounter: boolean;
  /** Minions count as "an encounter entering play" for hero triggers. */
  minionsTriggerEntersPlay: boolean;
  /** Hard cap on turns so a pathological game always ends. */
  maxTurns: number;
  /** When a hero falls, its player also discards a companion and a resource card of their choice (house rule). */
  fallCost: boolean;
  /**
   * Hero draft: look at this many heroes and keep one, at the start of the
   * game and whenever a hero is replaced. 1 = draw blind (v0.3).
   */
  heroDraft: number;
  /** Also look at `heroDraft` heroes whenever a fallen hero is replaced (house rule, off by default). Otherwise you draw one and may send it back once. */
  draftOnReplace: boolean;
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
  maxCompanions: 2,
  startingCompanions: 2,
  drawSize: 'playerCount',
  companionPhase: 'everyone',
  allPlayersFaceEncounter: true,
  minionsTriggerEntersPlay: true,
  maxTurns: 200,
  fallCost: true,
  heroDraft: 3,
  draftOnReplace: false,
  handModel: 'steady',
  activeDraw: 2,
  othersDraw: 1,
  handLimit: 6,
};

/** At the start of the game each player looks at this many companions and keeps `startingCompanions` (Ysolde: one more). */
export const OPENING_COMPANION_POOL = 5;
/** On later turns the companion phase lets you look at this many and keep one. */
export const COMPANION_PHASE_POOL = 3;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export interface RuleNote { id: string; topic: string; ruling: string }

export const RULE_NOTES: RuleNote[] = [
  { id: 'hero-draft', topic: 'Hero draft (house rule)',
    ruling: 'At the start of the game everyone looks at the top 3 heroes, keeps one and shuffles the rest back; nobody else sees them. When your hero falls you instead draw the top hero and may keep it or send it back and draw one more (which you must keep). The Hall of Rest still lets you choose from the whole hero stack. Option: look at 3 every time (draftOnReplace).' },
  { id: 'hand-model', topic: 'Steady draws (house rule)',
    ruling: 'Replaces "refill to the draw size on your turn": at the start of every turn the current player draws 2 resources and every other player draws 1, but routine draws stop at a hand of 6. Opening hands are still the player count. Draws from card abilities can go past 6. The v0.3 refill rule can be chosen when starting a game.' },
  { id: 'one-stat', topic: 'One stat per encounter (house rule)',
    ruling: 'There is no challenge roll. Each encounter is faced on one stat, its highest printed difficulty (ties were settled by the designers so each stat comes up equally often). Ability dice, Iron Mites and tiebreaks still roll.' },
  { id: 'opening', topic: 'The opening companion phase (house rule)',
    ruling: 'At the start of the game each player draws 5 companions and picks 2 (a hero that can keep a third, Ysolde, picks 3); the rest are shuffled back unseen. Nobody can use or trigger any hero or companion ability until every player has picked. The picked companions "enter play" (draws and other enter-play effects) when that phase ends, in turn order; start-of-turn abilities follow.' },
  { id: 'difficulty', topic: 'Harder challenges (house rule)',
    ruling: 'Every encounter card is printed 1 to 3 harder than the original game (easier ones more, and ones that already draw minions or have a condition less), so surviving is no longer a given and spending to survive is a real choice.' },
  { id: 'fall-cost', topic: 'Falling costs (house rule)',
    ruling: 'When your hero falls you also discard one of your companions (you choose which), before your new hero arrives. Nothing is discarded if you have none. Your hand is not affected.' },
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
    ruling: 'Tied winners each roll a die; the highest roll wins and ties re-roll. Tiebreak rolls never fire "when a N is rolled" triggers.' },
  { id: 'fall-cost', topic: 'Falling',
    ruling: 'Falling costs no Renown. The new hero is drawn before the fallen one is shuffled back, so you never redraw the same hero.' },
  { id: 'fall-timing', topic: 'Fall timing',
    ruling: 'Every player who fails the encounter falls at the end of that turn, whoever\'s turn it is. Players who fall at once choose their replacements one after another, so nobody draws the same hero.' },
  { id: 'companion-phase', topic: 'Companion phase',
    ruling: 'From turn 2, starting with the current player and going clockwise, each player may draw 3 companions and pick 1 (the rest are shuffled back unseen). If that would take you past your companion limit, you must replace one of your companions. Toggle: companionPhase.' },
  { id: 'draw-size', topic: 'Draw size',
    ruling: 'Draw size counts every seat, bots included.' },
  { id: 'empty-decks', topic: 'Empty stacks',
    ruling: 'An empty stack is refilled by shuffling its discard pile. If both are empty, nothing is drawn.' },
  { id: 'minion-triggers', topic: 'Minions entering play',
    ruling: 'Minions count as encounters entering play for hero triggers (e.g. Pip\'s Ironbound trigger). Toggle: minionsTriggerEntersPlay.' },
  { id: 'minion-search', topic: 'Minion search',
    ruling: 'A minion of a named group is taken from the top-most matching card of the encounter stack, then its discard pile. If neither has one, no minion is drawn.' },
  { id: 'group-boost', topic: 'Location group boosts',
    ruling: '"Challenges and minion bonuses of X encounters are increased by 2" applies to the main encounter if it is X, and to each X minion.' },
  { id: 'resource-against', topic: '"5 against X" resources',
    ruling: 'The higher value applies when the main encounter belongs to group X.' },
  { id: 'thorgar-margin', topic: 'Winning margin',
    ruling: 'Margin = winner\'s total minus the next-highest survivor\'s total, or minus the difficulty if the winner was the only survivor.' },
  { id: 'optional-auto', topic: 'Always-beneficial "may" effects',
    ruling: 'Optional effects that can only help (stat substitutions, drawing extra resources, council heroes, Kazra ignoring positive minion bonuses) are applied automatically in the player\'s favour.' },
  { id: 'bonus-location', topic: 'Unclaimed bonus location',
    ruling: 'The face-down extra location from The Endless Road or The Pirate Fens is shuffled back into the location stack unseen if nobody wins.' },
  { id: 'setup-triggers', topic: 'Setup',
    ruling: 'Triggers do not fire during setup; they start with turn 1.' },
  { id: 'ability-windows', topic: 'When abilities can be used',
    ruling: 'Start of turn: Aelthir, Wren. After the location: Grukka (any turn), Barnaby (your turn). Before bidding: Vaelis, Maren, Tova, Ilvena. On your bidding decision: forced-stat companions, Aldric, Pip (others\' turns), Urzha. End of bidding (after all reveals): geese, Mags, Mira. Activated abilities are once per turn unless the card says once per game.' },
  { id: 'single-option', topic: 'Only one legal choice',
    ruling: 'A choice with exactly one legal option resolves by itself (e.g. forcing a hero when there is only one opponent).' },
  { id: 'aldric', topic: 'Shield of the Dawn (Aldric)',
    ruling: 'Disables one opposing hero\'s or companion\'s abilities for the rest of the turn and cancels every effect it created this turn. It cannot undo something already done (a claimed card stays claimed).' },
  { id: 'forced-stats', topic: 'Forced stats',
    ruling: 'A forced companion or hero contributes the forced stat instead of any other (including their own substitutions). Brunna\'s player takes whichever is higher. Mayor Hobby\'s player draws each time anyone is forced.' },
  { id: 'iron-mites', topic: 'Iron Mites',
    ruling: 'Players with companions roll; the lowest roller (ties re-roll) gives one of their own companions to the encounter as a minion. It adds its stat for the challenge to the difficulty and is discarded at the end of the turn.' },
  { id: 'oskar', topic: 'Loremaster Oskar',
    ruling: 'Once per turn, on any player\'s turn, a face-down card turned face up with a positive value may be made to count negative (Oskar\'s controller decides).' },
  { id: 'ilvena', topic: 'Elder Ilvena (Ruling of the Conclave)',
    ruling: 'Before bidding, once per turn: discard a resource card from your hand (the price, paid first), then choose another player\'s companion. It contributes its lowest stat this turn instead of its usual one. Aldric and Brunna can still cancel it like any forcing effect.' },
  { id: 'mira', topic: 'Mira Coldwater',
    ruling: 'Used at the end of bidding: her player takes the location whatever the totals, discards their hand and their hero falls. Shield of Xorthalos still prevents that fall; the Amulet of Aesia does not.' },
  { id: 'mags', topic: 'Mags Tolliver',
    ruling: 'Used at the end of bidding; she is discarded at the end of the turn only if her ability was used.' },
  { id: 'hobby', topic: 'Mayor Hobby',
    ruling: 'His first bid may be face down too. Face-down cards still reveal in the normal reveal step.' },
  { id: 'pip', topic: 'Pip Wanderfoot',
    ruling: 'The claimed card becomes Pip\'s bid, stays face down until the reveal step, and Pip may look at it.' },
  { id: 'geese', topic: 'The geese',
    ruling: '"Gain 3 physical" adds 3 to your Physical total this turn; it only helps on a Physical challenge. A failed roll means that goose contributes nothing this turn.' },
  { id: 'vaelis', topic: 'Lord Vaelis',
    ruling: 'The drawn encounter is set aside and discarded at the end of the turn. Negative minion values count against you.' },
  { id: 'waystone', topic: 'The Waystone Inn',
    ruling: 'Drawing is optional. If you draw, the companion enters play and you then discard one of your companions (possibly the new one).' },
  { id: 'sigrun', topic: 'Sigrun Stonefast',
    ruling: 'The choice (stack or random cards from the discard pile) is made once per draw, for all cards in it.' },
  { id: 'tova', topic: 'Tova Emberdeep',
    ruling: 'Resting still counts toward your companion limit. She returns face up at the start of her controller\'s next turn with one extra resource.' },
  { id: 'apple', topic: 'An Apple for the Road',
    ruling: 'Swaps with any other face-up (or already revealed) bid; the two cards change owners.' },
  { id: 'hall-of-rest', topic: 'The Hall of Rest',
    ruling: 'If your hero falls from this turn, you choose any hero from the hero stack instead of drawing.' },
  { id: 'hesk', topic: 'Hesk of Two Homes',
    ruling: 'One extra use per turn of one companion\'s once-per-turn ability (heroes\' abilities are not included).' },
  { id: 'dice-mods', topic: 'Ability dice',
    ruling: 'The Hollow Hills invert ability rolls (a roll of r counts as 7 - r). Mogra lets her controller, on their own turn, roll ability dice twice and keep either. Challenge rolls and tiebreaks are not ability rolls.' },
  { id: 'game-end', topic: 'Running out of locations',
    ruling: 'If the location stack and its discard are both empty, the game ends and the highest Renown wins (ties: earliest seat after the current player). A safety cap of maxTurns also ends the game.' },
];
