// Patches of fog that drift slowly through a place.
//
// Each patch is a few soft puffs of different size and speed, at the height of the grass or the floor-mist, behind and beside
// the table (never in front of it, where the camera is). They run on past the far end of their drift and come round again,
// thinning out at the ends so none appears or vanishes.

import * as THREE from 'three';
import { dotTexture } from './surfaces';
import type { ThemeScene } from './props';

export interface FogSpec {
  color: string;
  /** How many patches (each is three puffs). */
  patches: number;
  /** How thick each puff is at most (0..1). */
  strength: number;
  /** How far the drift runs before it comes round again, in world units (150). */
  span?: number;
  /** How far behind the table the patches lie: nearest and farthest z, negative behind (-44 and -4). */
  reach?: [number, number];
  /** How high the puffs float above the ground (0.8 to 2.4). */
  rise?: [number, number];
  /** How big the puffs are, as a multiple of the usual (1). */
  size?: number;
}

export function addFogBanks(ts: ThemeScene, spec: FogSpec, coarse: boolean): void {
  const SPAN = spec.span ?? 150;
  const [zNear, zFar] = spec.reach ?? [-44, -4];
  const [rise0, rise1] = spec.rise ?? [0.8, 2.4];
  const size = spec.size ?? 1;
  const patches = coarse ? Math.ceil(spec.patches / 2) : spec.patches;
  const puffs: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; base: number; x0: number; z: number; y: number; speed: number; ph: number }[] = [];
  for (let i = 0; i < patches; i++) {
    const cx = ts.between(-SPAN / 2, SPAN / 2);
    const cz = ts.between(zNear, zFar);
    const cy = ts.ground + ts.between(rise0, rise1);
    const speed = ts.between(0.45, 1.0);
    for (let k = 0; k < 3; k++) {
      const base = spec.strength * ts.between(0.6, 1);
      const mat = ts.register(new THREE.SpriteMaterial({ map: dotTexture(), color: spec.color, depthWrite: false, fog: false }), base);
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(ts.between(22, 38) * size, ts.between(4.5, 8) * size, 1);
      ts.group.add(sprite);
      puffs.push({ sprite, mat, base, x0: cx + ts.between(-9, 9) * size, z: cz + ts.between(-3, 3), y: cy + ts.between(-0.4, 0.6), speed: speed * ts.between(0.8, 1.2), ph: ts.rnd() * 20 });
    }
  }
  let tz = 0;
  ts.onLayout((_w, _d, cz) => { tz = cz; });
  ts.onTick((t) => {
    for (const p of puffs) {
      const x = ((((p.x0 + p.speed * t + SPAN / 2) % SPAN) + SPAN) % SPAN) - SPAN / 2;
      p.sprite.position.set(x, p.y + Math.sin(t * 0.2 + p.ph) * 0.3, tz + p.z + Math.sin(t * 0.13 + p.ph * 1.7) * 2);
      p.mat.opacity = ts.fade * p.base * Math.min(1, (SPAN / 2 - Math.abs(x)) / 18) * (0.7 + 0.3 * Math.sin(t * 0.3 + p.ph * 2));
    }
  });
}
