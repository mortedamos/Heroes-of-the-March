# Card balance review (simulated play)

Status: **final**, from all 10 planned rounds (72,000 hero games, 79,200 companion games, 24,000 natural-play games). The raw data is in `docs/balance-data/`, and the full per-card tables are in `docs/CARD-BALANCE-TABLES.md`. The tables are the authority if any figure here differs.

## Method

- Everything is bot-vs-bot at **normal** level, seeded and exactly reproducible: game *g* of an experiment always uses the same seed, whatever the shard count. The harness is `scripts/balance/`; see "Reproducing" below.
- **Heroes (controlled):** the measured hero is dealt to a rotating seat; the other seats are dealt random distinct heroes, with `heroDraft: 1` so draft choices don't skew results. 3 and 4 players. Companions are drafted by the bots as normal.
- **Companions (controlled):** the measured companion is forced into one seat's opening pair; every opening companion draft is random, so bot preferences don't skew it. Heroes are dealt blind.
- **Ablation:** each experiment is repeated with the measured card's ability removed (stats kept). *Ability worth* = relative win rate with the ability − without it.
- **Relative win rate** = wins ÷ fair share (1/players), pooled over 3p and 4p. 1.00 is exactly fair, and the ± is a 95% interval. At this sample size heroes are ±0.04 and companions ±0.06.
- **Natural play:** bots draft and play normally, 2–6 players. This answers "what do winners hold and use?". It is confounded by bot preferences and by survivorship (see below), so it is a pointer, not a measurement.
- **Effects per turn held** counts triggered hooks that visibly did something plus activations used. It cannot see passive/static abilities (stat swaps, flat bonuses), which therefore show 0 and "never fired". For those, the ablation figure is the only measure.

## Headline

1. **Heroes are not balanced.** Relative win rates run from 0.61 to 1.64, and the spread is about 13× what noise alone would give. Stat totals do not predict it (r = −0.23); abilities do.
2. **Companions are much closer, but not equal.** Most sit within about ±10% of fair; there is a clear top (Oskar 1.41, Mags 1.24) and one clear outlier at the bottom (Ilvena 0.54).
3. **Going first is worth little** (about 35% vs 32% for 3rd seat at 3p; 26% vs 24–25% at 4p). Seat is not distorting the card results, since each card is rotated through seats.

## Heroes

| Tier | Hero | Rel. win rate | Stats Σ | Ability worth | Notes |
|---|---|---|---|---|---|
| Strong | Ysolde of the Wellspring | **1.64** | 18 | +1.08 | Entire strength is the 3rd companion slot; stats-only she would be 0.57. Still the open item from `HERO-BALANCE.md`. |
| Strong | Mayor Hobby Trickgrin | **1.42** | 21 | +0.81 | Draw trigger fires ~1.3×/turn, plus all-face-down bidding. Strongest in natural play too (1.72 when kept to the end). |
| Strong | High Thane Brunna Stonefast | **1.40** | 21 | +0.62 | Immunity to hostile effects plus a Physical-challenge draw. |
| Strong | Lord-Paladin Aldric Ashcroft | 1.17 | 21 | +0.46 | Counter ability; P11. |
| Fair | Aelthir 1.00, Hesk 0.99, Thorgar 0.98, Kazra 0.97, Maren 0.95 | | | | Within or just inside the noise band of fair. |
| Slightly weak | Warchief Grukka Ironjaw | 0.92 | 22 | +0.20 | |
| Weak | Urzha Half-Tusk | 0.80 | 23 | **+0.02** | Ability does nothing measurable and fires in only 0.02 effects/turn; 91% of games with her held 3+ turns never fire it. |
| Weak | Professor Barnaby Pickwort | 0.76 | 24 (highest) | **+0.09** | Highest stats, ability worth ≈ 0. |
| Weak | Archmage Corvin Varro | 0.73 | 18 | +0.24 | Low stats, ability not compensating. |
| Weak | Pip Wanderfoot | 0.69 | 20 | +0.13 | Uses his ability constantly (every time offered) with almost no payoff. |
| Weak | Lord Vaelis Nightbloom | **0.61** | 20 | +0.08 | Weakest hero by a margin; 9% at 4p. |

Takeaways:
- Four heroes (Ysolde, Hobby, Brunna, Aldric) win ~20–65% more than their share; five (Vaelis, Pip, Corvin, Barnaby, Urzha) win 20–40% less. A good target band is roughly 0.9–1.1.
- The weak heroes are the ones whose abilities add almost nothing (worth ≤ +0.13: Urzha, Barnaby, Pip, Vaelis). This is the same pattern `HERO-BALANCE.md` found before its tuning, so the earlier changes did not fix it for these four.
- The numbers here do not reproduce the "after changes" table in `HERO-BALANCE.md` (e.g. Ysolde 54% at 3p here vs 44% there; Hobby 43% vs 36%). The earlier runs predate later rule changes and used a different opponent mix, and its script is no longer in the repo, so I cannot say which differences matter. Rankings broadly agree (Ysolde and Hobby on top, Urzha and Barnaby low), so treat the ordering as reliable and the absolute levels as specific to this harness.
- Natural play agrees with the controlled results on the extremes (Hobby, Ysolde, Brunna, Aldric up; Corvin, Vaelis, Pip, Urzha, Barnaby down). It diverges for Aelthir (1.24 vs 0.98) and Kazra (0.75 vs 0.99), which suggests bot drafting and companion pairing matter for those two.

