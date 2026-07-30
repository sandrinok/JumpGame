import * as THREE from 'three';
import type { CharacterBody } from '../physics/character';
import type { Input } from '../core/input';
import { loadCharacterRig, pickState, setState, type CharacterRig } from './character/rig';
import { playJump, playLand } from '../audio/sfx';

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
/**
 * How long the character has to be off the ground before the rig plays an
 * airborne clip.
 *
 * The character controller reports contact per step, and walking across a seam
 * between two colliders, over a bump, or downhill at speed loses it for a single
 * step at a time. Reading that directly, the rig dropped into the fall clip for
 * one frame — and because state changes crossfade over 0.18s, one frame of it is
 * a visible lurch that reads as the animation being broken.
 *
 * Deliberately the same as COYOTE_TIME, so the rig goes airborne at exactly the
 * moment the jump stops being available. The two answer the same question.
 */
const AIR_ANIM_GRACE = COYOTE_TIME;
/** Movement below this is float noise, not the controller blocking us. */
const CONTACT_EPSILON = 1e-4;

export interface Player {
  body: CharacterBody;
  /** debug capsule, hidden when rig is loaded */
  debugMesh: THREE.Mesh;
  rig: CharacterRig | null;
  visualRoot: THREE.Object3D;
  velocity: THREE.Vector3;
  grounded: boolean;
  yaw: number;
  /** Simulation position at the end of the previous fixed step. */
  prevPos: THREE.Vector3;
  /** Simulation position at the end of the current fixed step. */
  currPos: THREE.Vector3;
  /** Facing at the end of the previous fixed step. */
  prevYaw: number;
  coyote: number;
  jumpBuffer: number;
  /** Seconds since the character last had ground under it. */
  airTime: number;
  jumping: boolean;
  /** ticks down after a jump press; while >0 the rig plays the jump_start one-shot */
  jumpTrigger: number;
  /** ticks down after a landing; while >0 the rig plays the land one-shot */
  landTimer: number;
}

export function createPlayer(scene: THREE.Scene, body: CharacterBody): Player {
  const visualRoot = new THREE.Group();
  scene.add(visualRoot);

  const geo = new THREE.CapsuleGeometry(body.radius, body.halfHeight * 2, 8, 16);
  const mat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.7 });
  const debugMesh = new THREE.Mesh(geo, mat);
  debugMesh.castShadow = true;
  // capsule center sits at body center; visualRoot sits at body center too
  visualRoot.add(debugMesh);

  const t = body.body.translation();
  const start = new THREE.Vector3(t.x, t.y, t.z);
  visualRoot.position.copy(start);

  return {
    body,
    debugMesh,
    rig: null,
    visualRoot,
    velocity: new THREE.Vector3(),
    grounded: false,
    yaw: 0,
    prevPos: start.clone(),
    currPos: start.clone(),
    prevYaw: 0,
    coyote: 0,
    jumpBuffer: 0,
    airTime: 0,
    jumping: false,
    jumpTrigger: 0,
    landTimer: 0,
  };
}

export function respawnPlayer(player: Player, pos: [number, number, number], yaw: number): void {
  player.body.body.setNextKinematicTranslation({ x: pos[0], y: pos[1], z: pos[2] });
  player.body.body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
  player.velocity.set(0, 0, 0);
  player.yaw = yaw;
  player.grounded = false;
  player.coyote = 0;
  player.jumpBuffer = 0;
  // Respawning drops the player from the spawn point, so they start airborne
  // for real rather than easing into it.
  player.airTime = AIR_ANIM_GRACE;
  player.jumping = false;
  player.jumpTrigger = 0;
  player.landTimer = 0;
  // Collapse both interpolation endpoints onto the spawn, or the first frame
  // after a respawn draws the player streaking across the map from wherever
  // they fell.
  player.prevPos.set(pos[0], pos[1], pos[2]);
  player.currPos.set(pos[0], pos[1], pos[2]);
  player.prevYaw = yaw;
  player.visualRoot.position.set(pos[0], pos[1], pos[2]);
  player.visualRoot.rotation.y = yaw;
}

