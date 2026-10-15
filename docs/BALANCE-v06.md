# Balance of the second card sheet pass (v0.6)

The sheet as edited on 14 October 2026 after the first balance report ([BALANCE-v05.md](BALANCE-v05.md)): 19 heroes with new stats, Allied taken off Aelthir, Kazra, Caelan and Ysolde, harder encounters with minions, Call the Five Crowns removed, Forgewrights Tools (was Gold Filings), cheaper Rune of Unmaking and two wands, three new plain resources. 204 cards: 49 heroes, 32 locations, 48 encounters, 75 resources. Same bots and harness; raw data in `docs/balance-data/v06/`.

## Summary

- **The game moved about halfway back.** At 3 players survival is 95.6% (the first pass 97.2%, the party rework 92.8%), falls per game 1.01 (0.63 and 1.69), games 8.9 turns (8.7 and 9.8), close games 18% (16% and 25%). Allied and Nemesis still add about 2.3 points of survival (93.3% with them off); Companion To adds about 0.3.
- **Hero strength is more even.** Relative win rates run from 0.70 to 1.61, standard deviation 0.17 (was 0.22; the party rework game 0.13). The four heroes that lost Allied or stats came back to the pack: Aelthir 1.84 to 1.18, Caelan 1.35 to 1.03, Kazra 1.25 to 1.06, Varg 1.30 to 1.10, Brunna 1.18 to 1.04, Aelder 1.31 to 1.18.
- **Still high:** Ysolde 1.61 (unchanged: her ability is the extra place, worth +0.87), Archmage Corvin 1.40 (up 0.23: the rest of the pool is weaker and his draw is worth +0.68), Farmer Hobart 1.31, Tobin 1.29, Hesk 1.20.
- **Still low, and stats are not the problem:** Vaelis 0.70 (13 total now), Barnaby 0.73, Thorgar 0.75, Grukka 0.79 (14 total, the highest in the game), Ilvena 0.81, Tova 0.82. Raising Grukka, Vaelis, Oskar and Tova helped Oskar (0.77 to 0.92) and Tova (0.76 to 0.82) a little and Grukka and Vaelis not at all; the abilities of all of these are worth nothing measurable.
- **Stacks:** the Goose party is now the strongest (2.79, up from 2.39), then Aelder + Aelthir + Vaelis 2.41 (was 2.92), Kazra + Brunna + Sigrun 2.35 (2.65), Gimlet + Goldie + Hobby 2.11 (1.80), Orc 1.89, Corvin + Pell + Rook 1.58 (1.29). Grukka + Hesk + Kesh rose from 0.82 to 1.39. Stacks of free riders did not weaken because the pool around them did.

## Game health (6000 games each)

Each cell is the party rework game / the first sheet pass (v0.5) / this pass (v0.6).

| Players | Avg turns | Falls per game | Survival | Survival P / M / G | Share of game before first fall | Bids per player-turn | Close games | Winning margin |
|---|---|---|---|---|---|---|---|---|
| 2 | 7.5 / 7.1 / **7.2** | 0.82 / 0.34 / **0.56** | 93.3% / 97.4% / **95.8%** | 93 / 92 / 95 / 97 / 97 / 98 / **96 / 95 / 97** | 81% / 91% / **86%** | 2.36 / 2.46 / **2.43** | 12% / 13% / **13%** | 11.7 / 12.1 / **11.8** |
| 3 | 9.8 / 8.7 / **8.9** | 1.69 / 0.63 / **1.01** | 92.8% / 97.2% / **95.6%** | 91 / 92 / 95 / 97 / 96 / 98 / **96 / 95 / 97** | 75% / 89% / **83%** | 2.42 / 2.57 / **2.52** | 25% / 16% / **18%** | 8.3 / 10.2 / **9.8** |
| 4 | 11.8 / 9.9 / **10.2** | 2.38 / 0.83 / **1.12** | 93.5% / 97.5% / **96.6%** | 92 / 92 / 96 / 97 / 97 / 98 / **97 / 96 / 98** | 79% / 90% / **88%** | 2.33 / 2.49 / **2.45** | 33% / 18% / **21%** | 7.1 / 9.4 / **9.1** |
| 5 | 13.5 / 11.3 / **11.2** | 3.35 / 1.29 / **1.57** | 93.5% / 97.2% / **96.4%** | 92 / 92 / 96 / 97 / 96 / 98 / **96 / 96 / 97** | 78% / 88% / **86%** | 2.08 / 2.26 / **2.21** | 33% / 23% / **22%** | 6.8 / 8.6 / **8.8** |
| 6 | 14.7 / 12.1 / **12.0** | 4.90 / 1.86 / **2.24** | 92.6% / 96.6% / **95.9%** | 91 / 91 / 95 / 97 / 95 / 98 / **96 / 95 / 97** | 74% / 85% / **83%** | 1.75 / 1.99 / **1.95** | 36% / 22% / **21%** | 6.5 / 8.5 / **8.7** |

