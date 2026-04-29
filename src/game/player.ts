import * as THREE from 'three';
import type { CharacterBody } from '../physics/character';
import type { Input } from '../core/input';

const WALK_SPEED = 5;
const JUMP_VELOCITY = 9;
const GRAVITY = -25;

export interface Player {
  body: CharacterBody;
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  grounded: boolean;
  /** facing yaw, radians (0 = +Z) */
  yaw: number;
}

export function createPlayer(scene: THREE.Scene, body: CharacterBody): Player {
  const geo = new THREE.CapsuleGeometry(body.radius, body.halfHeight * 2, 8, 16);
  const mat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  return {
    body,
    mesh,
    velocity: new THREE.Vector3(),
    grounded: false,
    yaw: 0,
  };
}

/** Update with movement basis yaw (camera yaw in C5; world for now). */
export function updatePlayer(player: Player, input: Input, dt: number, basisYaw = 0): void {
  const { body } = player;

  // input direction in local space
  const localX = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
  const localZ = (input.isDown('KeyS') ? 1 : 0) - (input.isDown('KeyW') ? 1 : 0);

  // rotate by basisYaw to get world direction
  const sin = Math.sin(basisYaw);
  const cos = Math.cos(basisYaw);
  let worldX = localX * cos + localZ * sin;
  let worldZ = -localX * sin + localZ * cos;

  const len = Math.hypot(worldX, worldZ);
  if (len > 0) {
    worldX /= len;
    worldZ /= len;
    player.yaw = Math.atan2(worldX, worldZ);
  }

  player.velocity.x = worldX * WALK_SPEED;
  player.velocity.z = worldZ * WALK_SPEED;

  // gravity + jump
  if (player.grounded && player.velocity.y < 0) player.velocity.y = 0;
  if (player.grounded && input.wasPressed('Space')) player.velocity.y = JUMP_VELOCITY;
  player.velocity.y += GRAVITY * dt;

  const desired = {
    x: player.velocity.x * dt,
    y: player.velocity.y * dt,
    z: player.velocity.z * dt,
  };

  body.controller.computeColliderMovement(body.collider, desired);
  const corrected = body.controller.computedMovement();
  const t = body.body.translation();
  body.body.setNextKinematicTranslation({
    x: t.x + corrected.x,
    y: t.y + corrected.y,
    z: t.z + corrected.z,
  });

  player.grounded = body.controller.computedGrounded();

  // visual sync
  const next = body.body.translation();
  player.mesh.position.set(next.x + corrected.x, next.y + corrected.y, next.z + corrected.z);
  player.mesh.rotation.y = player.yaw;
}
