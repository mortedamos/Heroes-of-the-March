// A six-sided die rolled on the table. Shown for every die roll; the face that ends
// up on top is the number that was rolled.

import * as THREE from 'three';
import type { TableScene } from './TableScene';
import { easeOut } from './tween';

const SIZE = 0.62;
// Face order of BoxGeometry: +x, -x, +y, -y, +z, -z. Opposite faces add up to 7.
const FACE_VALUE = [3, 4, 1, 6, 2, 5];
const FACE_NORMAL = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
};

function faceTexture(value: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f3ead2';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(120, 90, 50, 0.45)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 122);
  g.fillStyle = value === 1 ? '#b3372f' : '#2a1d10';
  for (const [x, y] of PIPS[value]!) {
    g.beginPath();
    g.arc(x * 128, y * 128, value === 1 ? 15 : 11, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const DIE_POS = { x: 2.6, z: 0.35 };

export class Die {
  private readonly mesh: THREE.Mesh;
  private token = {};

  constructor(private readonly t: TableScene, private readonly pos: { x: number; z: number }) {
    const mats = FACE_VALUE.map((v) => new THREE.MeshStandardMaterial({ map: faceTexture(v), roughness: 0.45 }));
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(SIZE, SIZE, SIZE), mats);
    this.mesh.castShadow = true;
    this.mesh.visible = false;
    t.scene.add(this.mesh);
  }

  hide(): void {
    this.mesh.visible = false;
  }

  /** Tumble onto the table with `value` on top. A new roll replaces one still in progress. */
  async roll(value: number): Promise<void> {
    const mine = {};
    this.token = mine;
    const face = FACE_VALUE.indexOf(value);
    if (face < 0) return;
    // Orientation with the wanted face up, turned a random amount about the vertical axis.
    const final = new THREE.Quaternion().setFromUnitVectors(FACE_NORMAL[face]!, new THREE.Vector3(0, 1, 0));
    final.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2));
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize();
    const turns = 2.5 + Math.random() * 1.5;
    const from = { x: this.pos.x + 3.2, z: this.pos.z - 1.8 };
    const m = this.mesh;
    m.visible = true;
    const spin = new THREE.Quaternion();
    await this.t.tweens.add(1100, (k) => {
      const e = easeOut(k);
      m.position.set(from.x + (this.pos.x - from.x) * e, SIZE / 2 + 0.02 + Math.abs(Math.sin(k * Math.PI * 2.5)) * 0.9 * (1 - k), from.z + (this.pos.z - from.z) * e);
      spin.setFromAxisAngle(axis, (1 - e) * turns * Math.PI * 2);
      m.quaternion.copy(final).premultiply(spin);
    }, { owner: m, ease: (k) => k });
    if (this.token !== mine) return;
    m.position.set(this.pos.x, SIZE / 2 + 0.02, this.pos.z);
    m.quaternion.copy(final);
    // Stay for a moment so the number can be read, then clear the table.
    await new Promise((r) => setTimeout(r, 1800));
    if (this.token === mine) m.visible = false;
  }
}
