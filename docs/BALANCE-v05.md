# Balance of the card sheet pass (v0.5)

The sheet edits of 14 October 2026 (new abilities on most heroes, three new heroes, Brisa and Grumma back, **Companion To**, **Allied** and **Nemesis**, a few locations and encounters) were built into the engine and simulated with the same bots and harness as the party rework ([BALANCE-party.md](BALANCE-party.md)). Raw results are in `docs/balance-data/v05/`; `docs/balance-data/party/final/` is the game before this pass. 202 cards are in the game: 49 heroes, 32 locations, 48 encounters, 73 resources (the Set aside tabs of the sheet are not used).

## Summary

- **The game got easier, shorter and less close.** Survival 97% (was 93%), falls per game about half, games 5-18% shorter, and at 3-6 players close games 16-23% (was 25-36%). Allied and Nemesis explain about half of the extra survival; Companion To under a point. Encounters about +2 / +3 / +2 harder would restore survival, but not game length.
- **Heroes are much less even.** Relative win rates run from 0.69 to 1.84 (standard deviation 0.22, was 0.13). Above: Aelthir 1.84, Ysolde 1.60, Caelan Halfelven 1.35, Aelder 1.31, Varg 1.30, Kazra 1.25. Below: Barnaby 0.69, Thorgar and Vaelis 0.71, Grukka 0.74, Tova 0.76, Oskar 0.77 (none of these has an ability that helps: the abilities are not statistically different from nothing). Stat total no longer says anything (r = -0.13).
- **A free fourth hero is worth about +1.0 of relative win rate.** Taking Companion To away costs the strong stacks 1.0 to 1.7 (the Goose party falls from 2.39 to 0.68), and Ysolde, whose ability is exactly an extra place, is at 1.60. Companions that ride for free are full heroes: Aelder (total 14, tied for the highest in the game), Varg, Brunna and Torvi (11). A cap on how many ride for free does not help except against the geese (2.39 to 1.55 with a cap of one), because one free hero is already most of the effect.
- **"Enters play" triggers on any kind of card fire almost every turn** (Aelthir 1.09 effects per turn held, Caelan 0.93, Varg 0.91): about one free resource a turn. On Aelthir it comes with Allied on the same tags (Elf and Human are about a quarter of all resources), and he is the strongest hero at 1.84 (ability worth +0.94).
- **Stacks of Allied and companions dominate:** Aelder + Aelthir + Vaelis 2.92 (88% to win a 3-player game), Kazra + Brunna + Sigrun 2.65, Tobin + Farmer Hobart + Honk 2.39, Mogra + Varg + Moss 1.98, Gimlet + Goldie + Hobby 1.80. Before this pass the best stack was 2.06. Thorgar + Tova + Thessaly (Nemesis Undead) is the weakest at 0.48.

Ideas that follow from the numbers, none of them applied: make companions cheap (a rider should total about 8, not 11-14) or let only one party member ride; give the broad "enters play" triggers a narrower scope (encounters and locations, not every resource and hero); give each of Aelthir, Kazra, Brunna and Tobin either the trigger or the Allied bonus, not both; look again at Thorgar, Barnaby, Vaelis, Grukka, Tova and Oskar, whose abilities add nothing measurable.

## Game health: the new game against the party-rework game (6000 games each)

Each cell is before / after.

| Players | Avg turns | Falls per game | Survival | Share of game before first fall | Bids per player-turn | Close games (winner within 4 Renown) | Winning margin |
|---|---|---|---|---|---|---|---|
| 2 | 7.5 / 7.1 | 0.82 / 0.34 | 93.3% / 97.4% | 81% / 91% | 2.36 / 2.46 | 12% / 13% | 11.7 / 12.1 |
| 3 | 9.8 / 8.7 | 1.69 / 0.63 | 92.8% / 97.2% | 75% / 89% | 2.42 / 2.57 | 25% / 16% | 8.3 / 10.2 |
| 4 | 11.8 / 9.9 | 2.38 / 0.83 | 93.5% / 97.5% | 79% / 90% | 2.33 / 2.49 | 33% / 18% | 7.1 / 9.4 |
| 5 | 13.5 / 11.3 | 3.35 / 1.29 | 93.5% / 97.2% | 78% / 88% | 2.08 / 2.26 | 33% / 23% | 6.8 / 8.6 |
| 6 | 14.7 / 12.1 | 4.90 / 1.86 | 92.6% / 96.6% | 74% / 85% | 1.75 / 1.99 | 36% / 22% | 6.5 / 8.5 |

