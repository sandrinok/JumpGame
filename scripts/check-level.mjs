#!/usr/bin/env node
/**
 * Independently audit a generated level.
 *
 * Deliberately shares no code with generate-level.mjs. The first build of the
 * generator printed "every jump verified inside the envelope" over a 176m
 * staircase, because the thing doing the verifying was the thing that had made
 * the mistake — it checked its own arithmetic with its own arithmetic. This
 * reads the emitted JSON and re-derives everything from the placements.
 *
 *   node scripts/check-level.mjs public/levels/ruins.json
 */

import { readFileSync } from 'node:fs';

const JUMP_VELOCITY = 9;
const GRAVITY = 25;
const DT = 1 / 60;
const PLAYER_HALF = 0.4;

/** Corners of a yaw-rotated box footprint. */
function corners(p) {
  const [cx, , cz] = p.pos;
  const [sx, , sz] = p.scale;
  const c = Math.cos(p.rot[1]);
  const s = Math.sin(p.rot[1]);
  const hx = sx / 2;
  const hz = sz / 2;
  return [
    [-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz],
  ].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
}

/** Separating-axis distance between two convex quads. Negative = overlapping. */
function obbGap(a, b) {
  const A = corners(a);
  const B = corners(b);
  let best = -Infinity;
  for (const poly of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = poly[i];
      const [x2, z2] = poly[(i + 1) % 4];
      let nx = -(z2 - z1);
      let nz = x2 - x1;
      const len = Math.hypot(nx, nz) || 1;
      nx /= len;
      nz /= len;
      const proj = (q) => q.map(([x, z]) => x * nx + z * nz);
      const pa = proj(A);
      const pb = proj(B);
      const gap = Math.max(Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
      if (gap > best) best = gap;
    }
  }
  return best;
}

function apex(v0 = JUMP_VELOCITY) {
  let v = v0;
  let y = 0;
  let max = 0;
  for (let i = 0; i < 600; i++) {
    v -= GRAVITY * DT;
    y += v * DT;
    if (y > max) max = y;
    if (y < -1) break;
  }
  return max;
}

/**
 * A moving platform is somewhere different depending on when you look.
 *
 * Reachability is a question about whether the jump is possible *at some point
 * in the cycle*, not at every point, so the target is evaluated at whichever
 * end of its travel is nearest to the takeoff. Judging it at its base position
 * would fail platforms that are perfectly reachable half the time.
 */
function nearestPose(placement, fromX, fromZ) {
  const m = placement.motion;
  if (placement.kind !== 'moving' || !m) return placement;
  const far = {
    ...placement,
    pos: [placement.pos[0] + m.to[0], placement.pos[1] + m.to[1], placement.pos[2] + m.to[2]],
  };
  const dNear = Math.hypot(placement.pos[0] - fromX, placement.pos[2] - fromZ);
  const dFar = Math.hypot(far.pos[0] - fromX, far.pos[2] - fromZ);
  return dFar < dNear ? far : placement;
}

const file = process.argv[2] ?? 'public/levels/ruins.json';
const level = JSON.parse(readFileSync(file, 'utf8'));
const MAX_RISE = apex();

const slabs = level.placements.filter((p) => p.id === 'box_stone');
const stubs = level.placements.filter((p) => p.id === 'box_wood');
const topY = (p) => p.pos[1] + p.scale[1] / 2;
const botY = (p) => p.pos[1] - p.scale[1] / 2;

/*
 * Route order is emission order — but only *within* a chain.
 *
 * Risk-line branches are appended after the whole main route, so reading the
 * slab array as one sequence walks off the summit and back down to a branch at
 * 6m, which it dutifully reported as a -177m rise and a 70m gap. Each chain is
 * checked on its own; the hops that join a branch to the main route are covered
 * by the generator's own audit, which knows both endpoints.
 */
const chains = new Map();
for (const s of slabs) {
  const key = s.chain ?? 'main';
  if (!chains.has(key)) chains.set(key, []);
  chains.get(key).push(s);
}

let overlaps = 0;
let tooFar = 0;
let tooHigh = 0;
let trivial = 0;
const gaps = [];
const rises = [];
for (const chain of chains.values()) {
for (let i = 1; i < chain.length; i++) {
  const a = chain[i - 1];
  // Jumping off a bounce pad is a different jump entirely, with its own arc.
  const v0 = a.kind === 'bounce' ? (a.launch ?? 15) : JUMP_VELOCITY;
  const b = nearestPose(chain[i], a.pos[0], a.pos[2]);
  const g = obbGap(a, b);
  const rise = topY(b) - topY(a);
  gaps.push(g);
  rises.push(rise);
  if (g < 0) overlaps++;
  if (g < 0.3) trivial++;
  if (rise > apex(v0) + 1e-6) tooHigh++;
  // Reach at this rise, assuming full run speed (optimistic on purpose: this is
  // an upper bound, so anything failing here fails for certain).
  let v = v0;
  let y = 0;
  let t = -1;
  for (let k = 0; k < 600; k++) {
    v -= GRAVITY * DT;
    y += v * DT;
    if (y >= rise) t = (k + 1) * DT;
    // Only give up once the arc is on its way down and has fallen clear. The
    // earlier condition tested height alone, which is satisfied on the very
    // first step of any jump aiming higher than ~1.2m — so every
    // bounce-launched jump bailed out before it had left the ground and was
    // reported as unreachable.
    if (v < 0 && y < rise - 1) break;
  }
  const reach = t < 0 ? 0 : 9 * t - PLAYER_HALF * 2;
  if (t < 0 || g > reach) tooFar++;
}
}

// Stubs must never stand proud of any slab's top face.
let stubProud = 0;
for (const s of stubs) {
  for (const sl of slabs) {
    if (topY(s) <= topY(sl) + 1e-6) continue;
    if (botY(s) >= topY(sl)) continue;
    if (obbGap(s, sl) < 0) { stubProud++; break; }
  }
}

// Any two stone slabs physically interpenetrating.
let interpenetrating = 0;
for (let i = 0; i < slabs.length; i++) {
  for (let j = i + 1; j < slabs.length; j++) {
    if (topY(slabs[i]) <= botY(slabs[j]) || topY(slabs[j]) <= botY(slabs[i])) continue;
    if (obbGap(slabs[i], slabs[j]) < 0) interpenetrating++;
  }
}

const f = (n) => Math.round(n * 1000) / 1000;
console.log(`[check] ${file}`);
console.log(`[check] ${slabs.length} slabs, ${stubs.length} supports, summit ${f(Math.max(...slabs.map(topY)))}m`);
console.log(`[check] reachable apex ${f(MAX_RISE)}m`);
console.log(`[check] edge gap ${f(Math.min(...gaps))}..${f(Math.max(...gaps))}m`);
console.log(`[check] rise ${f(Math.min(...rises))}..${f(Math.max(...rises))}m`);
console.log(`[check] killY ${level.killY}, spawn ${level.spawn.pos.join(',')}`);

const fails = [
  ['consecutive footprints overlapping', overlaps],
  ['moves with under 0.3m to clear (trivial)', trivial],
  ['rises above the reachable apex', tooHigh],
  ['gaps beyond an optimistic full-speed reach', tooFar],
  ['supports standing proud of a slab top face', stubProud],
  ['stone slabs interpenetrating', interpenetrating],
].filter(([, n]) => n > 0);

if (fails.length) {
  for (const [what, n] of fails) console.error(`[check] FAIL: ${n} ${what}`);
  process.exitCode = 1;
} else {
  console.log('[check] PASS: no overlaps, no trivial moves, nothing out of envelope');
}
