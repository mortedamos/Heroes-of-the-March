# Place sounds

Drop `.mp3` (or `.ogg`, `.wav`, `.webm`) files here, then run `npm run sfx`. Only use sounds you have the rights to:
this folder is public on GitHub Pages.

While the camera is lifted away from the board (the establishing shot at each new location, or when the player scrolls down to look
around) the music steps back to 25% and, every 7 to 20 seconds, one of these sounds plays. Nothing plays when the camera is back on the board.

Three generic sounds per place, named `<look>-background_1.mp3` to `<look>-background_3.mp3`:

- `fortress-background_1.mp3`, `_2`, `_3`: heard in castles and cities
- `any-background_1.mp3` (up to three): heard in every place, as well as that place's own

Each of the 32 locations can also have three of its own, named after its id: `<location-id>-background_1.mp3` to `_3` (for example
`barrowdeep-background_1.mp3`, `the-goose-and-kettle-background_2.mp3`). A location plays its own, and its family's when it has none.
The tracker lists every slot, what to put in it and what to search for under the group `Place sounds by location`, and its "By location"
section shows each place's sounds and music side by side.

Looks: `felt`, `tavern`, `harbor`, `snow`, `crypt`, `forge`, `forest`, `fortress`, `archive`, `plains`, `sky`.
`docs/SFX-TRACKER.md` and `tools/sfx-tracker.html` show what each place's sounds could be, with search terms, under the group `Place sounds`;
`npm run sfx` also lists which locations use which look. The Debug menu's "Location look" holds one look on the table and
"Play a place sound" plays one now.

Short, quiet, single events work best (a bird, a hammer on an anvil, a gust, people murmuring). They are picked at random, never the same
one twice in a row, and fade out if the camera drops back to the board. They follow the Effects volume and mute.
Any other file starting with a look name (`forest_wind2.mp3`) or `any_` also plays for that look.
