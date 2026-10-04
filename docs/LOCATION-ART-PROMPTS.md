# Location art (optional)

Every location already has a procedural 3D look (see `src/client/render/env/themes.ts`): table surface, ground,
scenery, light, fog and weather. You can replace the **table top** and **ground** textures of any theme with
hand-made art. Nothing else changes; the props, lights and weather stay real 3D.

## How to add art

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

The table is a real 3D slab standing on a ground plane under a sky dome, with a skyline ring and props around it.
`TableScene.establish()` already swings the camera low to show the surroundings when the place changes
(and is skipped for reduced-motion users and the portrait layout). Any other camera work can reuse the same pose code
in `TableScene.poseWide()`.
