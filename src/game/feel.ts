import * as THREE from 'three';

/**
 * Camera response to movement.
 *
 * This used to also shake the screen and squash the character on every landing.
 * Both are removed, and the reason is worth keeping: the thresholds were
 * calibrated against nothing. JUMP_VELOCITY is 9 m/s, so an ordinary jump lands
 * at between 5.6 and 9 m/s — which was at or above the "hard landing" cutoff.
 * Every single jump therefore triggered the full effect, and an effect that
 * fires on every input is not feedback, it is noise.
 *
 * There is also no good threshold available. In a game where falling any real
 * distance ends the run, a landing hard enough to be worth announcing is one
 * the player does not survive, so the feature had almost no valid trigger to
 * begin with.
 *
 * What remains is the field of view, which responds to *speed* rather than to
 * impacts. It opens as the player builds sprint speed and as they fall, which
 * reads as acceleration without touching a single rule — and unlike a shake, it
 * never obscures the next foothold.
 */

/** Extra FOV at full sprint, in degrees. */
const SPRINT_FOV = 6;
/** Extra FOV while falling fast, in degrees. */
const FALL_FOV = 8;

export interface Feel {
  /** Advance the response. Call once per rendered frame. */
  update(dt: number, speed: number, verticalSpeed: number, grounded: boolean): void;
  /** Apply to the camera. Call after it has been positioned. */
  apply(camera: THREE.PerspectiveCamera): void;
  /**
   * Switch the speed response off, for players who find a moving field of view
   * uncomfortable.
   *
   * A comfort setting rather than a quality one — it costs nothing to run, so
   * no tier has any reason to have an opinion about it. Switching it off eases
   * the offset back to zero instead of snapping the camera, because a sudden
   * FOV change is precisely the thing the person turning this off is avoiding.
   */
  setEnabled(on: boolean): void;
}

export function createFeel(baseFov: number): Feel {
  let fovOffset = 0;
  let enabled = true;

  return {
    setEnabled(on) {
      enabled = on;
    },

    update(dt, speed, verticalSpeed, grounded) {
      if (!enabled) {
        fovOffset += (0 - fovOffset) * Math.min(1, 2 * dt);
        return;
      }
      const sprint = Math.min(1, Math.max(0, (speed - 5) / 4)) * SPRINT_FOV;
      const fall = grounded ? 0 : Math.min(1, Math.max(0, -verticalSpeed / 20)) * FALL_FOV;
      const target = sprint + fall;
      // Asymmetric: opens quickly, closes slowly. Snapping back the instant the
      // player lands is far more noticeable than the widening was, and a FOV
      // that pops on every touchdown is the same mistake as a shake.
      const rate = target > fovOffset ? 5 : 2;
      fovOffset += (target - fovOffset) * Math.min(1, rate * dt);
    },

    apply(camera) {
      const want = baseFov + fovOffset;
      if (Math.abs(camera.fov - want) > 0.01) {
        camera.fov = want;
        camera.updateProjectionMatrix();
      }
    },
  };
}
