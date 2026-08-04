#!/usr/bin/env node
/**
 * Stand on every platform that does something, and check it behaves.
 *
 *   node scripts/check-platforms.mjs public/levels/ruins.json
 *
 * The other two checks answer "can a player get up this?". Neither of them ever
 * puts a player *on* anything and waits. So the 41 movers, 24 crumbling ledges,
 * 12 bounce pads and 7 rotators shipped statically verified and never ridden,
 * and all four were broken: the ground query underneath them started inside the
 * player's own capsule, so with Rapier's solid raycast every query answered
 * "the player is standing on the player" and nothing dynamic ever fired.
 *
 * This is the ride. For each dynamic placement it builds a world containing
 * just that platform and the player capsule, stands the player on it, presses
 * nothing for 30 s, and measures how far they slide across the surface.
 *
 * Two things make this worth trusting:
 *
 * Real Rapier, not a model of it. simulate-route.mjs reimplements the
 * integrator on purpose, and that is right for a question about arithmetic. The
 * question here is what the *engine* does — the controller carries a character
 * on a kinematic body by itself, unreliably — so a reimplementation would
 * simulate a bug-free engine and prove nothing.
 *
 * The game's own carry arithmetic, imported rather than rewritten. This breaks
 * the rule the other checks follow and it is the one place the rule is wrong:
 * the check kept its own copy, the shipped formula was changed underneath it,
 * riders started falling off 23 of 39 platforms, and every check still passed.
 *
 * Real level data. The platforms are built from the emitted JSON at their own
 * scale, travel, period and phase. Platform size decides whether this fails:
 * the controller's own carry is reliable on a wide slab and fires about half
 * the time on the 1.5m ledges this level is actually made of.
 */

import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
// The game's own carry arithmetic, imported rather than reimplemented. Node
// strips the types. See the header of that file for why this one check breaks
// the project's rule about verifiers not sharing code with what they verify.
import { addOwedCarry } from '../src/game/platformCarry.ts';

const DT = 1 / 60;
const GRAVITY = -25;
/** physics/character.ts */
const RADIUS = 0.4;
const HALF_HEIGHT = 0.6;
const OFFSET = 0.01;
const FEET = HALF_HEIGHT + RADIUS;
/** How long a rider is asked to stand still. */
const SECONDS = 30;
/**
 * A rider who slides this far across a slab has left it: the smallest platform
 * in the level is 1.5m across and the capsule is 0.8m wide, so there is only
 * about 0.35m of surface either side of centre to begin with.
 */
const SLIDE_LIMIT = 0.35;
/**
 * Motion across the surface in a single step, for a rider pressing nothing.
 * 5mm at 60Hz is 0.3m/s of apparent slip — visible, and about six times the
 * worst any platform in the level actually produces once it is behaving.
 */
const JUDDER_LIMIT = 0.005;
/**
 * Steps to ignore before judging the ride. The rider is put down onto a slab
 * that is already moving and takes a step or two to register as standing on
 * it, so the first fraction of a second is a landing, not a ride.
 */
const SETTLE = Math.round(0.5 / DT);

const file = process.argv[2] ?? 'public/levels/ruins.json';
const level = JSON.parse(readFileSync(file, 'utf8'));

await RAPIER.init();

/**
 * Run one rider on one platform.
 *
 * Mirrors the fixed step in main.ts: platforms move, we ask what the platform
 * under the feet travelled, the controller resolves that together with the
 * player's own movement, and addOwedCarry tops up whatever the engine did not
 * already do. Only the ordering and the measurement are this file's own.
 */
