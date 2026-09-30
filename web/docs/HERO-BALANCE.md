# Hero balance analysis

Goal: **no bad heroes.** Heroes with lower stat totals should be balanced by
stronger abilities.

## Method

- Bot games using the default rules at the time: steady draws, tavern, catch-up draw (the catch-up draw has since been removed).
- One seat, rotated, starts with the hero being measured. Heroes are dealt
  rather than drafted so draft choices don't skew the numbers.
- 600 games per hero at 3 players (fair win rate 33%) and 400 games at 4 players (fair 25%).
- Each hero was also measured with its ability switched off ("stats only").
  The difference is what the ability is worth.
- Normal-level bots, so these numbers measure how well *bots* use each ability.
  Treat ±4 points as noise.

## How often each stat is tested

| | Physical | Mental | Guile |
|---|---|---|---|
| Chance the challenge uses it | 36% | 31% | 34% |
| Average difficulty when it does | 10.8 | 10.5 | 11.7 |

Physical comes up most, so a very low Physical (Barnaby P2, Aelthir P3) is a real weakness.

## v0.3 heroes as printed (3 players)

| Hero | Stats (total) | Win % | Stats only % | Ability worth (points) |
|---|---|---|---|---|
| Ysolde of the Wellspring | P6 M8 G4 (18) | **52.5** | 22.0 | +30.5 |
| Archmage Corvin Varro | P4 M9 G5 (18) | **50.0** | 18.0 | +32.0 |
| Pip Wanderfoot | P5 M8 G7 (20) | **47.0** | 18.5 | +28.5 |
| Queen Maren Ashcroft | P6 M10 G6 (22) | **43.0** | 24.5 | +18.5 |
| Mayor Hobby Trickgrin | P4 M6 G11 (21) | 33.0 | 22.0 | +11.0 |
| Warchief Grukka Ironjaw | P10 M8 G5 (23) | 30.8 | 26.0 | +4.8 |
| Kazra Emberdeep | P6 M6 G8 (20) | 29.8 | 18.7 | +11.1 |
| Lord-Paladin Aldric Ashcroft | P11 M4 G6 (21) | 28.7 | 23.7 | +5.0 |
| Lord Vaelis Nightbloom | P4 M6 G10 (20) | 28.3 | 15.0 | +13.3 |
| Professor Barnaby Pickwort | P2 M10 G10 (22) | *25.3* | 22.5 | +2.8 |
| Thorgar Twice-Buried | P6 M6 G8 (20) | *23.8* | 19.3 | +4.5 |
| Urzha Half-Tusk | P8 M7 G5 (20) | *23.7* | 22.5 | +1.2 |
| High Thane Brunna Stonefast | P8 M6 G7 (21) | *23.3* | 21.7 | +1.6 |
| Hesk of Two Homes | P8 M4 G8 (20) | *23.3* | 18.5 | +4.8 |
| Aelthir Moonveil | P3 M7 G10 (20) | *22.3* | 16.3 | +6.0 |

**Findings**
- Win rates range from 22% to 52%. Abilities, not stat totals, drive almost all of it: ability value ranges from +1 to +32 points, while stat totals only range from 18 to 23.
- The principle "low stats, strong ability" already shows (Ysolde and Corvin at 18), but the compensation overshoots badly.
- The weak heroes have *situational* abilities that rarely decide a turn: Brunna only matters when she's forced, Urzha only when doomed, Thorgar only when failing (falls are rare), and Hesk needs companions with activated abilities.
- The new rules interact with some heroes. Steady draws make Corvin's "draw one more whenever you draw" fire every turn. More bidding gives Pip more face-down cards to steal.

## Changes (applied)

All of these except Ysolde are in the game. They're defined in `data/balance.json` on top of the spreadsheet: stats and card text change, and revised cards show a REVISED tag with the reason. The spreadsheet itself is unchanged.

| Hero | Change | Why |
|---|---|---|
| Archmage Corvin Varro | The extra draw happens **on your own turn** only. | Steady draws made it fire every turn. |
| Pip Wanderfoot | Claiming a face-down bid **swaps** it: the victim gets a random card from Pip's hand, face down, in its place. | Still sabotage, but no longer a pure double swing. |
| Queen Maren Ashcroft | Royal Requisition **on your turn** only (it was "any turn"). | Was usable up to 3 times per round. |
| Aelthir Moonveil | Silence **before bidding**, once the challenge is known (was "start of any turn"); **P3 → P5**. | Blind targeting was weak, and P3 fails Physical challenges. |
| Hesk of Two Homes | **M4 → M7**. | His ability depends on companions he may not have. |
| High Thane Brunna Stonefast | "Walls First" also blocks opponents' **silences and negations** on her cards, not just forced stats. | Makes her the anti-sabotage hero and gives her ability a real job. |
| Urzha Half-Tusk | Not This Fight **needs no roll**; **G5 → G8**. | The ability alone rarely decides a turn. |
| Thorgar Twice-Buried | **+1 to every challenge**; +5 instead if he would fail. | +3 overshot badly (46%). |
| Professor Barnaby Pickwort | **P2 → P4**. | Physical is the most-tested stat. |
| Warchief Grukka Ironjaw | **P10 → P9**. | Highest stat total; drifted up once others were fixed. |
| Ysolde of the Wellspring | *Still open.* Tried: stats 18 → 15 (44%); third companion's stats at half (44%). | Her strength is having a third companion at all (another ability, more survivability), not its stats. It needs an ability redesign. |

## Results with all changes applied

| Hero | Before (3p) | After (3p, fair 33) | After (4p, fair 25) |
|---|---|---|---|
| Ysolde of the Wellspring | 52.5 | **44.2** | 29.5 |
| Archmage Corvin Varro | 50.0 | 37.5 | 23.3 |
| Mayor Hobby Trickgrin | 33.0 | 35.8 | **37.5** |
| Queen Maren Ashcroft | 43.0 | 35.8 | 25.3 |
| Hesk of Two Homes | 23.3 | 35.0 | 21.0 |
| Warchief Grukka Ironjaw | 30.8 | 34.5 | 20.0 |
| Aelthir Moonveil | 22.3 | 34.2 | 23.3 |
| Lord-Paladin Aldric Ashcroft | 28.7 | 33.3 | 24.3 |
| High Thane Brunna Stonefast | 23.3 | 33.2 | 24.3 |
| Thorgar Twice-Buried | 23.8 | 31.7 | 22.3 |
| Kazra Emberdeep | 29.8 | 31.2 | 26.3 |
| Professor Barnaby Pickwort | 25.3 | 30.8 | 18.8 |
| Pip Wanderfoot | 47.0 | 30.5 | 20.0 |
| Lord Vaelis Nightbloom | 28.3 | 28.5 | **15.0** |
| Urzha Half-Tusk | 23.7 | 26.7 | **16.5** |

- At 3 players the spread shrinks from 22–52% to 27–38% for everyone except Ysolde.
- At 4 players the order changes. Hobby gets strong, because forced stats happen more often with more opponents and each one draws him a card. Vaelis, Urzha and Barnaby get weak.

**Still to decide:** Ysolde's redesign, and whether to tune for 4 or more players separately. Options include per-player-count Renown targets, or abilities that scale with the number of opponents.