export interface AttachRigOptions {
  /** Yaw offset applied to the rig (radians). Use Math.PI if the model faces backwards. */
  facingYaw?: number;
  /** If true, scale the rig so its bbox height matches the capsule height. Default: true. */
  autoFit?: boolean;
  /** Optional URL of a separate GLB whose animations are retargeted onto this rig. */
  animationsUrl?: string;
}

export async function attachCharacterRig(
  player: Player,
  url: string,
  opts: AttachRigOptions = {},
): Promise<void> {
  const rig = await loadCharacterRig(url, opts.animationsUrl);
  const capsuleHeight = (player.body.halfHeight + player.body.radius) * 2;

  if (opts.autoFit !== false) {
    const bbox = new THREE.Box3().setFromObject(rig.root);
    const size = bbox.getSize(new THREE.Vector3());
    if (size.y > 0.0001) {
      const s = capsuleHeight / size.y;
      rig.root.scale.setScalar(s);
    }
  }

  // recompute bbox after scaling so we can place feet at the capsule bottom
  const bbox = new THREE.Box3().setFromObject(rig.root);
  rig.root.position.y -= bbox.min.y + capsuleHeight / 2;

  rig.root.rotation.y = opts.facingYaw ?? 0;
  player.visualRoot.add(rig.root);
  player.debugMesh.visible = false;
  player.rig = rig;
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export function updatePlayer(player: Player, input: Input, dt: number, basisYaw: number): void {
  const { body } = player;

  // Snapshot where this step starts, so render() can interpolate towards where
  // it ends.
  player.prevPos.copy(player.currPos);
  player.prevYaw = player.yaw;

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
    player.jumpTrigger = 0.25;
    playJump();
  }
  player.jumpTrigger = Math.max(0, player.jumpTrigger - dt);
  player.landTimer = Math.max(0, player.landTimer - dt);

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

  // Ceiling hit: we asked to rise and the controller refused. Without dropping
  // the velocity, gravity has to burn off the whole jump before you start
  // falling, so you hang under the ledge for a moment as if stuck to it.
  // Horizontal blocking is deliberately left alone — the controller slides
  // along walls, and zeroing velocity on contact would kill that.
  if (desired.y > 0 && corrected.y < desired.y - CONTACT_EPSILON && player.velocity.y > 0) {
    player.velocity.y = 0;
  }

  const t = body.body.translation();
  body.body.setNextKinematicTranslation({
    x: t.x + corrected.x,
    y: t.y + corrected.y,
    z: t.z + corrected.z,
  });
  const wasGrounded = player.grounded;
  player.grounded = body.controller.computedGrounded();
  if (player.grounded) player.airTime = 0;
  else player.airTime += dt;
  if (player.grounded && !wasGrounded) {
    const impact = Math.min(2, Math.abs(player.velocity.y) / 8);
    if (impact > 0.2) {
      playLand(impact);
      player.landTimer = 0.25;
    }
  }

  player.currPos.set(t.x + corrected.x, t.y + corrected.y, t.z + corrected.z);

  if (player.rig) {
    const horizSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    const next = pickState({
      airborne: player.airTime > AIR_ANIM_GRACE,
      speed: horizSpeed,
      runSpeed: RUN_SPEED,
      verticalVelocity: player.velocity.y,
      justJumped: player.jumpTrigger > 0,
      landTimer: player.landTimer,
    });
    // Only the state decision belongs to the fixed step; the mixer is advanced
    // per rendered frame in renderPlayer so limbs do not step at 60Hz.
    setState(player.rig, next);
  }
}

/**
 * Draw the player somewhere between the last two simulation states.
 *
 * @param alpha    0 = previous step, 1 = current step.
 * @param frameDt  real time since the last frame, for the animation mixer.
 */
export function renderPlayer(player: Player, alpha: number, frameDt: number): void {
  player.visualRoot.position.lerpVectors(player.prevPos, player.currPos, alpha);
  player.visualRoot.rotation.y = lerpAngle(player.prevYaw, player.yaw, alpha);
  player.rig?.mixer.update(frameDt);
}

/** Interpolate around the shortest arc, so a wrap past ±PI does not spin. */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