The game is **easier and shorter and less close**: survival 97% (was 93%), falls per game down by about half, games 5-18% shorter, close games at 3-6 players 16-23% (was 25-36%). Bids per turn are a little higher. Surviving by stat: Physical / Mental / Guile are now 97 / 96 / 98.

### What explains it (3 players, 3000 games each unless noted)

| Version | Survival | Physical / Mental / Guile | Falls per game | Turns | Bids per player-turn |
|---|---|---|---|---|---|
| Party rework game (before) | 92.8% | 91 / 92 / 95 | 1.69 | 9.8 | 2.42 |
| **This sheet, as written** | 97.2% | 97 / 96 / 98 | 0.63 | 8.7 | 2.57 |
| Allied and Nemesis switched off | 95.2% | 96 / 93 / 97 | 1.05 | 9.0 | 2.45 |
| Allied, Nemesis and Companion To switched off | 94.8% | 95 / 93 / 97 | 1.17 | 9.3 | 2.43 |
| As written, other players draw 1 not 2 | 95.5% | 96 / 94 / 97 | 1.03 | 8.9 | 2.04 |
| As written, encounters +1/+1/+1 | 96.0% | 96 / 94 / 98 | 0.89 | 8.7 | 2.57 |
| As written, encounters +2/+2/+1 | 94.9% | 95 / 93 / 97 | 1.12 | 8.7 | 2.57 |
| As written, encounters +2/+3/+2 | 93.5% | 94 / 91 / 96 | 1.44 | 8.7 | 2.60 |
| As written, encounters +3/+3/+2 | 93.0% | 92 / 91 / 96 | 1.56 | 8.7 | 2.61 |

Allied and Nemesis account for about half of the extra survival (97.2% to 95.2%), Companion To for under a point; the rest comes from the changed heroes, the new heroes and the edited places. Giving the other players one card instead of two does **not** bring survival back (95.5%) and costs a fifth of the bids, so the extra cards are not the cause. Raising the encounters by about +2 / +3 / +2 restores survival to 93.5% and falls to 1.44 (was 1.69) with the same Physical / Mental / Guile split as before, but **game length does not come back** (8.7 turns whatever the encounters): games end sooner because stronger parties win more of their locations, which is also why fewer games are close.

## Individual heroes

Each hero was forced into a rotating seat's opening party (500 games per hero at 3 and 4 players), everyone else drafted at random, once as printed and once as a stats-only hero (no ability, no Allied, Nemesis or Companion To). Relative win rate: 1.00 is fair; the 95% margin is about 0.10.

