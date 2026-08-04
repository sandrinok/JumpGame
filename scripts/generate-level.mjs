#!/usr/bin/env node
/**
 * Generate the overgrown-ruins climb.
 *
 *   node scripts/generate-level.mjs public/levels/ruins.json
 *   node scripts/check-level.mjs   public/levels/ruins.json
 *
 * ---------------------------------------------------------------------------
 * Why the route is not a spiral any more
 *
 * The first playable build wrapped a single spiral around the tower for 177m.
 * It verified, it was climbable, and it was boring: one movement repeated 260
 * times. A spiral has exactly one idea in it, and once the player has read that
 * idea in the first fifteen seconds there is nothing left to learn — every
 * subsequent jump is the same jump at a different altitude.
 *
 * So the climb is a sequence of *movements* — spiral, switchback, shaft,
 * traverse, bridge, scatter — each with a different shape, sightline and
 * rhythm, one per band. The envelope machinery underneath is unchanged: a
 * movement only ever *proposes* a target, and the same clamp decides whether
 * the jump is legal. The shape is free to vary because it was never the thing
 * keeping the level honest.
 *
 * Elements do the same job moment to moment. A static ledge asks one question —
 * can I reach that. A crumbling ledge asks it under time pressure, a moving
 * platform asks it about somewhere that will not be there when you land, and a
 * bounce pad rewrites every question after it by lifting the ceiling from
 * 1.55m to about 4.4m.
 * ---------------------------------------------------------------------------
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Jump envelope. Mirrored from src/game/player.ts + src/physics/character.ts.
// ---------------------------------------------------------------------------

const JUMP_VELOCITY = 9;
const GRAVITY = 25;
const RUN_SPEED = 9;
const WALK_SPEED = 5;
const ACCEL_GROUND = 60;
const PLAYER_RADIUS = 0.4;
const DT = 1 / 60;

/**
 * The envelope is simulated, not solved.
 *
 * core/loop.ts steps at a fixed 1/60s and player.ts applies gravity *before*
 * the position update — semi-implicit Euler, which under-integrates a
 * decelerating arc. The continuous apex is 1.62m; the reachable apex is 1.546m.
 * Near the ceiling those 74mm are most of the remaining horizontal reach, so a
 * ledge placed by the closed form at 1.60m is simply unreachable.
 */
function trajectory(v0) {
  const pts = [{ t: 0, y: 0 }];
  let v = v0;
  let y = 0;
  for (let i = 1; i <= 600; i++) {
    v -= GRAVITY * DT;
    y += v * DT;
    pts.push({ t: i * DT, y });
    if (y < -60) break;
  }
  return pts;
}

const ARC = trajectory(JUMP_VELOCITY);
const MAX_RISE = ARC.reduce((m, p) => Math.max(m, p.y), 0);

/** Launch speed of a bounce pad, and the ceiling it buys. */
const LAUNCH = 15;
const LAUNCH_ARC = trajectory(LAUNCH);
const LAUNCH_RISE = LAUNCH_ARC.reduce((m, p) => Math.max(m, p.y), 0);

function flightTime(arc, rise) {
  let last = -1;
  for (const p of arc) if (p.y >= rise) last = p.t;
  return last;
}

function reachFor(rise, speed, arc = ARC) {
  const t = flightTime(arc, rise);
  return t < 0 ? 0 : speed * t;
}

/**
 * Horizontal speed actually achievable after accelerating across `runUp`.
 * player.ts damps velocity exponentially, so "at run speed" is earned with
 * distance: about 2.8m to reach 95% of it.
 */
function speedAfterRunUp(runUp, target) {
  const k = ACCEL_GROUND / target;
  let lo = 0;
  let hi = 6;
  for (let i = 0; i < 48; i++) {
    const t = (lo + hi) / 2;
    const x = target * (t - (1 - Math.exp(-k * t)) / k);
    if (x < runUp) lo = t;
    else hi = t;
  }
  return target * (1 - Math.exp((-k * (lo + hi)) / 2));
}

const COMFORT = 0.7;
const RISK = 0.9;
const MIN_EDGE_GAP = 0.8;

/**
 * Air a jump can clear once the player's own body is paid for. `reach` is how
 * far the capsule *centre* travels; it starts a radius short of the takeoff
 * edge and must end a radius past the landing edge, so a whole diameter of the
 * flight buys no gap at all.
 */
const usableEdge = (reach) => reach * RISK - PLAYER_RADIUS * 2;

// ---------------------------------------------------------------------------

const SLAB = 'box_stone';
const SUPPORT = 'box_wood';

const round = (n) => Math.round(n * 1000) / 1000;
const lerp = (a, b, t) => a + (b - a) * t;
const MIN_SLAB = PLAYER_RADIUS * 2 + 0.7;
const BASE_Y = 3.0;
const SPAWN_W = 13;
const SPAWN_X = 16;

function rngFrom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Exact half-extent of a yawed box footprint along a direction.
 *
 * Approximating this broke two earlier builds. A bounding circle is too big in
 * the direction that matters, so every gap is understated and a jump escapes
 * the envelope; an inscribed circle is too small, so the required step grows
 * past the whole walk-speed envelope and a band silently emits nothing.
 */
function extentAlong(across, along, yaw, dx, dz) {
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return (across / 2) * Math.abs(ux * c - uz * s) + (along / 2) * Math.abs(ux * s + uz * c);
}

function fitStep(target, prev, minCentre, maxCentre) {
  const dx = target[0] - prev[0];
  const dz = target[2] - prev[2];
  const d = Math.hypot(dx, dz);
  if (d === 0) {
    target[0] = prev[0] + minCentre;
    return;
  }
  const k = Math.min(maxCentre, Math.max(minCentre, d)) / d;
  target[0] = prev[0] + dx * k;
  target[2] = prev[2] + dz * k;
}

// ---------------------------------------------------------------------------
// Movements
//
// Each proposes where the route wants to go next, in plan. None is trusted: the
// caller clamps whatever comes back to the jump envelope. That is what lets the
// shapes be expressive without any of them being able to author a jump the
// player cannot make.
// ---------------------------------------------------------------------------

