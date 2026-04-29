import * as THREE from 'three';
import type { CharacterBody } from '../physics/character';

export interface Player {
  body: CharacterBody;
  mesh: THREE.Mesh;
  velocityY: number;
}

export function createPlayerMesh(scene: THREE.Scene, body: CharacterBody): THREE.Mesh {
  const totalHeight = (body.halfHeight + body.radius) * 2;
  const geo = new THREE.CapsuleGeometry(body.radius, body.halfHeight * 2, 8, 16);
  const mat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.totalHeight = totalHeight;
  scene.add(mesh);
  return mesh;
}

export function syncPlayerMesh(player: Player): void {
  const t = player.body.body.translation();
  player.mesh.position.set(t.x, t.y, t.z);
}
