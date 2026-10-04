# Brief: generate and hook in the skybox art

You are generating panoramic sky images for the ten location themes of *Heroes of the March* (a three.js card game) and wiring them into the game.
The code side is finished and tested: a theme names a panorama in `public/locations/manifest.json` and the sky dome crossfades to it.
Your job is to produce the images, add manifest entries, and verify each one visually. Do not change game code unless a check below fails.

Work on branch `claude/awesome-albattani-q2nsez`. Commit the images and manifest there. Do not push to `main` unless told to.

## What each image is

An **equirectangular 360 degree panorama, 2:1** (target 4096 x 2048; 2048 x 1024 acceptable if the generator cannot do more).
It is mapped on the inside of a sphere around a table. The camera mostly looks at the table from above, and during a short "establishing shot"
swings low to look across it, seeing the horizon and the sky just above it. So:

- Put the interest (horizon features, clouds, windows, skyline) in a band about 30 degrees either side of the horizon (the vertical middle, rows 35% to 65%).
- The lower half is hidden behind the ground: keep it plain and dark or mid-toned; no detail needed.
- The **left and right edges must wrap seamlessly** (they meet behind the camera).
- Painterly, stylised fantasy, matching illustrated card art. Darker and calmer than the card art so cards stay readable. No text, no characters, no table, no ground plane, no UI.
- Do not paint a bright sun disc low on the horizon (the game adds its own light shafts).

Interiors (tavern, archive) are real interiors: walls, arches, rafters and ceiling in the panorama; the 3D table and props stand in front of it.

## Prompt prefix (prepend to every theme prompt)

> Equirectangular 360 degree panorama, 2:1 aspect ratio, seamless left and right edges, painterly stylised fantasy illustration, soft atmospheric lighting, no ground plane, no characters, no text, no UI,

If the generator ignores "equirectangular", add: "full spherical projection as used for skyboxes / HDRI backgrounds".

## Themes, prompts and file names

For each: save as `public/locations/<theme>_sky.webp` (quality about 85; convert from png with `cwebp` or an image library). Keep each file under about 3 MB.

| Theme | File | Prompt (after the prefix) |
|---|---|---|
| `tavern` | `tavern_sky.webp` | the inside of a timber-framed tavern hall at night, dark oak rafters and beams all around, hanging lanterns, shuttered windows, a glowing hearth far off, warm smoky air, deep brown and amber |
| `harbor` | `harbor_sky.webp` | overcast dusk over a misty harbour, heavy grey-blue clouds, faint silhouettes of ship masts and rooftops along the horizon, damp cold light |
| `snow` | `snow_sky.webp` | pale arctic sky, soft green-white aurora ribbon, layered snow-capped mountain ranges along the horizon, thin drifting cloud, cold blue light |
| `crypt` | `crypt_sky.webp` | black night sky with a sickly green moon behind thin cloud, faint silhouettes of dead trees and ruined arches at the horizon, low green mist |
| `forge` | `forge_sky.webp` | smoke-choked dark red sky, glowing volcanic ridges and tall chimney stacks along the horizon, drifting sparks, ominous orange underlight |
| `forest` | `forest_sky.webp` | dusk in a dense forest, deep green mist, shafts of pale gold light through a dark canopy, ring of dark pine silhouettes at the horizon |
| `fortress` | `fortress_sky.webp` | clear late-afternoon sky with high cirrus, a distant ring of castle walls and towers along the horizon, soft blue to pale gold |
| `archive` | `archive_sky.webp` | the inside of a vast gothic library, ring of tall pointed-arch windows with violet moonlight, rows of towering bookshelves, vaulted ceiling with ribs, candle glow, deep indigo and gold |
| `plains` | `plains_sky.webp` | golden-hour sky over rolling farmland, long pink and amber clouds, a windmill and soft hills on the horizon |
| `sky` | `sky_sky.webp` | open sky above a sea of clouds, brilliant blue fading to pale horizon, huge cumulus towers, no ground, no ships |

(`felt` is the plain default table and has no skybox.)

Generate 2 or 3 candidates per theme and keep the one that best satisfies the rules above, especially the seam and the calm lower half.

## Fog colour (automatic; this section is optional)

The game now reads the horizon colour from each panorama when it loads and fades the ground into it, so `fog` in the manifest is only a fallback shown
before the image loads. You can skip the step below, or still set a rough `fog` to avoid a flash.

The ground fades into a "fog" colour at the distance. It must match the panorama's horizon band or a visible seam appears.
For each image, compute the **average colour of the rows from 48% to 55% of the image height** (the band at the horizon), darkened about 10%, and use it as `fog` (hex).
Example with Python/Pillow:

```python
from PIL import Image
im = Image.open("public/locations/forest_sky.webp").convert("RGB")
w, h = im.size
band = im.crop((0, int(h*0.48), w, int(h*0.55))).resize((1, 1), Image.BOX).getpixel((0, 0))
fog = "#%02x%02x%02x" % tuple(int(c * 0.9) for c in band)
```

## Manifest

Edit `public/locations/manifest.json` (currently `{}`). One entry per theme; keep any other keys that already exist:

```json
{
  "forest": { "sky": "forest_sky.webp", "fog": "#2c4a38" },
  "archive": { "sky": "archive_sky.webp", "fog": "#171226" }
}
```

Keys: `sky` (file in `public/locations/`), `fog` (hex, from the step above), optional `keepSkyline: true` (keep the procedural silhouette ring in front of the
panorama; default false = the panorama replaces it). Do not add `top` or `floor` entries unless you were asked to make table textures too
(see `docs/LOCATION-ART-PROMPTS.md`, which is gitignored; use `git add -f` if you edit it).

## Verify each one (required)

1. `npm install` if needed, then start the dev server: `npx vite --port 5174 --host 127.0.0.1`.
2. Use Playwright with the preinstalled Chromium (`executablePath: '/opt/pw-browsers/chromium'`, args `--use-gl=swiftshader --enable-webgl --ignore-gpu-blocklist --no-sandbox`), viewport 1280 x 800.
   Open `http://127.0.0.1:5174/`, click "Ride out", then wait for `window.__table` (dev builds expose the scene).
3. For each theme run in the page:
   ```js
   window.__table.environment.setTheme('<theme>', true);   // instant
   document.querySelector('#overlay').style.visibility = 'hidden';
   window.__table.setShot(1);                              // the low establishing view
   ```
   wait about 3 seconds (the panorama loads asynchronously), take a screenshot, and look at it. Also screenshot with `setShot(0)` (normal play view; the sky is barely visible, the surface and weather should look right).
4. Check, and regenerate or fix if any fail:
   - the horizon band of the panorama meets the ground without a hard colour seam (adjust `fog`),
   - no visible vertical seam where the panorama wraps (turn the view with `window.__table.camera.rotation.y += 1.5` to inspect the back of the sphere),
   - the sky is not brighter than the cards (cards stay the brightest thing on screen),
   - towers, flags, lights and particles still read clearly in front of it,
   - no console errors.
5. `npx tsc --noEmit` and `npm test` must pass (they should; no code changed).

## Commit

Stage `public/locations/*.webp` and `manifest.json`, commit with a message like "Skybox art for location themes", and end it with:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

Push to `claude/awesome-albattani-q2nsez` only. In your report list each theme, the chosen file, the fog colour, and anything that looked wrong.

## Do not

- Change `src/` unless a verification step fails and you can say exactly why.
- Commit source PNGs or rejected candidates (keep them outside the repo or in a gitignored folder).
- Use real artists' names, trademarks or existing game art in prompts.
