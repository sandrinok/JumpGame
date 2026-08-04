# JumpGame V2

A third-person 3D platformer — climb a flooded, overgrown ruin as high as you
can without touching the water — with a built-in level editor. Three.js for
rendering, Rapier for physics, TypeScript throughout.

> **New here? Read [HANDOVER.md](HANDOVER.md) first.** It covers what V2 is, the
> commands, the architecture, the decisions that took several attempts, and
> everything still open. This file documents the parts inherited from V1, all of
> which still hold.

The level is **generated, not hand-placed** — see [DESIGN.md](DESIGN.md) — and
`npm run level` generates it, audits the geometry with an independent checker,
and then plays every jump with the real physics integrator.

For putting it on a server, see [DEPLOY.md](DEPLOY.md). For adding 3D models,
see [ASSETS.md](ASSETS.md).

## Running it

```sh
npm install
npm run dev          # http://localhost:5173
```

Requires Node >= 20.12.

| | |
|---|---|
| `npm run dev` | Vite dev server, editor unlocked |
| `npm run build` | typecheck + production build into `dist/` |
| `npm run serve` | run the production server against `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run optimize-assets` | rebuild `public/assets/3d/` from `3dassets/` |
| `npm run optimize-character` | rebuild the player rig from `3dassets/character/` |
| `npm run set-editor-password` | set the editor password (writes `.env`) |
| `npm run level` | generate the level, audit it, and play every jump |
| `npm run gen:foliage` etc. | regenerate assets with fal.ai — see HANDOVER.md |

## Playing

WASD to move, Shift to sprint, Space to jump — held longer for a higher jump,
with coyote time and jump buffering so near-misses still feel fair. Click the
canvas after pressing Play to capture the mouse. F3 toggles an FPS overlay.
Your best height is kept in `localStorage`.

Falling into the water at street level ends the run. There are no checkpoints —
that is the whole tension, and the water exists so the rule is visible rather
than something you learn by dying to it.

On the dev server only: **PageUp/PageDown** move you ±15 m through the climb
(Shift for ±45 m) and **Home** returns to the bottom, so a jump at 140 m can be
inspected without climbing to it.

## The editor

**F2** opens it. On the dev server it opens straight away; in production it asks
for a password first (see DEPLOY.md).

Right mouse drag to fly, WASD/QE while held, scroll to change fly speed. Click
to select, G/R/S for the translate/rotate/scale gizmo, Ctrl+Z / Ctrl+Y for
undo/redo, Ctrl+S to save, Delete to remove. Numpad 1/3/7 snap to axis views,
Numpad 5 toggles orthographic. C cycles the collider debug view. The Hotkeys
panel in the editor lists the rest.

Drag a `.glb` onto the canvas to import it for the session.

## How it fits together

```
src/
  core/       fixed-timestep loop, input
  physics/    Rapier world, kinematic character controller, collider debug view
  render/     renderer, scene + shadows, follow camera
              ruinMaterial  triplanar concrete + moss on the structure
              brokenSlab    12 procedural broken-slab silhouettes
              godRays       screen-space light shafts
              water         the flooded street level
              particles     motes, dust, splash
  game/       player movement, character rig + animation state machine
              feel          speed-driven field of view
  world/      asset registry, level format, instantiation
              dynamics      moving / crumbling / bounce / rotating platforms
              vegetation    ~6,000 instanced plants, canopy, vines, debris
  editor/     editor controller + React UI
  persistence/ level files, score
  ui/         start screen, climb-gauge HUD
server/       production server: static files + authenticated editor API
scripts/      level generation + audit + simulation, asset generation (fal.ai),
              asset optimization pipeline, password setup
```

Three ideas are worth knowing before changing things:

**Simulation and presentation are separate.** `core/loop.ts` steps the
simulation at a fixed 60Hz and renders once per animation frame, handing the
render step an `alpha` between the last two steps. Gameplay decisions belong in
the update callback so they behave identically on any refresh rate; anything the
eye follows — camera, character, animation — is interpolated in the render
callback. Put camera work in the fixed step and it stutters on a 144Hz display.

**Assets are compiled, not committed raw.** `3dassets/` holds the raw downloads
and is gitignored; `scripts/optimize-*.mjs` turn them into the WebP +
meshopt-compressed files in `public/assets/`, which *are* committed. The build
runs the optimizer automatically and skips anything already up to date. If you
have no `3dassets/` checkout, that step prints "nothing to do" — which is
correct, since the optimized output is what the game loads.

**The level is generated, and never trusted.** `scripts/generate-level.mjs`
emits it from the jump envelope and a band spec, then three independent stages
check the result: `check-level.mjs` re-derives the geometry from the emitted
JSON, `simulate-route.mjs` plays every jump with the same integrator the game
uses, and `check-platforms.mjs` stands a rider on each of the 84 platforms that
move, crumble, bounce or spin. None of the four shares code with the others,
which is the point — the first version of the generator verified its own
arithmetic with its own arithmetic and cheerfully printed "every jump verified"
over a level that was a staircase. Run all four with `npm run level`.

The platform check is the odd one out in using *real* Rapier rather than a
reimplementation. That is deliberate: the question it answers is what the
physics engine does with a rider on a kinematic body, and a model of the engine
would only ever simulate a well-behaved one.

## Levels

A level is JSON: a spawn, a kill height, and a list of placements referencing
asset ids from `public/assets/manifest.json`. `public/levels/ruins.json` is the
one loaded at startup, and it is generated — edit
`scripts/generate-level.mjs` and re-run `npm run level` rather than editing the
JSON, or the next generation discards the change.

Placements may carry behaviour: `kind` of `moving` (with a `motion`),
`crumbling` (with a `fuse`), `bounce` (with a `launch`) or `rotating` (with a
`spin`). Omitted means static, so levels authored before this still load
unchanged. `world/dynamics.ts` drives them.

Saving from the editor writes back to where the level came from — through the
Vite middleware in dev, through the authenticated API in production.

`node scripts/measure-platforms.mjs out.json` measures every asset in the
manifest for use as a platform: the height of its top surface, and the size of
the largest square up there. Colliders are trimeshes, so "can I land on this,
and where" is a question about the model's triangles rather than its bounding
box — the box around a street lamp is four metres tall and standing on it means
balancing on the bulb. Placing props by those numbers, rather than by their
pivots, is what makes a jump land where it was meant to.

The **Levels** panel lists what the server has (`GET /api/levels`: `public/levels`
in dev, `LEVELS_DIR` plus the copy inside the build in production). Picking one
replaces everything — placements, physics bodies, selection, undo history — so
exactly one level is loaded at any time; there is no merging or layering. It
warns first if the current level has unsaved changes. "Save as new level" writes
the level under a new name and points subsequent saves at it, which is how a
level opened from disk gets into the server's library.
