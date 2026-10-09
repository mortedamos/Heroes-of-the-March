# Brief: a painted sky for each location (26 paintings, as flat wide strips)

Every location has its own look, and 26 of them need a painting of their own. Until a painting exists, a location shows its family's painting (or, if the family's is the wrong kind of place or retired, a plain gradient). This replaces `art/SKYBOX-BRIEF.md` for these paintings; the old brief still describes the ten family paintings.

The spec for every place (mood, light, what is in the picture) is `docs/LOCATION-LOOKS.md` (local, gitignored). The scenes below are taken from it, and they are what `npm run skies` reads (see "Making them").

## The format: a flat, wide strip

A painting is **one flat, wide picture, not a panorama of the whole sky**. The game sticks it onto the sky like a poster, centred on the way the camera looks, and it fades into the plain sky at its left, right and top edges. The picture does not need to wrap, and nothing outside it is ever seen.

- **Any shape that is not exactly 2:1 is a strip.** (The ten old family paintings are 2:1 panoramas of the whole sky and still work as they are.) The wider the better: a 4:1 picture spends all of its pixels where the camera looks, a 21:9 picture most of them, a 16:9 picture only its lower third. The generator asks for 4:1 and falls back to 21:9.
- **Its height on the sky follows from its shape**, so it is never stretched: 4:1 covers 34 degrees up from the horizon, 21:9 covers 59, 16:9 covers 77. Only the lowest part of a tall picture is ever on screen.
- **Where things go, measured in the game** (1280 x 720 window, a 4:1 strip; heights are measured up from the bottom edge, which is the horizon):

| | Across the picture | Up the picture |
|---|---|---|
| Looking straight ahead | the middle 57% (x 21% to 78%) | from about 10% to about 70% |
| Turning the mouse to its limit | the whole width, edge to edge | the same |
| Phone in portrait | the middle 35% | from about 10% to about 70% |

- **The bottom edge is the horizon.** The 3D ground hides the bottom 5% to 10% of the picture, and its far edge fades into the painting at about 10% to 20% up, so **put the horizon (where the ground meets the sky, or the walls meet the floor) about 10% up from the bottom edge**, and keep the band from 10% to 20% up calm, smooth and mid-toned: the game reads its average colour to fade the ground into the sky without a line. Below the horizon the picture only needs to be plain and dark.
- **The top of the picture is never seen** for a 4:1 strip above about 70% of its height (higher for a taller one), so the sky above the subject can be simple.
- **The subject goes in the middle**, with the left and right sides continuing the scene more quietly: the middle is what you see first, and the camera turns less than 25 degrees either way.
- Soft, broad shapes. A strip is shown at about its own size, so it can have more detail than the old panoramas, but it is still only a backdrop.
- Darker and calmer than the card art (the cards must stay the brightest thing on screen). No bright sun disc low on the horizon, no people, no text, no UI.
- **Indoors:** the picture is the middle of the walls at eye level (windows, arches, shelves, braziers, banners). Ceiling and floor are never seen, so spend nothing on them.
- **Outdoors:** the picture is the horizon: structures and landscape, with soft sky above.

## Making them

`npm run skies` makes them with Gemini, reading the scenes in the two tables below. It needs the `GEMINI_API_KEY` environment variable (it never prints it) and credits on the Gemini account.

```
npm run skies -- list                      what there is to make, what is made and what is installed
npm run skies -- prompts --only barrowdeep the full prompt, to paste into the Gemini app by hand
npm run skies -- generate --only barrowdeep,the-umbral-deep     ask Gemini (leave out --only for all 26)
npm run skies -- install --only barrowdeep copy it into public/locations and the manifest
```

Made pictures are kept in `_build/art-work/skies/` (not in git) next to a `.json` note of the prompt and model used, until they are installed. Use `--force` to make one again, `--ratio 21:9` or `--size 2K` to ask for a different shape or size, `--model` to pick a model, and `--dry` to see the prompts without asking.

