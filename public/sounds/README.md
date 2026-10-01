# Sound effects

Drop sound files here, then run `npm run sfx`. Open `tools/sfx-tracker.html` in a browser to see what you have and what is still missing, and to play each file. The command updates `manifest.json` (the list of
sounds the game is allowed to load, so a missing sound never causes a 404) and
`docs/SFX-TRACKER.md` (what you have and what you still need, with where to search).

- Name a file after the sound: `card-flip.mp3`. For variety add up to three variants,
  `card-flip_1.mp3`, `card-flip_2.mp3`, `card-flip_3.mp3`; the game picks one at random each time
  it plays. `_` and `-` are interchangeable (`card_flip_1.mp3` works too).
- `.mp3` plays everywhere; `.ogg`, `.wav` and `.webm` also work. Keep effects short and
  small (under ~100 KB) and similar in loudness. The Effects slider sets their volume.
- The full list of sound names, when each plays, and which the game already uses is in
  `data/sfx-catalog.json` and the tracker.
- Only use sounds you have the rights to: this folder is public on GitHub Pages.
