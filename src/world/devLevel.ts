import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../physics/world';

interface BoxSpec {
  pos: [number, number, number];
  size: [number, number, number];
  color?: number;
}

const BOXES: BoxSpec[] = [
  { pos: [4, 1, 0], size: [3, 2, 3], color: 0x8a6a4a },
  { pos: [10, 2.5, 2], size: [3, 0.5, 3], color: 0x8a6a4a },
  { pos: [14, 4, -2], size: [2, 0.5, 2], color: 0x8a6a4a },
  { pos: [18, 6, 1], size: [2, 0.5, 2], color: 0x8a6a4a },
  { pos: [22, 8, -2], size: [2, 0.5, 2], color: 0x8a6a4a },
  { pos: [-6, 0.5, 6], size: [4, 1, 4], color: 0x8a6a4a },
];

export function buildDevLevel(scene: THREE.Scene, physics: Physics): void {
  for (const b of BOXES) {
    const [px, py, pz] = b.pos;
    const [sx, sy, sz] = b.size;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mat = new THREE.MeshStandardMaterial({ color: b.color ?? 0x999999, roughness: 0.85 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px, py, pz);
    scene.add(mesh);

    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, pz),
    );
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2), body);
  }
}
