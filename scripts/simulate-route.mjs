#!/usr/bin/env node
/**
 * Play the level, jump by jump, with the game's actual integrator.
 *
 *   node scripts/simulate-route.mjs public/levels/ruins.json
 *
 * This is the playtest. A browser bot was the obvious approach and it was not
 * reliable: the tab drops to `hidden`, requestAnimationFrame stops, and the run
 * silently stalls — a test that can quietly do nothing is worse than no test.
 *
 * So instead of driving the real game, this reimplements the part that decides
 * whether a jump lands: semi-implicit Euler at a fixed 1/60s, exponential
 * damping on horizontal speed, and the run-up available on the slab being left.
 * It is deterministic, needs no browser, and answers the only question that
 * matters — *can a player actually get up this?*
 *
 * It is deliberately not the same code as the generator. The generator decides
 * where to put things using a closed-form reach; this simulates a jump and
 * watches where it lands. Two implementations agreeing is evidence; one
 * implementation agreeing with itself is not.
 */

import { readFileSync } from 'node:fs';

const JUMP_VELOCITY = 9;
/** Upward speed a released jump is clamped to. player.ts:10. */
const JUMP_CUT_VELOCITY = 4;
const GRAVITY = 25;
const RUN_SPEED = 9;
const ACCEL_GROUND = 60;
const ACCEL_AIR = 20;
const AIR_CONTROL = 0.6;
const PLAYER_RADIUS = 0.4;
const DT = 1 / 60;

const topY = (p) => p.pos[1] + p.scale[1] / 2;