## Companions

| Group | Card | Rel. win rate | Ability worth | Notes |
|---|---|---|---|---|
| Strongest | Loremaster Oskar Grimgate | **1.41** | +0.57 | Static ability, so it never shows up as "firing". Bots keep him in ~74% of natural games. Consistent in both experiments, so this is a real outlier. |
| | Mags Tolliver | **1.24** | +0.38 | Doubles hero stats once, then leaves. |
| | Marshal Hedda Ironvow | 1.18 | +0.29 | |
| | Seraphine Moonveil, Tansy Brambleby | 1.11 / 1.09 | +0.18 / +0.16 | |
| Weakest | Elder Ilvena of the Conclave | **0.54** | **−0.25** | Stats-only she would be 0.78. Her ability costs a resource card; bots use it on 61% of offers. Either the cost is too high, or the bot overuses it. Natural play agrees (0.57 ever-held). |
| | Caelan, Wren, Honk | 0.85–0.89 | ≈ 0 | Slightly below fair. |

Everything else is between about 0.9 and 1.1, near the noise band. Stat totals do not predict results (r = 0.12), which is the desired state.

### Static abilities (stat swaps and flat bonuses)

Effects/turn can't measure these; the ablation does. Measured worth: Oskar +0.57, Gnash +0.17, Aurelie +0.14, Goldie +0.12; and effectively **zero**: Mogra (0.00), Nettle (−0.02), Sigrun (0.00), Posy (+0.05), Osric (+0.05), Pell (+0.07). Those six are near-vanilla companions.

## Abilities that rarely or never trigger

Counted by wrapping every trigger hook and counting activations used, over 24,000 natural games.

| Card | Evidence |
|---|---|
| **Tova Emberdeep** | Her activation was offered 2,801 times and **used 0** times (4,745 offers in the final data). |
| **Urzha Half-Tusk** (hero) | Used 1,387 of 418,452 offers (0.3%); never fires in 90% of games where she's held 3+ turns. |
| **Goose cluster:** Sergeant Waddle, Cobra Chicken, Duchess, Honk | Used on only ~6–7% of offers; 71–83% of games never fire. Worth ≈ 0. They may depend on specific partners or locations; or the bots don't know how to use them. |
| Clemence Fairbrook | Used 29% of offers; 64% of games never fire. |
| Tansy Brambleby | Hook effective 6% of calls; 64% never fire. |
| Mira Coldwater | Used 14% of offers; 45% never fire. |
| Tobin Quill, Fennick Puffcap | Hooks effective ~8% / ~19% of calls; ~40% of games never fire. |
| Barnaby, Corvin | 24–32% of games never fire (and low worth). |

**Locations, resources, encounters:**
- Every card in the database is implemented (`statusReport()` lists none as todo or partial). The 19 encounters shown with no mechanism are vanilla stat blocks; encounters appear evenly (about 3,500–3,900 each).
- Hook-bearing cards that were **called but never visibly did anything**: Cold Iron Barrier, Null-Rune Seal and Shield of Xorthalos (about 12,000–18,000 calls each, 0 effective). They only matter in particular situations (wands, falls), and my detector may miss their effects; a spot check is needed before calling them dead.
- Conditionally useful: the six Shards of the Marchstone, Blasting Powder (≈28%), Arangil's Vision Glass (≈34%), and The Goose & Kettle (≈29%).
- **The Hall of Rest was never played in 24,000 games.** Its value is 0, so the bots never bid it. That is a bot blind spot, not a card bug; it needs a hand-built scenario.

## Winners vs. others (natural play)

"Final roster" win ratio is biased upward: a card you still hold at the end is evidence you didn't lose it to falls. The **ever-held** ratio is cleaner. Cards that stand out under both views:
- **Hobby, Ysolde, Brunna, Aldric** — high both ways (heroes above).
- **Oskar** (1.41 ever-held, 1.53 final roster), **Mags** (1.33), **Hedda** (1.18) — high both ways.
- **Ilvena** — 0.57 ever-held, 0.48 final roster, held in about a quarter of all player-games, so she is an actively harmful pick that the bots keep making.
- **Mira Coldwater** looks huge (1.81) in the final roster but 1.27 ever-held and 1.0 or below in the controlled run, so that is mostly survivorship, not strength.
- Activation rates of winners vs. losers are nearly identical for every card, so no ability stands out as a "winners use it more" signal; strength shows up in who holds the card, not how often it fires.

## Suggested tuning (not applied)

Targets are the clearly outlying cards; all changes should be re-measured with the harness.

