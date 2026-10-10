/** A music track that is not tied to one place: the file in public/music/, what it is for, and what to look for if it is replaced. */
export interface MusicSlot { file: string; label: string; plays: string; brief: string; prompt?: string }

/** The tracks src/client/audio/Music.ts plays besides each location's own (scripts/sfx-moods.test.ts keeps the two lists the same). */
export const GAME_MUSIC: MusicSlot[] = [
  { file: 'title.mp3', label: 'Title screen', plays: 'Loops on the title screen', brief: 'the game\'s theme: a memorable fantasy melody, heroic and inviting' },
  { file: 'hero_selection.mp3', label: 'Hero and companion draft', plays: 'Loops on the hero draft and the opening companion draft', brief: 'choosing a party: expectant, warm, building' },
  { file: 'neutral_music_1.mp3', label: 'Neutral playlist 1 of 3', plays: 'The game starts on a random neutral track; the next plays each round when the location has no track of its own', brief: 'calm fantasy table music that sits behind a long game, not tied to a place' },
  { file: 'neutral_music_2.mp3', label: 'Neutral playlist 2 of 3', plays: 'The neutral playlist, as above', brief: 'calm fantasy table music that sits behind a long game, not tied to a place' },
  { file: 'neutral_music_3.mp3', label: 'Neutral playlist 3 of 3', plays: 'The neutral playlist, as above', brief: 'calm fantasy table music that sits behind a long game, not tied to a place' },
];

// What each location's own music track could sound like, for the tracker (npm run sfx) to show next to
// public/music/locations/<location-id>.mp3. Drawn from docs/LOCATION-LOOKS.md; a location with no entry here
// falls back to the mood of its family (MOOD in scripts/sfx.ts).
export const LOCATION_MOOD: Record<string, string> = {
  'the-goose-and-kettle': 'rowdy snug pub, fiddle and stamping folk, warm, always one more round',
  'parting-strand': 'bittersweet farewell, slow strings, swell of the sea, one far horn, grey dawn',
  'the-barrowlands': 'lonely windswept downs at night, sparse low strings, wrong-sounding drones',
  'tomb-of-the-first-wardens': 'hushed solemn tomb, soft choir pads, pale bells; protected, holy rather than haunted',
  'barrowdeep': 'ancient forgotten ritual, deep drone, slow frame-drum heartbeat, whispered chant far back',
  'the-umbral-deep': 'lightless vast cavern, sub-bass, glassy drips with long echo, a violet shimmer',
  'the-deep-forge-of-karrak': 'roaring orderly dwarven craft, a regular anvil beat, bellows, heavy brass',
  'the-old-quarry': 'everyday stone as a legendary stage, dry plucked strings, sparse percussion, wide and flat',
  'the-crack-in-the-marchstone': 'awe and dread, a slowly breathing drone, resonant choir swells, gold and violet',
  'gorewatch': 'brutal proud orc fortress, war drums, bone horns, low brass, loud',
  'the-storybook-glade': 'enchanted sweet fairy tale, music box, harp, bright flutes, a little too perfect',
  'the-silverwood-hunt': 'tense fast cold chase, hunting horns, galloping strings, pre-dawn',
  'sylvaneth': 'majestic living elf capital, harp, high choir, flowing strings, wind chimes',
  'the-hollow-hills': 'hushed damp fey fog, muffled far flute, soft whispers, watching',
  'the-hollow-between': 'liminal empty twilight, glassy drone, sparse chimes, long silences, melancholy',
  'the-mirror-marches': 'cold symmetrical uncanny, glass bells, single piano notes, still water',
  'silverlake-at-midsummer': 'festive golden nostalgic fair at dusk, fiddle and lute, warm and a little wistful',
  'marchguard-keep': 'disciplined plain watchful, snare march, stately brass, morning drill',
  'the-wardens-hall': 'solemn warm ceremonial great hall, organ, strings, brass, echo',
  'the-field-of-oaths': 'windswept honourable sombre, a lone horn, slow strings, overcast',
  'grimgate': 'weighty ancient proud dwarf capital, deep horns, low male choir, alpine dusk',
  'kingsford': 'grand bright busy human capital, fanfare brass, lively strings; the showpiece',
  'the-speaking-stones': 'ancient resonant brooding moor, throat-singing drone, stone-circle hum',
  'the-hearthlands-archive': 'cosy fussy scholarly halfellow museum, pizzicato strings, clarinet, small and warm',
  'the-mage-college-vaults': 'arcane ordered humming library, harpsichord, glassy pads, candlelit',
  'the-sealed-archive': 'forbidden airless watched, near silence, one low cello, a distant chain',
  'the-collegium-observatory': 'clear cold astonishing starfield, celesta, high strings, ticking brass',
  'the-endless-stair': 'vertiginous patient echoing, slow descending brass, a far hammer, going on forever',
  'the-endless-road': 'wide-skied unhurried a little lonely, acoustic guitar, tin whistle, travelling',
  'clover-hollow': 'small sleepy safe village green, gentle guitar, tin whistle, bright spring morning',
  'hearthmeadow': 'abundant warm welcoming feast, fiddle and tsymbaly, golden hour',
  'the-skyship-valour': 'proud airy bright high-altitude noon, soaring strings, adventurous wonder',
};

