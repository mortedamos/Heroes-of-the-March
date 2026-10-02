# Visual language of the table

| Signal | Meaning | Where |
|---|---|---|
| Static soft red glow around a card | Something bad has happened to the card (an opponent's ability was used on it). | `Board.setAfflicted` |
| Gold one-shot flash and lift | An ability just fired on this card. | `Board.flash` |
| **Pulsing soft sky-blue glow, a short wiggle every couple of seconds, and a soft two-note chime** | **This card can use an ability right now. Click it.** | `Board.setAttention`, `attentionOf` |
| Gold ring on the player plate | Whose decision it is. | `.plate.deciding` |
| Gold ring on a hand card | A card you can play. | `.card-btn.playable` |

## "Can act now"

- The set of glowing cards is exactly the abilities the engine is offering the viewer in the pending decision (an `activate` window or a `bid`); see `src/client/attention.ts`. The engine accepts `ability.use` only then.
- There is no message or Continue button. Clicking a glowing card opens the large card view with a sky-blue **OK** button on the card face at the right end of the ability name. OK uses the ability. The × button, Esc or a click outside the card closes the view without using it. While that view is open, passing the mouse over other cards does not replace it.
- If the glowing card is ignored, the chance passes by: after 8 s with no card view open and the pointer off the glowing cards, the client answers the window for the player (the glow dims over the last 2 s). The wait is held open while a card view is open or the pointer is on a glowing card. An ability that passed by is not offered again that turn.
- The chime plays once per ability per turn. It is `public/sounds/ability-ready_1.mp3` (a placeholder synthesized with ffmpeg; replace it with any file of the same name).
- With `prefers-reduced-motion` the glow is static and there is no wiggle.
- Colour: `#4fb8ff`. Not used elsewhere on cards; the pale `#6cb8ff` of the insight zap is a brief effect on other objects.