| Hero | P/M/G | Total | Relative win rate | Stats only | Ability worth | Effects per turn held | Held 3+ turns, never fired |
|---|---|---|---|---|---|---|---|
| Aelthir Moonveil | 2/4/5 | 11 | **1.84** ▲ | 0.90 | +0.94 | 1.09 | 0% |
| Ysolde of the Wellspring | 2/3/3 | 8 | **1.60** ▲ | 0.79 | +0.82 | 0.00 | 100% |
| Caelan Halfelven | 2/4/4 | 10 | **1.35** ▲ | 0.90 | +0.45 | 0.93 | 0% |
| Aelder Mossleaf | 8/2/4 | 14 | **1.31** ▲ | 0.73 | +0.58 | 0.84 | 1% |
| Varg Ironjaw | 5/3/3 | 11 | **1.30** ▲ | 0.92 | +0.39 | 0.91 | 0% |
| Kazra Emberdeep | 4/3/4 | 11 | **1.25** ▲ | 0.94 | +0.31 | 0.49 | 8% |
| High Thane Brunna Stonefast | 4/3/4 | 11 | **1.18** ▲ | 0.85 | +0.34 | 0.00 | 100% |
| Tobin Quill | 3/4/2 | 9 | **1.18** ▲ | 0.96 | +0.22 | 0.97 | 0% |
| Archmage Corvin Varro | 1/5/4 | 10 | **1.17** ▲ | 0.75 | +0.41 | 0.00 | 100% |
| Farmer Hobart Thimblewick | 4/3/4 | 11 | **1.12** ▲ | 0.87 | +0.26 | 0.13 | 49% |
| Hesk of Two Homes | 5/3/4 | 12 | **1.11** ▲ | 0.77 | +0.35 | 0.00 | 100% |
| Goldie Trickgrin | 2/4/5 | 11 | **1.10** ▲ | 0.87 | +0.24 | 0.00 | 100% |
| Sigrun Stonefast | 2/3/5 | 10 | **1.06** | 0.91 | +0.16 | 0.00 | 100% |
| Brisa Blastcap | 5/3/3 | 11 | **1.06** | 0.82 | +0.25 | 0.44 | 9% |
| Honk | 4/2/1 | 7 | **1.06** | 0.86 | +0.20 | 0.83 | 0% |
| Sergeant Waddle | 4/2/2 | 8 | **1.06** | 0.91 | +0.15 | 0.89 | 0% |
| Moss | 4/3/3 | 10 | **1.04** | 0.84 | +0.20 | 0.47 | 13% |
| Queen Maren Ashcroft | 2/4/5 | 11 | **1.00** | 0.70 | +0.31 | 0.28 | 11% |
| Seraphine Moonveil | 2/6/3 | 11 | **1.00** | 0.85 | +0.15 | 0.47 | 5% |
| Duchess | 4/2/1 | 7 | **0.99** | 0.85 | +0.13 (n.s.) | 0.84 | 0% |
| Captain Rook Halloran | 5/2/5 | 12 | **0.98** | 0.83 | +0.14 | 0.76 | 2% |
| Torvi Cinderkeg | 4/3/4 | 11 | **0.98** | 0.78 | +0.20 | 0.11 | 71% |
| Pip Wanderfoot | 3/3/3 | 9 | **0.97** | 0.92 | +0.04 (n.s.) | 0.31 | 28% |
| Cobra Chicken | 4/2/2 | 8 | **0.96** | 0.85 | +0.11 (n.s.) | 0.44 | 10% |
| Grumma Ladlejaw | 3/4/2 | 9 | **0.95** | 0.92 | +0.04 (n.s.) | 0.19 | 48% |
| Liriel Nightbloom | 3/5/3 | 11 | **0.94** | 0.87 | +0.07 (n.s.) | 0.43 | 10% |
| Dagny Coldhearth | 2/3/4 | 9 | **0.94** | 0.82 | +0.12 (n.s.) | 0.10 | 69% |
| Nettle Burrows | 2/3/5 | 10 | **0.92** | 0.85 | +0.07 (n.s.) | 0.26 | 33% |
| Marshal Hedda Ironvow | 5/2/4 | 11 | **0.92** | 0.91 | +0.01 (n.s.) | 0.00 | 100% |
| Sister Aurelie Dane | 2/4/3 | 9 | **0.92** | 0.90 | +0.02 (n.s.) | 0.30 | 38% |
| Elowen Leafwatch | 4/3/6 | 13 | **0.92** | 0.78 | +0.14 | 0.32 | 1% |
| Pell Quillon | 1/5/3 | 9 | **0.90** ▼ | 0.80 | +0.10 (n.s.) | 0.29 | 31% |
| Gimlet | 3/3/3 | 9 | **0.89** ▼ | 0.86 | +0.04 (n.s.) | 0.37 | 18% |
| Urzha Half-Tusk | 5/3/5 | 13 | **0.89** ▼ | 0.79 | +0.10 (n.s.) | 0.05 | 73% |
| Lord-Paladin Aldric Ashcroft | 5/2/3 | 10 | **0.88** ▼ | 0.83 | +0.05 (n.s.) | 0.00 | 100% |
| Kesh the Bog Huntress | 5/2/4 | 11 | **0.87** ▼ | 0.84 | +0.03 (n.s.) | 0.17 | 42% |
| Mogra Swiftfoot | 3/3/2 | 8 | **0.86** ▼ | 0.84 | +0.02 (n.s.) | 0.59 | 3% |
| Mayor Hobby Trickgrin | 3/4/5 | 12 | **0.85** ▼ | 0.83 | +0.02 (n.s.) | 0.00 | 100% |
| Elder Ilvena of the Conclave | 2/5/3 | 10 | **0.83** ▼ | 0.78 | +0.05 (n.s.) | 1.01 | 0% |
| Fennick Puffcap | 2/4/3 | 9 | **0.82** ▼ | 0.87 | -0.05 (n.s.) | 0.24 | 54% |
| Gnash | 6/2/2 | 10 | **0.81** ▼ | 0.81 | +0.00 (n.s.) | 0.28 | 31% |
| Thessaly of the Grove | 2/5/4 | 11 | **0.79** ▼ | 0.84 | -0.05 (n.s.) | 0.59 | 5% |
| Tansy Brambleby | 3/3/4 | 10 | **0.78** ▼ | 0.74 | +0.04 (n.s.) | 0.72 | 1% |
| Loremaster Oskar Grimgate | 4/4/5 | 13 | **0.77** ▼ | 0.81 | -0.04 (n.s.) | 1.18 | 0% |
| Tova Emberdeep | 3/4/5 | 12 | **0.76** ▼ | 0.84 | -0.08 (n.s.) | 0.11 | 59% |
| Warchief Grukka Ironjaw | 6/3/4 | 13 | **0.74** ▼ | 0.68 | +0.06 (n.s.) | 0.15 | 40% |
| Lord Vaelis Nightbloom | 3/5/6 | 14 | **0.71** ▼ | 0.69 | +0.02 (n.s.) | 0.09 | 61% |
| Thorgar Twice-Buried | 4/3/4 | 11 | **0.71** ▼ | 0.71 | +0.00 (n.s.) | 0.00 | 100% |
| Professor Barnaby Pickwort | 2/5/4 | 11 | **0.69** ▼ | 0.67 | +0.01 (n.s.) | 0.05 | 77% |

