// The GLSL that paints a panorama (or a strip, see strip.ts) onto the sky: shared by the sky dome and by water that
// reflects it, so the two always agree.

export const SKY_PAINT_GLSL = `
// The picture \`tex\` at dome position \`uv\` (x round, y up): its colour, and how much of it shows there.
// A window with no width means a 2:1 panorama of the whole sky, which can slide round by \`off\`; otherwise \`win\` is the
// patch of dome (x0, x1, y0, y1) a flat strip is stuck onto, and its edges fade away.
vec4 skyTexel(sampler2D tex, vec4 win, float off, vec2 uv) {
  if (win.y <= win.x) return vec4(texture2D(tex, vec2(uv.x + off, uv.y)).rgb, 1.0);
  vec2 q = vec2((uv.x - win.x) / (win.y - win.x), (uv.y - win.z) / (win.w - win.z));
  float m = smoothstep(0.0, 0.08, q.x) * smoothstep(0.0, 0.08, 1.0 - q.x) * smoothstep(0.0, 0.1, 1.0 - q.y) * smoothstep(-0.03, 0.0, q.y);
  return vec4(texture2D(tex, clamp(q, 0.0, 1.0)).rgb, m);
}

// \`base\` (the plain sky) with the two paintings laid over it: the one that is fading out, then the one fading in.
// \`y\` is how far up the sky the point is (0 at the horizon, 1 overhead); the paintings fade out towards the horizon haze.
vec3 skyPaint(vec3 base, vec2 uv, float y, sampler2D skyA, sampler2D skyB, float wA, float wB, float offA, float offB, vec4 winA, vec4 winB, float haze) {
  float vis = smoothstep(0.07 * haze, 0.32 * haze + 0.001, y);
  vec4 a = skyTexel(skyA, winA, offA, uv);
  vec4 b = skyTexel(skyB, winB, offB, uv);
  vec3 c = mix(base, a.rgb, wA * vis * a.a);
  return mix(c, b.rgb, wB * vis * b.a);
}
`;
