# Balance of the third card sheet pass (v0.7)

The sheet as edited on 14 October 2026 after the second balance report ([BALANCE-v06.md](BALANCE-v06.md)): Grukka's ability rewritten (a Capital only, draws 2) and given Nemesis: Capital, Ysolde 2/2/3, Farmer Hobart 3/2/4 with a once-a-turn draw, Corvin without Allied, tag edits on Rook (Marchguard) and Thessaly (no Collegium), and three new resources: Pariapt of Peace, The Tome of Nethrak and Immobilizing Word. 207 cards: 49 heroes, 32 locations, 48 encounters, 78 resources. Same bots and harness; raw data in `docs/balance-data/v07/`.

## Summary

- **The game got harder again, and the three new resources are the whole reason.** At 3 players survival is 94.6% (v0.6 95.6%, the party rework game 92.8%) and falls per game 1.24 (1.01 and 1.69). The change is larger at the bigger tables: falls at 4, 5 and 6 players rose from 1.12, 1.57 and 2.24 to 1.86, 2.99 and 4.19, which is 78%, 89% and 86% of what the party rework game had (v0.6 was about 47%). Games run 0.2 to 0.6 turns longer and close games are 19% to 23%.
- **The hero edits changed nothing measurable.** With the three new resources switched off, falls are 0.98, 1.31 and 2.08 at 3, 4 and 6 players, the same as v0.6 (1.01, 1.12, 2.24; the 1500-game diagnostic is good to about 0.2). Switched off one at a time at 6 players: The Tome of Nethrak accounts for about 1.1 falls per game, Pariapt of Peace about 0.8, Immobilizing Word about 0.5. At 3 players all three are small (the Tome 0.14).
- **How the bots play them matters.** The bots bid by printed value, so the Tome goes in as a +4 whenever a +4 would, and a Pariapt or a Word as a +2 or +1; none of them is held back or timed. A human who plays the Tome only when it wins the table, or the Pariapt only against a big Allied party, would use them better and make them cost less (or more). Treat these numbers as the price of the cards when played blindly.
- **Hero strength is slightly more even.** Relative win rates run from 0.68 to 1.46, standard deviation 0.16 (v0.6: 0.70 to 1.61, 0.17). Farmer Hobart came down from 1.31 to 1.11 (the stat cut and the once-a-turn draw; he now draws 0.16 per turn held), Ysolde from 1.61 to 1.46 (still first; her ability is worth +0.68), Corvin from 1.40 to 1.32 without Allied (his draw is still worth +0.46). Grukka rose from 0.79 to 0.88, but his ability is worth nothing measurable (it only pays off when the next location is a Capital, and it produced an effect on 0.14 of the turns he was held). Rook (0.99) and Thessaly (0.94) are fair; the tag changes did not matter. Other moves are within the 0.10 margin.
- **Still high:** Ysolde 1.46, Tobin 1.41, Corvin 1.32, Aelder 1.27, Hesk 1.23. **Still low:** Barnaby 0.68, Vaelis 0.75, Oskar 0.81 (down 0.11), Tansy 0.82, Gnash and Grumma 0.85.
- **Stacks:** the Goose party is still the strongest (2.65, was 2.79), then Aelder + Aelthir + Vaelis 2.51, Kazra + Brunna + Sigrun 2.41, Gimlet + Goldie + Hobby 2.09, Mogra + Varg + Moss 2.02. Corvin + Pell + Rook fell from 1.58 to 1.27 (his Allied went). The turtle party is 0.93 and the Undead party 0.50.
- **What the named abilities add (3 players):** Allied and Nemesis together are worth 2.4 points of survival (94.6% against 92.2% with them off); Companion To 0.2 more.

## Game health (6000 games each)

Each cell is the first sheet pass (v0.5) / the second (v0.6) / this pass (v0.7).