Spread: 0.69 to 1.84, standard deviation 0.22 (the party rework game: 0.75 to 1.57, 0.13). Stats-only heroes win about 0.8 of their share here because the opposition's abilities are stronger than theirs.

## Stacking: three heroes forced into one seat (1500 games per player count at 3 and 4 players, random opponents)

| Party | Relative win rate | 3 players | 4 players |
|---|---|---|---|
| Aelder + Aelthir + Vaelis | **2.92** | 88.3% | 81.7% |
| Kazra + Brunna + Sigrun (Dwarf) | **2.65** | 80.5% | 74.1% |
| Tobin + Farmer Hobart + Honk (Goose) | **2.39** | 73.1% | 66.3% |
| Mogra + Varg + Moss (Orc) | **1.98** | 63.1% | 52.2% |
| Gimlet + Goldie + Hobby | **1.80** | 58.6% | 46.3% |
| Torvi + Brisa + Pell | **1.30** | 42.0% | 33.7% |
| Corvin + Pell + Rook (draws) | **1.29** | 43.8% | 31.5% |
| Liriel + Elowen + Seraphine (Warden) | **1.02** | 36.8% | 22.8% |
| Aldric + Hedda + Brunna (turtle) | **0.89** | 30.1% | 22.1% |
| Grukka + Hesk + Kesh (Orc) | **0.82** | 28.5% | 19.2% |
| Thorgar + Tova + Thessaly (Undead) | **0.48** | 16.1% | 12.0% |

### What each part is worth (the same parties with one thing taken away)

Taking a thing away "anywhere" also changes the random opponents, so those rows understate its effect on the party.

