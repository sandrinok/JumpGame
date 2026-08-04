/**
 * How much of a moving platform's travel the player still has to be given.
 *
 * Deliberately dependency-free and deliberately its own file. `player.ts` uses
 * it and so does `scripts/check-platforms.mjs`, which rides every platform in
 * the level — Node imports this directly by stripping the types. The rest of
 * the project's checks reimplement what they verify on purpose, because two
 * implementations agreeing is evidence and one agreeing with itself is not.
 * That rule is right for arithmetic and wrong here, and it has already cost
 * once: the check kept its own copy of this formula, the shipped one was
 * changed, riders started falling off 23 of 39 platforms, and every check still
 * said PASS. What has to be verified here is not the arithmetic — it is what
 * the physics engine does with it, and that only means anything if the check is
 * running the same arithmetic the game is.
 *
 * ---------------------------------------------------------------------------
 *
 * Rapier's character controller carries a character standing on a kinematic
 * body by itself, but only on the steps where its ground cast happens to find
 * the platform. On a wide slab that is essentially every step; on the 1.5-2.5m
 * ledges this level is built from it is about half of them, so the rider keeps
 * half the platform's travel and slides off the back within two seconds.
 *
 * The contribution cannot be switched off — it comes from the platform's own
 * velocity, so neither deferring the platform's motion nor zeroing its linear
 * velocity suppresses it (both measured). And it cannot simply be duplicated:
 * adding the travel ourselves doubles it on every step the controller did fire,
 * and the rider slides off the front instead.
 *
 * So measure it. Whatever the controller moved us beyond what we asked it for,
 * projected onto the platform's direction of travel, is what it already gave
 * us. Return only the remainder. Total platform-induced movement is then one
 * platform-step regardless of what the engine decided to do.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Movement below this is float noise, not a real contribution. */
const EPSILON = 1e-4;

/**
 * @param desired What the controller was asked to move the character by.
 * @param moved   What it reported moving them by.
 * @param carry   How far the platform underfoot travelled this step.
 * @param out     Receives the movement to actually apply.
 */
export function addOwedCarry(
  desired: Vec3Like,
  moved: Vec3Like,
  carry: Vec3Like,
  out: Vec3Like,
): Vec3Like {
  out.x = moved.x;
  out.y = moved.y;
  out.z = moved.z;

  const len = Math.sqrt(carry.x * carry.x + carry.y * carry.y + carry.z * carry.z);
  if (len <= EPSILON) return out;

  const ux = carry.x / len;
  const uy = carry.y / len;
  const uz = carry.z / len;
  const along =
    (moved.x - desired.x) * ux + (moved.y - desired.y) * uy + (moved.z - desired.z) * uz;

  // Clamped to [0, len]. An ordinary collision makes the controller return
  // *less* than it was asked for, which reads as a negative contribution; left
  // unclamped that would be topped up to more than one platform-step.
  const given = along < 0 ? 0 : along > len ? len : along;
  const owed = len - given;

  // Added straight on, not fed back through computeColliderMovement. Resolving
  // it is the obvious refinement and is much worse — the second call reads the
  // collider's position, which the first has not written back yet, so it
  // re-answers a question already asked and the owed movement evaporates:
  // riders fell off 23 of 39 movers that way, against none this way. The
  // remainder is at most one platform-step, a couple of centimetres, and the
  // controller depenetrates anything it pushes into on the following step.
  // Being carried into scenery is prevented where it belongs — the generator
  // will not route a platform through anything solid.
  out.x += ux * owed;
  out.y += uy * owed;
  out.z += uz * owed;
  return out;
}