const MOVEMENTS = {
  /** Wrap the core. Long sightlines, steady rhythm — good for learning. */
  spiral(st, step) {
    st.angle += step / Math.max(st.radius, 1);
    return [Math.cos(st.angle) * st.radius, Math.sin(st.angle) * st.radius];
  },

  /**
   * Zig-zag across a face and back. The reversal is the point: you climb until
   * you run out of room, then have to turn and read an entirely new line.
   */
  switchback(st, step, rand) {
    st.leg += step;
    if (st.leg > st.legLength) {
      st.leg = 0;
      st.dir = -st.dir;
      st.legLength = 10 + rand() * 10;
      st.radius += 1.6; // drift outward so legs do not stack on each other
    }
    const across = st.dir * st.leg - st.legLength / 2;
    return [
      Math.cos(st.angle) * st.radius - Math.sin(st.angle) * across,
      Math.sin(st.angle) * st.radius + Math.cos(st.angle) * across,
    ];
  },

  /**
   * A tight chimney. Small footprint and fast angular travel, so the player is
   * turning constantly with the walls always close — claustrophobic straight
   * after the openness of a traverse.
   */
  shaft(st, step) {
    st.radius = lerp(st.radius, 5.5, 0.25);
    st.angle += step / Math.max(st.radius, 1);
    return [
      st.centreX + Math.cos(st.angle) * st.radius,
      st.centreZ + Math.sin(st.angle) * st.radius,
    ];
  },

  /** A long run in one direction with little height. Recovery, and a view. */
  traverse(st, step) {
    st.angle += step / Math.max(st.radius * 3.2, 1);
    st.radius = Math.min(st.radius + step * 0.22, 34);
    return [Math.cos(st.angle) * st.radius, Math.sin(st.angle) * st.radius];
  },

  /** Dead straight out across open air. Exposed, and the drop is the idea. */
  bridge(st, step) {
    st.leg += step;
    const across = st.leg;
    return [
      Math.cos(st.angle) * st.radius - Math.sin(st.angle) * across,
      Math.sin(st.angle) * st.radius + Math.cos(st.angle) * across,
    ];
  },

  /** Irregular. No rhythm to settle into, so every jump is read fresh. */
  scatter(st, step, rand) {
    st.angle += (step / Math.max(st.radius, 1)) * (0.45 + rand() * 1.5);
    const r = st.radius + (rand() - 0.5) * 9;
    return [Math.cos(st.angle) * r, Math.sin(st.angle) * r];
  },
};

// ---------------------------------------------------------------------------
// Bands
//
// One new idea at a time, then combinations. The Floor teaches the jump with
// nothing else going on; the Undergrowth adds ground that gives way; the Canopy
// adds platforms that move; everything after that is combination and precision.
// ---------------------------------------------------------------------------

const BANDS = [
  {
    name: 'The Floor',
    yEnd: 20,
    movement: 'spiral',
    radius: [16, 22],
    slab: [5.0, 3.4],
    riseFrac: [0.3, 0.5],
    gapFrac: [0.3, 0.5],
    walkSpeed: true,
    // Nothing dynamic. Introducing a mechanic in the safe learning space means
    // failing before you can understand why.
    elements: {},
  },
  {
    name: 'The Undergrowth',
    yEnd: 50,
    movement: 'switchback',
    radius: [19, 26],
    slab: [3.4, 2.6],
    riseFrac: [0.45, 0.65],
    gapFrac: [0.45, 0.65],
    elements: { crumbling: 0.18 },
  },
  {
    name: 'The Canopy',
    yEnd: 92,
    movement: 'traverse',
    radius: [22, 30],
    slab: [2.6, 2.0],
    riseFrac: [0.55, 0.75],
    gapFrac: [0.6, 0.8],
    elements: { crumbling: 0.12, moving: 0.2, bounce: 0.07 },
  },
  {
    name: 'The Spires',
    yEnd: 128,
    movement: 'shaft',
    radius: [16, 24],
    slab: [2.0, 1.5],
    riseFrac: [0.65, 0.85],
    gapFrac: [0.7, 0.88],
    elements: { crumbling: 0.2, moving: 0.24, bounce: 0.1, rotating: 0.08 },
  },
  {
    name: 'The Long Fall',
    yEnd: 152,
    movement: 'bridge',
    radius: [20, 30],
    slab: [1.9, 1.6],
    riseFrac: [0.5, 0.7],
    gapFrac: [0.75, 0.9],
    // Exposed and mostly moving: the drop under the bridge is the whole idea.
    elements: { moving: 0.4, crumbling: 0.16, bounce: 0.08 },
  },
  {
    name: 'Above the Trees',
    yEnd: 182,
    movement: 'scatter',
    radius: [11, 20],
    slab: [2.2, 3.0],
    riseFrac: [0.5, 0.65],
    gapFrac: [0.5, 0.65],
    elements: { moving: 0.22, bounce: 0.12, rotating: 0.1 },
  },
];

/**
 * Set-piece landmarks, deliberately off the critical path.
 *
 * These are what a climb gets remembered by — you say "just past the tram", not
 * "at 74 metres". They are not part of the verified route: they have colliders
 * and can be stood on, but nothing requires it, so a landmark is free to be any
 * shape without the envelope having an opinion about it.
 */