To make one by hand instead, paste the output of `prompts` into the Gemini app, ask for a 4:1 (or the widest) picture, and save it as `public/locations/<id>_sky.jpg`; then add `"<id>": { "sky": "<id>_sky.jpg" }` to `public/locations/manifest.json` (`fog` is optional: the game reads the horizon colour from the image).

## Judging a painting

Open the debug menu (the Debug button in the dev build, or add `?debug` to the page address), choose the place under "Location look", then pick the image file under **Try a painting**. It becomes the sky of every place, so you can check it against each table and light, until you press Reset or reload. Nothing is saved or copied into the project. Pull the camera back (scroll down on the table) or start a new place to see the sky, and move the mouse to turn the view. The same picture installed in the manifest looks exactly the same.

The old forge and fortress paintings (`forge_sky.webp`, `fortress_sky.webp`) are retired: no location uses them any more. The files are left in place.

## Indoors (9)

Do these first: they are the places that are most wrong today (a table inside a room, under an outdoor sky).

| File | Prompt |
|---|---|
| `tomb-of-the-first-wardens_sky.jpg` | a sealed rib-vaulted burial chamber, stone wardens standing in wall niches with hands on sword hilts, faint pale gold-white warding runes glowing along the arches, one slanted lance of dusty light from a crack in the vault, cold slate stone, blue-black shadow |
| `barrowdeep_sky.jpg` | an ancient Neolithic passage tomb chamber in the manner of Bryn Celli Ddu, rough upright megalith slabs and a corbelled dry-stone roof, packed earth and hanging roots between the stones, spirals, zigzags and concentric rings pecked into every slab with the grooves glowing faint ghost-blue, a long stone-lined passage with a pale light far down it, cold breath-mist, earth brown and bone white |
| `the-umbral-deep_sky.jpg` | an immense lightless cavern, a black still underground lake, stalactites vanishing into darkness overhead, clusters of violet glowing fungus and crystals along the shore as the only light, cold cyan glints on wet rock, near-black |
| `the-deep-forge-of-karrak_sky.jpg` | a vast dwarven smithy hall, dressed stone masonry, dwarf-cut pillars and arches, a vaulted roof with chimney flues rising into smoke, glowing furnace mouths along the walls, hanging chains, orange-white firelight on grey stone, black iron |
| `the-wardens-hall_sky.jpg` | a great stone hall of the old wardhouse, a vaulted ceiling with long banner-hung beams, tall slit windows throwing dusty gold shafts of light, a huge hearth with a fire, stone statues of wardens along the walls, warm stone and deep red banners |
| `the-hearthlands-archive_sky.jpg` | a small cosy halfling museum room by afternoon daylight, a low ceiling, wood-panelled walls, glass display cases, framed maps, brass desk lamps with green shades, a round window onto a green hill, honey wood and cream |
| `the-sealed-archive_sky.jpg` | a windowless sealed archive, tall shelves bound with iron chains and red wax seals, a heavy iron-bound door, chalk ward circles, a single cold white lamp, near-monochrome iron grey with accents of wax red |
| `the-collegium-observatory_sky.jpg` | a domed observatory with the dome slit open on a brilliant starfield and the Milky Way, a brass orrery, astrolabes and telescopes catching starlight, chart tables, midnight blue and brass, cool silver light |
| `the-endless-stair_sky.jpg` | a vertical mountain shaft with a dwarven spiral stair cut into the stone, carved balustrades and rune bands on the walls, a brazier at every turn dwindling into darkness both far above and far below, amber firelight on slate, bronze details |

## Outdoors (17)