| Players | Avg turns | Falls per game | Survival | Survival P-M-G | Share of game before first fall | Bids per player-turn | Close games | Winning margin |
|---|---|---|---|---|---|---|---|---|
| 2 | 7.1 / 7.2 / **7.3** | 0.34 / 0.56 / **0.63** | 97.4% / 95.8% / **95.3%** | 97-97-98 · 96-95-97 · **96-93-97** | 91% / 86% / **84%** | 2.46 / 2.43 / **2.39** | 13% / 13% / **10%** | 12.1 / 11.8 / **12.2** |
| 3 | 8.7 / 8.9 / **9.1** | 0.63 / 1.01 / **1.24** | 97.2% / 95.6% / **94.6%** | 97-96-98 · 96-95-97 · **95-93-96** | 89% / 83% / **81%** | 2.57 / 2.52 / **2.48** | 16% / 18% / **19%** | 10.2 / 9.8 / **9.4** |
| 4 | 9.9 / 10.2 / **10.5** | 0.83 / 1.12 / **1.86** | 97.5% / 96.6% / **94.5%** | 97-97-98 · 97-96-98 · **94-93-96** | 90% / 88% / **81%** | 2.49 / 2.45 / **2.38** | 18% / 21% / **22%** | 9.4 / 9.1 / **8.8** |
| 5 | 11.3 / 11.2 / **11.9** | 1.29 / 1.57 / **2.99** | 97.2% / 96.4% / **93.4%** | 97-96-98 · 96-96-97 · **93-92-95** | 88% / 86% / **76%** | 2.26 / 2.21 / **2.16** | 23% / 22% / **22%** | 8.6 / 8.8 / **8.5** |
| 6 | 12.1 / 12.0 / **12.6** | 1.86 / 2.24 / **4.19** | 96.6% / 95.9% / **92.6%** | 97-95-98 · 96-95-97 · **93-91-94** | 85% / 83% / **74%** | 1.99 / 1.95 / **1.89** | 22% / 21% / **23%** | 8.5 / 8.7 / **8.4** |

### What the named abilities add (3 players, 3000 games each)

| Version | Survival | Falls per game | Turns | Bids per player-turn |
|---|---|---|---|---|
| This pass as written | 94.6% | 1.24 | 9.1 | 2.48 |
| Allied and Nemesis switched off | 92.2% | 1.66 | 9.1 | 2.53 |
| Allied, Nemesis and Companion To switched off | 92.0% | 1.73 | 9.4 | 2.48 |

### The three new resources, switched off one at a time

The first two rows are the published 6000-game runs, the others 1500 games each (falls are good to about 0.2).

| Version | Falls 3p | Falls 4p | Falls 6p | Survival 3p | Survival 6p |
|---|---|---|---|---|---|
| v0.6 | 1.01 | 1.12 | 2.24 | 95.6% | 95.9% |
| v0.7 as written | 1.24 | 1.86 | 4.19 | 94.6% | 92.6% |
| without The Tome of Nethrak | 1.10 | 1.52 | 3.07 | 95.3% | 94.8% |
| without Immobilizing Word | 1.30 | 1.82 | 3.73 | 94.4% | 93.3% |
| without Pariapt of Peace | 1.29 | 1.70 | 3.40 | 94.4% | 94.0% |
| without all three | 0.98 | 1.31 | 2.08 | 95.8% | 96.4% |

## Individual heroes

Each hero forced into a rotating seat's opening party (500 games per hero at 3 and 4 players), once as printed and once as a stats-only hero. 1.00 is fair; the 95% margin is about 0.10. "v0.6" is the same experiment on the previous pass. Heroes edited in this pass are marked *.

