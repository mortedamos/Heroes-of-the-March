// Display fonts for the game's own text (title, headings, buttons): not the card faces.
// They come from @fontsource, so they are bundled with the game (same origin, which the
// Content-Security-Policy requires) and nothing is fetched from a font service.

import '@fontsource/cinzel/latin-700.css';
import '@fontsource/cinzel-decorative/latin-700.css';
import '@fontsource/medievalsharp/latin-400.css';
import '@fontsource/uncial-antiqua/latin-400.css';
import '@fontsource/almendra-sc/latin-400.css';
import '@fontsource/im-fell-english-sc/latin-400.css';
import '@fontsource/metamorphous/latin-400.css';

export interface DisplayFont { id: string; label: string; family: string }

export const DISPLAY_FONTS: DisplayFont[] = [
  { id: 'cinzel', label: 'Cinzel: carved, Roman', family: 'Cinzel' },
  { id: 'cinzel-decorative', label: 'Cinzel Decorative: carved with flourishes', family: 'Cinzel Decorative' },
  { id: 'medievalsharp', label: 'MedievalSharp: pointed, storybook', family: 'MedievalSharp' },
  { id: 'uncial', label: 'Uncial Antiqua: old manuscript', family: 'Uncial Antiqua' },
  { id: 'almendra', label: 'Almendra SC: calligraphic', family: 'Almendra SC' },
  { id: 'im-fell', label: 'IM Fell English SC: old printed book', family: 'IM Fell English SC' },
  { id: 'metamorphous', label: 'Metamorphous: sharp, arcane', family: 'Metamorphous' },
];

const STORE = 'hotm.font';
const DEFAULT_ID = 'cinzel';

export function currentFontId(): string {
  try {
    const saved = localStorage.getItem(STORE);
    if (saved && DISPLAY_FONTS.some((f) => f.id === saved)) return saved;
  } catch { /* storage unavailable */ }
  return DEFAULT_ID;
}

/** Use this font for the game's display text (and remember the choice). */
export function applyFont(id: string): void {
  const font = DISPLAY_FONTS.find((f) => f.id === id) ?? DISPLAY_FONTS[0]!;
  document.documentElement.style.setProperty('--display', `"${font.family}", Georgia, "Palatino Linotype", serif`);
  try { localStorage.setItem(STORE, font.id); } catch { /* storage unavailable */ }
}