### What the named abilities add (3 players, 3000 games each)

| Version | Survival | Falls per game | Turns | Bids per player-turn |
|---|---|---|---|---|
| This pass as written | 95.6% | 1.01 | 8.9 | 2.52 |
| Allied and Nemesis switched off | 93.3% | 1.45 | 9.0 | 2.53 |
| Allied, Nemesis and Companion To switched off | 93.0% | 1.58 | 9.5 | 2.48 |

## Individual heroes

Each hero forced into a rotating seat's opening party (500 games per hero at 3 and 4 players), once as printed and once as a stats-only hero. 1.00 is fair; the 95% margin is about 0.10. "v0.5" is the same experiment on the first sheet pass.

| Hero | P/M/G | Total | v0.5 | v0.6 | Change | Stats only | Ability worth | Effects per turn held |
|---|---|---|---|---|---|---|---|---|
| Ysolde of the Wellspring | 2/3/3 | 8 | 1.60 | **1.61** ▲ | +0.00 | 0.73 | +0.87 | 0.00 |
| Archmage Corvin Varro | 1/5/4 | 10 | 1.17 | **1.40** ▲ | +0.23 | 0.72 | +0.68 | 0.00 |
| Farmer Hobart Thimblewick | 4/3/4 | 11 | 1.12 | **1.31** ▲ | +0.19 | 0.98 | +0.33 | 0.12 |
| Tobin Quill | 3/4/2 | 9 | 1.18 | **1.29** ▲ | +0.11 | 0.99 | +0.29 | 1.02 |
| Hesk of Two Homes | 5/3/4 | 12 | 1.11 | **1.20** ▲ | +0.09 | 0.73 | +0.47 | 0.00 |
| Aelthir Moonveil | 2/4/4 | 10 | 1.84 | **1.18** ▲ | -0.66 | 1.00 | +0.17 | 1.03 |
| Aelder Mossleaf | 7/1/3 | 11 | 1.31 | **1.18** ▲ | -0.13 | 0.69 | +0.49 | 0.87 |
| Goldie Trickgrin | 2/4/5 | 11 | 1.10 | **1.14** ▲ | +0.04 | 0.94 | +0.20 | 0.00 |
| Honk | 4/2/1 | 7 | 1.06 | **1.14** ▲ | +0.08 | 0.95 | +0.19 | 0.88 |
| Queen Maren Ashcroft | 2/4/5 | 11 | 1.00 | **1.13** ▲ | +0.13 | 0.76 | +0.37 | 0.30 |
| Brisa Blastcap | 5/3/3 | 11 | 1.06 | **1.12** ▲ | +0.06 | 0.81 | +0.31 | 0.47 |
| Seraphine Moonveil | 2/6/3 | 11 | 1.00 | **1.12** ▲ | +0.11 | 0.83 | +0.28 | 0.48 |
| Duchess | 4/2/1 | 7 | 0.99 | **1.11** ▲ | +0.13 | 0.89 | +0.22 | 0.90 |
| Varg Ironjaw | 4/2/3 | 9 | 1.30 | **1.10** ▲ | -0.20 | 0.92 | +0.18 | 0.90 |
| Sigrun Stonefast | 2/3/5 | 10 | 1.06 | **1.09** | +0.02 | 0.86 | +0.23 | 0.00 |
| Sergeant Waddle | 4/2/2 | 8 | 1.06 | **1.08** | +0.02 | 0.87 | +0.20 | 0.94 |
| Kazra Emberdeep | 4/3/3 | 10 | 1.25 | **1.06** | -0.19 | 0.91 | +0.15 | 0.43 |
| High Thane Brunna Stonefast | 3/3/3 | 9 | 1.18 | **1.04** | -0.14 | 0.76 | +0.28 | 0.00 |
| Liriel Nightbloom | 3/5/3 | 11 | 0.94 | **1.04** | +0.10 | 0.82 | +0.22 | 0.46 |
| Dagny Coldhearth | 2/3/4 | 9 | 0.94 | **1.04** | +0.10 | 0.85 | +0.18 | 0.10 |
| Caelan Halfelven | 2/3/4 | 9 | 1.35 | **1.03** | -0.32 | 0.88 | +0.15 | 0.94 |
| Cobra Chicken | 4/2/2 | 8 | 0.96 | **1.00** | +0.04 | 0.94 | +0.07 (n.s.) | 0.46 |
| Moss | 4/1/3 | 8 | 1.04 | **0.98** | -0.06 | 0.95 | +0.03 (n.s.) | 0.41 |
| Fennick Puffcap | 2/4/3 | 9 | 0.82 | **0.97** | +0.15 | 0.91 | +0.06 (n.s.) | 0.27 |
| Captain Rook Halloran | 5/2/4 | 11 | 0.98 | **0.97** | -0.01 | 0.85 | +0.12 (n.s.) | 0.86 |
| Gnash | 6/2/2 | 10 | 0.81 | **0.96** | +0.15 | 0.86 | +0.10 (n.s.) | 0.31 |
| Sister Aurelie Dane | 2/4/3 | 9 | 0.92 | **0.95** | +0.03 | 0.93 | +0.02 (n.s.) | 0.35 |
| Urzha Half-Tusk | 4/2/4 | 10 | 0.89 | **0.95** | +0.06 | 0.83 | +0.12 (n.s.) | 0.10 |
| Pell Quillon | 1/5/3 | 9 | 0.90 | **0.94** | +0.04 | 0.89 | +0.05 (n.s.) | 0.31 |
| Elowen Leafwatch | 4/3/4 | 11 | 0.92 | **0.94** | +0.03 | 0.81 | +0.13 (n.s.) | 0.32 |
| Gimlet | 3/3/3 | 9 | 0.89 | **0.94** | +0.04 | 0.86 | +0.08 (n.s.) | 0.42 |
| Pip Wanderfoot | 3/3/3 | 9 | 0.97 | **0.92** | -0.04 | 0.92 | +0.01 (n.s.) | 0.32 |
| Nettle Burrows | 2/3/5 | 10 | 0.92 | **0.92** | -0.00 | 0.87 | +0.05 (n.s.) | 0.29 |
| Loremaster Oskar Grimgate | 3/4/5 | 12 | 0.77 | **0.92** | +0.14 | 0.82 | +0.10 (n.s.) | 1.21 |
| Grumma Ladlejaw | 3/4/2 | 9 | 0.95 | **0.92** | -0.04 | 0.85 | +0.06 (n.s.) | 0.23 |
| Mogra Swiftfoot | 3/3/2 | 8 | 0.86 | **0.91** | +0.05 | 0.83 | +0.08 (n.s.) | 0.63 |
| Torvi Cinderkeg | 3/2/3 | 8 | 0.98 | **0.90** ▼ | -0.08 | 0.84 | +0.06 (n.s.) | 0.19 |
| Marshal Hedda Ironvow | 5/2/4 | 11 | 0.92 | **0.87** ▼ | -0.04 | 0.80 | +0.08 (n.s.) | 0.00 |
| Lord-Paladin Aldric Ashcroft | 5/2/3 | 10 | 0.88 | **0.87** ▼ | -0.01 | 0.77 | +0.10 (n.s.) | 0.00 |
| Thessaly of the Grove | 2/5/4 | 11 | 0.79 | **0.86** ▼ | +0.08 | 0.84 | +0.02 (n.s.) | 0.64 |
| Kesh the Bog Huntress | 5/2/4 | 11 | 0.87 | **0.86** ▼ | -0.01 | 0.86 | +0.00 (n.s.) | 0.19 |
| Mayor Hobby Trickgrin | 2/4/5 | 11 | 0.85 | **0.85** ▼ | -0.00 | 0.74 | +0.10 (n.s.) | 0.00 |
| Tansy Brambleby | 3/3/4 | 10 | 0.78 | **0.84** ▼ | +0.06 | 0.84 | +0.01 (n.s.) | 0.80 |
| Tova Emberdeep | 4/4/2 | 10 | 0.76 | **0.82** ▼ | +0.06 | 0.81 | +0.01 (n.s.) | 0.11 |
| Elder Ilvena of the Conclave | 2/5/3 | 10 | 0.83 | **0.81** ▼ | -0.03 | 0.70 | +0.11 (n.s.) | 1.06 |
| Warchief Grukka Ironjaw | 6/3/5 | 14 | 0.74 | **0.79** ▼ | +0.05 | 0.71 | +0.08 (n.s.) | 0.15 |
| Thorgar Twice-Buried | 4/3/4 | 11 | 0.71 | **0.75** ▼ | +0.04 | 0.65 | +0.10 (n.s.) | 0.00 |
| Professor Barnaby Pickwort | 2/5/4 | 11 | 0.69 | **0.73** ▼ | +0.04 | 0.77 | -0.04 (n.s.) | 0.05 |
| Lord Vaelis Nightbloom | 2/5/6 | 13 | 0.71 | **0.70** ▼ | -0.01 | 0.78 | -0.08 (n.s.) | 0.11 |