const LANDMARKS = [
  // Generated with fal (scripts/gen-models.mjs) and normalised to a 1m cube by
  // the mesher, so `scale` is the finished size in metres. These are the hero
  // geometry — 15-31k triangles each, which is affordable exactly because there
  // are a dozen of them and not a thousand. The same meshes scattered per-slab
  // would be four million triangles.
  { id: 'generated_idol_head', y: 8, scale: 7.5, tilt: 0.18, near: true },
  { id: 'generated_column_broken', y: 15, scale: 8.5, tilt: 0.1 },
  { id: 'generated_slab_broken_a', y: 22, scale: 7, tilt: 0.5 },
  { id: 'generated_ruined_arch', y: 31, scale: 11, tilt: 0.08, near: true },
  { id: 'generated_rubble_pile', y: 38, scale: 5.5, tilt: 0.2 },
  { id: 'generated_column_broken', y: 47, scale: 6.5, tilt: 0.3 },
  { id: 'generated_slab_broken_b', y: 55, scale: 8, tilt: 0.6 },
  { id: 'generated_idol_head', y: 68, scale: 5.5, tilt: 0.55, near: true },
  { id: 'generated_ruined_arch', y: 84, scale: 9, tilt: 0.25 },
  { id: 'generated_column_broken', y: 100, scale: 7, tilt: 0.45 },
  { id: 'generated_slab_broken_a', y: 118, scale: 6, tilt: 0.7 },
  { id: 'generated_rubble_pile', y: 134, scale: 4.5, tilt: 0.3 },
  { id: 'generated_idol_head', y: 150, scale: 6.5, tilt: 0.4, near: true },
  { id: 'generated_ruined_arch', y: 168, scale: 8, tilt: 0.35 },

  // Library pieces, for the things a jungle would have swallowed rather than
  // built: vehicles, street furniture, industrial junk.
  { id: 'moai_low_poly_game_ready', y: 12, scale: 4.2, tilt: 0.22 },
  { id: 'low-poly_telephone_booth__game_asset', y: 26, scale: 1.6, tilt: 0.35 },
  { id: 'city_buses', y: 42, scale: 1.5, tilt: 0.28 },
  { id: 'psx_industrial_pack_cargo_container', y: 60, scale: 1.8, tilt: 0.12 },
  { id: 'city_trams', y: 76, scale: 1.4, tilt: 0.4 },
  { id: 'crane', y: 96, scale: 1.1, tilt: 0.06 },
  { id: 'camper_ps1_spec', y: 112, scale: 1.5, tilt: 0.5 },
  { id: 'ps1_retro_concrete_mixer', y: 128, scale: 1.7, tilt: 0.3 },
  { id: 'emergency_power_station_ps1', y: 142, scale: 1.6, tilt: 0.15 },
  { id: 'psx_prop_old_garage', y: 160, scale: 1.3, tilt: 0.2 },
  { id: 'garden_gnome', y: 180, scale: 2.4, tilt: 0 },
];

export const LANDMARK_IDS = [...new Set(LANDMARKS.map((l) => l.id))];

/**
 * Optional lines that leave the main route and rejoin it higher.
 *
 * `bulge` pushes the branch sideways off the main line so it is visibly a
 * different way up rather than a second row of platforms alongside the first —
 * a choice you cannot see is not a choice.
 */
const BRANCHES = [
  { from: 5, to: 19, bulge: -13, tighten: 0.9, label: 'Floor shortcut' },
  { from: 24, to: 45, bulge: 15, tighten: 0.95, label: 'Undergrowth line' },
  { from: 56, to: 82, bulge: -17, tighten: 1.0, label: 'Canopy line' },
  { from: 96, to: 122, bulge: 14, tighten: 1.0, label: 'Spire line' },
  { from: 132, to: 150, bulge: -15, tighten: 1.0, label: 'Long Fall line' },
];

/**
 * Emit a chain of footholds from one route node to another.
 *
 * Returns how many slabs it placed, or 0 if the gap could not be bridged
 * without breaking the envelope.
 */
