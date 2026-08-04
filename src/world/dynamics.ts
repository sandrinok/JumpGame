import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { playCrumble } from '../audio/sfx';
import type { Physics } from '../physics/world';
import type { LevelHandle, RenderedPlacement } from './level';
import type { Placement } from './types';

/**
 * The parts of the level that do something.
 *
 * Moving platforms, crumbling ledges, bounce pads and rotators. All of it runs
 * inside the fixed simulation step, never the render frame, because every one
 * of these changes where the player can stand — decide any of it per rendered
 * frame and the level behaves differently on a 60Hz and a 144Hz display.
 *
 * Ordering inside the step matters and is easy to get wrong:
 *
 *   1. Platforms move.
 *   2. We report what the platform under the player travelled.
 *   3. The player's controller applies that together with their own movement.
 *
 * The report has to come after the platform moves. Do it in the other order and
 * the player is always one step behind the platform, which reads as sliding
 * backwards off it — the single most common bug in moving-platform code.
 *
 * Note that step 3 does not simply add the reported travel: Rapier's character
 * controller carries the character on its own, unreliably, and the two have to
 * be reconciled. That reconciliation lives in updatePlayer, next to the
 * controller call it depends on.
 */

interface Dynamic {
  placement: Placement;
  rendered: RenderedPlacement;
  /** Where the body sits at phase 0. */
  base: THREE.Vector3;
  /**
   * Simulation transform at the end of this step and the previous one.
   *
   * Held separately from the Object3D because the group's transform is the
   * *visual* one, and the two are not the same thing: the simulation advances
   * at a fixed 60Hz and the frame does not. Writing the simulation position
   * straight onto the group steps the platform at 60Hz while the player, who is
   * interpolated, moves smoothly — so on any display above 60Hz the player
   * appears to shuffle back and forth across a platform they are standing
   * perfectly still on, by up to a whole simulation step of its travel. That is
   * around 6cm on the faster movers, and it reads as the physics being broken
   * when the physics is fine.
   */
  sim: THREE.Vector3;
  simPrev: THREE.Vector3;
  quat: THREE.Quaternion;
  quatPrev: THREE.Quaternion;
  /** Position at the end of the previous step, for computing carry delta. */
  prev: THREE.Vector3;
  /** Live travel this step, handed to whoever is standing on it. */
  delta: THREE.Vector3;
  /** rotating: radians turned this step, for carrying an off-centre rider. */
  spun: number;
  /** crumbling: seconds of contact accumulated; -1 once it has gone. */
  fuse: number;
  fallen: boolean;
  fallSpeed: number;
}

export interface Dynamics {
  /** Advance platforms. Call at the start of the fixed step. */
  step(dt: number): void;
  /**
   * Report how far the platform under these feet travelled this step, and
   * whether it is a bounce pad. Writes the travel into `out`, zero if there is
   * nothing dynamic underfoot. Call after step(), before the player updates.
   */
  carry(feet: THREE.Vector3, out: THREE.Vector3): { launch: number | null };
  /**
   * Draw the platforms somewhere between the last two simulation states.
   *
   * @param alpha 0 = previous step, 1 = current step. The same alpha the player
   *   is drawn with, or they will not agree with each other.
   */
  render(alpha: number): void;
  count: number;
}

/**
 * @param self The player's own collider. The ground ray starts inside it, so it
 *   has to be excluded explicitly — see groundQuery.
 */
