// A ground that is not a flat, still plane. It patches the floor's standard material, so light, shadow and fog
// still apply. Three kinds:
//   waves  - the harbor: the vertices swell, the normals follow (so the light rolls over the swell), crests brighten
//            and the texture slides past itself in two layers so it never settles.
//   clouds - the same, slower and softer, for the skyship.
//   rock   - the forge: uneven, jagged stone. Jittered, ridged heights, shaded in flat facets; calmer round the table
//            so the foot of the anvil sits in it.
//   mirror - still water that reflects the sky dome.

import * as THREE from 'three';

export type GroundKind = 'waves' | 'clouds' | 'rock' | 'mirror';

/** The sky dome's own uniforms (Environment.domeUniforms), so water can reflect what the dome shows. */
export interface SkyUniforms {
  top: { value: THREE.Color };
  bottom: { value: THREE.Color };
  skyFrom: { value: THREE.Texture };
  skyTo: { value: THREE.Texture };
  wFrom: { value: number };
  wTo: { value: number };
  offFrom: { value: number };
  offTo: { value: number };
  haze: { value: number };
}

/** What every moving ground shares: the clock, the table's footprint (half width, half depth, centre z), the sky, and the dome's size (semi-axes) and the height of its centre. */
export interface GroundUniforms {
  time: { value: number };
  table: { value: THREE.Vector4 };
  sky: SkyUniforms;
  dome: { value: THREE.Vector4 };
}

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

const SWELLS: Record<'waves' | 'clouds', Swell> = {
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

/** Make `mat` (a ground material) move or break up as `kind` says. */
export function groundMaterial(mat: THREE.MeshStandardMaterial, kind: GroundKind, u: GroundUniforms): void {
  if (kind === 'rock') rock(mat, u);
  else if (kind === 'mirror') mirror(mat, u);
  else swell(mat, kind, u);
  mat.customProgramCacheKey = () => `ground:${kind}`;
}

function swell(mat: THREE.MeshStandardMaterial, kind: 'waves' | 'clouds', u: GroundUniforms): void {
  const s = SWELLS[kind];
  const total = s.waves.reduce((a, w) => a + w.amp, 0);

  const waves = s.waves.map((w) => {
    const len = Math.hypot(...w.dir);
    return `{ vec2 d = vec2(${f(w.dir[0] / len)}, ${f(w.dir[1] / len)}); float k = ${f((Math.PI * 2) / w.len)};
      float ph = k * (dot(d, position.xy) - ${f(w.speed)} * uTime); float c = cos(ph);
      swH += ${f(w.amp)} * sin(ph); swDx += ${f(w.amp)} * k * c * d.x; swDy += ${f(w.amp)} * k * c * d.y; }`;
  }).join('\n');

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.time;
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
}

function rock(mat: THREE.MeshStandardMaterial, u: GroundUniforms): void {
  // Flat facets, not smooth shading: the ground is broken, jagged stone.
  mat.flatShading = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTable = u.table;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec4 uTable;
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gNoise(vec2 p) {
          vec2 i = floor(p); vec2 fr = fract(p); fr = fr * fr * (3.0 - 2.0 * fr);
          return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), fr.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), fr.x), fr.y);
        }
        float gRidge(vec2 p) { return 1.0 - abs(2.0 * gNoise(p) - 1.0); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // The plane's local y is the world's -z. Ridged noise makes sharp crests; a jitter keeps the facets off a grid.
        vec2 gp = position.xy;
        vec2 jit = (vec2(gNoise(gp * 0.9), gNoise(gp * 0.9 + 17.0)) - 0.5) * 1.6;
        vec2 gq = gp + jit;
        float gh = gRidge(gq / 7.0) + gRidge(gq / 3.1 + 11.0) * 0.55 + gNoise(gq / 1.3) * 0.25 - 0.9;
        // Calmer under and beside the table, and flat again far away.
        vec2 gd = max(abs(vec2(gp.x, gp.y + uTable.z)) - uTable.xy, 0.0);
        float gCalm = mix(0.15, 1.0, smoothstep(2.0, 9.0, length(gd))) * (1.0 - smoothstep(90.0, 150.0, length(gp)));
        transformed.xy += jit * gCalm;
        transformed.z += gh * 1.15 * gCalm;`);
  };
}

/**
 * Still water: the ground mirrors the sky. For each pixel the reflected ray is followed up to the sky dome (an ellipsoid, see
 * Environment) and the dome's colour there is mixed in, more strongly the lower the camera looks (Fresnel). So a painted
 * sky, trees and all, doubles itself in the water, and the sky crossfades with the one above.
 */
function mirror(mat: THREE.MeshStandardMaterial, u: GroundUniforms): void {
  mat.onBeforeCompile = (shader) => {
    const s = u.sky;
    Object.assign(shader.uniforms, {
      uTop: s.top, uBottom: s.bottom, uSkyFrom: s.skyFrom, uSkyTo: s.skyTo, uWFrom: s.wFrom, uWTo: s.wTo,
      uOffFrom: s.offFrom, uOffTo: s.offTo, uHaze: s.haze, uDome: u.dome,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMirrorPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMirrorPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMirrorPos;
        uniform vec3 uTop; uniform vec3 uBottom; uniform sampler2D uSkyFrom; uniform sampler2D uSkyTo;
        uniform float uWFrom; uniform float uWTo; uniform float uOffFrom; uniform float uOffTo; uniform float uHaze; uniform vec4 uDome;
        // The sky as the dome paints it, seen along the unit direction R from the point P.
        vec3 mirrorSky(vec3 P, vec3 R) {
          vec3 o = vec3(P.x / uDome.x, (P.y - uDome.w) / uDome.y, P.z / uDome.z);
          vec3 d = vec3(R.x / uDome.x, R.y / uDome.y, R.z / uDome.z);
          float a = dot(d, d);
          float b = dot(o, d);
          float c = dot(o, o) - 1.0;
          float t = (-b + sqrt(max(b * b - a * c, 0.0))) / a;
          vec3 n = normalize(o + d * t);
          vec2 uv = vec2(1.0 - fract(atan(n.z, -n.x) / 6.28318530718), 1.0 - acos(clamp(n.y, -1.0, 1.0)) / 3.14159265359);
          float h = pow(clamp(n.y, 0.0, 1.0), mix(0.55, 1.4, max(uWFrom, uWTo)));
          vec3 sky = mix(uBottom, uTop, h);
          float vis = smoothstep(0.07 * uHaze, 0.32 * uHaze + 0.001, n.y);
          sky = mix(sky, texture2D(uSkyFrom, vec2(uv.x + uOffFrom, uv.y)).rgb, uWFrom * vis);
          sky = mix(sky, texture2D(uSkyTo, vec2(uv.x + uOffTo, uv.y)).rgb, uWTo * vis);
          return sky;
        }`)
      .replace('#include <opaque_fragment>', `
        {
          vec3 mV = normalize(vMirrorPos - cameraPosition);
          vec3 mR = vec3(mV.x, -mV.y, mV.z);
          float mF = mix(0.3, 1.0, pow(1.0 - clamp(-mV.y, 0.0, 1.0), 4.0));
          outgoingLight = mix(outgoingLight, mirrorSky(vMirrorPos, mR), mF);
        }
        #include <opaque_fragment>`);
  };
}