function emitBranch(from, to, spec, rand, placements, audit, nextUid, slab, solids) {
  const dx = to.pos[0] - from.pos[0];
  const dz = to.pos[2] - from.pos[2];
  const totalRise = to.pos[1] - from.pos[1];
  const totalFlat = Math.hypot(dx, dz);

  // A risk line runs at up to RISK of the envelope where the main route runs at
  // COMFORT, which is what makes it worth taking and what makes it punishing.
  const slabSize = Math.max(MIN_SLAB, 1.9 * spec.tighten);
  const speed = speedAfterRunUp(slabSize, RUN_SPEED);
  const hopRise = MAX_RISE * RISK * 0.92;
  const hopReach = usableEdge(reachFor(hopRise, speed));
  if (hopReach < MIN_EDGE_GAP) return 0;

  // Hops are set by whichever of the two constraints needs more of them.
  const hops = Math.max(
    2,
    Math.ceil(totalRise / hopRise),
    Math.ceil(totalFlat / (hopReach + slabSize)),
  );

  /*
   * The branch is a circular arc of a *prescribed length*, and that choice is
   * the whole trick.
   *
   * A straight line between the two ends cannot fit the hops: a 21m climb needs
   * 17 of them, and spreading 10m of ground over 17 gives 0.6m steps — after
   * subtracting the slab width that is a negative gap, so the footholds overlap
   * and it is a ladder, not a route.
   *
   * Two earlier attempts bowed the path to lengthen it and both failed for the
   * same underlying reason: they controlled the *shape* and hoped the spacing
   * and the endpoint came out right. A bowed helix ended nowhere near the
   * rejoin slab (a 43m final hop), and blending that error away redistributed
   * it into the spacing instead, producing gaps both too large and too small in
   * the same branch.
   *
   * An arc with a given chord and a given length has exactly one solution, and
   * walking it at constant arc-length gives identical spacing at every hop with
   * both endpoints landing exactly where they must. Nothing is left to hope.
   */
  const chord = Math.max(totalFlat, 0.001);

  /*
   * Required length, summed hop by hop rather than as hops x spacing.
   *
   * The two end hops are not like the others: they leave and land on main-route
   * slabs, which are wider than anything the branch places. Budgeting every hop
   * as branch-to-branch left exactly those two short — every remaining
   * violation was a first hop, departing a slab whose half-extent alone ate the
   * gap.
   */
  const endExtent = (n) => Math.hypot(n.along / 2, n.across / 2);

  // What each individual hop needs. Summing these and then dividing the total
  // evenly is not the same thing: an opening hop that needs 4.8m still only got
  // the average 3.2m, and stayed short. The arc is walked on this cumulative
  // schedule instead, so every hop gets exactly what it asked for.
  const want = [];
  for (let i = 1; i <= hops; i++) {
    const nearHalf = i === 1 ? endExtent(from) : slabSize / 2;
    const farHalf = i === hops ? endExtent(to) : slabSize / 2;
    want.push(nearHalf + farHalf + MIN_EDGE_GAP * 1.3);
  }
  const wantTotal = want.reduce((a, b) => a + b, 0);
  const arcLen = Math.max(chord * 1.0002, wantTotal);

  // Cumulative fraction of the arc at each hop. Arc length is linear in the
  // sweep angle, so a fraction of length is a fraction of angle.
  const at = [0];
  let acc = 0;
  for (const w of want) {
    acc += (w / wantTotal) * arcLen;
    at.push(Math.min(1, acc / arcLen));
  }

  // Solve arcLen/chord = alpha/sin(alpha) for the half-angle. Monotonic on
  // (0, pi), so a bisection is enough and cannot get stuck.
  const ratio = arcLen / chord;
  let lo = 1e-4;
  let hi = Math.PI - 1e-4;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (mid / Math.sin(mid) < ratio) lo = mid;
    else hi = mid;
  }
  const alpha = (lo + hi) / 2;
  const radius = chord / (2 * Math.sin(alpha));

  // Local frame: chord along u, bulge along v.
  const ux = dx / chord;
  const uz = dz / chord;
  const side = Math.sign(spec.bulge) || 1;
  const vx = -uz * side;
  const vz = ux * side;
  const midX = from.pos[0] + dx / 2;
  const midZ = from.pos[2] + dz / 2;
  // Circle centre sits opposite the bulge.
  const cxw = midX - vx * radius * Math.cos(alpha);
  const czw = midZ - vz * radius * Math.cos(alpha);

  // Walking the arc at constant arc-length: phi is linear in f, so every hop
  // covers exactly `arcLen / hops` regardless of where it is on the curve.
  const arcAt = (f) => {
    const phi = -alpha + 2 * alpha * f;
    const su = Math.sin(phi) * radius;
    const sv = Math.cos(phi) * radius;
    return [
      cxw + ux * su + vx * sv,
      from.pos[1] + totalRise * f,
      czw + uz * su + vz * sv,
    ];
  };

  // Buffered, because a branch is committed only if all of it works. Pushing as
  // we go would leave the slabs of an abandoned branch behind in the level.
  const outPlacements = [];
  const outSolids = [];
  const outAudit = [];

  let prev = [...from.pos];
  let prevAlong = from.along;
  let prevAcross = from.across;
  let prevYaw = from.yaw;

  for (let i = 1; i <= hops; i++) {
    const f = at[i];
    const target = i === hops ? [...to.pos] : arcAt(f);
    // Height is shared out evenly even though ground distance is not. A hop
    // given extra arc to clear a wide fork slab must not also be given extra
    // climb — that is how a horizontal fix turns into a rise violation.
    if (i !== hops) target[1] = from.pos[1] + totalRise * (i / hops);

    // Near the fork and the rejoin a branch necessarily runs close to the route
    // it left, and close turned into overlapping: 13 pairs of slabs sharing the
    // same space. Nudging them apart individually fixed that and broke the
    // spacing instead — the schedule above is what makes every hop legal, and
    // moving one slab out of it invalidates two jumps.
    //
    // So intrusion abandons the whole branch rather than repairing it. A branch
    // is optional by definition; a *partial* branch is a route that leads
    // nowhere, which is worse than not offering the choice at all.
    if (i !== hops) {
      const halfR = Math.hypot((slabSize * 0.85) / 2, slabSize / 2);
      if (intrudes(solids, target[0], target[2], halfR, target[1], target[1] - 0.6)) {
        return 0;
      }
    }

    const yaw = Math.atan2(target[0] - prev[0], target[2] - prev[2]);
    const ext = extentAlong(prevAcross, prevAlong, prevYaw, target[0] - prev[0], target[2] - prev[2]);
    const rise = target[1] - prev[1];
    const reach = reachFor(rise, speedAfterRunUp(prevAlong, RUN_SPEED));
    const centre = Math.hypot(target[0] - prev[0], target[2] - prev[2]);
    const gap = centre - ext - slabSize / 2;

    // The final hop lands on the existing main-route slab, so nothing is
    // emitted for it — only checked.
    const last = i === hops;
    if (!last) {
      const thickness = Math.max(0.25, Math.min(0.6, rise * 0.6));
      // Tagged so the audit script can follow each route separately. Without
      // it, consecutive slabs in the file jump from the summit back down to a
      // branch at 6m and it reports a -177m "rise".
      outPlacements.push(slab(target, slabSize * 0.85, slabSize, thickness, yaw, { chain: spec.label }));
      outSolids.push({
        x: target[0],
        z: target[2],
        radius: Math.hypot((slabSize * 0.85) / 2, slabSize / 2),
        topY: target[1],
        botY: target[1] - thickness,
      });
    }

    outAudit.push({
      band: `${spec.label} (risk)`,
      kind: 'risk',
      y: target[1],
      rise,
      gap,
      reach,
      slab: last ? Math.min(to.across, to.along) : slabSize,
      launched: false,
      from: [...prev],
      to: [...target],
      v0: JUMP_VELOCITY,
    });

    prev = target;
    prevAlong = last ? to.along : slabSize;
    prevAcross = last ? to.across : slabSize * 0.85;
    prevYaw = yaw;
  }

  placements.push(...outPlacements);
  solids.push(...outSolids);
  audit.push(...outAudit);
  return outPlacements.length;
}

// ---------------------------------------------------------------------------

function pickKind(weights, rand) {
  let roll = rand();
  for (const [kind, w] of Object.entries(weights)) {
    if (roll < w) return kind;
    roll -= w;
  }
  return null;
}

/** Would a column at (x,z,r) spanning [botY,topY] push up through anything? */
function intrudes(solids, x, z, r, topY, botY) {
  for (const s of solids) {
    if (topY <= s.botY || botY >= s.topY) continue;
    if (Math.hypot(s.x - x, s.z - z) < s.radius + r) return true;
  }
  return false;
}