| Hero | P/M/G | Total | v0.6 | v0.7 | Change | Stats only | Ability worth | Effects per turn held |
|---|---|---|---|---|---|---|---|---|
| Ysolde of the Wellspring * | 2/2/3 | 7 | 1.61 | **1.46** ▲ | -0.15 | 0.79 | +0.68 | 0.00 |
| Tobin Quill | 3/4/2 | 9 | 1.29 | **1.41** ▲ | +0.13 | 1.01 | +0.40 | 1.04 |
| Archmage Corvin Varro * | 1/5/4 | 10 | 1.40 | **1.32** ▲ | -0.08 | 0.85 | +0.46 | 0.00 |
| Aelder Mossleaf | 7/1/3 | 11 | 1.18 | **1.27** ▲ | +0.09 | 0.68 | +0.59 | 0.86 |
| Hesk of Two Homes | 5/3/4 | 12 | 1.20 | **1.23** ▲ | +0.03 | 0.81 | +0.43 | 0.00 |
| Duchess | 4/2/1 | 7 | 1.11 | **1.20** ▲ | +0.08 | 0.94 | +0.26 | 0.84 |
| Sigrun Stonefast | 2/3/5 | 10 | 1.09 | **1.18** ▲ | +0.10 | 1.05 | +0.14 | 0.00 |
| Aelthir Moonveil | 2/4/4 | 10 | 1.18 | **1.18** ▲ | -0.00 | 0.87 | +0.31 | 1.04 |
| Varg Ironjaw | 4/2/3 | 9 | 1.10 | **1.18** ▲ | +0.07 | 0.89 | +0.29 | 0.91 |
| Brisa Blastcap | 5/3/3 | 11 | 1.12 | **1.17** ▲ | +0.04 | 0.87 | +0.29 | 0.48 |
| Goldie Trickgrin | 2/4/5 | 11 | 1.14 | **1.16** ▲ | +0.01 | 0.87 | +0.28 | 0.00 |
| Seraphine Moonveil | 2/6/3 | 11 | 1.12 | **1.14** ▲ | +0.02 | 0.87 | +0.27 | 0.48 |
| Honk | 4/2/1 | 7 | 1.14 | **1.14** ▲ | +0.00 | 0.87 | +0.27 | 0.83 |
| Farmer Hobart Thimblewick * | 3/2/4 | 9 | 1.31 | **1.11** ▲ | -0.20 | 0.92 | +0.19 | 0.16 |
| Queen Maren Ashcroft | 2/4/5 | 11 | 1.13 | **1.10** ▲ | -0.03 | 0.73 | +0.38 | 0.31 |
| High Thane Brunna Stonefast | 3/3/3 | 9 | 1.04 | **1.08** | +0.04 | 0.93 | +0.15 | 0.00 |
| Gimlet | 3/3/3 | 9 | 0.94 | **1.07** | +0.13 | 0.78 | +0.29 | 0.43 |
| Kazra Emberdeep | 4/3/3 | 10 | 1.06 | **1.06** | -0.01 | 0.98 | +0.08 (n.s.) | 0.45 |
| Sergeant Waddle | 4/2/2 | 8 | 1.08 | **1.03** | -0.05 | 0.80 | +0.23 | 0.89 |
| Caelan Halfelven | 2/3/4 | 9 | 1.03 | **1.03** | +0.00 | 0.87 | +0.16 | 0.95 |
| Torvi Cinderkeg | 3/2/3 | 8 | 0.90 | **1.03** | +0.12 | 0.86 | +0.16 | 0.19 |
| Captain Rook Halloran * | 5/2/4 | 11 | 0.97 | **0.99** | +0.03 | 0.80 | +0.20 | 0.89 |
| Pip Wanderfoot | 3/3/3 | 9 | 0.92 | **0.98** | +0.06 | 0.89 | +0.09 (n.s.) | 0.29 |
| Mogra Swiftfoot | 3/3/2 | 8 | 0.91 | **0.98** | +0.08 | 0.95 | +0.03 (n.s.) | 0.65 |
| Liriel Nightbloom | 3/5/3 | 11 | 1.04 | **0.96** | -0.07 | 0.70 | +0.27 | 0.47 |
| Dagny Coldhearth | 2/3/4 | 9 | 1.04 | **0.96** | -0.07 | 0.82 | +0.15 | 0.10 |
| Urzha Half-Tusk | 4/2/4 | 10 | 0.95 | **0.96** | +0.01 | 0.77 | +0.19 | 0.10 |
| Cobra Chicken | 4/2/2 | 8 | 1.00 | **0.95** | -0.05 | 0.86 | +0.09 (n.s.) | 0.45 |
| Pell Quillon | 1/5/3 | 9 | 0.94 | **0.94** | -0.00 | 0.85 | +0.09 (n.s.) | 0.31 |
| Thessaly of the Grove * | 2/5/4 | 11 | 0.86 | **0.94** | +0.08 | 0.84 | +0.10 (n.s.) | 0.64 |
| Moss | 4/1/3 | 8 | 0.98 | **0.93** | -0.05 | 0.85 | +0.09 (n.s.) | 0.54 |
| Fennick Puffcap | 2/4/3 | 9 | 0.97 | **0.93** | -0.04 | 0.94 | -0.01 (n.s.) | 0.29 |
| Nettle Burrows | 2/3/5 | 10 | 0.92 | **0.92** | +0.00 | 0.84 | +0.09 (n.s.) | 0.30 |
| Elowen Leafwatch | 4/3/4 | 11 | 0.94 | **0.92** | -0.02 | 0.79 | +0.13 (n.s.) | 0.32 |
| Mayor Hobby Trickgrin | 2/4/5 | 11 | 0.85 | **0.92** | +0.07 | 0.72 | +0.20 | 0.00 |
| Lord-Paladin Aldric Ashcroft | 5/2/3 | 10 | 0.87 | **0.92** | +0.05 | 0.67 | +0.25 | 0.00 |
| Tova Emberdeep | 4/4/2 | 10 | 0.82 | **0.91** | +0.09 | 0.82 | +0.09 (n.s.) | 0.12 |
| Sister Aurelie Dane | 2/4/3 | 9 | 0.95 | **0.90** ▼ | -0.05 | 0.89 | +0.01 (n.s.) | 0.36 |
| Kesh the Bog Huntress | 5/2/4 | 11 | 0.86 | **0.89** ▼ | +0.03 | 0.81 | +0.09 (n.s.) | 0.21 |
| Warchief Grukka Ironjaw * | 6/3/5 | 14 | 0.79 | **0.88** ▼ | +0.09 | 0.84 | +0.04 (n.s.) | 0.14 |
| Thorgar Twice-Buried | 4/3/4 | 11 | 0.75 | **0.88** ▼ | +0.13 | 0.68 | +0.20 | 0.00 |
| Elder Ilvena of the Conclave | 2/5/3 | 10 | 0.81 | **0.86** ▼ | +0.06 | 0.70 | +0.16 | 1.07 |
| Marshal Hedda Ironvow | 5/2/4 | 11 | 0.87 | **0.86** ▼ | -0.01 | 0.79 | +0.07 (n.s.) | 0.00 |
| Grumma Ladlejaw | 3/4/2 | 9 | 0.92 | **0.85** ▼ | -0.07 | 0.83 | +0.02 (n.s.) | 0.25 |
| Gnash | 6/2/2 | 10 | 0.96 | **0.85** ▼ | -0.11 | 0.72 | +0.13 (n.s.) | 0.32 |
| Tansy Brambleby | 3/3/4 | 10 | 0.84 | **0.82** ▼ | -0.02 | 0.88 | -0.07 (n.s.) | 0.82 |
| Loremaster Oskar Grimgate | 3/4/5 | 12 | 0.92 | **0.81** ▼ | -0.11 | 0.73 | +0.08 (n.s.) | 1.21 |
| Lord Vaelis Nightbloom | 2/5/6 | 13 | 0.70 | **0.75** ▼ | +0.05 | 0.72 | +0.03 (n.s.) | 0.11 |
| Professor Barnaby Pickwort | 2/5/4 | 11 | 0.73 | **0.68** ▼ | -0.05 | 0.67 | +0.01 (n.s.) | 0.05 |