|  | Relative win rate | Change |
|---|---|---|
| **Aelder + Aelthir + Vaelis** | **2.92** |  |
| &nbsp;&nbsp;no draw trigger on Aelthir | 2.21 | -0.71 |
| &nbsp;&nbsp;no Allied on Aelthir | 2.39 | -0.53 |
| &nbsp;&nbsp;no Companion To anywhere | 1.83 | -1.09 |
| &nbsp;&nbsp;no +3 on Aelder | 2.44 | -0.47 |
| **Kazra + Brunna + Sigrun** | **2.65** |  |
| &nbsp;&nbsp;no Allied anywhere | 2.10 | -0.55 |
| &nbsp;&nbsp;no Companion To anywhere | 1.50 | -1.15 |
| &nbsp;&nbsp;no trigger on Kazra | 2.39 | -0.26 |
| **Tobin + Farmer Hobart + Honk** | **2.39** |  |
| &nbsp;&nbsp;no draws on Farmer Hobart | 2.19 | -0.20 |
| &nbsp;&nbsp;no Companion To anywhere | 0.68 | -1.71 |
| &nbsp;&nbsp;no Allied anywhere | 1.88 | -0.51 |
| &nbsp;&nbsp;no Keeper of the Flock | 1.87 | -0.52 |
| **Mogra + Varg + Moss** | **1.98** |  |
| &nbsp;&nbsp;no Companion To anywhere | 1.00 | -0.98 |
| &nbsp;&nbsp;no trigger on Varg | 1.47 | -0.51 |
| &nbsp;&nbsp;no steal on Mogra | 1.92 | -0.05 |
| &nbsp;&nbsp;no draw on Moss | 1.69 | -0.28 |
| **Gimlet + Goldie + Hobby** | **1.80** |  |
| &nbsp;&nbsp;no Allied anywhere | 1.59 | -0.20 |
| &nbsp;&nbsp;no Companion To anywhere | 0.75 | -1.04 |
| &nbsp;&nbsp;no Tavern Keeper | 1.71 | -0.09 |

### A lever: a cap on companions that ride for free (`companionCap`, off by default)

|  | Survival (3p) | Turns (3p) | Aelder + Aelthir + Vaelis | Kazra + Brunna + Sigrun | Tobin + Hobart + Honk | Mogra + Varg + Moss | Gimlet + Goldie + Hobby |
|---|---|---|---|---|---|---|---|
| No cap (as written) | 97.2% | 8.7 | 2.92 | 2.65 | 2.39 | 1.98 | 1.80 |
| At most 2 free riders | 97.2% | 8.8 | 2.92 | 2.66 | 2.23 | 1.99 | 1.79 |
| At most 1 free rider | 97.2% | 8.9 | 2.97 | 2.67 | 1.55 | 1.94 | 1.74 |

### Single-hero what-ifs (2000 games each at 3 and 4 players, margin about 0.07)

The same hero forced into one seat, with one thing changed. Nothing here is applied to the cards.

| Hero | Change | Relative win rate |
|---|---|---|
| **Aelthir Moonveil** | as written | 1.83 |
|  | no Allied | 1.22 |
|  | no draw trigger | 1.12 |
| **Caelan Halfelven** | as written | 1.35 |
|  | no Allied | 1.06 |
|  | no draw trigger | 0.92 |
| **Kazra Emberdeep** | as written | 1.23 |
|  | no Allied | 0.98 |
|  | no draw trigger | 1.04 |
| **Varg Ironjaw** | as written | 1.28 |
|  | no draw trigger | 1.02 |
|  | no Companion To | 1.13 |
| **Aelder Mossleaf** | as written | 1.33 |
|  | stats 4/1/3 | 1.06 |
|  | stats 4/1/3, no +3 | 0.93 |
|  | no Companion To | 1.15 |
| **Brunna Stonefast** | as written | 1.14 |
|  | stats 3/2/3 | 1.00 |
|  | no Companion To | 0.87 |
| **Torvi Cinderkeg** | as written | 1.00 |
|  | stats 3/2/3 | 0.99 |
| **Moss** | as written | 1.04 |
|  | stats 3/2/3 | 0.97 |
| **Ysolde** | as written | 1.58 |
|  | no Allied or Nemesis | 1.36 |