function generate(seed = 20260803) {
  const rand = rngFrom(seed);
  const placements = [];
  const audit = [];
  /** Every slab footprint, so supports can be filtered against all of them. */
  const solids = [];
  /** Candidate supports, resolved after the whole route is known. */
  const stubs = [];
  /** Main-route footholds, so risk lines have something to fork from. */
  const route = [];
  let uid = 0;
  const nextUid = () => `g${(uid++).toString(36)}`;

  const slab = (target, across, along, thickness, yaw, extra = {}) => ({
    id: SLAB,
    uid: nextUid(),
    pos: [round(target[0]), round(target[1] - thickness / 2), round(target[2])],
    rot: [0, round(yaw), 0],
    scale: [round(across), round(thickness), round(along)],
    ...extra,
  });

  placements.push(slab([SPAWN_X, BASE_Y, 0], SPAWN_W, SPAWN_W, BASE_Y * 2, 0));

  let y = BASE_Y;
  let prev = [SPAWN_X, BASE_Y, 0];
  let prevAlong = SPAWN_W;
  let prevAcross = SPAWN_W;
  let prevYaw = 0;
  /** Set when the last platform was a bounce pad: the next jump gets the big arc. */
  let launched = false;

  const st = {
    angle: 0,
    radius: 16,
    dir: 1,
    leg: 0,
    legLength: 14,
    centreX: 0,
    centreZ: 0,
  };

  for (const band of BANDS) {
    const speedCap = band.walkSpeed ? WALK_SPEED : RUN_SPEED;
    const move = MOVEMENTS[band.movement];
    const yStart = y;
    const span = band.yEnd - yStart;
    if (span <= 0) continue;

    st.radius = band.radius[0];
    st.leg = 0;
    st.legLength = 14;
    st.centreX = prev[0] * 0.55;
    st.centreZ = prev[2] * 0.55;

    let guard = 0;
    while (y < band.yEnd && guard++ < 600) {
      const t = Math.min(1, (y - yStart) / span);
      const slabBase = lerp(band.slab[0], band.slab[1], t);
      st.radius = lerp(st.radius, lerp(band.radius[0], band.radius[1], t), 0.15);

      // `along` is the axis yaw aligns with travel, so it is deliberately the
      // long one: the axis the player runs down to build speed and lands into.
      const along = Math.max(MIN_SLAB, slabBase * (1.05 + rand() * 0.5));
      const across = Math.max(MIN_SLAB, slabBase * (0.7 + rand() * 0.3));
      const speed = speedAfterRunUp(prevAlong, speedCap);

      const arc = launched ? LAUNCH_ARC : ARC;
      const ceiling = launched ? LAUNCH_RISE : MAX_RISE;
      const riseFrac = lerp(band.riseFrac[0], band.riseFrac[1], t);

      let rise = ceiling * riseFrac * COMFORT * (0.85 + rand() * 0.3);
      let reach = reachFor(rise, speed, arc);
      for (let i = 0; i < 10 && usableEdge(reach) < MIN_EDGE_GAP; i++) {
        rise *= 0.85;
        reach = reachFor(rise, speed, arc);
      }
      if (usableEdge(reach) < MIN_EDGE_GAP) break;

      const gapFrac = lerp(band.gapFrac[0], band.gapFrac[1], t);
      const edge = Math.max(
        MIN_EDGE_GAP,
        Math.min(usableEdge(reach), reach * gapFrac * COMFORT * (0.85 + rand() * 0.3)),
      );

      const ny = y + rise;
      // Two passes: direction depends on the step and the step depends on the
      // direction. It converges immediately because the route turns slowly
      // relative to a single step.
      let ext = extentAlong(prevAcross, prevAlong, prevYaw, 1, 0);
      const [px, pz] = move(st, edge + ext + along / 2, rand);
      ext = extentAlong(prevAcross, prevAlong, prevYaw, px - prev[0], pz - prev[2]);
      const target = [px, ny, pz];
      fitStep(target, prev, MIN_EDGE_GAP + ext + along / 2, usableEdge(reach) + ext + along / 2);

      const yaw = Math.atan2(target[0] - prev[0], target[2] - prev[2]);
      const thickness = Math.max(0.25, Math.min(0.85, rise * 0.7));

      const kind = pickKind(band.elements, rand);
      const extra = {};
      if (kind === 'crumbling') {
        extra.kind = 'crumbling';
        extra.fuse = round(0.45 + rand() * 0.5);
      } else if (kind === 'moving') {
        extra.kind = 'moving';
        // Travel perpendicular to the direction of arrival, so the platform
        // slides across the player's line rather than along it. Moving away and
        // back along the same axis just makes the gap breathe, which reads as
        // the level being indecisive rather than as a moving platform.
        const perp = yaw + Math.PI / 2;
        const dist = 3 + rand() * 5;
        extra.motion = {
          to:
            rand() < 0.28
              ? [0, round(2 + rand() * 3.5), 0]
              : [round(Math.sin(perp) * dist), 0, round(Math.cos(perp) * dist)],
          period: round(3.2 + rand() * 3),
          phase: round(rand()),
        };
      } else if (kind === 'bounce') {
        extra.kind = 'bounce';
        extra.launch = LAUNCH;
      } else if (kind === 'rotating') {
        extra.kind = 'rotating';
        extra.spin = round((rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.5));
      }

      const placed = slab(target, across, along, thickness, yaw, extra);
      placements.push(placed);

      solids.push({
        x: target[0],
        z: target[2],
        // Circumradius, not half-length. A rectangle reaches furthest at its
        // corner: a 2.7x4.0 slab reaches 2.42m, not the 2.01m that max/2 gives.
        // Understating it let a support sit 1.5m proud of a landing while the
        // circle test insisted they were 13cm apart.
        radius: Math.hypot(across / 2, along / 2),
        topY: ny,
        botY: ny - thickness,
      });

      // No stub under a moving platform — it would stay behind while the
      // platform slid out from over it. And never one that would punch up
      // through something already placed: a stub standing proud of a *different*
      // slab's top face is a solid obstacle dropped into someone's landing.
      if (kind !== 'moving' && rand() < 0.55) {
        const sw = Math.min(across, along) * (0.3 + rand() * 0.25);
        const sh = 1.2 + rand() * 2.2;
        const stubTop = ny - thickness;
        // Held back rather than emitted here. Checking only against slabs
        // placed *so far* misses the ones the route lays down later and then
        // wraps back over, which is how a stub ends up standing proud of a
        // landing that did not exist when the stub was decided.
        stubs.push({
          x: target[0],
          z: target[2],
          r: sw / 2,
          topY: stubTop,
          botY: stubTop - sh,
          sw,
          sh,
          yaw,
        });
      }

      const centre = Math.hypot(target[0] - prev[0], target[2] - prev[2]);
      audit.push({
        band: band.name,
        // Carried so a later pass that changes what a foothold *is* can correct
        // the record it will be counted from.
        uid: placed.uid,
        kind: kind ?? 'static',
        y: ny,
        rise: ny - prev[1],
        gap: centre - ext - along / 2,
        reach,
        slab: Math.min(across, along),
        launched,
        // Endpoints, so the flight path between them can be checked for
        // obstructions later. A jump can be perfectly within the envelope and
        // still impossible because something is standing in the arc.
        from: [prev[0], prev[1], prev[2]],
        to: [target[0], target[1], target[2]],
        v0: launched ? LAUNCH : JUMP_VELOCITY,
      });

      // Only static footholds are offered as fork or rejoin points. Forking off
      // a crumbling ledge means the choice disappears while you are reading it,
      // and rejoining onto one means the safe line ends somewhere that is not.
      if (!kind) route.push({ pos: [...target], along, across, yaw, y: ny });

      launched = kind === 'bounce';
      prev = target;
      prevAlong = along;
      prevAcross = across;
      prevYaw = yaw;
      y = ny;
    }

    // Recovery terrace closing the band. Always static and always wide: after a
    // band of crumbling and moving ledges the player needs somewhere that is
    // unambiguously safe to stand still and look around from.
    {
      const size = 7.5;
      const speed = speedAfterRunUp(prevAlong, speedCap);
      const rise = Math.min(0.9, MAX_RISE * 0.55);
      const reach = reachFor(rise, speed);
      const half = size / 2;
      const edge = Math.max(MIN_EDGE_GAP, Math.min(usableEdge(reach), reach * COMFORT * 0.5));
      let ext = extentAlong(prevAcross, prevAlong, prevYaw, 1, 0);
      const [px, pz] = MOVEMENTS.spiral(st, edge + ext + half, rand);
      ext = extentAlong(prevAcross, prevAlong, prevYaw, px - prev[0], pz - prev[2]);
      const target = [px, y + rise, pz];
      fitStep(target, prev, MIN_EDGE_GAP + ext + half, usableEdge(reach) + ext + half);
      const tYaw = Math.atan2(target[0] - prev[0], target[2] - prev[2]);
      placements.push(slab(target, size, size, 1.0, tYaw));
      solids.push({
        x: target[0],
        z: target[2],
        radius: Math.hypot(size / 2, size / 2),
        topY: target[1],
        botY: target[1] - 1.0,
      });

      const centre = Math.hypot(target[0] - prev[0], target[2] - prev[2]);
      audit.push({
        band: `${band.name} — terrace`,
        kind: 'static',
        y: target[1],
        rise: target[1] - prev[1],
        gap: centre - ext - half,
        reach,
        slab: size,
        launched: false,
      });
      prev = target;
      prevAlong = size;
      prevAcross = size;
      prevYaw = tYaw;
      launched = false;
      y = target[1];
    }
  }

  // Now that every slab is known, keep only the supports that stay under them.
  let dropped = 0;
  for (const s of stubs) {
    if (intrudes(solids, s.x, s.z, s.r, s.topY, s.botY)) {
      dropped++;
      continue;
    }
    placements.push({
      id: SUPPORT,
      uid: nextUid(),
      pos: [round(s.x), round(s.topY - s.sh / 2), round(s.z)],
      rot: [0, round(s.yaw), 0],
      scale: [round(s.sw), round(s.sh), round(s.sw)],
    });
  }

  // The Spine: one leaning mass running the full height, the orientation
  // anchor. You read your progress off it rather than off the HUD.
  //
  // Chunks that would stand proud of a foothold are dropped. The Spine used to
  // be emitted unconditionally, which was safe only while the route stayed at
  // radius 16+; the `shaft` band pulls in to about 5.5, straight through where
  // the Spine stands. A missing chunk reads as the tower having broken apart,
  // which is what a ruin should look like anyway — a chunk sitting in the
  // middle of a landing does not.
  const top = y;
  for (let h = 0; h < top; h += 9) {
    const f = h / top;
    const lean = f * f * 7;
    const w = Math.max(3.2, lerp(10, 3.2, f) * (0.95 + rand() * 0.05));
    const cx = lean;
    const cz = -lean * 0.5;
    if (intrudes(solids, cx, cz, w / 2, h + 9.2, h)) {
      dropped++;
      continue;
    }
    placements.push({
      id: SUPPORT,
      uid: nextUid(),
      pos: [round(cx), round(h + 4.6), round(cz)],
      rot: [0, round(f * 0.6), 0],
      scale: [round(w), 9.2, round(w * 0.92)],
    });
  }

  for (const lm of LANDMARKS) {
    const a = rand() * Math.PI * 2;
    // `near` pulls a landmark in close enough to actually be looked at rather
    // than glimpsed through fog. Safe to do because the flight-path pass runs
    // afterwards and removes anything that ends up standing in a jump.
    const r = lm.near ? 15 + rand() * 8 : 28 + rand() * 14;
    const lx = Math.cos(a) * r;
    const lz = Math.sin(a) * r;
    placements.push({
      id: lm.id,
      uid: nextUid(),
      pos: [round(lx), round(lm.y), round(lz)],
      rot: [
        round((rand() - 0.5) * lm.tilt),
        round(rand() * Math.PI * 2),
        round((rand() - 0.5) * lm.tilt),
      ],
      scale: [lm.scale, lm.scale, lm.scale],
    });

    // Perch it on something. Landmarks used to be placed at a height with
    // nothing underneath, so a red phone box hung in clear air 26m up — which
    // reads as a bug rather than as a ruin, and undermines every other floating
    // thing in the scene that *is* deliberate. A column down to the canopy is
    // enough: the eye only needs the object to be supported, not to trace the
    // support all the way to the ground.
    const pillarH = Math.min(lm.y - 1, 10 + rand() * 8);
    if (pillarH > 3) {
      const pw = Math.max(1.1, lm.scale * 0.3);
      placements.push({
        id: SUPPORT,
        uid: nextUid(),
        pos: [round(lx), round(lm.y - pillarH / 2), round(lz)],
        rot: [0, round(rand() * Math.PI), 0],
        scale: [round(pw), round(pillarH), round(pw * 0.9)],
      });
    }
  }

  /*
   * Risk lines.
   *
   * Until now the generator kept one route cursor and the climb had no choice
   * in it: every player took the same 261 jumps in the same order, so "skill
   * expression" reduced to execution. A branch that leaves the main route,
   * climbs harder, and rejoins it higher up turns each band into a decision —
   * take the safe line, or spend a worse landing for fifteen metres.
   *
   * Branches are generated *after* the main route, so both ends are known and
   * the chain between them can be solved rather than guessed: pick the number
   * of hops from whichever of rise or distance needs more of them, then spread
   * the difference evenly. That guarantees the rejoin lands inside the envelope
   * instead of hoping the last hop happens to work.
   */
  let branchSlabs = 0;
  const branchesPlaced = [];
  for (const b of BRANCHES) {
    const from = route.find((n) => n.y >= b.from);
    const to = route.find((n) => n.y >= b.to);
    if (!from || !to || to.y - from.y < 4) continue;
    const n = emitBranch(from, to, b, rand, placements, audit, nextUid, slab, solids);
    if (n > 0) {
      branchSlabs += n;
      branchesPlaced.push({ label: b.label, slabs: n, skips: round(to.y - from.y) });
    }
  }

  const blocked = clearFlightPaths(placements, audit);
  const { shortened, demoted } = clearMoverPaths(placements, audit);

  return {
    placements: placements.filter((p) => !p.__cut),
    audit,
    top,
    dropped,
    blocked,
    shortened,
    demoted,
    branchSlabs,
    branchesPlaced,
  };
}