Spread: 0.68 to 1.46, standard deviation 0.16 (v0.6: 0.70 to 1.61, 0.17).

## Stacking (1500 games per player count at 3 and 4 players)

| Party | v0.6 | v0.7 | Change | 3 players | 4 players |
|---|---|---|---|---|---|
| Aelder + Aelthir + Vaelis | 2.41 | **2.51** | +0.11 | 77.9% | 68.7% |
| Kazra + Brunna + Sigrun (Dwarf) | 2.35 | **2.41** | +0.07 | 74.1% | 66.5% |
| Tobin + Farmer Hobart + Honk (Goose) | 2.79 | **2.65** | -0.13 | 77.7% | 77.0% |
| Mogra + Varg + Moss (Orc) | 1.89 | **2.02** | +0.13 | 63.7% | 54.3% |
| Gimlet + Goldie + Hobby | 2.11 | **2.09** | -0.03 | 66.4% | 55.3% |
| Torvi + Brisa + Pell | 1.25 | **1.33** | +0.07 | 43.9% | 33.5% |
| Corvin + Pell + Rook (draws) | 1.58 | **1.27** | -0.30 | 42.9% | 31.3% |
| Liriel + Elowen + Seraphine (Warden) | 1.33 | **1.37** | +0.04 | 49.5% | 30.4% |
| Aldric + Hedda + Brunna (turtle) | 0.82 | **0.93** | +0.11 | 30.9% | 23.1% |
| Grukka + Hesk + Kesh (Orc) | 1.39 | **1.52** | +0.13 | 50.9% | 37.5% |
| Thorgar + Tova + Thessaly (Undead) | 0.53 | **0.50** | -0.03 | 18.8% | 10.5% |


## Afterwards: Immobilizing Word narrowed

The designer confirmed that "Companion heroes" means heroes riding free beside the hero they are Companion To (not every hero with a Companion To entry). The card was changed and game health rerun (6000 games each, `docs/balance-data/v07b/nat.json`). The hero and stacking tables above were run before the change; the Word is one card in 78, so they are not expected to move by more than the noise.

| Players | Falls v0.6 | Falls v0.7 (before) | Falls v0.7 (riders only) | Survival (riders only) | Turns (riders only) |
|---|---|---|---|---|---|
| 2 | 0.56 | 0.63 | 0.63 | 95.3% | 7.29 |
| 3 | 1.01 | 1.24 | 1.22 | 94.7% | 9.10 |
| 4 | 1.12 | 1.86 | 1.81 | 94.7% | 10.48 |
| 5 | 1.57 | 2.99 | 2.91 | 93.6% | 11.92 |
| 6 | 2.24 | 4.19 | 4.00 | 92.8% | 12.51 |

## Afterwards: the weakest heroes

Extra runs on the lowest heroes (3000 games each at 3 and 4 players, about 0.06 either way) are in `docs/balance-data/v07-weak/`: stat what-ifs, and a variant of the bots that uses Barnaby, Grukka and Vaelis whenever it can.
