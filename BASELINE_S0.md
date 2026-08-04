# S0 — Baseline & measurement harness

Captured 2026-08-03, dev server `http://localhost:5173/`, spawn point, desktop.

## Environment

Node 24.18.0, npm 11.16.0, Vite 5.4.21, Chrome. Display 3840×2160 @ DPR 1.25.
Viewport 1534×1592 (see *Known limitations*).

## Three.js upgrade — 0.169.0 → 0.185.1 (kept)

Done at S0 deliberately: every graphics system S3–S8 would otherwise be written
against an API we were about to replace.

| Check | Result |
|---|---|
| `tsc --noEmit` | **clean, exit 0**, no changes to any of the 62 source files |
| `GradedOutputPass` anchor tripwire | **did not fire** — three's `OutputShader` still contains the injection anchor |
| Runtime | start screen, character rig, garment + print system, level load, physics, post chain all working |
| Console errors | none |
| Draw calls | 73 → 75 (different camera frame, not a regression) |

### Regression 1 — soft shadows lost

three 0.185 deprecated `PCFSoftShadowMap` and silently
falls back to `PCFShadowMap`.

```
THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.
```

`renderer.shadowMap.type` now reports `1` (PCF) where it reported `2` (PCFSoft).
Soft shadow edges are lost. **Owned by S5 (Lighting & atmosphere)** — dappled
canopy light needs a deliberate soft-shadow strategy anyway (`shadow.radius`,
VSM, or a contact-shadow pass), so this folds into work already planned rather
than needing a separate fix.

### Regression 2 — the sky bloomed wholesale (fixed)

Reported by the user as "the bloom is waaaaay too high". Confirmed: a white band
bled across the entire horizon and the whole frame read washed out and
desaturated. Setting `strength = 0` restored clean, saturated colour, which
isolated bloom as the cause of essentially all of it.

Root cause is a knife-edge constant rather than a large behavioural change.
`BLOOM_THRESHOLD` was `4.0`, tuned on 0.169 to sit *just* below the sky shader's
radiance. three 0.185 nudges the Sky output up slightly, the sky crossed the
line, and every pixel of it became a highlight.

Bisected live against the frame via a bloom handle added to the debug object:

| Threshold | Horizon |
|---|---|
| 4.0 (shipped) | Wholesale bloom, white band across frame |
| 6 | Clean |
| 11 | Clean |
| 22 | Clean, indistinguishable from bloom-off |

So the sky's radiance sits between **4 and 6**. A first pass at threshold 8.0 /
strength 0.35 still read as too strong in play, so the committed values are
`BLOOM_THRESHOLD 4.0 → 12.0`, `STRENGTH 0.4 → 0.12`, `RADIUS 0.6 → 0.4`.

Strength is a taste call, and the taste is restraint: this is a game about
reading a surface and judging a jump, so anything that lifts black level or
softens an edge costs the player information.

`PostFx` now exposes `bloom` so this is re-bisectable from the console —
S5 retunes sky, exposure and tone mapping, and all three move this threshold.

## Baseline metrics (on 0.185.1, at spawn)

| Metric | Value |
|---|---|
| Draw calls | 75 |
| Triangles rendered | 106,229 |
| Triangles in scene | 138,182 |
| Meshes | 117 |
| **Instanced meshes** | **0** |
| Lights | 2 (1 directional + 1 hemisphere) |
| Unique materials | 73 |
| Unique geometries | 73 |
| GPU geometries / textures | 34 / 72 |
| Render buffer | 1917×1990 @ pixelRatio 1.25 |
| Adaptive render scale | 1.0 (no downscaling needed — headroom available) |
| Tone mapping | ACESFilmic, exposure 0.5 |
| Fog | Linear, 140 → 460 |
| Environment intensity | 0.55 |

### What these numbers mean for the plan

- **0 instanced meshes** with 117 meshes and 73 unique materials/geometries is
  the single biggest headroom finding. Vegetation (S4) is only affordable via
  instancing, and the existing prop placement should move to instancing too.
- **73 unique materials for 117 meshes** means almost no material sharing —
  a material library (S6) reclaims draw calls before S4 spends them.
- **Render scale pinned at 1.0** means the adaptive system never engaged: there
  is real GPU budget available to spend on S5/S7.

## Visual baseline

Screenshot: flat green 400×400 plane, flat grey-blue slab, a crane prop, harsh
blocky shadow artifacts across the ground, washed-out sky, no mid-ground or
background interest.

Automatic scorecard failures present at baseline: **flat arena**, **sparse
world**, **primitive-dominant composition**.

## Known limitations of this harness

1. **FPS not measured.** The Chrome window reports `visibilityState: "hidden"`
   even while focused, so `requestAnimationFrame` is fully paused (frame counter
   frozen). Frame timing must be captured with the window genuinely foregrounded.
2. **Viewport locked at 1534×1592** (aspect 0.96). `resize_window` reports
   success but `innerWidth`/`innerHeight` do not change — the window appears
   maximized. A near-square viewport is not representative for judging a
   landscape game's composition.

Both need the browser window un-maximized and foregrounded once; neither blocks
S1–S4.