/**
 * Player capsule, plus a little room for error.
 *
 * The capsule is r=0.4 h=2.0. Clearing a jump by exactly a capsule width is not
 * clearing it — the controller slides along contact, so brushing an obstacle
 * mid-flight bleeds the horizontal speed the landing depended on.
 */
const CLEAR_R = PLAYER_RADIUS + 0.22;
const CLEAR_H = 1.15;

/**
 * Remove decoration that stands in a jump.
 *
 * The envelope check answers "is the landing reachable" and says nothing about
 * what is in between. A support stub, a Spine chunk or a landmark sitting in
 * the arc makes a verified jump impossible, and it fails in the worst way: the
 * player is told by the geometry that the jump is on, commits to it, and is
 * stopped in mid-air by something they read as scenery.
 *
 * Route slabs are never removed — they are the level. Everything else is
 * decoration and loses the argument.
 */
function clearFlightPaths(placements, audit) {
  const removable = placements.filter((p) => p.id !== SLAB);
  let cut = 0;

  for (const a of audit) {
    if (!a.from || !a.to) continue;
    const arc = trajectory(a.v0 ?? JUMP_VELOCITY);
    const rise = a.to[1] - a.from[1];
    const tLand = flightTime(arc, rise);
    if (tLand <= 0) continue;

    // Sample the arc. The capsule centre starts a body-height above the takeoff
    // surface and follows the trajectory; horizontal travel is linear.
    const samples = 14;
    for (let i = 1; i < samples; i++) {
      const f = i / samples;
      const t = f * tLand;
      const px = a.from[0] + (a.to[0] - a.from[0]) * f;
      const pz = a.from[2] + (a.to[2] - a.from[2]) * f;
      let v = a.v0 ?? JUMP_VELOCITY;
      let dy = 0;
      const steps = Math.max(1, Math.round(t / DT));
      for (let k = 0; k < steps; k++) {
        v -= GRAVITY * DT;
        dy += v * DT;
      }
      const py = a.from[1] + 1.0 + dy;

      for (const p of removable) {
        if (p.__cut) continue;
        const hx = Math.hypot(p.scale[0] / 2, p.scale[2] / 2);
        const dxz = Math.hypot(p.pos[0] - px, p.pos[2] - pz);
        if (dxz > hx + CLEAR_R) continue;
        const top = p.pos[1] + p.scale[1] / 2;
        const bot = p.pos[1] - p.scale[1] / 2;
        if (py + CLEAR_H < bot || py - CLEAR_H > top) continue;
        p.__cut = true;
        cut++;
      }
    }
  }
  return cut;
}

