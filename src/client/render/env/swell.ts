// A ground that moves: rolling waves (the harbor) or rolling clouds (the skyship). It patches the floor's
// standard material, so light, shadow and fog still apply: the vertices swell, the normals follow (so the light
// rolls over the swell), crests brighten, and the texture slides past itself in two layers so it never settles.

import * as THREE from 'three';

export type SwellKind = 'waves' | 'clouds';

interface Wave {
  /** Which way the crests travel (across the ground plane). */
  dir: [number, number];
  /** Crest to crest, in world units. */
  len: number;
  /** How fast the crests travel, in world units per second. */
  speed: number;
  amp: number;
}

interface Swell {
  waves: Wave[];
  /** How fast the two texture layers slide, in texture repeats per second. */
  slide: [[number, number], [number, number]];
  /** How much crests lighten and troughs darken the surface. */
  shade: number;
  /** How white the highest crests go (0 = not at all). */
  foam: number;
}

const SWELLS: Record<SwellKind, Swell> = {
  waves: {
    waves: [
      { dir: [1, 0.3], len: 14, speed: 1.0, amp: 0.2 },
      { dir: [0.5, 1], len: 9.5, speed: 1.3, amp: 0.1 },
      { dir: [-0.6, 0.8], len: 7, speed: 1.6, amp: 0.05 },
    ],
    slide: [[0.016, 0.004], [-0.009, 0.013]],
    shade: 0.3,
    foam: 0.45,
  },
  clouds: {
    waves: [
      { dir: [1, 0.15], len: 20, speed: 0.6, amp: 0.45 },
      { dir: [0.7, 0.8], len: 12, speed: 0.75, amp: 0.25 },
      { dir: [-0.5, 1], len: 9, speed: 0.9, amp: 0.12 },
    ],
    slide: [[0.01, 0.002], [0.005, -0.004]],
    shade: 0.3,
    foam: 0,
  },
};

const f = (n: number): string => n.toFixed(4);

/** Make `mat` (a ground material) roll. `time` is shared, so every swelling material moves together. */
export function swellMaterial(mat: THREE.MeshStandardMaterial, kind: SwellKind, time: { value: number }): void {
  const s = SWELLS[kind];
  const total = s.waves.reduce((a, w) => a + w.amp, 0);

  const waves = s.waves.map((w) => {
    const len = Math.hypot(...w.dir);
    return `{ vec2 d = vec2(${f(w.dir[0] / len)}, ${f(w.dir[1] / len)}); float k = ${f((Math.PI * 2) / w.len)};
      float ph = k * (dot(d, position.xy) - ${f(w.speed)} * uTime); float c = cos(ph);
      swH += ${f(w.amp)} * sin(ph); swDx += ${f(w.amp)} * k * c * d.x; swDy += ${f(w.amp)} * k * c * d.y; }`;
  }).join('\n');

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vSwell;')
      // The plane lies in local x/y with z up (it is turned flat by its mesh), so the swell lifts local z.
      .replace('#include <beginnormal_vertex>', `
        float swH = 0.0; float swDx = 0.0; float swDy = 0.0;
        ${waves}
        // The far ground flattens out, so the swell does not shimmer where the waves are smaller than a pixel.
        float swFar = 1.0 - smoothstep(70.0, 140.0, length(position.xy));
        swH *= swFar; swDx *= swFar; swDy *= swFar;
        vSwell = swH / ${f(total)};
        vec3 objectNormal = normalize(vec3(-swDx, -swDy, 1.0));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
        #endif`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.z += swH;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vSwell;')
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 swA = texture2D( map, vMapUv + vec2( uTime * ${f(s.slide[0][0])}, uTime * ${f(s.slide[0][1])} ) );
          vec4 swB = texture2D( map, vMapUv * 0.71 + vec2( 0.37 + uTime * ${f(s.slide[1][0])}, 0.11 + uTime * ${f(s.slide[1][1])} ) );
          diffuseColor *= mix( swA, swB, 0.5 );
        #endif
        diffuseColor.rgb *= 1.0 + vSwell * ${f(s.shade)};
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0 ), smoothstep( 0.55, 1.0, vSwell ) * ${f(s.foam)} );`);
  };
  mat.customProgramCacheKey = () => `swell:${kind}`;
}