function ride(p) {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });

  const [sx, sy, sz] = p.scale;
  const yaw = p.rot?.[1] ?? 0;
  const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  const base = { x: p.pos[0], y: p.pos[1], z: p.pos[2] };

  // Where the platform actually is at t=0. A mover with a non-zero phase does
  // not start at its base position, and a rider stood at the base would simply
  // be standing next to it in mid-air.
  const start = { ...base };
  if (p.kind === 'moving' && p.motion) {
    const { to, phase = 0 } = p.motion;
    const k = (1 - Math.cos(phase * Math.PI * 2)) * 0.5;
    start.x += to[0] * k;
    start.y += to[1] * k;
    start.z += to[2] * k;
  }

  const pBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(start.x, start.y, start.z)
      .setRotation(q),
  );
  const pCol = world.createCollider(
    RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2),
    pBody,
  );

  // A rider stood on a rotator's axis is not being tested by it: the surface
  // turns under them but nothing about their position changes. Put them out
  // towards the edge, where the rotation actually has to carry them, but inside
  // the capsule's own footprint so they start fully supported.
  let offX = 0;
  let offZ = 0;
  if (p.kind === 'rotating') {
    const reach = Math.max(0, Math.min(sx, sz) / 2 - RADIUS) * 0.6;
    offX = reach * Math.cos(yaw);
    offZ = -reach * Math.sin(yaw);
  }

  const top = start.y + sy / 2;
  const cBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(start.x + offX, top + FEET, start.z + offZ),
  );
  const cCol = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), cBody);
  const ctrl = world.createCharacterController(OFFSET);
  ctrl.enableAutostep(0.5, 0.2, true);
  ctrl.enableSnapToGround(0.5);
  ctrl.setApplyImpulsesToDynamicBodies(false);
  ctrl.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
  ctrl.setSlideEnabled(true);
  ctrl.setUp({ x: 0, y: 1, z: 0 });
  world.step();

  // The drop-off point in the platform's own frame, so drift is measured
  // against where the rider was put rather than against the axis.
  const startLocal = {
    x: offX * Math.cos(-yaw) + offZ * Math.sin(-yaw),
    z: -offX * Math.sin(-yaw) + offZ * Math.cos(-yaw),
  };

  let clock = 0;
  let vy = 0;
  let grounded = false;
  let prev = { ...start };
  let prevAngle = yaw;
  let fuse = p.fuse ?? 0;
  const result = {
    slide: 0, judder: 0, prevRel: null,
    launched: false, crumbled: null, fell: null, contact: 0,
  };

  for (let i = 0; i < Math.round(SECONDS / DT); i++) {
    clock += DT;

    // --- 1. the platform moves ---
    let delta = { x: 0, y: 0, z: 0 };
    let spun = 0;
    if (p.kind === 'moving' && p.motion) {
      const { to, period, phase = 0 } = p.motion;
      const t = (clock / Math.max(period, 0.1) + phase) * Math.PI * 2;
      const k = (1 - Math.cos(t)) * 0.5;
      const next = { x: base.x + to[0] * k, y: base.y + to[1] * k, z: base.z + to[2] * k };
      pBody.setNextKinematicTranslation(next);
      delta = { x: next.x - prev.x, y: next.y - prev.y, z: next.z - prev.z };
      prev = next;
    } else if (p.kind === 'rotating') {
      const a = yaw + clock * (p.spin ?? 0.6);
      pBody.setNextKinematicRotation({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
      spun = a - prevAngle;
      prevAngle = a;
    }

    // --- 2. what is under the feet, and what did it travel? ---
    const c0 = cBody.translation();
    const feet = { x: c0.x, y: c0.y - FEET, z: c0.z };
    const ray = new RAPIER.Ray({ x: feet.x, y: feet.y + 0.25, z: feet.z }, { x: 0, y: -1, z: 0 });
    // The exclusion is the whole point: without it this ray hits the capsule it
    // starts inside and reports the player standing on themselves.
    const hit = world.castRay(ray, 0.75, true, undefined, undefined, cCol);
    const onPad = !!hit && hit.collider.handle === pCol.handle;
    if (onPad) result.contact++;

    let carry = { x: 0, y: 0, z: 0 };
    if (onPad) {
      if (p.kind === 'moving') {
        carry = delta;
      } else if (p.kind === 'rotating' && spun !== 0) {
        const dx = feet.x - base.x;
        const dz = feet.z - base.z;
        const cs = Math.cos(spun);
        const sn = Math.sin(spun);
        carry = { x: dx * cs + dz * sn - dx, y: 0, z: -dx * sn + dz * cs - dz };
      } else if (p.kind === 'bounce') {
        if (grounded && vy <= 0.01) {
          result.launched = true;
          vy = p.launch ?? 15;
        }
      } else if (p.kind === 'crumbling' && result.crumbled === null) {
        fuse -= DT;
        if (fuse <= 0) {
          result.crumbled = +(clock).toFixed(2);
          world.removeCollider(pCol, false);
        }
      }
    }

    // --- 3. the player's own movement, plus whatever the carry still owes ---
    if (grounded && vy < 0) vy = 0;
    vy += GRAVITY * DT;
    const desired = { x: 0, y: vy * DT, z: 0 };
    ctrl.computeColliderMovement(cCol, desired);
    const m = ctrl.computedMovement();
    const groundedNow = ctrl.computedGrounded();
    const applied = addOwedCarry(desired, m, carry, { x: 0, y: 0, z: 0 });

    const t = cBody.translation();
    cBody.setNextKinematicTranslation({
      x: t.x + applied.x,
      y: t.y + applied.y,
      z: t.z + applied.z,
    });
    grounded = groundedNow;
    world.step();

    // --- 4. how far has the rider slid across the platform's own surface? ---
    const cur = cBody.translation();
    const pt = pBody.translation();
    let slide;
    if (p.kind === 'rotating') {
      // Un-turn the rider back into the platform's own frame and see how far
      // they have wandered from the spot they were put down on.
      const a = -(yaw + clock * (p.spin ?? 0.6));
      const dx = cur.x - start.x, dz = cur.z - start.z;
      const lx = dx * Math.cos(a) + dz * Math.sin(a);
      const lz = -dx * Math.sin(a) + dz * Math.cos(a);
      slide = Math.hypot(lx - startLocal.x, lz - startLocal.z);
    } else {
      slide = Math.hypot(cur.x - pt.x, cur.z - pt.z);
    }
    // A crumbling ledge is supposed to drop the rider once its fuse blows.
    if (result.crumbled !== null) break;
    // A bounce pad throws the rider into the air; sliding is only meaningful
    // while they are on it.
    if (p.kind !== 'bounce') result.slide = Math.max(result.slide, slide);

    // Worst drift says whether the rider falls off. It says nothing about what
    // the ride looks like, and a rider who ends up where they started having
    // twitched the whole way is not a rider who stood still. Measure the motion
    // across the surface *per step*: for someone pressing nothing it is zero.
    if (p.kind !== 'bounce' && i > SETTLE) {
      if (result.prevRel !== null) {
        result.judder = Math.max(result.judder, Math.abs(slide - result.prevRel));
      }
      result.prevRel = slide;
    }
    // Against the platform's *current* top face, not where it started: a
    // vertical mover legitimately carries the rider five metres down, and
    // measuring from the starting height calls that falling off.
    if (cur.y - FEET < pt.y + sy / 2 - 1.0) {
      result.fell = +(clock).toFixed(2);
      break;
    }
  }
  return result;
}

/* ------------------------------------------------------------------------ *
 * Is anything standing in the way of the ride?
 *
 * A rider carried into a pillar is pressed against it and scraped off while the
 * platform leaves without them, which reads as the level being broken rather
 * than as a hazard. The generator already refuses to leave a decoration in a
 * *jump's* flight path; a moving platform sweeps a corridor too, and nothing
 * was checking it.
 * ------------------------------------------------------------------------ */

const corners = (cx, cz, hx, hz, a) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([x, z]) => [
    cx + x * c + z * s,
    cz - x * s + z * c,
  ]);
};