/** Footprint corners of a yaw-rotated box. */
function corners(p) {
  const [cx, , cz] = p.pos;
  const [sx, , sz] = p.scale;
  const c = Math.cos(p.rot[1]);
  const s = Math.sin(p.rot[1]);
  const hx = sx / 2;
  const hz = sz / 2;
  return [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
}

/** How far a footprint extends from its centre along a unit direction. */
function extentAlong(p, ux, uz) {
  let best = 0;
  for (const [x, z] of corners(p)) {
    best = Math.max(best, (x - p.pos[0]) * ux + (z - p.pos[2]) * uz);
  }
  return best;
}

/**
 * Simulate one jump between two slabs.
 *
 * Everything is reduced to the plane containing both centres: the player runs
 * along it, jumps, and either reaches the far slab's top surface while still
 * over it, or does not.
 */
function attempt(a, b, opts = {}) {
  const dx = b.pos[0] - a.pos[0];
  const dz = b.pos[2] - a.pos[2];
  const dist = Math.hypot(dx, dz) || 1e-6;
  const ux = dx / dist;
  const uz = dz / dist;

  const aExt = extentAlong(a, ux, uz);
  const bNear = extentAlong(b, -ux, -uz);
  const rise = topY(b) - topY(a);

  // Distance from the takeoff edge to the near edge of the target.
  const gap = dist - aExt - bNear;
  // Landing window for the capsule centre, measured from the takeoff edge.
  const landNear = gap;
  const landFar = gap + extentAlong(b, ux, uz) + bNear;

  // Run-up: the player accelerates across the slab they are leaving. Capped at
  // its extent along the direction of travel, which is what they actually have.
  const runUp = Math.max(0.5, aExt * 2 * (opts.runUpFraction ?? 0.85));
  const k = ACCEL_GROUND / RUN_SPEED;
  // Distance covered while damping towards RUN_SPEED, solved for time.
  let lo = 0;
  let hi = 8;
  for (let i = 0; i < 50; i++) {
    const t = (lo + hi) / 2;
    const x = RUN_SPEED * (t - (1 - Math.exp(-k * t)) / k);
    if (x < runUp) lo = t;
    else hi = t;
  }
  let vh = RUN_SPEED * (1 - Math.exp((-k * (lo + hi)) / 2));

  const maxVh = vh;
  const launch = opts.launch ?? JUMP_VELOCITY;

  /**
   * One attempt with a fixed input: approach at `speedFrac` of what the run-up
   * allows, and hold the jump for `holdSteps` before releasing.
   */
  const once = (speedFrac, holdSteps) => {
    let vh2 = maxVh * speedFrac;
    let vy = launch;
    let x = 0;
    let y = 0;
    let apex = 0;
    const target = RUN_SPEED * speedFrac;

    for (let step = 0; step < 900; step++) {
      // Jump-cut: releasing the button clamps upward speed, which is how the
      // player controls jump height. player.ts:221.
      if (step >= holdSteps && vy > JUMP_CUT_VELOCITY) vy = JUMP_CUT_VELOCITY;
      // Air control damps towards the held speed, so a jump taken slow does not
      // reach full speed in mid-air.
      const rate = (ACCEL_AIR * AIR_CONTROL) / RUN_SPEED;
      vh2 += (target - vh2) * (1 - Math.exp(-rate * DT));
      vy -= GRAVITY * DT;
      y += vy * DT;
      x += vh2 * DT;
      apex = Math.max(apex, y);

      if (vy < 0 && y <= rise) {
        return { landed: x >= landNear && x <= landFar, x, apex };
      }
      if (y < rise - 30) break;
    }
    return { landed: false, x, apex, never: true };
  };

  /*
   * Search the control space rather than testing one policy.
   *
   * A first version always sprinted and always held the jump to full height,
   * and reported 157 of 305 jumps as failures — every one of them *overshot*.
   * That is not a level that cannot be climbed, it is a test that refuses to
   * let go of the button. A jump is playable if some input the player can
   * actually give lands it, so that is what gets asked.
   *
   * The fraction of the space that works is worth more than the yes/no: a hop
   * with one working input is brutal, one with many is generous, and knowing
   * which is which is the difference between tuning and guessing.
   */
  const speeds = [0.25, 0.4, 0.55, 0.7, 0.85, 1];
  const holds = [0, 2, 4, 7, 10, 14, 20, 30];
  let works = 0;
  let attempts = 0;
  let best = null;

  for (const sf of speeds) {
    for (const hs of holds) {
      const r = once(sf, hs);
      attempts++;
      if (r.landed) {
        works++;
        if (!best) best = { ...r, speedFrac: sf, holdSteps: hs };
      } else if (!best) {
        best = { ...r, speedFrac: sf, holdSteps: hs };
      }
    }
  }

  const full = once(1, 99);
  return {
    ok: works > 0,
    // What the player has to do, not what they cannot.
    forgiveness: works / attempts,
    reason: works > 0 ? null : full.x < landNear ? 'unreachable — always short' : 'always overshoots',
    x: best?.x ?? 0,
    landNear,
    landFar,
    gap,
    rise,
    apex: full.apex,
    vh: maxVh,
  };
}

// ---------------------------------------------------------------------------

const file = process.argv[2] ?? 'public/levels/ruins.json';
const level = JSON.parse(readFileSync(file, 'utf8'));
const slabs = level.placements.filter((p) => p.id === 'box_stone');

const chains = new Map();
for (const s of slabs) {
  const key = s.chain ?? 'main';
  if (!chains.has(key)) chains.set(key, []);
  chains.get(key).push(s);
}

let total = 0;
let failed = 0;
const failures = [];
const margins = [];

for (const [name, chain] of chains) {
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1];
    const b = chain[i];
    // A bounce pad launches the next jump, and a moving platform is judged at
    // whichever end of its travel is nearer.
    const launch = a.kind === 'bounce' ? (a.launch ?? 15) : JUMP_VELOCITY;
    const target =
      b.kind === 'moving' && b.motion
        ? [b, { ...b, pos: [b.pos[0] + b.motion.to[0], b.pos[1] + b.motion.to[1], b.pos[2] + b.motion.to[2]] }]
            .map((c) => ({ c, d: Math.hypot(c.pos[0] - a.pos[0], c.pos[2] - a.pos[2]) }))
            .sort((p, q) => p.d - q.d)[0].c
        : b;

    const r = attempt(a, target, { launch });
    total++;
    if (!r.ok) {
      failed++;
      if (failures.length < 12) {
        failures.push(
          `${name} #${i} @${topY(b).toFixed(1)}m: ${r.reason} — ` +
            `landed at ${r.x.toFixed(2)}m, window ${r.landNear.toFixed(2)}..${r.landFar.toFixed(2)}, ` +
            `rise ${r.rise.toFixed(2)}, apex ${r.apex.toFixed(2)}`,
        );
      }
    } else {
      margins.push(r.forgiveness);
    }
  }
}

const f = (n) => Math.round(n * 1000) / 1000;
const sorted = [...margins].sort((p, q) => p - q);
console.log(`[sim] ${file}`);
console.log(`[sim] ${chains.size} chains, ${total} jumps simulated with the real integrator`);
console.log(`[sim] ${total - failed} landed, ${failed} failed`);
if (margins.length) {
  console.log(
    `[sim] forgiveness — share of the 48 tested inputs that land the jump: ` +
      `p05 ${f(sorted[Math.floor(sorted.length * 0.05)])}, ` +
      `median ${f(sorted[Math.floor(sorted.length * 0.5)])}, ` +
      `p95 ${f(sorted[Math.floor(sorted.length * 0.95)])}`,
  );
  // The difficulty curve, as measured rather than as intended.
  const brutal = margins.filter((m) => m <= 2 / 48).length;
  const tight = margins.filter((m) => m <= 6 / 48).length;
  console.log(`[sim] ${brutal} jumps land on 1-2 inputs only, ${tight} on 6 or fewer`);
}
for (const line of failures) console.error(`  - ${line}`);
if (failed) process.exitCode = 1;
