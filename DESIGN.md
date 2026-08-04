# JumpGame V2 — Design

Overgrown ruins. A city the jungle took back, climbed from the flooded street
level to open sky.

## Design brief

| | |
|---|---|
| **Player promise** | You climb a city the jungle swallowed. Every ruin is a foothold, and the only way to see the sky again is up. |
| **Target feeling** | Quiet, exposed, precise. Long calm stretches punctuated by moments of commitment. Nature-documentary stillness, not action-game noise. |
| **Primary verb** | **Jump** — specifically: *read a surface, commit, land.* |
| **Secondary verbs** | Sprint, traverse (slopes), controlled drop. |
| **Core loop (5–30 s)** | Read the next two or three footholds, commit to a jump chain, land, gain height. |
| **Progression loop (1–5 min)** | Cross a height band into a new ruin archetype with a new movement demand and a visibly different light. |
| **Fail/retry loop** | Touching street level ends the run and restarts at spawn. No checkpoints. |
| **Scoring** | Peak height in metres. Best run persisted. |
| **Skill expression** | Route choice. Better players take the risk lines, carry sprint speed into gaps, and use jump-cut for short hops instead of overshooting. |
| **Readability promise** | Every landable surface is separated from its background by *value* contrast, never by colour alone. Foliage never covers a landing zone. |
| **Non-goals** | Enemies, combat, collectibles, timers, checkpoints. |

### On the harshness

Falling from 150 m costs the whole run. That is deliberate and it is the
identity of the game — "Get as high as you can. Don't fall." The genre's
tension comes entirely from having something to lose. The design keeps it, and
compensates by making failure *legible*: you should always know which jump
killed you and why.

**This did not actually work before S1.** `killY` sat at −20, beneath a solid
200-unit ground collider that the whole tower stands on top of, so a fall landed
you on the grass and you walked back — costing nothing. The codebase had already
noticed the symptom from the other end (`main.ts`: runs were only ever banked
when someone closed the tab). The ground is now the fail state: `killY` sits
above the ground plane and below the spawn terrace, so touching street level
ends the run. The game's stated identity is only now something the artifact
actually does.

## Core loop contract

```
Player JUMPS between ruin footholds to gain HEIGHT while a single mistake
costs the entire run; success gives a higher peak and a new band of the
world, failure returns them to spawn with nothing but what they learned.
```

## Measured envelope

Everything below is derived from the shipped constants, not estimated.
`JUMP_VELOCITY = 9`, `GRAVITY = −25`, `RUN_SPEED = 9`, `WALK_SPEED = 5`,
autostep `0.5`, max slope `45°`, capsule r`0.4` h`2.0`.

The numbers that matter are **simulated, not solved.** The closed forms describe
continuous motion; the game steps at a fixed 1/60 s and applies gravity *before*
the position update (semi-implicit Euler), which under-integrates a decelerating
arc. Ignoring that overstates the envelope by up to 10% — and the error is worst
exactly where it is most dangerous, near the ceiling.

| Quantity | Closed form | **Actual at 1/60 s** |
|---|---|---|
| Max jump height | 1.62 m | **1.546 m** |
| Jump-cut height | 0.32 m | 0.288 m |
| Airtime, flat | 0.72 s | 0.717 s |
| Max gap, flat, running | 6.48 m | 6.45 m |
| Max gap, rising 1.0 m | 5.24 m | 5.10 m |
| Max gap, rising 1.5 m | 4.12 m | **3.75 m** |
| Free step-up (no jump) | — | 0.50 m |

A ledge placed at 1.60 m "by the formula" is **unreachable**. The generator
derives its trajectory by running the same integrator the game runs.

Two further costs the formula hides:

- **Speed is earned, not given.** Horizontal velocity damps exponentially
  towards the target, so reaching 95% of run speed takes ~2.8 m of run-up. Off a
  1.5 m foothold you get ~7.7 m/s, not 9 — about 14% less reach.
- **The player's own body is not free.** Reach measures how far the capsule
  *centre* travels, and it starts a radius short of the takeoff edge and must
  end a radius past the landing edge. A whole 0.8 m diameter of the flight buys
  no gap at all.

**Design rule: comfortable = 70% of maximum.** Comfortable rise ≤ 1.1 m,
comfortable running gap ≤ 4.5 m. Anything above 90% of max is a *risk line*
and must be optional.

**The consequence that shapes everything:** at 1.1 m per jump, a 160 m climb is
~145 consecutive jumps. Pure jumping would be exhausting and monotonous. So
**slopes carry the height, jumps carry the tension.** Ramps are the recovery
beat; gauntlets are the pressure.

