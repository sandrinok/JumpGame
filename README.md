# JumpGame

A third-person 3D platformer — climb as high as you can without falling — with a
built-in level editor. Three.js for rendering, Rapier for physics, TypeScript
throughout.

For putting it on a server, see [DEPLOY.md](DEPLOY.md).

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

## Playing

WASD to move, Shift to sprint, Space to jump — held longer for a higher jump,
with coyote time and jump buffering so near-misses still feel fair. Click the
canvas after pressing Play to capture the mouse. F3 toggles an FPS overlay.
Your best height is kept in `localStorage`.

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
  game/       player movement, character rig + animation state machine
  world/      asset registry, level format, instantiation
  editor/     editor controller + React UI
  persistence/ level files, score
  ui/         start screen, HUD
server/       production server: static files + authenticated editor API
scripts/      asset optimization pipeline, password setup
```

Two ideas are worth knowing before changing things:

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

## Levels

A level is JSON: a spawn, a kill height, and a list of placements referencing
asset ids from `public/assets/manifest.json`. `public/levels/dev.json` is the
one loaded at startup.

Saving from the editor writes back to where the level came from — through the
Vite middleware in dev, through the authenticated API in production.