| File | Prompt |
|---|---|
| `parting-strand_sky.jpg` | grey dawn over a harbour mouth, a shingle beach and a stone quay, a bank of sea fog, a thin cold gold line at the horizon, dark orc longships with red-ochre sails putting out to sea, a beacon on the harbour mole burning low, slate-green water |
| `the-old-quarry_sky.jpg` | an open-air abandoned stone quarry in bright flat overcast light, terraced cut walls showing layered strata in white, rust and grey with one green seam, a still teal pool, crows on the rim, no fire |
| `the-crack-in-the-marchstone_sky.jpg` | a torn dusk sky, a rent in the clouds pouring white-gold light with violet edges, shards of black-veined stone hanging in the air, a vast split standing stone silhouetted on the horizon, dark cracked land |
| `gorewatch_sky.jpg` | the view from a great rocky rise over endless swampland under a sullen red low sun veiled by smoke and marsh haze, reed beds, black pools, drowned dead trees, rising mist, the black timber palisade, towers and hide banners of an orc fortress silhouetted around the near edge, smoke columns |
| `the-storybook-glade_sky.jpg` | a bright spring morning in a clearing ringed by great leaning trees like the border of an illuminated manuscript page, giant flowers, toadstool rings, golden shafts of light, rose-gold and fresh green, soft and slightly too perfect |
| `sylvaneth_sky.jpg` | afternoon among colossal ancient trees whose trunks stand like cathedral columns, gold-green dappled light, softly lit elven halls and rope bridges high in the canopy, a waterfall off a root cliff, ivory and living bronze |
| `the-hollow-hills_sky.jpg` | thick white fog over grass-covered mounds with round doors in their flanks, a blurred pale sun, faint blue-white fey lights low among the mounds, milk-white and pale green |
| `the-hollow-between_sky.jpg` | endless twilight over a thin wood of pale half-transparent trees, stars visible through the canopy, a seam of light low on the horizon, black still water, indigo and teal |
| `the-mirror-marches_sky.jpg` | a flooded forest under flat pewter noon light, water so still the trees and sky are perfectly doubled, rusted armoured helmets and spear tips just breaking the surface, silver and glass-green |
| `silverlake-at-midsummer_sky.jpg` | last light on a wide silver lake under a lilac sky with the first stars, strings of lanterns between the trees on the shore, small lit boats on the water, bonfires, a midsummer fair |
| `marchguard-keep_sky.jpg` | a cold clear morning in a paved inner castle courtyard hemmed in by high grey granite walls, barracks, a gatehouse, stairs to the wall-walk, towers and roofs of a castle-city rising behind, five banners in five different colours on one wall |
| `the-field-of-oaths_sky.jpg` | an open meadow under an overcast late-afternoon sky, a ring of weathered oath-stones, rows of pennants, one old oak at the centre, a faint ring of castle towers far on the horizon, steel and faded green |
| `grimgate_sky.jpg` | alpine dusk at a mountain face carved into a colossal gate with bronze-bound doors, brazier-lit stairs climbing the cliff, snowfields above, amber windows glowing in the rock, cold blue sky |
| `kingsford_sky.jpg` | a commons square inside a great human castle-city on a bright clear afternoon, tall timber-and-stone buildings with awnings and flower boxes all round, streets and lanes leading off in several directions, banners strung across them, a castle rising over the rooftops, white-gold light, royal blue sky |
| `the-speaking-stones_sky.jpg` | a ring of tall rune-cut monoliths on a heather moor under a bruise-violet storm sky, one break in the cloud lighting the stones, runes faintly glowing, heather violet and lichen grey |
| `the-endless-road_sky.jpg` | a dirt road with wheel ruts running straight to the horizon in both directions between hedgerows, milestones, one lone wagon, an afternoon of racing cloud shadows with a far rain curtain on one side |
| `clover-hollow_sky.jpg` | a green bowl of hills with round-door cottages and chimney smoke, clover and wildflowers, a bright late-spring morning, blue sky with soft white clouds |

## Optional polish (the six that already have a fitting painting)

These keep their current painting and need nothing. If you want to improve them later: the Goose & Kettle with a low beamed ceiling and a goose-and-kettle sign; Hearthmeadow with a terraced hill-town of round doors; the Silverwood Hunt with silver-white birch and colder light; the Skyship Valour with the ship's blue-and-white pennants and rigging; the Barrowlands and the Mage College Vaults as they are.