## Level plan

**Spatial format: tower path — a spiral wrapping a central ruin core.**

The spiral is chosen for four concrete reasons:

1. The next section is always above and slightly ahead, so it stays in frame in
   a third-person follow camera.
2. Passing the same core from different sides gives continuous orientation —
   you can read your progress off the landmark rather than off the HUD.
3. It concentrates geometry near a single axis, which keeps the shadow frustum
   and draw distance tight — cheap for S5/S11.

An earlier draft claimed a fourth reason: that lower spiral arms would catch a
fall and soften the loss. Measured, the helix pitch is ~46 m of rise per turn,
so a fall passes two or three arms each presenting a few m² of catch area over a
several-hundred-m² annulus. The catch probability is negligible. The reason was
removed rather than kept as flavour — **falls are total, and the design should
say so.**

**Camera contract:** third-person follow. The camera may not see the summit from
the floor, and must always show at least the next two footholds when the player
is standing still.

### Bands

| Band | Height | Archetype | Movement demand | Light |
|---|---|---|---|---|
| **The Floor** | 0–15 m | Flooded street level, wide collapsed slabs | Safe learning space. Teaches walk, sprint, the 1.6 m ceiling, autostep | Dim, green, enclosed |
| **The Undergrowth** | 15–45 m | Containers, small buildings, dense growth | Tight gaps ≤ 3.5 m, enclosed sightlines | Dappled, heavy occlusion |
| **The Canopy** | 45–90 m | Tilted slabs over open air | First committing jumps, 4–4.5 m | Signature band — god rays, breaking light |
| **The Spires** | 90–140 m | Thin building fragments, exposed ledges | Narrow footholds, ≤ 1.5 m rises | Bright, thinning haze |
| **Above the Trees** | 140 m+ | Open sky, the summit | Sparse, wide, calm | Full sun, no canopy |

### Beats

- **Player start:** a wide slab standing proud of the street, nothing to fall
  off.
- **First reward:** clearing the Floor band, where you can see how far up the
  Spine actually goes.
- **First threat:** the first gap over a genuine drop at ~20 m — survivable
  height, real consequence.
- **Landmark:** *the Spine* — one massive leaning structure running the full
  height, visible from every band, that the spiral wraps.
- **Recovery beats:** a wide terrace (≥ 6 m landable square, no gaps) at the top
  of every band. Breathe, re-orient, see the next band's light.
- **Escalation, per band** (as actually generated, not as hoped): edge gap
  0.8 m → 4.3 m; foothold 7.5 m → 1.5 m; rise 0.30 m → 1.05 m. Rises above
  ~1.05 m are structurally unreachable given the comfort budget, and footholds
  are floored at 1.5 m because the player is 0.8 m wide.

### Risk lines

**Built.** Three of five specified branches place; the other two are abandoned
because they would overlap the main route, and the generator names them rather
than dropping them quietly.

| Line | Footholds | Skips |
|---|---|---|
| Floor shortcut | 10 | 13.8 m |
| Undergrowth line | 16 | 21.2 m |
| Spire line | 21 | 27.7 m |

A branch leaves a static main-route foothold, climbs at up to **90%** of the
envelope where the main route runs at 70%, and rejoins higher. That is the
trade: worse landings for skipped metres.

Each is a **circular arc of prescribed length**. A straight line between the two
ends cannot hold the hops — a 21 m climb needs 17 of them, and spreading 10 m of
ground over 17 gives 0.6 m steps, which after subtracting the slab width is a
*negative* gap. An arc with a given chord and a given length has exactly one
solution, so spacing and both endpoints are solved rather than approximated.
Hops are spaced on a per-hop schedule rather than evenly: the first and last
leave and land on full-width main-route slabs and need more room than the ones
between.

A branch is committed **whole or not at all** — a partial branch is a route that
leads nowhere. Forking off or rejoining a *crumbling* ledge is excluded, because
the choice would disappear while the player was still reading it.

### Not built yet

- **Two visibly different routes at the spawn slab.** The Floor shortcut is a
  branch off the early climb, not a fork at the start line, so the first real
  decision arrives a few jumps in rather than immediately.

### Failure readability

- Foliage never occludes a landable top face and never overhangs a landing zone.
- Edge wear and moss accumulate on *upward* faces and *edges* (S6), so the
  affordance "you can stand here" is carried by the material itself.
- A surface you cannot stand on never gets the edge treatment.

## Difficulty and pacing

One new concept at a time: the Floor teaches the jump ceiling; the Undergrowth
combines it with narrow footholds; the Canopy adds real height consequence; the
Spires combine all three. Escalation is by *combination and precision*, never by
"more props".

