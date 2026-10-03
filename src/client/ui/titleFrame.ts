// The title screen's border: gold-leaf scrollwork on a dark margin, like the edge of an illuminated manuscript.
// One 256x256 picture used as a CSS border-image (64px corners, 128px edge strips that repeat), so the corners
// keep their shape at any screen size. Drawn here as SVG so there is no file to ship.

const GOLD = 'url(#g)';
const CRIMSON = '#8c1d1d';
const LAPIS = '#1f4e8c';

/** One corner (top-left), in the 64x64 corner square. The other three are mirrors of it. */
const CORNER = `
  <path d="M4 64V4H64" fill="none" stroke="${GOLD}" stroke-width="3.5"/>
  <path d="M59 64V59H64" fill="none" stroke="${GOLD}" stroke-width="2"/>
  <circle cx="31" cy="31" r="17" fill="none" stroke="${GOLD}" stroke-width="3"/>
  <circle cx="31" cy="31" r="10" fill="none" stroke="${GOLD}" stroke-width="2"/>
  <circle cx="31" cy="31" r="5" fill="${GOLD}"/><circle cx="31" cy="31" r="2.2" fill="${CRIMSON}"/>
  <path d="M31 14C31 7 45 5 53 11S63 22 57 29" fill="none" stroke="${GOLD}" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M14 31C7 31 5 45 11 53S22 63 29 57" fill="none" stroke="${GOLD}" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M57 29c3-1 5 1 5 3-2 1-5 0-5-3zM29 57c-1 3 1 5 3 5 1-2 0-5-3-5z" fill="${GOLD}"/>
  <path d="M45 45l4 4-4 4-4-4z" fill="${LAPIS}" stroke="${GOLD}" stroke-width="1.6"/>
  <circle cx="9" cy="9" r="3" fill="${GOLD}"/><circle cx="9" cy="9" r="1.2" fill="${LAPIS}"/>`;

/** The top edge strip (x 64..192, y 0..64): two rules and a vine whose phase matches at both ends, so it tiles. */
const EDGE = `
  <path d="M64 4H192M64 59H192" stroke="${GOLD}" stroke-width="3" fill="none"/>
  <path d="M64 32q16-20 32 0t32 0 32 0 32 0" fill="none" stroke="${GOLD}" stroke-width="3" stroke-linecap="round"/>
  <path d="M64 32q16 14 32 0t32 0 32 0 32 0" fill="none" stroke="${GOLD}" stroke-width="1.4" stroke-linecap="round" opacity="0.65"/>
  <circle cx="80" cy="22" r="4.5" fill="${GOLD}"/><circle cx="80" cy="22" r="2" fill="${CRIMSON}"/>
  <circle cx="112" cy="42" r="4.5" fill="${GOLD}"/><circle cx="112" cy="42" r="2" fill="${LAPIS}"/>
  <circle cx="144" cy="22" r="4.5" fill="${GOLD}"/><circle cx="144" cy="22" r="2" fill="${CRIMSON}"/>
  <circle cx="176" cy="42" r="4.5" fill="${GOLD}"/><circle cx="176" cy="42" r="2" fill="${LAPIS}"/>
  <path d="M96 27l5 5-5 5-5-5zM128 27l5 5-5 5-5-5zM160 27l5 5-5 5-5-5z" fill="${GOLD}"/>`;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#f7e29a"/><stop offset="0.35" stop-color="#d4a437"/><stop offset="0.7" stop-color="#9a6a1a"/><stop offset="1" stop-color="#ecc864"/>
  </linearGradient>
  <g id="corner">${CORNER}</g>
  <g id="edge">${EDGE}</g>
</defs>
<path fill-rule="evenodd" fill="#150d06" fill-opacity="0.82" d="M0 0H256V256H0ZM64 64V192H192V64Z"/>
<use href="#corner"/>
<use href="#corner" transform="translate(256 0) scale(-1 1)"/>
<use href="#corner" transform="translate(0 256) scale(1 -1)"/>
<use href="#corner" transform="translate(256 256) scale(-1 -1)"/>
<use href="#edge"/>
<use href="#edge" transform="translate(0 256) rotate(-90)"/>
<use href="#edge" transform="translate(256 0) rotate(90)"/>
<use href="#edge" transform="translate(256 256) rotate(180)"/>
</svg>`;

/** A CSS `url(...)` for the frame picture. */
export const TITLE_FRAME_URL = `url("data:image/svg+xml,${encodeURIComponent(SVG)}")`;
