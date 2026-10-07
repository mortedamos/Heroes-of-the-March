# Location art (optional)

Every location already has a procedural 3D look (see `src/client/render/env/themes.ts`): table surface, ground,
table, light, fog and weather. You can replace the **table top** and **ground** textures of any theme with
hand-made art. Nothing else changes; the table itself, the lights and the weather stay real 3D.

## Skyboxes (recommended first)

Each theme can also have a **panorama for the sky dome**. It blends with the procedural look: the dome crossfades to it
when the place changes, and the 3D table, light shafts, mist and particles stay live in front of it. Harbor and sky panoramas also slide slowly round the sky in a loop (see `skyScroll` in `themes.ts`), so keep their left and right edges seamless.

```json
{
  "fortress": { "sky": "fortress_sky.webp", "fog": "#9fb0c4" },
  "archive":  { "sky": "archive_sky.webp", "fog": "#120e1c", "keepSkyline": false }
}
```

- `sky`: an **equirectangular 2:1 panorama**, 4096 x 2048 (2048 x 1024 is fine for mobile), webp or jpg. The horizon runs through the
  vertical middle. The camera only ever sees the part around and above the horizon, so put the interest there and keep the lower half plain.
- `fog`: the colour of the horizon where it meets the ground. The ground fades into this colour, so match it to the panorama's horizon
  band or you will see a seam. Sample it from the image.
- `keepSkyline`: by default a panorama replaces the procedural skyline ring. Set true to keep the ring in front of it.
- The left and right edges must wrap without a seam.
- Keep it **darker and calmer than the card art**; no bright sun disc low on the horizon (the light shafts add the sun feel).
- No ground or table, no people, no text. The game draws the table and the ground.

Skybox prompt prefix: *"Equirectangular 360 degree panorama, 2:1, seamless left and right edges, painterly stylised fantasy, no ground plane, no characters, no text,"*

| Theme | Skybox prompt |
|---|---|
| tavern | the inside of a timber-framed tavern hall at night: dark rafters, hanging lanterns, shuttered windows, a glowing hearth far off, warm smoky air |
| harbor | overcast dusk over a misty harbour, grey-blue clouds, distant ship masts and rooftop silhouettes at the horizon |
| snow | pale arctic sky, soft aurora ribbon, layered snow-capped peaks at the horizon, drifting cloud |
| crypt | black sky with a sickly green moon behind thin clouds, dead trees and ruined arches as faint silhouettes at the horizon |
| forge | smoke-choked red sky, glowing volcanic ridges and chimney stacks on the horizon, drifting embers |
| forest | dusk through a dense forest canopy, deep green mist, shafts of gold light, dark pine silhouettes ringing the horizon |
| fortress | clear late-afternoon sky with high cloud, a distant ring of castle walls and towers on the horizon |
| archive | the inside of a vast gothic library: ring of tall arched windows with violet moonlight, rows of shelves and a vaulted ceiling, candle glow |
| plains | golden-hour sky over rolling farmland, a windmill and hills on the horizon, long clouds |
| sky | open sky above a sea of clouds, brilliant blue to pale horizon, huge cumulus towers, no ground |

Interiors (tavern, archive) work: the walls and ceiling are in the panorama, and the table, shelves, candles and light
shafts are 3D in front of it.

## How to add table and ground art

1. Put the image files in `public/locations/` (webp or png, square, **1024 x 1024**, **seamlessly tileable**).
2. List them in `public/locations/manifest.json`:

```json
{
  "forest": { "top": "forest_top.webp", "floor": "forest_floor.webp", "tile": 5 },
  "forge":  { "top": "forge_top.webp",  "tile": 6 }
}
```

`tile` is how many world units one repeat covers (the table is 19 x 12.6 units; cards are about 1.3 wide).
Leave a key out to keep the procedural version. Themes: `tavern`, `harbor`, `snow`, `crypt`, `forge`, `forest`,
`fortress`, `archive`, `plains`, `sky`.

## Rules for the images

- Top-down orthographic view of the surface only. No perspective, no horizon, no vignette, no objects, no text, no cards.
- Seamless: edges must wrap. Ask for "seamless tileable texture", then check by tiling 2 x 2.
- Mid-to-dark values. Cards are cream and must stay readable on top, so keep it darker than the card art and low contrast.
- Even lighting with no baked shadows or highlights (the game lights it).

## Prompts

Prefix every prompt with: *"Top-down seamless tileable game texture, flat even lighting, no shadows, no objects, no text, painterly stylised fantasy,"*

| Theme | Locations | Table top | Ground |
|---|---|---|---|
| tavern | Waystone Inn, Goose & Kettle, Moot Hall | worn oak tavern planks, ring stains from mugs, candle-wax drips | dark scuffed floorboards, spilled straw |
| harbor | Old Kingsford Docks, Parting Strand | wet weathered pier planks, rope scuffs, salt stains | dark green harbour water, gentle ripples |
| snow | The Frostfells | packed snow with ice crust and blue shadows | deep untouched snow, faint wind ripples |
| crypt | Barrowlands, Tomb, Barrowdeep, Last Field, Umbral Deep | cracked grey-green flagstones, moss in the seams | black wet stone, creeping moss |
| forge | Deep Forge, Old Quarry, Crack in the Marchstone, Gorewatch | dark cooled-lava plates with glowing orange seams | black basalt, faint ember cracks |
| forest | Storybook Glade, Silverwood Hunt, Heartwood, Sylvaneth, Hollow Hills, Hollow Between, Mirror Marches, Silverlake | mossy forest floor, fallen leaves, tiny flowers | dense dark undergrowth and ferns |
| fortress | Marchguard Keep, Wardens' Hall, Well/Field of Oaths, Grimgate, Kingsford, Marchstone Heart, Speaking Stones | large grey castle flagstones, worn edges | rougher darker courtyard cobbles |
| archive | Hearthlands Archive, Mage College Vaults, Sealed Archive, Observatory, Endless Stair | deep wine leather desk top with gold tooled lattice | dark polished wood floor |
| plains | Endless Road, Clover Hollow, Hearthmeadow | packed dirt road, wheel ruts, pebbles | meadow grass in late sun |
| sky | Skyship Valour, Wreck of the Gallant | pale scrubbed airship deck planks, brass nails | soft white cloud sea |

## Later: moving the camera

The playing surface is the top of a real 3D table (a tavern table, a ship's deck, a stone altar, a vault, an anvil: see `tables.ts`) standing on a ground plane under a sky dome. The harbor ground rolls like waves and the sky ground like clouds (`swell.ts`).
`TableScene.establish()` already swings the camera low to show the surroundings when the place changes
(and is skipped for reduced-motion users and the portrait layout). Any other camera work can reuse the same pose code
in `TableScene.poseWide()`.
