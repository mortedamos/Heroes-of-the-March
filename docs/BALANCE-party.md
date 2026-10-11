# Balance of the party rework (October 2026)

Heroes and companions became one kind of card, **hero**, and each player leads a **party of three**. This note records how the numbers were set and what the simulation says about the new game. Raw results are in `docs/balance-data/party/` (`baseline/` is the game before the rework, `final/` the game after).

## What changed in the numbers

- Former heroes: every stat halved and rounded up (totals 8-14, average 11.2; former companions 8-13, average 10.0). Their triggers and Kin bonuses are set aside (`data/set-aside.json`).
- Pool: 44 heroes (15 former heroes + 36 former companions - 7 set aside).
- A random three-hero party is 3.0 / 3.2 / 3.7 points per stat (Physical / Mental / Guile) weaker than the old hero + two companions, about 4 when drafted.
- **Encounters: Physical -5, Mental -6, Guile -5** from the cards of the old game (the first guess, -3/-3/-4, left survival at 82%).
- **Steady draws: every player draws 2 per turn** (was 2 for the current player, 1 for the others).

## Why not just -3 or -4

Three things were measured with the same bots on both versions (6000 games each, mix of 2-6 players):

| Setting | Survival | Falls per player per game (3p) | Bids per player-turn (3p) | Turns (3p) |
|---|---|---|---|---|
| Old game (baseline) | 93.8% | 0.49 | 2.34 | 9.4 |
| New cards, encounters -3/-3/-4, draws 2/1 (first guess) | 81.5% | 1.57 | 1.88 | 10.0 |
| Encounters -7/-7/-8, draws 2/1 | 94.0% | 0.48 | 1.85 | 10.0 |
| **Encounters -5/-6/-5, draws 2/2 (chosen)** | **92.8%** | **0.56** | **2.42** | **9.8** |

Two effects add up. The party is weaker (about 3.3 per stat), and the 15 former-hero triggers and Kin bonuses were a large source of cards: bids per player-turn fall from 2.3 to 1.9 without them. Easier encounters alone would keep survival right but leave bidding 20-25% quieter (and bidding is meant to be core fun). Drawing 2 for everyone puts the bids back, and then a shift of 5-6 matches the old game. Per stat the same shift leaves Guile about 5 points easier than the others (97% vs 92% / 90% survival at -2 each), so Mental got the larger cut and Guile the smaller one: survival is now 93% / 92% / 95% for Physical / Mental / Guile.

## The new game against the old one (6000 games each)

| Players | Avg turns | | Falls per game | | Survival | | Turns before first fall | | Bids per player-turn | | Close games (≤4 Renown) | | Winning margin | |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | old | new | old | new | old | new | old | new | old | new | old | new | old | new |
| 2 | 7.5 | 7.5 | 0.78 | 0.82 | 94.0% | 93.3% | 83% | 81% | 2.34 | 2.36 | 11% | 12% | 12.0 | 11.7 |
| 3 | 9.4 | 9.8 | 1.48 | 1.69 | 93.8% | 92.8% | 81% | 75% | 2.34 | 2.42 | 20% | 25% | 9.2 | 8.3 |
| 4 | 11.2 | 11.8 | 2.31 | 2.38 | 93.5% | 93.5% | 80% | 79% | 2.34 | 2.33 | 26% | 33% | 8.1 | 7.1 |
| 5 | 13.0 | 13.5 | 3.34 | 3.35 | 93.1% | 93.5% | 78% | 78% | 2.34 | 2.08 | 29% | 33% | 7.3 | 6.8 |
| 6 | 14.4 | 14.7 | 5.37 | 4.90 | 91.4% | 92.6% | 71% | 75% | 2.24 | 1.75 | 32% | 36% | 7.0 | 6.5 |

Games are as long, as dangerous and as sabotage-heavy (turns with an opposing effect or card trade: 71% / 90% / 96% / 98% / 99% against 69% / 89% / 96% / 99% / 100%). Two small differences: games are a little closer (parties vary less than hero + companions did), and at 5-6 players bids per turn are lower (the hand limit of 6 and more bidders per location).

## Individual heroes

Each hero was forced into a rotating seat's opening party (500 games per hero at 3 and 4 players), everyone else drafted at random, once with abilities and once stats-only. Relative win rate: 1.00 is fair.

- **Spread:** 0.75 to 1.57, standard deviation 0.13. As heroes and companions the same cards spread 0.65 to 1.58 with standard deviation 0.23 (heroes alone) because a hero's slot was worth so much. Stat total no longer explains much (r = -0.37).
- **Outliers up:** Archmage Corvin Varro **1.57** (stats only 0.80, so his ability is worth +0.78; he was 1.58 as a hero), Ysolde **1.28** (was 1.42), Pell Quillon 1.17, Rook 1.14, Pip 1.11, Aelthir 1.10.
- **Outliers down:** Grukka 0.75, Tova 0.82, Thorgar 0.82, Vaelis 0.86, Liriel and Elowen 0.89. The bots draft Vaelis, Grukka and Thorgar highly (high stats) and they win less than their share: stat total is a poor guide in the new game.
- **Seat order:** first player 33.6 / 24.0% against fair 33.3 / 25.0%.

### Stacking

Parties forced into one seat (1500 games each at 3 and 4 players, random opponents):

| Party | Relative win rate |
|---|---|
| Corvin + Ysolde + Pip (draws) | **2.06** |
| Corvin + Rook + Pell | **1.95** |
| Aldric + Hedda + Brunna (turtle) | 0.86 |
| Liriel + Thessaly + Kesh (forcing stats) | 0.86 |
| Grukka + Barnaby + Urzha (location and encounter control) | 0.60 |
| Vaelis + Grukka + Elowen (highest stats) | 0.57 |

Stacking abilities is not a problem except around Corvin: the turtle and control parties lose. With Corvin, even ordinary partners win about twice their share.

**Candidate fix, not applied:** Corvin's extra draw on his player's own turn only (the version in HERO-BALANCE.md). Corvin alone 1.09, with Rook and Pell 1.38, with Ysolde and Pip 1.49. It needs the card text "Once per turn on your turn, when you draw a resource, draw an additional resource." The text currently says "once per turn" and the engine matches it.

## Left for the owner

- Corvin as above. Ysolde (party size 4) at 1.28 controlled, but she is drafted often and wins 1.7 times her share in natural play. The decision to keep her stands unless this matters to you; setting her ability aside is a one-line change (`partyBonus` in `abilities.ts`, plus card text).
- Bot draft valuation (`src/bots/knowledge.ts`) overrates raw stats; a human drafter will do better.
