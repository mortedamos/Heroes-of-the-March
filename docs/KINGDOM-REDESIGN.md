# Kingdom redesign

Goal: a player can build a viable single-kingdom strategy, and abilities that key on a card group trigger often enough to matter.
Every number below is a starting point; see CARD-BALANCE.md for the measured results.

## Kin bonuses (one per hero, in addition to the hero's trigger)

- **A** - +1 to every stat of your hero for each companion of the hero's kingdom you control.
- **B** - when a companion of the hero's kingdom enters play under any player's control, draw a resource.
- **C** - while an opponent controls a companion of the hero's kingdom, that companion gets -1 to each of its stats.

| Hero | Kin | Trigger |
|---|---|---|
| Maren | B | Wardhouse location enters play |
| Aldric | A | Marchguard location enters play, or a Marchguard companion enters under his control |
| Corvin | B | Undead encounter enters play |
| Aelthir | B | Guile challenge is faced (any turn) |
| Ysolde | A | Magic (Mental) challenge is faced (any turn) |
| Vaelis | C | A hero falls: draw 2 |
| Brunna | A | Physical challenge is faced (any turn) |
| Kazra | B | Ironbound encounter enters play |
| Thorgar | C | Location won by a margin of 3 or less |
| Oskar (new hero) | C | Oathbreaker encounter enters play |
| Grukka | A | Capital location enters play |
| Urzha | C | A minion is drawn |
| Barnaby | B | Accord location enters play |
| Hobby | C | The first time each turn anyone is forced to use a different stat |
| Pip | A | A location is replaced |

Oskar's ability (Entered in the Grudge Book): at the start of bidding, name an opponent; if they win the encounter they have -3 in the next one.
Urzha's ability (Pick Your Fight): look at the next encounter and may replace the current one with it.

## Companions

Rook (Skyship Manifest), Fennick (Spore Cloud), Seraphine (Wellspring Renewal), Ilvena (no discard cost), Hedda (Hold the Line),
Mogra (Smash and Grab), Goldie (Rumour Mill), Varg (Pack Runner; +1 with Sigrun), Sigrun (+1 with Varg).
Renamed and moved: Mira -> Dagny Coldhearth (Dwarf), Wren -> Elowen Leafwatch (Elf), Clemence -> Grumma Ladlejaw (Orc),
Hugo -> Hobart Thimblewick (Halfellow), Posy -> Rosalind Marchwell (Human). Hesk is now a companion (Orc + Human); Oskar is now a hero.
New: Moss (Dire Wolf), Torvi Cinderkeg (Fire in the Hole), Gimlet (Fetch).

**Bonus pairs** (Varg + Moss, Goldie + Gimlet): with both in your party the companion limit is one higher; the second may be played above the limit;
if the pair is broken you immediately discard down to the limit. Under Ysolde with both pairs that is five companions.

## New and changed cards

- Encounters: The Treasure Trow (all draw on entering; survivors draw when it is defeated), Destiny the Frog (Skarra's minion, worth 3; shuffled back when a minion),
  Runeforged Titan (replaces Frost Golem: Physical 18, only 10 if the challenge is Mental or Guile).
- Resource: The Book of Grudges (+3, +4 for Oskar's player; if its owner falls the winner has -3 next encounter).
- Locations: capitals Sylvaneth, Grimgate, Gorewatch, Hearthmeadow, Barrowdeep (each draws per companion of its kingdom; Barrowdeep gives an Undead encounter an extra Undead minion);
  The Moot Hall replaces The Dame School; The Frostfells and Wreck of the Skyship Gallant search the top 5 encounters for a Frostborn / Gargoyle card.

## Tags

Retired: Realm, Otherworld, Healer, Underway. Locations: Capital, Wardhouse, Accord, Marchguard, Collegium plus a kingdom tag.
Encounters: Undead 17, Ironbound 13, Oathbreaker 11, Beast 6 (+ kingdom and Skarra tags). Resources: kingdom tags (the relics) and Goose / Beast on a few.
Companions: kingdom, Warden, Marchguard, Collegium, Goose, Beast, Goose & Kettle.

Final hero and companion stats were tuned in the harness; see KINGDOM-BALANCE.md for the stats and the measured win rates.