/** Separating-axis test on two yaw-rotated footprints. */
function overlaps(a, b) {
  for (const r of [a, b]) {
    const c = Math.cos(r.a);
    const s = Math.sin(r.a);
    for (const [ax, az] of [[c, -s], [s, c]]) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, z] of corners(a.cx, a.cz, a.hx, a.hz, a.a)) {
        const d = x * ax + z * az;
        a0 = Math.min(a0, d); a1 = Math.max(a1, d);
      }
      for (const [x, z] of corners(b.cx, b.cz, b.hx, b.hz, b.a)) {
        const d = x * ax + z * az;
        b0 = Math.min(b0, d); b1 = Math.max(b1, d);
      }
      if (a1 < b0 || b1 < a0) return false;
    }
  }
  return true;
}

/** How far up an obstacle stands in the rider's body, along a mover's travel. */
function obstruction(m, others) {
  const to = m.motion?.to ?? [0, 0, 0];
  const worst = { height: 0, uid: null, at: 0 };
  for (let i = 0; i <= 32; i++) {
    const k = i / 32;
    const cx = m.pos[0] + to[0] * k;
    const cy = m.pos[1] + to[1] * k;
    const cz = m.pos[2] + to[2] * k;
    // The rider's own footprint, standing on the slab at this point of travel.
    const rider = { cx, cz, hx: RADIUS, hz: RADIUS, a: 0 };
    const feetY = cy + m.scale[1] / 2;
    for (const s of others) {
      const lo = s.pos[1] - s.scale[1] / 2;
      const hi = s.pos[1] + s.scale[1] / 2;
      // Anything below ankle height is a kerb, not an obstacle.
      if (hi < feetY + 0.2 || lo > feetY + HALF_HEIGHT * 2 + RADIUS * 2) continue;
      const box = { cx: s.pos[0], cz: s.pos[2], hx: s.scale[0] / 2, hz: s.scale[2] / 2, a: s.rot?.[1] ?? 0 };
      if (!overlaps(rider, box)) continue;
      const height = hi - feetY;
      if (height > worst.height) { worst.height = height; worst.uid = s.uid; worst.at = k; }
    }
  }
  return worst;
}

