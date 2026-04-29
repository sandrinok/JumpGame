import * as THREE from 'three';
import type { CharacterBody } from '../physics/character';
import type { Input } from '../core/input';

const WALK_SPEED = 5;
const RUN_SPEED = 9;
const JUMP_VELOCITY = 9;
const JUMP_CUT_VELOCITY = 4;
const GRAVITY = -25;
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.12;
const AIR_CONTROL = 0.6;
const ACCEL_GROUND = 60;
const ACCEL_AIR = 20;
const TURN_RATE = 12;

export interface Player {
  body: CharacterBody;
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  grounded: boolean;
  yaw: number;
  coyote: number;
  jumpBuffer: number;
  jumping: boolean;
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
    coyote: 0,
    jumpBuffer: 0,
    jumping: false,
  };
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export function updatePlayer(player: Player, input: Input, dt: number, basisYaw: number): void {
  const { body } = player;

  const lx = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
  const lz = (input.isDown('KeyS') ? 1 : 0) - (input.isDown('KeyW') ? 1 : 0);

  const sin = Math.sin(basisYaw);
  const cos = Math.cos(basisYaw);
  let wx = lx * cos + lz * sin;
  let wz = -lx * sin + lz * cos;
  const len = Math.hypot(wx, wz);
  if (len > 0) {
    wx /= len;
    wz /= len;
  }

  const sprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
  const speed = sprint ? RUN_SPEED : WALK_SPEED;

  const targetVx = wx * speed;
  const targetVz = wz * speed;
  const accel = (player.grounded ? ACCEL_GROUND : ACCEL_AIR) * (player.grounded ? 1 : AIR_CONTROL);
  const rate = accel / Math.max(speed, 0.01);
  player.velocity.x = damp(player.velocity.x, targetVx, rate, dt);
  player.velocity.z = damp(player.velocity.z, targetVz, rate, dt);

  if (len > 0) {
    const targetYaw = Math.atan2(wx, wz);
    let diff = targetYaw - player.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    player.yaw += diff * (1 - Math.exp(-TURN_RATE * dt));
  }

  if (player.grounded) {
    player.coyote = COYOTE_TIME;
    if (player.velocity.y < 0) player.velocity.y = 0;
    player.jumping = false;
  } else {
    player.coyote -= dt;
  }

  if (input.wasPressed('Space')) player.jumpBuffer = JUMP_BUFFER;
  else player.jumpBuffer -= dt;

  if (player.jumpBuffer > 0 && player.coyote > 0) {
    player.velocity.y = JUMP_VELOCITY;
    player.jumping = true;
    player.coyote = 0;
    player.jumpBuffer = 0;
  }

  // variable jump height: cut upward velocity if Space released early
  if (player.jumping && !input.isDown('Space') && player.velocity.y > JUMP_CUT_VELOCITY) {
    player.velocity.y = JUMP_CUT_VELOCITY;
  }

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
  player.mesh.position.set(t.x + corrected.x, t.y + corrected.y, t.z + corrected.z);
  player.mesh.rotation.y = player.yaw;
}
