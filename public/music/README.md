# Music

Drop `.mp3` files here. Only use music you have the rights to: this folder
is public on GitHub Pages.

- `title.mp3` loops on the title screen.
- `hero_selection.mp3` loops on the hero draft and the opening companion draft.
- `neutral_music_*.mp3` are the neutral playlist (`TRACKS` in `src/client/audio/Music.ts`). The game starts on a random one
  and moves to the next each round when the location has no track of its own.
- `locations/<location-id>.mp3` is the track for one location, for example `locations/kingsford.mp3`. It loops while that location is
  on the table. A location without a file plays a neutral track. The ids and a mood suggestion for each are in `docs/SFX-TRACKER.md`.
  Run `npm run sfx` after adding files: it writes `manifest.json` here (the list of location tracks that exist, so a missing
  track never causes a 404).