/** Shortest travel worth keeping. Below this it reads as a wobble, not a ride. */
const MIN_TRAVEL = 1.8;

/**
 * Stop a moving platform from carrying its rider into something solid.
 *
 * A mover's travel is chosen when it is placed, before the slabs and supports
 * further up the route exist, so nothing has ever checked the corridor it
 * sweeps. Three of them ended up dragging the player into a pillar — and being
 * scraped off by scenery while the platform leaves without you does not read as
 * a hazard, it reads as the game being broken. It is also the one failure the
 * player cannot answer: standing still is the correct input and it loses.
 *
 * The travel is shortened rather than the obstacle removed, because unlike a
 * decoration in a flight path the obstacle here is usually a route slab, and
 * the route outranks the platform. Travel is decoration too: the jump onto and
 * off a mover is measured from `pos`, which does not move, so a shorter ride
 * changes the texture of the level and nothing that was verified about it.
 */
function clearMoverPaths(placements, audit) {
  const still = placements.filter((p) => !p.kind && !p.__cut && p.scale);
  let shortened = 0;
  let demoted = 0;

  for (const m of placements) {
    if (m.kind !== 'moving' || !m.motion || m.__cut) continue;
    const to = m.motion.to;
    const full = Math.hypot(to[0], to[1], to[2]);
    if (full < 1e-6) continue;

    const clearAt = (f) => {
      for (let i = 0; i <= 24; i++) {
        const k = (i / 24) * f;
        const cx = m.pos[0] + to[0] * k;
        const cy = m.pos[1] + to[1] * k;
        const cz = m.pos[2] + to[2] * k;
        const feetY = cy + m.scale[1] / 2;
        for (const s of still) {
          const hi = s.pos[1] + s.scale[1] / 2;
          const lo = s.pos[1] - s.scale[1] / 2;
          // Ankle-high is a kerb you step over, not an obstacle.
          if (hi < feetY + 0.2 || lo > feetY + CLEAR_H * 2) continue;
          const reach = Math.hypot(s.scale[0] / 2, s.scale[2] / 2) + CLEAR_R;
          if (Math.hypot(s.pos[0] - cx, s.pos[2] - cz) < reach) return false;
        }
      }
      return true;
    };

    if (clearAt(1)) continue;

    // Longest ride that stays clear. Coarse on purpose — a platform whose
    // travel has to be tuned to the centimetre is one that should not travel.
    let best = 0;
    for (let f = 0.9; f >= 0.1; f -= 0.1) {
      if (clearAt(f)) { best = f; break; }
    }

    if (best * full < MIN_TRAVEL) {
      // Nothing usable sideways. Send it straight up instead, which sweeps no
      // corridor at rider height, and only if that is clear too.
      const rise = Math.max(2, Math.min(3.5, full * 0.6));
      const saved = m.motion.to;
      m.motion.to = [0, round(rise), 0];
      if (!clearAt(1)) {
        m.motion.to = saved;
        delete m.kind;
        delete m.motion;
        // The audit records what a foothold was when it was placed, and it is
        // what the move counts are printed from. Leave it saying "moving" and
        // the summary claims platforms the level no longer contains.
        const entry = audit.find((a) => a.uid === m.uid);
        if (entry) entry.kind = 'static';
        demoted++;
        continue;
      }
    } else {
      m.motion.to = [round(to[0] * best), round(to[1] * best), round(to[2] * best)];
    }
    shortened++;
  }
  return { shortened, demoted };
}

