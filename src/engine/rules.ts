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

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export interface RuleNote { id: string; topic: string; ruling: string }

export const RULE_NOTES: RuleNote[] = [
  { id: 'hero-draft', topic: 'Hero draft (house rule)',
    ruling: 'At the start of the game everyone looks at the top 3 heroes, keeps one and shuffles the rest back; nobody else sees them. When your hero falls you instead draw the top hero and may keep it or send it back and draw one more (which you must keep). The Hall of Rest still lets you choose from the whole hero stack. Option: look at 3 every time (draftOnReplace).' },
  { id: 'hand-model', topic: 'Steady draws (house rule)',
    ruling: 'Replaces "refill to the draw size on your turn": at the start of every turn the current player draws 2 resources and every other player draws 1, but routine draws stop at a hand of 6. Opening hands are still the player count. Draws from card abilities can go past 6. The v0.3 refill rule can be chosen when starting a game.' },
  { id: 'one-stat', topic: 'One stat per encounter (house rule)',
    ruling: 'There is no challenge roll. Each encounter is faced on one stat, its highest printed difficulty (ties were settled by the designers so each stat comes up equally often). There are no dice in the game.' },
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
    ruling: 'If survivors are level on the highest total, nobody takes the current location: it is discarded. Each tied player instead draws a location at random and claims it, scoring its Renown only. The abilities and conditions of that card do not trigger, and win triggers (such as Thorgar) do not fire. If the stack is empty, a tied player gets nothing.' },
  { id: 'fall-cost', topic: 'Falling',
    ruling: 'Falling costs no Renown. The new hero is drawn before the fallen one is shuffled back, so you never redraw the same hero.' },
  { id: 'fall-timing', topic: 'Fall timing',
    ruling: 'Every player who fails the encounter falls at the end of that turn, whoever\'s turn it is. Players who fall at once choose their replacements one after another, so nobody draws the same hero.' },
  { id: 'companion-phase', topic: 'Companion phase',
    ruling: 'From turn 2, starting with the current player and going clockwise, each player may draw one companion at random and decide whether to keep it. If keeping it would take you past your companion limit, you must replace one of your companions. Toggle: companionPhase.' },
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
  { id: 'iron-mites', topic: 'Infectious Zombie',
    ruling: 'Players with companions each turn up the top resource card; the lowest value (ties turn up again) gives one of their own companions to the encounter as a minion. It adds its stat for the challenge to the difficulty and is discarded at the end of the turn. The resource cards turned up are discarded.' },
  { id: 'oskar', topic: 'Loremaster Oskar (Entered in the Grudge Book)',
    ruling: "At the start of bidding, once per turn, name an opponent. If they win the encounter, they have -3 to their total in the next encounter only. Aldric can counter it; if Oskar's ability is disabled the grudge is void." },
  { id: 'ilvena', topic: 'Elder Ilvena (Ruling of the Conclave)',
    ruling: "Before bidding, once per turn, choose another player's companion. It contributes its lowest stat this turn instead of its usual one. Aldric, Brunna and Hedda can still cancel it like any forcing effect." },
  { id: 'mira', topic: 'Dagny Coldhearth (Grudge Paid in Full)',
    ruling: 'Used at the end of bidding: her player takes the location whatever the totals, discards their hand and their hero falls. Shield of Xorthalos still prevents that fall; the Amulet of Aesia does not.' },
  { id: 'mags', topic: 'Mags Tolliver',
    ruling: 'Used at the end of bidding; she is discarded at the end of the turn only if her ability was used.' },
  { id: 'hobby', topic: 'Mayor Hobby',
    ruling: 'He may play every resource face down, not only the first. Face-down cards reveal in the normal reveal step.' },
  { id: 'pip', topic: 'Pip Wanderfoot',
    ruling: 'The claimed card becomes Pip\'s bid, stays face down until the reveal step, and Pip may look at it.' },
  { id: 'geese', topic: 'The geese',
    ruling: '"Gain 3 physical" adds 3 to your Physical total this turn; it only helps on a Physical challenge. A failed roll means that goose contributes nothing this turn.' },
  { id: 'vaelis', topic: 'Lord Vaelis',
    ruling: 'The drawn encounter is set aside and discarded at the end of the turn. Its minion bonus goes to all of the stats of the player who uses it or of another player of their choice; a negative bonus counts against whoever receives it.' },
  { id: 'rumour', topic: 'Goldie (Rumour Mill)',
    ruling: 'Choose one opponent and look at all of their face-down bids. You keep seeing those cards for the rest of the turn (your totals for them are exact); other players do not.' },
  { id: 'thorgar', topic: 'Thorgar (Unburied)',
    ruling: 'Once per game, when he would fall at the end of the turn, he does not, and his player draws 3 resources. Other effects that make heroes fall are prevented the same way.' },
  { id: 'kazra', topic: 'Kazra (The Right Tools)',
    ruling: 'Each Dwarf resource card the Kazra player bids is worth 1 more. A curse placed in front of him is not his bid and gets no bonus.' },
  { id: 'waystone', topic: 'The Goose & Kettle',
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
    ruling: "Hesk is a companion, and counts as both an Orc and a Human for every Kin bonus. Once per turn he gives one extra use of another companion's once-per-turn ability (heroes' abilities are not included)." },
  { id: 'game-end', topic: 'Running out of locations',
    ruling: 'If the location stack and its discard are both empty, the game ends and the highest Renown wins (ties: earliest seat after the current player). A safety cap of maxTurns also ends the game.' },
  { id: 'kin', topic: 'Kin bonuses (heroes)',
    ruling: 'Every hero has one. A: +1 to every stat of your hero for each companion of the hero\'s kingdom you control (face up, not resting). B: when a card of the hero\'s kingdom enters play under your control, draw a resource. A companion enters when it is put into play; a resource enters when it is revealed or played face up (face-down bids do not count until then, and a claimed or cursed card counts for the player holding it when it is revealed). Locations, encounters and heroes do not trigger it. C: while an opponent controls a companion of the hero\'s kingdom, that companion gets -1 to each of its stats (never below 0; Brunna ignores it). A half-breed (Hesk) counts for both of his kingdoms.' },
  { id: 'bonus-pairs', topic: 'Bonus companions (Varg and Moss, Goldie and Gimlet)',
    ruling: 'With both members of a pair in your party your companion limit is one higher (Ysolde with both pairs: five). A pair member drawn while its partner is in play may be kept above the normal limit. If the pair is broken (one leaves play) and you are over the limit, you immediately choose companions to discard down to it.' },
  { id: 'challenge-faced', topic: '"When a challenge is faced"',
    ruling: 'Fires when the encounter\'s challenge is announced, on every player\'s turn, and again if a later location changes the challenge type.' },
  { id: 'skarra-destiny', topic: 'Skarra and Destiny the Frog',
    ruling: 'A Skarra encounter\'s minion can be anything except another Skarra. When Destiny the Frog would be the encounter, a Skarra encounter is drawn from the stack instead: that card becomes the encounter and Destiny becomes its minion (worth her printed 1), standing in for one of its minion draws. If no Skarra is left in the stack, Destiny is the encounter herself. Everything is discarded at the end of the turn.' },
  { id: 'curses', topic: 'Curses (Rotten Apple and friends)',
    ruling: 'A curse is bid like any resource, face up or face down. When it is revealed or played face up, its owner places it in front of an opposing player of their choice; its negative value counts toward that player\'s bid. It is discarded with the rest at the end of the turn.' },
  { id: 'grudges', topic: 'The Book of Grudges',
    ruling: 'If its owner loses the encounter (their hero falls) and someone else wins, the winner has -3 in the next encounter. It is worth +1 for a player whose hero is Oskar. Penalties from several grudges add up.' },
  { id: 'hedda', topic: 'Marshal Hedda (Hold the Line)',
    ruling: 'Once per turn, the first opposing ability that would silence, force the stat of, or disable one of her controller\'s companions has no effect (including a counter by Aldric). Abilities aimed at heroes or resources are not covered.' },
  { id: 'torvi', topic: 'Torvi Cinderkeg (Fire in the Hole)',
    ruling: 'Used at the end of bidding, before the winner is declared. Torvi is discarded (so his own stat no longer counts) and every opponent has -4 to their total this encounter, or -5 if the player controls a revealed Mhorgrim\'s Hunt. Torvi\'s replacement is drawn in the normal companion phase.' },
  { id: 'treasure-trow', topic: 'The Treasure Trow',
    ruling: 'Every player draws a resource when it enters play (as the encounter or as a minion). When someone survives its challenge, each survivor draws a resource.' },
  { id: 'fog-of-the-fey', topic: 'The Hollow Hills (Fog of the Fey)',
    ruling: 'While it is the location, face-down resource cards stay hidden until the reveal step: Goldie\'s Rumour Mill cannot be used, and no ability can reveal or look at a face-down card early.' },
];