export function createDynamics(
  physics: Physics,
  handle: LevelHandle,
  self: RAPIER.Collider,
): Dynamics {
  const items: Dynamic[] = [];
  /** collider handle -> the dynamic it belongs to, for the ground query. */
  const byCollider = new Map<number, Dynamic>();
  /** collider handle -> launch speed, for bounce pads (which never move). */
  const pads = new Map<number, number>();

  for (const rendered of handle.rendered.values()) {
    const p = rendered.placement;
    if (!p.kind) continue;
    const base = new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]);
    const q0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot[1]);
    const d: Dynamic = {
      placement: p,
      rendered,
      base,
      sim: base.clone(),
      simPrev: base.clone(),
      quat: q0.clone(),
      quatPrev: q0.clone(),
      prev: base.clone(),
      delta: new THREE.Vector3(),
      spun: 0,
      fuse: p.fuse ?? 0,
      fallen: false,
      fallSpeed: 0,
    };
    if (p.kind === 'bounce') {
      pads.set(rendered.collider.handle, p.launch ?? 15);
    }
    byCollider.set(rendered.collider.handle, d);
    items.push(d);
  }

  let clock = 0;
  const scratch = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  /** What is directly under these feet, if anything dynamic? */
  const groundQuery = (feet: THREE.Vector3): Dynamic | { pad: number } | null => {
    // Short ray, started slightly above the feet so it does not begin inside
    // the platform's own collider on the frame the player lands.
    //
    // Starting above the feet means starting *inside the player's own capsule* —
    // the feet are its bottom cap. With solid:true a ray that begins inside a
    // shape reports that shape at distance 0, so without this exclusion every
    // query answered "the player is standing on the player", the lookup missed,
    // and nothing dynamic ever did anything: no platform carried anyone, no
    // bounce pad fired, no ledge crumbled. Exclude the capsule explicitly.
    const ray = new RAPIER.Ray({ x: feet.x, y: feet.y + 0.25, z: feet.z }, { x: 0, y: -1, z: 0 });
    const hit = physics.world.castRay(ray, 0.75, true, undefined, undefined, self);
    if (!hit) return null;
    const handleId = hit.collider.handle;
    const pad = pads.get(handleId);
    if (pad !== undefined) return { pad };
    return byCollider.get(handleId) ?? null;
  };

  return {
    count: items.length,

    step(dt) {
      clock += dt;
      for (const d of items) {
        const p = d.placement;
        d.prev.copy(d.sim);
        d.simPrev.copy(d.sim);
        d.quatPrev.copy(d.quat);

        if (p.kind === 'moving' && p.motion) {
          const { to, period, phase = 0 } = p.motion;
          // Cosine rather than a triangle wave: a platform that reverses
          // instantly yanks anyone standing on it, and at the ends of the
          // travel the eased velocity gives the player a moment to commit.
          const t = ((clock / Math.max(period, 0.1)) + phase) * Math.PI * 2;
          const k = (1 - Math.cos(t)) * 0.5;
          scratch.set(
            d.base.x + to[0] * k,
            d.base.y + to[1] * k,
            d.base.z + to[2] * k,
          );
          d.rendered.body.setNextKinematicTranslation(scratch);
          d.sim.copy(scratch);
        } else if (p.kind === 'rotating') {
          const angle = p.rot[1] + clock * (p.spin ?? 0.6);
          d.quat.setFromAxisAngle(UP, angle);
          d.rendered.body.setNextKinematicRotation(d.quat);
          d.spun = (p.spin ?? 0.6) * dt;
        } else if (p.kind === 'crumbling' && d.fallen) {
          // Gone: drop the visual out of frame under gravity. The collider was
          // already removed the moment the fuse blew, so this is cosmetic.
          d.fallSpeed += 26 * dt;
          d.sim.y -= d.fallSpeed * dt;
        }

        d.delta.copy(d.sim).sub(d.prev);
      }
    },

    carry(feet, out) {
      out.set(0, 0, 0);
      const found = groundQuery(feet);
      if (!found) return { launch: null };
      if ('pad' in found) return { launch: found.pad };

      const p = found.placement;
      if (p.kind === 'crumbling' && !found.fallen) {
        found.fuse -= 1 / 60;
        if (found.fuse <= 0) {
          found.fallen = true;
          playCrumble();
          // Remove the collider rather than the whole body: the body still owns
          // the visual's transform while it drops away.
          physics.world.removeCollider(found.rendered.collider, false);
          byCollider.delete(found.rendered.collider.handle);
        }
        return { launch: null };
      }

      if (p.kind === 'moving') {
        out.copy(found.delta);
      } else if (p.kind === 'rotating' && found.spun !== 0) {
        // A rotator's own origin never moves, so found.delta is zero — but a
        // rider standing off the axis is on a surface that is travelling. Turn
        // their offset with the platform, or they hold world position while the
        // plank rotates out from under them and they walk off the end without
        // touching a key. Yaw only; these spin about Y.
        const dx = feet.x - found.base.x;
        const dz = feet.z - found.base.z;
        const c = Math.cos(found.spun);
        const s = Math.sin(found.spun);
        out.set(dx * c + dz * s - dx, 0, -dx * s + dz * c - dz);
      }
      return { launch: null };
    },

    render(alpha) {
      const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
      for (const d of items) {
        const kind = d.placement.kind;
        const moves = kind === 'moving' || (kind === 'crumbling' && d.fallen);
        if (!moves && kind !== 'rotating') continue;
        if (moves) d.rendered.group.position.lerpVectors(d.simPrev, d.sim, a);
        if (kind === 'rotating') d.rendered.group.quaternion.slerpQuaternions(d.quatPrev, d.quat, a);
        d.rendered.group.updateMatrix();
        d.rendered.group.updateMatrixWorld(true);
      }
    },
  };
}

/** Kinematic bodies need a Vector3-like; three's Vector3 satisfies it. */
export type { Dynamic };