- **Heroes down:** Ysolde (ability redesign, as `HERO-BALANCE.md` already concluded: the third slot is the problem, not her stats), Hobby (reduce draw frequency), Brunna (trim one of her two effects). Aldric only slightly.
- **Heroes up:** Vaelis (+stat or stronger effect), Pip, Corvin, Urzha (the ability almost never matters; give it a trigger that happens), Barnaby (24 total stats with no ability value suggests he can lose a stat point or gain an ability).
- **Companions:** trim Oskar or make his effect cost something; look at Mags (strong in both experiments). Ilvena needs either a cheaper cost or a bot-logic check. Review Tova, the goose cluster, and the six near-vanilla stat-swap companions. They are cheap to improve because they currently add almost nothing.
- **Bots:** before tuning anything, check whether Tova, Ilvena, Pip and the goose cluster are used badly. A card that bots handle poorly looks weak here for the wrong reason (`src/bots/knowledge.ts` has hand-written logic for several of them).

## Limitations

- Bot skill with each card is part of every number, particularly for cards with hand-coded bot logic. Humans may use abilities (bluffing, timing, Pip's stealing) quite differently.
- 3 and 4 player games only in the controlled runs; 2, 5 and 6 appear only in natural play.
- The "did anything" detector for hooks watches events, queued tasks, pending decisions and renown; effects outside those are undercounted.
- Companion forcing replaces one offered pool card, which very slightly changes who sees which pool.

## Reproducing

```
npm run balance:build
node _build/balance/cli.mjs run hero --games 240 --from 0 --ns 3,4 --seed 1 --out docs/balance-data/hero-r1.json
node _build/balance/cli.mjs run hero --games 240 --from 0 --ns 3,4 --seed 1 --ablate --out docs/balance-data/hero-ablate-r1.json
node _build/balance/cli.mjs run comp --games 120 --from 0 --ns 3,4 --seed 2 --out docs/balance-data/comp-r1.json
node _build/balance/cli.mjs run nat --games 2400 --from 0 --seed 7 --out docs/balance-data/nat-r1.json
node _build/balance/report.mjs docs/balance-data > docs/CARD-BALANCE-TABLES.md
```

Each round uses a new `--from` offset (240, 480, … for heroes) so chunks never overlap; the report merges every `*-rN.json` file.

## Companion redesign results (round 2)

After the geese, Tobin, Tansy, Sigrun, Pell, Mogra, Nettle, Posy, Osric and Tova changes, the 13 changed companions were rerun with the same controlled method (1,200 games per card at 3 and 4 players, with and without the ability; data in `docs/balance-data/v2/`). All sit between 0.90 and 1.17 relative win rate (95% interval ±0.06), against 0.53–1.41 before for the full roster.

| Card | Before | After | Notes |
|---|---|---|---|
| Honk | 0.88 | 0.95 | The reveal is used on about 20% of turns held. |
| Waddle | 0.94 | 0.98 | |
| Duchess (Hiss) | 0.98 | 1.05 | |
| Cobra Chicken (Hiss) | 0.98 | 1.04 | |
| Tobin | 1.03 | 0.98 | Fires on almost every game (0.7 effects per turn); ability worth ≈ 0 because Geese are rare. |
| Tansy | 1.10 | 1.00 | Fires in about 22% of games where held 3+ turns. |
| Tova | 0.95 | 0.93 | Now used (about 0.2 rests per turn, was 0 of 4,745 offers) but the ability is worth only +0.01. Still slightly low; a small stat buff would fix it. |
| Mogra | 1.02 | 0.96 | |
| Sigrun | 0.99 | 1.02 | Ability worth +0.03. |
| Nettle | 1.02 | 1.00 | |
| Pell (+2) | 1.02 | 1.14 | Ability worth +0.25. Slightly above the target band, kept at +2 as requested. |
| Posy (cap +1) | 0.96 | 1.06 | |
| Osric (cap +1) | 0.94 | 0.99 | |

Posy and Osric were first measured with a +2 cap on the borrowed stat and came out too strong (1.17 and 1.14, ability worth +0.25 each, against about +0.09 predicted), so the cap was lowered to +1. The table shows the +1 results.

Not yet measured: The Golden Egg (added after these runs), and Tobin and Tansy's effect on opponents' win rates.

## Round 3: Tova, Pell, Posy and Osric adjustments

Tova 1/3/4 → 2/4/4; Pell 2/5/3 → 1/5/2 (ability still +2); Posy and Osric now gain +1 themselves when the hero's stat swap is used (replacing the "one companion borrows the stat" clause). Rerun with the same method and seed (1,200 games per card at 3 and 4 players, ±0.06; data in `docs/balance-data/v2/comp-tweak3.json`).

| Card | Round 2 | Round 3 |
|---|---|---|
| Tova Emberdeep | 0.93 | **1.02** |
| Pell Quillon | 1.14 | **0.97** |
| Posy Marchbank | 1.06 (cap +1) | **1.01** |
| Sir Osric Vane | 0.99 (cap +1) | **0.97** |

All four sit inside the 0.9–1.1 target band. Pell overshot a little downward (about 0.97 against a predicted 1.10); a one-point stat restore would put her near 1.0 if you want it. The Golden Egg was in the deck for this run (75 resource cards).
