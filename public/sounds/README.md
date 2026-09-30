# Sound effects

Put sound files here. Everything in `web/public/` is served as-is, so a file
saved as `sounds/card-flip.mp3` is available to the game at that path.

**Formats:** `.mp3` plays everywhere; `.ogg`, `.webm` and `.wav` work in
most browsers. Keep effects short and small (under ~100 KB each). Normalise
them to a similar loudness; the game plays them quieter than the music.

**Names:** use these exact names so wiring them up is straightforward. Any you
leave out simply stay silent. Where I say "a few variations", two or three
versions of the same sound (named `card-flip-1`, `card-flip-2`, ...) stop it
sounding repetitive.

Only use sounds you have the rights to: this folder will be public once the
game is on GitHub Pages.

## Cards (the ones you'll hear most)

| File | Length | What it is | When it plays | Search for |
|---|---|---|---|---|
| `shuffle` | 1-2 s | A deck being riffle-shuffled | Start of the game; whenever a stack is reshuffled | "card shuffle", "riffle shuffle" |
| `deal` | 0.2-0.4 s | One card slid across felt (a few variations) | Opening hands are dealt; each card you draw; the tavern refills | "card deal", "card slide", "card draw" |
| `card-flip` | 0.2-0.3 s | A card turned over | A card is revealed: encounter, location, bids at the reveal step | "card flip", "card turn over" |
| `card-place` | 0.15-0.3 s | A card set down on a table, soft tap (a few variations) | You or a bot place a bid; a companion joins a party; the location or encounter lands on the table | "card place", "card put down", "card tap on table" |
| `card-pickup` | 0.15-0.3 s | A card picked up off a table | Card hover/select in your hand (optional); a card is taken from the tavern | "card pick up" |
| `card-discard` | 0.3-0.5 s | A card tossed onto a pile | A card goes to a discard pile; "Let them go"; a companion is replaced | "card toss", "card discard" |
| `cards-gather` | 0.5-1 s | A handful of cards swept together | End of a turn when bids are cleared; a hero falls and a hand is discarded | "cards gather", "cards scoop" |
| `card-fan` | 0.3-0.5 s | Cards fanned in a hand | Your hand is dealt or refilled at the start of a turn | "card fan", "card spread" |
| `card-swap` | 0.3-0.5 s | Two cards quickly exchanged | Maren's trade, Pip's claim, the apple swap, a bid swap | "card swap", "card shuffle quick" |
| `card-peek` | 0.3-0.6 s | A card corner lifted (soft) | You look at the top of a stack (Grukka, Wren) | "card peek", "card lift" |

## Game events

| File | Length | When it plays | Search for |
|---|---|---|---|
| `your-turn` | 0.5-1 s | Your turn starts (soft chime or bell) | "turn chime", "soft bell" |
| `recruit` | 0.5-1 s | A companion joins your party (a small flourish) | "recruit", "level up small", "party join" |
| `location-claimed` | 1-1.5 s | Someone wins the location (satisfying coin or gavel sound) | "coins", "gavel", "success short" |
| `survive` | 0.5-1 s | You survive the encounter | "success", "relief" |
| `hero-falls` | 1-2 s | A hero falls (low thud or sad horn) | "defeat", "fall thud", "sad trombone" |
| `effect-negative-1`, `-2`, `-3` | 0.5-1 s | The attack animation: an ability is used against a card (a crackle or zap with a dark, menacing edge). Three variations are picked at random | "energy zap", "magic hit dark", "curse", "electric discharge" |
| `effect-positive-1`, `-2`, `-3` | 0.5-1 s | The same animation for a boon or a counter (a bright chime-like shimmer) | "magic shimmer", "buff", "heal chime", "holy" |
| `ability-used` | 0.4-0.8 s | An ability is used (magical shimmer) | "magic shimmer", "spell cast short" |
| `ability-countered` | 0.5-1 s | Aldric's counter lands (shield clang) | "shield block", "metal clang" |
| `sabotage` | 0.5-1 s | Another player's ability hits you (low sting) | "sting", "ominous hit" |
| `die-roll` | 0.6-1 s | Any die is rolled (ability dice, tiebreaks) | "dice roll", "dice on table" |
| `renown` | 0.3-0.6 s | Renown increases (bright ping) | "coin ping", "points up" |
| `game-win` | 2-4 s | You win the game (short fanfare) | "victory fanfare", "win jingle" |
| `game-lose` | 2-3 s | Someone else wins (muted outro) | "defeat jingle", "game over soft" |

## Interface

| File | Length | When it plays | Search for |
|---|---|---|---|
| `click` | under 0.1 s | Buttons (very short and quiet) | "ui click", "wood click" |
| `notice` | 0.3-0.5 s | An opponent's ability message pops up | "notification soft", "paper slide" |
| `error` | 0.2-0.4 s | Something was rejected ("slow down", "not your turn") | "ui error soft", "thud soft" |
| `menu-open` | 0.2 s | The music panel, rules or log opens (optional) | "ui open", "whoosh short" |

The two `effect-` sounds are already wired in: drop the files in and they play with the attack animation (the Effects slider in the music panel sets their volume). A plain `effect-negative.mp3` works too if you only have one.

## Priority

If you only find a handful, these give the most: `shuffle`, `deal`, `card-flip`,
`card-place`, `card-discard`, `your-turn`, `location-claimed`, `hero-falls`.