Spread: 0.70 to 1.61, standard deviation 0.17 (v0.5: 0.69 to 1.84, 0.22; the party rework game: 0.75 to 1.57, 0.13).

## Stacking (1500 games per player count at 3 and 4 players)

| Party | v0.5 | v0.6 | Change | 3 players | 4 players |
|---|---|---|---|---|---|
| Aelder + Aelthir + Vaelis | 2.92 | **2.41** | -0.51 | 74.2% | 66.2% |
| Kazra + Brunna + Sigrun (Dwarf) | 2.65 | **2.35** | -0.30 | 73.3% | 63.6% |
| Tobin + Farmer Hobart + Honk (Goose) | 2.39 | **2.79** | +0.40 | 83.0% | 79.5% |
| Mogra + Varg + Moss (Orc) | 1.98 | **1.89** | -0.08 | 58.9% | 51.4% |
| Gimlet + Goldie + Hobby | 1.80 | **2.11** | +0.31 | 66.7% | 56.5% |
| Torvi + Brisa + Pell | 1.30 | **1.25** | -0.04 | 41.2% | 31.9% |
| Corvin + Pell + Rook (draws) | 1.29 | **1.58** | +0.28 | 52.7% | 39.3% |
| Liriel + Elowen + Seraphine (Warden) | 1.02 | **1.33** | +0.31 | 47.3% | 30.3% |
| Aldric + Hedda + Brunna (turtle) | 0.89 | **0.82** | -0.08 | 28.1% | 19.7% |
| Grukka + Hesk + Kesh (Orc) | 0.82 | **1.39** | +0.57 | 47.4% | 33.5% |
| Thorgar + Tova + Thessaly (Undead) | 0.48 | **0.53** | +0.05 | 19.9% | 11.2% |