// ---------------------------------------------------------------------------

function verify(audit) {
  const problems = [];
  for (const a of audit) {
    const at = `${a.band} @${round(a.y)}m`;
    // A jump taken off a bounce pad is a different jump, with its own arc.
    const ceiling = a.launched ? LAUNCH_RISE : MAX_RISE;
    if (a.rise > ceiling + 1e-9) {
      problems.push(`${at}: rise ${round(a.rise)} exceeds reachable ${round(ceiling)}`);
    }
    if (a.reach > 0 && a.gap > a.reach * RISK + 1e-9) {
      problems.push(`${at}: gap ${round(a.gap)} exceeds ${Math.round(RISK * 100)}% of reach`);
    }
    if (a.gap < MIN_EDGE_GAP - 1e-9) {
      problems.push(`${at}: gap ${round(a.gap)} under the ${MIN_EDGE_GAP}m minimum — not a jump`);
    }
    if (a.slab < MIN_SLAB - 1e-9) {
      problems.push(`${at}: foothold ${round(a.slab)} under ${round(MIN_SLAB)}m`);
    }
  }
  return problems;
}

function main() {
  const out = resolve(process.argv[2] ?? 'public/levels/ruins.json');
  const { placements, audit, top, dropped, blocked, shortened, demoted, branchSlabs, branchesPlaced } =
    generate();
  const problems = verify(audit);

  const level = {
    // The ground is the fail state. killY sits above the static ground collider
    // rather than below it: at -20 the player simply landed on the grass and
    // walked back, so a fall cost nothing and no run was ever banked.
    // Facing the sun. render/scene.ts puts it at (0.5, 0.4, 0.32), so its
    // horizontal bearing is atan2(0.5, 0.32) — and the opening shot of a game
    // about climbing towards the light should be looking at the light.
    spawn: { pos: [SPAWN_X, BASE_Y + 2.5, 0], yaw: round(Math.atan2(0.5, 0.32)) },
    killY: round(BASE_Y * 0.6),
    placements,
  };
  writeFileSync(out, `${JSON.stringify(level, null, 1)}\n`);

  const stat = (xs) => `${round(Math.min(...xs))}..${round(Math.max(...xs))}`;
  const kinds = {};
  for (const a of audit) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;

  console.log(`[level] ${placements.length} placements, summit ${round(top)}m -> ${out}`);
  console.log(`[level] apex ${round(MAX_RISE)}m, off a bounce pad ${round(LAUNCH_RISE)}m`);
  console.log(`[level] route: ${BANDS.map((b) => b.movement).join(' -> ')}`);
  console.log(
    `[level] ${audit.length} moves — ${Object.entries(kinds)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${k}`)
      .join(', ')}`,
  );
  console.log(`[level] rise ${stat(audit.map((a) => a.rise))}m`);
  console.log(`[level] edge gap ${stat(audit.map((a) => a.gap))}m`);
  console.log(`[level] ${LANDMARKS.length} landmarks off-route, ${dropped} supports dropped as intrusive`);
  console.log(`[level] ${blocked} decorations cut for standing in a flight path`);
  console.log(
    `[level] ${shortened} mover(s) had their travel cut short of solid geometry, ` +
      `${demoted} made static outright`,
  );
  const risk = audit.filter((a) => a.kind === 'risk');
  const skipped = BRANCHES.length - branchesPlaced.length;
  console.log(
    `[level] ${branchesPlaced.length}/${BRANCHES.length} risk lines placed, ` +
      `${branchSlabs} footholds, skipping ${round(branchesPlaced.reduce((n, b) => n + b.skips, 0))}m`,
  );
  for (const b of branchesPlaced) {
    console.log(`[level]   ${b.label}: ${b.slabs} footholds, skips ${b.skips}m`);
  }
  // Named rather than merely counted: a silently dropped branch is a design
  // decision quietly reversing itself.
  if (skipped) {
    const placed = new Set(branchesPlaced.map((b) => b.label));
    console.log(
      `[level]   abandoned (would overlap the main route): ` +
        BRANCHES.filter((b) => !placed.has(b.label)).map((b) => b.label).join(', '),
    );
  }
  if (risk.length) {
    console.log(
      `[level] risk hops: rise up to ${round(Math.max(...risk.map((a) => a.rise)))}m, ` +
        `gap up to ${round(Math.max(...risk.map((a) => a.gap)))}m`,
    );
  }
  if (problems.length) {
    console.error(`[level] ${problems.length} VIOLATION(S):`);
    for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('[level] every move verified: real air, inside the envelope');
  }
}

main();
