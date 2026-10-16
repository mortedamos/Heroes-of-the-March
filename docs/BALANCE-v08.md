# Balance of the fourth card sheet pass (v0.8)

The sheet as edited on 15 October 2026 after the third balance report ([BALANCE-v07.md](BALANCE-v07.md)) and the look at the weakest heroes: Professor Barnaby is 2/6/4 and uses his maps during bidding on any turn, Oskar's Book of Grudges is a passive draw when an opponent's ability lands on his heroes or resources, Tansy draws a resource when a Halfellow card is among the face-down cards she looks at, and Gnash (Nemesis: Elf), Pell (Nemesis: Wardhouse) and Nettle (Allied: Halfellow) gained named abilities. 207 cards, as before. Same harness; the bots changed too: they use Vaelis half the time (easy), three times in four (normal) or always (hard), use Grukka's and Barnaby's looks every turn (easy bots half the time), choose Barnaby's location with Nemesis in mind, and a bug that made them keep a negative minion bonus from Vaelis was fixed. Raw data in `docs/balance-data/v08/`.

## Summary

- **Game health is the same as v0.7.** Survival at 3 players is 94.8% (94.7%), falls per game 1.18 (1.22). At 6 players falls are 4.53 (4.00), and bids per player-turn are up by 0.1 to 0.25 everywhere because Oskar and the bots' fuller use of their abilities put more cards into play. Allied and Nemesis still add about 2.3 points of survival.
- **Vaelis was a bot problem, and is fair now: 0.75 to 1.11.** A lost backslash in the bots' reading of the minion bonus made them keep a negative bonus for themselves, and they only used him when behind. With the 50% / 75% / 100% use rates and the fix, his ability is worth +0.43. The Aelder + Aelthir + Vaelis stack rose from 2.51 to 2.72.
- **Oskar works as a passive: 0.81 to 1.04.** He draws about 3.3 resources a game (a bit over one turn in three), mostly from curses, Mogra and forced stats; his ability is worth +0.22.
- **Barnaby is better but still low: 0.68 to 0.79.** The bots now use his maps every turn and weigh Nemesis (they swap away a location that switches on several opponents' Nemesis bonuses). The probe shows he swaps 5 times a game and raises Renown by 0.7 per swap, but Renown only helps when you take the location, so his own wins average 4.4 Renown against 4.2 for everyone else's: about half a Renown a game. His ability is worth +0.12 (n.s.). Tested on the side: +2 Physical gives 0.77 against 0.73 at the time, a draw whenever he swaps gives 1.25 (too much), so the right fix is between the two.
- **Tansy is unchanged (0.85, ability worth 0.00).** The Halfellow draw fires 0.34 times a game. The bots already bid on the exact totals she gives them, but they never hide a curse or a trick card, so there is nothing for them to read beyond the numbers; a human who reads which abilities are coming gets more out of her than the sim can show.
- **Gnash 0.93, Pell 1.00 and Nettle 0.95** with their new Nemesis and Allied entries (Gnash's ability is now worth +0.20, up from +0.13).
- **Spread:** 0.73 to 1.55, standard deviation 0.15. **Still high:** Ysolde 1.55, Tobin 1.32, Hesk 1.21, Aelthir 1.20, Aelder 1.20. **Now lowest:** Thorgar 0.73, Ilvena 0.77, Barnaby 0.79, Tova 0.80, Aldric 0.83, Grumma 0.84, Tansy 0.85, Hobby 0.85; none of these has a measurable ability.
- **Stacks:** Aelder + Aelthir + Vaelis 2.72, Goose 2.52, Dwarf 2.24, Gimlet + Goldie + Hobby 2.01, Orc 1.90, Grukka + Hesk + Kesh 1.70 (up with Grukka looking every turn), Warden 1.11 (down 0.26), turtle 0.79, Undead 0.47.

## Game health (6000 games each)

Each cell is the second sheet pass (v0.6) / the third (v0.7, with Immobilizing Word on riding Companions only) / this pass (v0.8).

| Players | Avg turns | Falls per game | Survival | Survival P-M-G | Share of game before first fall | Bids per player-turn | Close games | Winning margin |
|---|---|---|---|---|---|---|---|---|
| 2 | 7.2 / 7.3 / **7.2** | 0.56 / 0.63 / **0.59** | 95.8% / 95.3% / **95.5%** | 96-95-97 · 96-93-97 · **96-94-96** | 86% / 84% / **85%** | 2.43 / 2.39 / **2.52** | 13% / 9% / **12%** | 11.8 / 12.2 / **11.9** |
| 3 | 8.9 / 9.1 / **9.0** | 1.01 / 1.22 / **1.18** | 95.6% / 94.7% / **94.8%** | 96-95-97 · 95-94-96 · **94-94-96** | 83% / 81% / **82%** | 2.52 / 2.48 / **2.67** | 18% / 19% / **19%** | 9.8 / 9.4 / **9.6** |
| 4 | 10.2 / 10.5 / **10.4** | 1.12 / 1.81 / **1.83** | 96.6% / 94.7% / **94.5%** | 97-96-98 · 95-94-96 · **94-93-96** | 88% / 81% / **82%** | 2.45 / 2.38 / **2.60** | 21% / 22% / **21%** | 9.1 / 8.9 / **8.8** |
| 5 | 11.2 / 11.9 / **11.9** | 1.57 / 2.91 / **3.01** | 96.4% / 93.6% / **93.4%** | 96-96-97 · 93-92-95 · **93-92-95** | 86% / 77% / **77%** | 2.21 / 2.16 / **2.37** | 22% / 23% / **23%** | 8.8 / 8.4 / **8.1** |
| 6 | 12.0 / 12.5 / **12.9** | 2.24 / 4.00 / **4.53** | 95.9% / 92.8% / **92.0%** | 96-95-97 · 93-91-94 · **92-90-94** | 83% / 74% / **72%** | 1.95 / 1.89 / **2.13** | 21% / 23% / **24%** | 8.7 / 8.3 / **7.9** |

### What the named abilities add (3 players, 3000 games each)

| Version | Survival | Falls per game | Turns | Bids per player-turn |
|---|---|---|---|---|
| This pass as written | 94.8% | 1.18 | 9.0 | 2.67 |
| Allied and Nemesis switched off | 92.5% | 1.60 | 9.0 | 2.72 |
| Allied, Nemesis and Companion To switched off | 92.2% | 1.69 | 9.2 | 2.71 |

## Individual heroes

Each hero forced into a rotating seat's opening party (500 games per hero at 3 and 4 players), once as printed and once as a stats-only hero. 1.00 is fair; the 95% margin is about 0.10. "v0.7" is the same experiment on the previous pass. Heroes edited in this pass are marked *, heroes whose bots now use the ability more are marked †.

| Hero | P/M/G | Total | v0.7 | v0.8 | Change | Stats only | Ability worth | Effects per turn held |
|---|---|---|---|---|---|---|---|---|
| Ysolde of the Wellspring | 2/2/3 | 7 | 1.46 | **1.55** ▲ | +0.09 | 0.90 | +0.64 | 0.00 |
| Tobin Quill | 3/4/2 | 9 | 1.41 | **1.32** ▲ | -0.09 | 1.00 | +0.32 | 1.05 |
| Hesk of Two Homes | 5/3/4 | 12 | 1.23 | **1.21** ▲ | -0.02 | 0.82 | +0.39 | 0.00 |
| Aelthir Moonveil | 2/4/4 | 10 | 1.18 | **1.20** ▲ | +0.03 | 0.81 | +0.39 | 1.05 |
| Aelder Mossleaf | 7/1/3 | 11 | 1.27 | **1.20** ▲ | -0.07 | 0.66 | +0.54 | 0.87 |
| Archmage Corvin Varro | 1/5/4 | 10 | 1.32 | **1.17** ▲ | -0.14 | 0.69 | +0.48 | 0.00 |
| Duchess | 4/2/1 | 7 | 1.20 | **1.17** ▲ | -0.03 | 0.91 | +0.26 | 0.84 |
| Brisa Blastcap | 5/3/3 | 11 | 1.17 | **1.17** ▲ | +0.00 | 0.74 | +0.42 | 0.50 |
| Honk | 4/2/1 | 7 | 1.14 | **1.12** ▲ | -0.02 | 0.85 | +0.28 | 0.83 |
| Lord Vaelis Nightbloom † | 2/5/6 | 13 | 0.75 | **1.11** ▲ | +0.36 | 0.68 | +0.43 | 0.88 |
| Varg Ironjaw | 4/2/3 | 9 | 1.18 | **1.10** ▲ | -0.07 | 0.83 | +0.27 | 0.93 |
| Sigrun Stonefast | 2/3/5 | 10 | 1.18 | **1.10** ▲ | -0.09 | 1.00 | +0.10 (n.s.) | 0.00 |
| Caelan Halfelven | 2/3/4 | 9 | 1.03 | **1.08** | +0.05 | 0.91 | +0.17 | 0.97 |
| Seraphine Moonveil | 2/6/3 | 11 | 1.14 | **1.07** | -0.07 | 0.79 | +0.29 | 0.51 |
| Goldie Trickgrin | 2/4/5 | 11 | 1.16 | **1.07** | -0.09 | 0.87 | +0.20 | 0.00 |
| Kazra Emberdeep | 4/3/3 | 10 | 1.06 | **1.07** | +0.01 | 0.98 | +0.08 (n.s.) | 0.47 |
| Queen Maren Ashcroft | 2/4/5 | 11 | 1.10 | **1.06** | -0.04 | 0.73 | +0.33 | 0.31 |
| High Thane Brunna Stonefast | 3/3/3 | 9 | 1.08 | **1.05** | -0.03 | 0.85 | +0.20 | 0.00 |
| Loremaster Oskar Grimgate * | 3/4/5 | 12 | 0.81 | **1.04** | +0.23 | 0.82 | +0.22 | 0.00 |
| Dagny Coldhearth | 2/3/4 | 9 | 0.96 | **1.04** | +0.07 | 0.89 | +0.14 | 0.11 |
| Farmer Hobart Thimblewick | 3/2/4 | 9 | 1.11 | **1.03** | -0.08 | 0.92 | +0.11 (n.s.) | 0.16 |
| Gimlet | 3/3/3 | 9 | 1.07 | **1.02** | -0.05 | 0.94 | +0.08 (n.s.) | 0.44 |
| Sergeant Waddle | 4/2/2 | 8 | 1.03 | **1.02** | -0.01 | 0.84 | +0.17 | 0.89 |
| Moss | 4/1/3 | 8 | 0.93 | **1.01** | +0.08 | 0.91 | +0.10 (n.s.) | 0.56 |
| Pell Quillon * | 1/5/3 | 9 | 0.94 | **1.00** | +0.07 | 0.94 | +0.07 (n.s.) | 0.36 |
| Captain Rook Halloran | 5/2/4 | 11 | 0.99 | **0.99** | +0.00 | 0.83 | +0.16 | 0.90 |
| Cobra Chicken | 4/2/2 | 8 | 0.95 | **0.98** | +0.03 | 0.92 | +0.06 (n.s.) | 0.46 |
| Mogra Swiftfoot | 3/3/2 | 8 | 0.98 | **0.96** | -0.02 | 0.83 | +0.13 (n.s.) | 0.65 |
| Nettle Burrows * | 2/3/5 | 10 | 0.92 | **0.95** | +0.02 | 0.76 | +0.19 | 0.38 |
| Pip Wanderfoot | 3/3/3 | 9 | 0.98 | **0.93** | -0.05 | 0.85 | +0.08 (n.s.) | 0.47 |
| Gnash * | 6/2/2 | 10 | 0.85 | **0.93** | +0.08 | 0.73 | +0.20 | 0.35 |
| Urzha Half-Tusk | 4/2/4 | 10 | 0.96 | **0.93** | -0.03 | 0.79 | +0.14 | 0.10 |
| Torvi Cinderkeg | 3/2/3 | 8 | 1.03 | **0.92** | -0.11 | 0.76 | +0.16 | 0.18 |
| Warchief Grukka Ironjaw † | 6/3/5 | 14 | 0.88 | **0.91** | +0.03 | 0.68 | +0.23 | 1.30 |
| Fennick Puffcap | 2/4/3 | 9 | 0.93 | **0.91** | -0.02 | 0.94 | -0.03 (n.s.) | 0.29 |
| Liriel Nightbloom | 3/5/3 | 11 | 0.96 | **0.91** | -0.05 | 0.64 | +0.26 | 0.52 |
| Elowen Leafwatch | 4/3/4 | 11 | 0.92 | **0.91** | -0.01 | 0.81 | +0.10 (n.s.) | 0.32 |
| Sister Aurelie Dane | 2/4/3 | 9 | 0.90 | **0.90** ▼ | -0.00 | 0.89 | +0.00 (n.s.) | 0.37 |
| Marshal Hedda Ironvow | 5/2/4 | 11 | 0.86 | **0.88** ▼ | +0.02 | 0.85 | +0.03 (n.s.) | 0.00 |
| Thessaly of the Grove | 2/5/4 | 11 | 0.94 | **0.87** ▼ | -0.07 | 0.83 | +0.04 (n.s.) | 0.65 |
| Kesh the Bog Huntress | 5/2/4 | 11 | 0.89 | **0.87** ▼ | -0.02 | 0.73 | +0.15 | 0.21 |
| Mayor Hobby Trickgrin | 2/4/5 | 11 | 0.92 | **0.85** ▼ | -0.06 | 0.80 | +0.05 (n.s.) | 0.00 |
| Tansy Brambleby * | 3/3/4 | 10 | 0.82 | **0.85** ▼ | +0.03 | 0.87 | -0.02 (n.s.) | 0.82 |
| Grumma Ladlejaw | 3/4/2 | 9 | 0.85 | **0.84** ▼ | -0.01 | 0.83 | +0.01 (n.s.) | 0.28 |
| Lord-Paladin Aldric Ashcroft | 5/2/3 | 10 | 0.92 | **0.83** ▼ | -0.08 | 0.85 | -0.02 (n.s.) | 0.00 |
| Tova Emberdeep | 4/4/2 | 10 | 0.91 | **0.80** ▼ | -0.11 | 0.76 | +0.04 (n.s.) | 0.13 |
| Professor Barnaby Pickwort * | 2/6/4 | 12 | 0.68 | **0.79** ▼ | +0.11 | 0.66 | +0.12 (n.s.) | 1.18 |
| Elder Ilvena of the Conclave | 2/5/3 | 10 | 0.86 | **0.77** ▼ | -0.10 | 0.81 | -0.04 (n.s.) | 1.07 |
| Thorgar Twice-Buried | 4/3/4 | 11 | 0.88 | **0.73** ▼ | -0.15 | 0.70 | +0.03 (n.s.) | 0.00 |

Spread: 0.73 to 1.55, standard deviation 0.15 (v0.7: 0.68 to 1.46, 0.16).

## Stacking (1500 games per player count at 3 and 4 players)

| Party | v0.7 | v0.8 | Change | 3 players | 4 players |
|---|---|---|---|---|---|
| Aelder + Aelthir + Vaelis | 2.51 | **2.72** | +0.20 | 83.3% | 75.2% |
| Kazra + Brunna + Sigrun (Dwarf) | 2.41 | **2.24** | -0.17 | 68.3% | 62.3% |
| Tobin + Farmer Hobart + Honk (Goose) | 2.65 | **2.52** | -0.14 | 75.2% | 71.5% |
| Mogra + Varg + Moss (Orc) | 2.02 | **1.90** | -0.12 | 59.7% | 51.0% |
| Gimlet + Goldie + Hobby | 2.09 | **2.01** | -0.07 | 65.6% | 51.9% |
| Torvi + Brisa + Pell | 1.33 | **1.36** | +0.03 | 45.2% | 33.9% |
| Corvin + Pell + Rook (draws) | 1.27 | **1.18** | -0.09 | 39.2% | 29.9% |
| Liriel + Elowen + Seraphine (Warden) | 1.37 | **1.11** | -0.26 | 39.7% | 25.0% |
| Aldric + Hedda + Brunna (turtle) | 0.93 | **0.79** | -0.14 | 27.3% | 18.5% |
| Grukka + Hesk + Kesh (Orc) | 1.52 | **1.70** | +0.18 | 57.3% | 41.7% |
| Thorgar + Tova + Thessaly (Undead) | 0.50 | **0.47** | -0.04 | 16.6% | 10.5% |


## Extra runs on Barnaby

3000 games each at 3 and 4 players (`docs/balance-data/v08-barnaby/`, probe in `scripts/balance/probe-maps.ts`): the bot that raises Renown only when it is the favourite 0.73 (before that change 0.67); the same bot and a draw whenever he swaps 1.25; the same bot with Physical 4 (4/6/4) 0.77.

## Afterwards: what bots of each level assume about face-down bids

An easy bot guesses every unseen card of a rival's at between 2 and 3 (a new guess each decision), so it generally undervalues them; a normal bot uses 3.1 for all of them (unchanged); a hard bot uses the average for the position the card was played in (2nd bid 3.0, 3rd 2.9, later 2.7 to 2.8). Measured over bot games, face-down bids average 2.9. Win share of one seat at one level against two seats of another, 3 players, 1500 games each (fair 33.3%, margin 2.4 points), :

| Seat | Others | Wins | Wins before (easy guessing 0 to 6) | Wins before (flat 3.1 for everyone) |
|---|---|---|---|---|
| hard | normal | 35.6% | 35.6% | 34.5% |
| easy | normal | 4.3% | 6.0% | 6.2% |
| normal | normal | 34.8% | 33.2% | |
| normal | easy | 81.0% | 80.3% | |
| hard | easy | 83.7% | 81.2% | |

Easy bots were already far weaker than normal ones for other reasons (they play cards at random and often sit still); undervaluing rivals makes them a little weaker still.

## Afterwards: Barnaby, Tansy and Urzha (sheet of 16 October)

The sheet now has Allied: Accord on Barnaby, and his maps may swap a location in with its effect ignored (an ignored location keeps its Renown and tags; its text does nothing this turn, including text that works while in play and what happens when it is won). Urzha has Nemesis: Wardhouse and Tansy Allied: Halfellow. Bots choose a location by Renown (when they are the favourite), by whose Nemesis it switches on, and by what its text does to them against their rivals: they swap it in with its text when that hurts the others more than them, ignored when it hurts them or helps the others. 3000 games per hero at 3 and 4 players (margin 0.06), `docs/balance-data/v09-retest/`:

| Version | Barnaby | Tansy | Urzha |
|---|---|---|---|
| before (v0.8 data) | 0.73 | 0.87 | 0.83 |
| Urzha Nemesis Wardhouse, Tansy Allied Halfellow (Barnaby without either) | 0.72 | 0.93 | 0.85 |
| the same plus Nemesis: Wardhouse on Barnaby (what the designer first described) | 0.75 | | |
| now: Barnaby Allied: Accord, ignoring, and bots that use it | **0.89** | **0.93** | **0.87** |
| Barnaby as now, without Allied (the ignoring alone) | 0.82 | | |