## Implementation approach

The level is **generated, not hand-placed.** A 160 m spiral is ~145 footholds;
authoring that by hand produces a level nobody can retune when S2 changes the
jump constants by 10%.

`scripts/generate-level.mjs` emits the level JSON from a band spec. When S2
retunes the jump, the level is regenerated rather than rebuilt.

The structural layer is **authored boxes, not library props.** Measuring all 299
assets settled that: only 34 have a metre-wide plateau, and those are almost all
4 cm road decals; filtering for real mass leaves 16, all crates and barrels. The
library has no architectural ruin pieces. Boxes also get an exactly-matching
cuboid collider, so what you see is what you stand on. Art arrives in S3–S6;
the library props are dressing, which is what they are good at.

**`scripts/simulate-route.mjs` plays it.** Not a browser bot — that approach was
tried and was not trustworthy, because the tab drops to `hidden`,
`requestAnimationFrame` stops, and the run silently stalls. A test that can
quietly do nothing is worse than no test. Instead it reimplements the part of
the player that decides whether a jump lands — semi-implicit Euler at 1/60s,
exponential damping, jump-cut — and asks the only question that matters: *can a
player get up this?*

It searches the **control space** rather than testing one policy. A first
version always sprinted and always held the jump to full height, and reported
157 of 305 jumps as failures — every one of them *overshot*. That is not a level
that cannot be climbed, it is a test that refuses to let go of the button. A
jump is playable if some input the player can actually give lands it.

Current result: **305 of 305 jumps land**. Median jump works on 56% of the 48
tested inputs; none require one or two specific inputs; seven land on six or
fewer, which is the hard end of the difficulty curve and is meant to be there.

**`scripts/check-platforms.mjs` rides the platforms that do something.** The two
checks above both answer "can a player get up this?", and neither ever puts a
player *on* anything and waits — so the 41 movers, 24 crumbling ledges, 12
bounce pads and 7 rotators shipped statically verified and never ridden, and all
four kinds turned out to be inert. It stands a rider on each of the 84, presses
nothing for 30s, and measures how far they slide across the surface.

It also audits the corridor a mover sweeps. Travel is chosen when the platform
is placed, before the route above it exists, so three movers dragged the rider
into a pillar — the one failure a player cannot answer, since standing still is
the correct input and it still loses. The generator now shortens that travel
until the corridor is clear, and drops the platform to static if nothing usable
remains.

This one uses real Rapier rather than reimplementing it, which is the opposite
of the rule the other checks follow. The rule is right when the question is
arithmetic; here the question is what the engine does with a rider on a moving
kinematic body, and a reimplementation would model a well-behaved engine and
prove nothing. Platform *size* decides the answer: the engine's own carry is
reliable on a wide slab and fires about half the time on the 1.5m ledges this
level is actually built from.

**`scripts/check-level.mjs` audits the geometry and shares no code with the
generator.** This is not belt-and-braces. The first generator verified its own
arithmetic with its own arithmetic and printed *"every jump verified inside the
envelope"* over a 176 m staircase — it had computed the gap as an edge distance
and spent it as a centre-to-centre step, so 140 of 236 footholds overlapped, and
a `Math.max(0, …)` in the audit erased the evidence. The checker re-derives
everything from the emitted JSON: separating-axis tests on the true rotated
footprints, its own trajectory integration, and lower bounds as well as upper
ones.

## Fun-factor rejection tests

Two of these were once marked "Pass" citing features that had never been
written. A design doc used as evidence that the design works has to be held to
the artifact, so they were failed until the code existed. Both now pass on the
code, not on the claim.

| Test | Status |
|---|---|
| First 30 s lack a real decision | **Partial** — three risk lines exist, but the earliest forks a few jumps in rather than at the spawn slab |
| Main mechanic can be ignored | **Pass** — all 311 moves clear real air, verified independently |
| Objective unclear without instructions | **Pass** — "up" is self-evident; height is on the HUD |
| Failure happens before it can be understood | **Pass** — the spawn terrace has nothing to fall off |
| Challenge is only "more things" | **Pass** — escalation is gap and precision, not density |
| Rewards don't change strategy | **Pass** — risk lines trade landing quality for 62.7 m of skipped climb |
| Space is decorative, doesn't shape decisions | **Pass** — six route shapes, and the branches make the space a choice |
| Fun only in explanation, not in play | **Climbable, not yet proven fun** — all 305 jumps land in simulation; whether it is *enjoyable* is not something a simulation can answer |
