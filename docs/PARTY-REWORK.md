# The party rework (October 2026)

Heroes and companions are now one kind of card, **hero**, and every player leads an **adventuring party** of three. This note records the design, what was set aside, and where things live. How the numbers were set is in [BALANCE-party.md](BALANCE-party.md); the rulings are in [HOUSE-RULES.md](HOUSE-RULES.md).

## The rules in short

- A party is three heroes (a fourth with Ysolde, and one more for each complete pair: Varg and Moss, Goldie and Gimlet). Stats add up; there is no special "leader".
- **Start:** each player, in turn order, privately looks at the top 6 heroes and picks 3. Nobody can use a hero ability until everyone has picked.
- **Each turn from turn 2 (recruit phase):** each player may draw one hero at random and keep it (replacing one if the party is full) or let it go.
- **Falling:** a player who fails the encounter chooses one of their heroes to leave behind. It goes to the discard pile; the recruit phase refills the party (or The Hall of Rest does, at once). Nothing else is lost.
- **Encounters** are printed 5 or 6 lower (Physical -5, Mental -6, Guile -5), and **everyone draws 2 resources per turn**; both were set so the new game plays like the old one (see BALANCE-party.md).

## What happened to the cards

| | Before | After |
|---|---|---|
| Heroes (15) | one per player; stats 16-25 total; trigger; Kin bonus | stats halved, rounded up (8-14 total); ability kept; trigger and Kin bonus set aside |
| Companions (36) | up to two per player | now heroes, unchanged stats |
| Total pool | 15 + 36 | **44** (7 set aside) |

Set aside (all kept, text and numbers, in `data/set-aside.json`; the working engine code is in git at commit `262e213`):

- The 15 **triggers** ("When a Capital card enters play, draw two resources") and the 15 **Kin bonuses**.
- Seven companions whose abilities worked on "your hero": Sir Osric Vane and Rosalind Marchwell (stat swaps), Hobart Thimblewick, Caelan the Exile, Brisa Blastcap and Grumma Ladlejaw (force an opposing hero's stat), Mags Tolliver (double your hero's stats). With one kind of card, the four forcers duplicate Liriel, Thessaly and Kesh.

Reworded (the old text is in `changedMeaning` in `set-aside.json`): Thorgar ("if you would fall, you don't"), Ysolde ("your party may have four heroes"), Dagny ("one of your heroes falls"), Aelthir, Aldric, Brunna and Oskar (heroes, not companions), The Hall of Rest, The Amulet of Aesia and The Book of Grudges. Every other "companion" in a rules text became "hero" ("bonus hero above your party size"). The Runeforged Titan is 5 on Mental or Guile.

Card numbers are unchanged (1001-1015 former heroes, 2001-2036 former companions).

## Where it lives

| What | Where |
|---|---|
| Card data | `src/data/cards.json` (version v0.4), made from v0.3 by `scripts/apply-party-rework.mjs` |
| Set-aside register | `data/set-aside.json` |
| State | `PlayerState.party` (+ `inactive`, `resting`, `borrowed`); one hero deck and discard |
| Opening draft | `STEPS.partyDraft` in `flow.ts`; choose purpose `partyDraft` (pool size: rule `draftPool`, picks: `partySize`) |
| Recruit phase | `STEPS.recruit`; commands `recruit.draw / skip / keep / discard` (protocol version 2) |
| Falling | `heroFalls` task and choose purpose `fallHero` in `flow.ts` |
| Party size | `partySize()` in `effects.ts`: rule + `partyBonus` (Ysolde) + complete pairs |
| Ability flags | read from any party member with `playerHas()` (Brunna, Thorgar, Kazra, Corvin, Aldric's counter) |
| Balance harness | `scripts/balance` (`card`, `party`, `nat` experiments; `--ease`, `--rules`, `--tweak` for calibration) |

## Not done, on purpose

- **Corvin** is the one clear outlier (relative win rate 1.57; unchanged from before the rework). The candidate fix is in BALANCE-party.md; no card was changed beyond the rework.
- **Ysolde** keeps "party size 4" (decision). She wins 1.28 times her share controlled and 1.7 times in natural play; set her ability aside if that bothers you.
- The files `data/balance.json`, `data/art-map.json`, `data/encounter-difficulty.json` and `data/encounter-stats.json` belonged to the spreadsheet pipeline (already unrunnable before this change) and are no longer used.
- The tavern described in older notes never existed in the code.