const dynamic = level.placements.filter((p) => p.kind);
const byKind = new Map();
const failures = [];

const blockers = [];
const still = level.placements.filter((p) => !p.kind && p.scale);
for (const m of dynamic.filter((p) => p.kind === 'moving' && p.motion)) {
  const o = obstruction(m, still);
  if (o.uid) blockers.push({ mover: m.uid, ...o, top: m.pos[1] + m.scale[1] / 2 });
}

for (const p of dynamic) {
  const r = ride(p);
  const bucket = byKind.get(p.kind) ?? { n: 0, worst: 0, judder: 0, fired: 0, fell: 0 };
  bucket.n++;
  bucket.worst = Math.max(bucket.worst, r.slide);
  bucket.judder = Math.max(bucket.judder, r.judder);
  byKind.set(p.kind, bucket);

  const where = `${p.kind} ${p.uid} @${(p.pos[1] + p.scale[1] / 2).toFixed(1)}m ` +
    `(${p.scale[0].toFixed(2)}x${p.scale[2].toFixed(2)}m)`;

  if (r.contact === 0) {
    failures.push(`${where}: the rider never registered as standing on it`);
    bucket.fell++;
    continue;
  }
  if (p.kind === 'moving' || p.kind === 'rotating') {
    if (r.fell !== null) {
      failures.push(`${where}: rider slid off after ${r.fell}s`);
      bucket.fell++;
    } else if (r.slide > SLIDE_LIMIT) {
      failures.push(`${where}: rider slid ${r.slide.toFixed(2)}m across it (limit ${SLIDE_LIMIT}m)`);
      bucket.fell++;
    } else if (r.judder > JUDDER_LIMIT) {
      failures.push(
        `${where}: rider judders ${(r.judder * 1000).toFixed(0)}mm in a single step ` +
          `(limit ${(JUDDER_LIMIT * 1000).toFixed(0)}mm) — they are not standing still, they are being shaken`,
      );
      bucket.fell++;
    } else {
      bucket.fired++;
    }
  } else if (p.kind === 'bounce') {
    if (!r.launched) failures.push(`${where}: never launched the rider`);
    else bucket.fired++;
  } else if (p.kind === 'crumbling') {
    if (r.crumbled === null) {
      failures.push(`${where}: fuse never blew (fuse ${p.fuse}s, stood on it for ${SECONDS}s)`);
    } else bucket.fired++;
  }
}

console.log(`[platforms] ${file}`);
console.log(`[platforms] ${dynamic.length} dynamic placements ridden for ${SECONDS}s each`);
for (const [kind, b] of [...byKind].sort()) {
  const detail = kind === 'moving' || kind === 'rotating'
    ? `worst slide ${b.worst.toFixed(3)}m, worst judder ${(b.judder * 1000).toFixed(1)}mm/step`
    : 'fired';
  console.log(`[platforms]   ${String(b.fired).padStart(3)}/${String(b.n).padEnd(3)} ${kind.padEnd(10)} ${detail}`);
}
if (blockers.length) {
  console.log(`[platforms] ${blockers.length} mover(s) carry the rider into static geometry:`);
  for (const b of blockers.sort((x, y) => y.height - x.height)) {
    console.log(
      `[platforms]   ${b.mover} @${b.top.toFixed(1)}m meets ${b.uid} ` +
        `${b.height.toFixed(2)}m up, ${Math.round(b.at * 100)}% along its travel`,
    );
    failures.push(
      `moving ${b.mover} @${b.top.toFixed(1)}m: carries the rider into ${b.uid}, ` +
        `which stands ${b.height.toFixed(2)}m above the slab`,
    );
  }
}

if (failures.length) {
  console.error(`[platforms] FAIL: ${failures.length} placement(s)`);
  for (const line of failures.slice(0, 20)) console.error(`  - ${line}`);
  if (failures.length > 20) console.error(`  ... and ${failures.length - 20} more`);
  process.exitCode = 1;
} else {
  console.log('[platforms] PASS: every rider stayed put, every pad fired, every fuse blew');
}