/** For Suno's Exclude styles box, the same for every track: these play under a card game, so nothing may build, climb or sing over the cards. */
export const SUNO_EXCLUDE = 'vocals, singing, lyrics, spoken word, crescendo, build-up, climax, drum fills, big finish, accordion';

// A prompt to paste into Suno's style box for each location's track (instrumental). Only drafts so far: a location with no entry shows
// "not written yet" in the tracker. Motifs are written as scale degrees (1 = the key's tonic), so the same shape can be played in any key or mode.
export const LOCATION_PROMPT: Record<string, string> = {
  'barrowdeep':
    'Instrumental cinematic dark ambient ritual underscore, ancient passage tomb, 54 BPM, E Phrygian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. Deep drone, slow frame-drum heartbeat, bowed low strings, wind through stone, faint wordless chant. '
    + 'A falling minor lament 8-7-b6-5 on low cello (Undead); a far-off horn call, up a fourth, ends each phrase (Capital); the March motif 1-5-6-5 once on a soft bell. '
    + 'Sparse, patient, no vocals.',
  'the-goose-and-kettle':
    'Instrumental cinematic cosy tavern folk underscore, 92 BPM, G major. Warm intimate film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up, no fills. Fiddle, tin whistle, lute, tsymbaly, light hand drum. '
    + 'The fiddle plays a gentle pentatonic tune 1-2-3-5-3 (Halfellow); the March motif 1-5-6-5 once on whistle. '
    + 'Warm, relaxed and friendly, like a pub heard from the next room. No vocals.',
  'grimgate':
    'Instrumental cinematic dwarven mountain hall underscore, 66 BPM, D Aeolian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. Deep French horns and low brass in open fourths and fifths 1-4-1-5 (Dwarf), wordless male choir hum, timpani, anvil taps, wind in a mountain pass. '
    + 'A bright brass call, up a fourth, crowns each phrase (Capital); the March motif 1-5-6-5 once on horn. '
    + 'Weighty, ancient, proud. No vocals.',
  'marchguard-keep':
    'Instrumental cinematic stately slow processional underscore, Slavic folk fantasy, 74 BPM, D Dorian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up, no fills, no snare roll. '
    + 'Soft frame drum on the beat, muted horns, low strings and a droning hurdy-gurdy. A lone fiddle plays the March motif 1-5-6-5 in a slow dotted march rhythm (Marchguard), with a gentle rising triad 1-3-5-8 (Human). '
    + 'Disciplined, noble, a clear cold morning. No vocals.',
  'the-crack-in-the-marchstone':
    'Instrumental cinematic awe and dread, a wound in the world, 60 BPM, F# minor. A slow breathing drone that swells and fades, wordless choir pads, a deep struck bell tolling a slow pair 1-5-1-5 (Wardhouse), '
    + 'sustained strings holding a suspension that resolves 4 to 3 (Accord), glassy shimmer like cracking stone, grinding low rumble, the March motif 1-5-6-5 on a distant bell. '
    + 'Pale gold light with a violet edge. No vocals.',

  // --- Outdoors: the coast, the wild, the roads ---
  'parting-strand':
    'Instrumental cinematic bittersweet farewell underscore, grey dawn on a shingle harbour, a bell buoy and one far horn, 62 BPM, A Dorian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'Slow low strings, a lone kaval flute, soft tsymbaly, a far gaida drone, a frame drum barely there. A slow stomping root with a flat third 1-1-b3-1 on low strings (Orc); sustained strings hold a suspension that resolves 4 to 3 (Accord); the March motif 1-5-6-5 once on kaval. '
    + 'No vocals.',
  'the-barrowlands':
    'Instrumental cinematic lonely windswept downs underscore, deep night, a thin sick-green moon, wrong and quiet, 56 BPM, B Phrygian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'A doina-style lament in free rhythm on solo kaval over a low drone, bowed double bass, sparse tsymbaly, wind over grass. A falling minor lament 8-7-b6-5 (Undead); the March motif 1-5-6-5 once on a distant bell. '
    + 'No vocals.',
  'the-old-quarry':
    'Instrumental cinematic plain open quarry underscore, bright flat overcast, everyday stone as a legendary stage, 76 BPM, A Dorian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up, no fills. '
    + 'Dry plucked kobza, sparse frame drum, a lone sopilka, wind in a pit, a distant chisel tap. Each motif plays once in turn on a different instrument: rising triad 1-3-5-8, floating Lydian line 5-6-8-7, open fourths and fifths 1-4-1-5, gentle pentatonic 1-2-3-5-3, stomping root 1-1-b3-1, falling lament 8-7-b6-5, bell pair 1-5-1-5, then the March motif 1-5-6-5. '
    + 'No vocals.',
  'gorewatch':
    'Instrumental cinematic brutal proud orc fortress underscore, a great rocky rise over a marsh at sullen red sunset, smoke and haze, 64 BPM, D Phrygian dominant. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up, no fills. '
    + 'A low gaida drone, a slow tapan frame drum on the beat, deep low brass, marsh birds far below. A stomping root with a flat third 1-1-b3-1 (Orc); a heavy brass call, up a fourth, ends each phrase (Capital); the March motif 1-5-6-5 once on low horn. '
    + 'No vocals.',
  'the-storybook-glade':
    'Instrumental cinematic enchanted fairy-tale clearing underscore, a spring morning, golden light, a little too perfect, 78 BPM, D Lydian. Warm spacious film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'Music box, soft gusli, sopilka flute, pizzicato strings, glockenspiel sparkles. A floating Lydian line 5-6-8-7 (Elf); the March motif 1-5-6-5 once on music box. '
    + 'Sweet and gentle. No vocals.',
  'the-silverwood-hunt':
    'Instrumental cinematic cold pre-dawn forest underscore, a hunt somewhere far off, tense but restrained, silver-blue mist, 84 BPM, E Dorian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up, no fills. '
    + 'A soft steady low-string ostinato and a muted frame drum like distant hooves, kaval flute, sparse gusli, one far hunting horn call. A floating Lydian line 5-6-8-7 (Elf); the March motif 1-5-6-5 once on horn. '
    + 'Watchful, never urgent. No vocals.',
  'sylvaneth':
    'Instrumental cinematic majestic elven canopy city underscore, colossal trees, golden afternoon light, a waterfall far off, 68 BPM, F Lydian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'Gusli and harp, sopilka flute, warm strings, soft wind chimes. A floating Lydian line 5-6-8-7 (Elf); a gentle brass call, up a fourth, ends each phrase (Capital); the March motif 1-5-6-5 once on harp. '
    + 'Noble, airy, living. No vocals.',
  'the-hollow-hills':
    'Instrumental cinematic fog-bound fey hills underscore, hushed, damp and watching, grassy mounds with round doors, 54 BPM, A Dorian. Close muffled spacious film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'A distant sopilka, a soft low gaida drone, a muted frame drum like a heartbeat under the fog, whisper-soft strings, tiny bells. A very soft slow stomping root with a flat third 1-1-b3-1 (Orc); the March motif 1-5-6-5 once on a far flute. '
    + 'No vocals.',
  'the-hollow-between':
    'Instrumental cinematic liminal twilight underscore, empty and still, a thin wood of pale trees, melancholy, 50 BPM, G Lydian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'A glassy sustained drone, sparse glass-like tsymbaly chimes with no wind, long silences between notes, a soft low frame drum once in a while. A slow bell pair 1-5-1-5 (Wardhouse); a slow stomping root with a flat third 1-1-b3-1, far away (Orc); the March motif 1-5-6-5 once on a chime. '
    + 'No vocals.',
  'the-mirror-marches':
    'Instrumental cinematic cold still flooded wood underscore, mirror-flat water, pewter light, uncanny symmetry, 60 BPM, C Lydian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'Glass bell notes, single soft tsymbaly notes, a pure sopilka flute, a faint echo answering every phrase, a muted far-off metal clank like marching. A floating Lydian line 5-6-8-7 answered by its upside-down mirror (Elf); the March motif 1-5-6-5 once on a glass bell. '
    + 'No vocals.',
  'silverlake-at-midsummer':
    'Instrumental cinematic wistful midsummer fair at dusk underscore, a silver lake, strings of lanterns and fireflies, nostalgic, 72 BPM, G Dorian. Warm spacious film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'Soft fiddle, gusli, sopilka, tsymbaly, a light frame drum, a far-off fair tune drifting over water. A floating Lydian line 5-6-8-7 (Elf); the March motif 1-5-6-5 once on fiddle. '
    + 'Festive from a distance, gentle, never a dance. No vocals.',
  'kingsford':
    'Instrumental cinematic grand bright medieval capital underscore, high white-gold afternoon, the hum of a city commons, bells in the distance, 80 BPM, C Mixolydian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'Warm strings, a muted brass chorale, cimbalom, soft fiddle, a light frame drum, distant bell chimes. A rising triad 1-3-5-8 (Human); a bright brass call, up a fourth, ends each phrase (Capital); the March motif 1-5-6-5 once on strings. '
    + 'Noble and generous but gentle. No vocals.',
  'the-field-of-oaths':
    'Instrumental cinematic windswept sombre meadow underscore, a ring of oath stones, pennants in the wind, overcast late afternoon, 64 BPM, A Aeolian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'A lone horn, slow strings, a soft frame drum, wind. A single church bell tolled slowly 1-5-1-5 (Wardhouse); sustained strings hold a suspension that resolves 4 to 3 (Accord); the March motif 1-5-6-5 in a slow dotted march rhythm on low strings (Marchguard). '
    + 'Honourable, quiet. No vocals.',
  'the-speaking-stones':
    'Instrumental cinematic ancient brooding moor underscore, a ring of rune-cut standing stones, violet storm light, 56 BPM, D Dorian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'A deep sustained drone with a resonant stone-like hum, low trembita-like horns in open fourths and fifths 1-4-1-5 (Dwarf), sparse frame drum, wind whistling over stone. Sustained strings hold a suspension that resolves 4 to 3 (Accord); the March motif 1-5-6-5 once on low horn. '
    + 'No vocals.',
  'the-endless-road':
    'Instrumental cinematic wide-skied lonely road underscore, an unhurried journey, racing cloud shadows and a far rain curtain, 72 BPM, G Mixolydian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'A fingerpicked kobza, a tin whistle, soft fiddle, double bass, a light frame drum at walking pace. A gentle pentatonic tune 1-2-3-5-3 (Halfellow); a slow bell pair 1-5-1-5 on one far wardhouse bell (Wardhouse); the March motif 1-5-6-5 once on whistle. '
    + 'No vocals.',
  'clover-hollow':
    'Instrumental cinematic small sleepy village green underscore, a bright late-spring morning, cottages and clover, 80 BPM, C major. Intimate warm film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'A gentle fingerpicked kobza, tin whistle, soft fiddle, pizzicato strings, tsymbaly, a light shaker. A gentle pentatonic tune 1-2-3-5-3 (Halfellow); the March motif 1-5-6-5 once on whistle. '
    + 'Safe, sleepy, kind. No vocals.',
  'hearthmeadow':
    'Instrumental cinematic warm golden-hour hill town underscore, abundant and welcoming, orchards and long feast tables, 76 BPM, D major. Spacious warm film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'Fiddle, tsymbaly, tin whistle, warm strings, a soft frame drum, a distant supper bell. A gentle pentatonic tune 1-2-3-5-3 (Halfellow); a soft brass call, up a fourth, ends each phrase (Capital); the March motif 1-5-6-5 once on fiddle. '
    + 'Generous and warm, never a dance. No vocals.',
  'the-skyship-valour':
    'Instrumental cinematic proud airy high-altitude airship underscore, brilliant blue above a sea of cloud, sails and rigging, 78 BPM, D major. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'Soaring but restrained strings, warm horns, harp, a soft engine hum, a rope creak, a light frame drum. The March motif 1-5-6-5 in a gentle dotted rhythm on horns (Marchguard); a rising triad 1-3-5-8 (Human). '
    + 'Adventurous wonder, wide and steady, no swell. No vocals.',

  // --- Indoors: tombs, caves, halls, libraries ---
  'tomb-of-the-first-wardens':
    'Instrumental cinematic hushed solemn tomb underscore, a sealed vaulted chamber, warding runes glowing pale gold, 58 BPM, G Dorian. Spacious cathedral-reverb film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'Soft wordless choir pads, low strings, a slow church bell pair tolling 1-5-1-5 (Wardhouse), sustained strings holding a suspension that resolves 4 to 3 (Accord), the March motif 1-5-6-5 once on a high glass-like tsymbaly note. '
    + 'Protected, holy rather than haunted. No vocals.',
  'the-umbral-deep':
    'Instrumental cinematic lightless cavern underscore, vast and still, glowing violet fungus, 52 BPM, C# Phrygian. Spacious wide film-score mix with a long cave reverb. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'A sub-bass drone, glassy tsymbaly drips with a long echo, bowed low strings, air moving in the deep. A falling minor lament 8-7-b6-5 on cello (Undead); the March motif 1-5-6-5 once on a single bell. '
    + 'Patient and vast. No vocals.',
  'the-deep-forge-of-karrak':
    'Instrumental cinematic dwarven forge hall underscore, orderly craft, glowing furnaces and worked stone, 70 BPM, E Aeolian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up, no fills. '
    + 'A soft regular anvil tap and a muted bellows pulse keep a steady beat, low trembita-like horns in open fourths and fifths 1-4-1-5 (Dwarf), a slow bell pair 1-5-1-5 (Wardhouse), low strings, steam hiss; the March motif 1-5-6-5 once on horn. '
    + 'Steady, proud, ordered. No vocals.',
  'the-wardens-hall':
    'Instrumental cinematic solemn warm great hall underscore, vaulted stone, banners, dusty gold light shafts, a hearth, 66 BPM, G Dorian. Spacious hall-reverb film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'Muted horns, warm low strings, a soft frame drum, a hurdy-gurdy drone. A slow church bell pair 1-5-1-5 (Wardhouse); the March motif 1-5-6-5 in a slow dotted march rhythm on strings (Marchguard). '
    + 'Ceremonial, lived-in, echoing. No vocals.',
  'the-hearthlands-archive':
    'Instrumental cinematic cosy scholarly museum room underscore, daylit, polished wood, brass lamps and a ticking clock, 76 BPM, F Mixolydian. Intimate warm film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'Pizzicato strings, clarinet, soft tsymbaly, fiddle, tiny clock-tick percussion. A gentle pentatonic tune 1-2-3-5-3 (Halfellow); sustained strings hold a suspension that resolves 4 to 3 (Accord); the March motif 1-5-6-5 once on clarinet. '
    + 'Fussy, warm and small. No vocals.',
  'the-mage-college-vaults':
    'Instrumental cinematic arcane candlelit library vaults underscore, ordered and humming, violet moonlight, 62 BPM, E Dorian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'Glassy cimbalom arpeggios, a soft harpsichord-like tsymbaly, low strings, a low arcane hum, faint chimes. A slow whole-tone arpeggio 1-2-3-#4 (Collegium); a rising triad 1-3-5-8 once on strings (Human); the March motif 1-5-6-5 once on celesta. '
    + 'No vocals.',
  'the-sealed-archive':
    'Instrumental cinematic forbidden airless stacks underscore, near silence, an iron-doored vault, chained shelves, one cold lamp, 48 BPM, C Phrygian. Close, dry, quiet film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'One low cello note at a time, a single soft cimbalom tone now and then, faint chain and lock textures far off. A very sparse slow whole-tone arpeggio 1-2-3-#4 (Collegium); the March motif 1-5-6-5 once on cello in a slow dotted rhythm (Marchguard). '
    + 'No vocals.',
  'the-collegium-observatory':
    'Instrumental cinematic starry observatory underscore, an open dome slit onto the Milky Way, cold clear air, a brass orrery, 60 BPM, D Lydian. Spacious wide film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'Celesta and glass tsymbaly shimmer, high strings, soft ticking gears, thin wind, warm low strings underneath. A slow whole-tone arpeggio 1-2-3-#4 (Collegium); a gentle rising triad 1-3-5-8 (Human); the March motif 1-5-6-5 once on celesta. '
    + 'Clear, cold, astonished. No vocals.',
  'the-endless-stair':
    'Instrumental cinematic vertiginous spiral stair underscore, a dwarven shaft in the mountain, braziers dwindling up and down into the dark, 58 BPM, F Aeolian. Very spacious echoing film-score mix. Quiet background bed, low energy, steady dynamics, no crescendo, no build-up. '
    + 'Slow descending low brass in open fourths and fifths 1-4-1-5 (Dwarf), a far hammer tap below, a slow bell pair 1-5-1-5 echoing (Wardhouse), low strings, wind in the shaft; the March motif 1-5-6-5 once on horn. '
    + 'Patient, going on forever. No vocals.',
};
