# JumpGame V2 — Build Order

> **Status: all thirteen systems closed.** This document is kept as the record
> of what was planned and why. For the state of the project as it stands, and
> what is still open, read **[HANDOVER.md](HANDOVER.md)** instead.
>
> | | |
> |---|---|
> | S0 Baseline | done — [BASELINE_S0.md](BASELINE_S0.md) |
> | S1 World structure | done — generated, audited and simulated |
> | S2 Player feel | done, then **partly reverted**: landing shake and landing particles removed. `JUMP_VELOCITY` is 9 m/s so every ordinary jump was tripping the "hard landing" threshold |
> | S3 Terrain | done — displaced riverbed, kept below the waterline inside the tower radius |
> | S4 Vegetation | done — ~6,000 instances, canopy layer at 30 m |
> | S5 Lighting | done — humid fog, canopy bounce, VSM shadows |
> | S6 Surface detail | done — triplanar generated concrete and moss |
> | S7 Post pipeline | done — contrast added to the grade, light shafts, bloom re-bisected |
> | S8 VFX & readability | done — motes, dust, splash |
> | S9 Audio | done — generated ambience and SFX, synth kept as fallback |
> | S10 UI/HUD | done — vertical climb gauge |
> | S11 Performance | **closed as not needed**: 1.46 ms of a 6.94 ms budget. Instancing the placements would have been work without a win |
> | S12 QA & release | done — `npm run level` generates, audits and plays the level |


Target: **overgrown ruins** — post-apocalyptic structures reclaimed by jungle.
Quality bar: **nature documentary / real jungle photography** — applied to
light, atmosphere, composition and surface response.

## Working rules (from the user, these override skill defaults)

1. **One system at a time.** Finish and verify a system before starting the next.
2. **No parallel fan-out.** Never more than one subagent running at a time.
3. **One critic per system**, run *after* that system is implemented, never
   several critics at once.
4. **Explicit build order** — the sequence below. No jumping ahead.
5. **No copyrighted IP as reference.** The bar is real jungle photography and
   nature documentary footage, not any specific game.

## Standing constraint — readability beats lushness

This is the biggest design risk in the whole project and it applies to every
visual system below. The core skill in a climbing platformer is *reading where
you can land*. Overgrowth is, by nature, visual noise placed exactly where the
player needs signal. Every foliage, fog, VFX and grading change must be checked
against one question: **can the player still instantly tell what is standing
surface, what is edge, and what is decoration?** A system that scores well on
beauty and badly on this is rejected, not tuned.

Rule of thumb: foliage never occludes a landable top face, never overhangs a
landing zone, and silhouettes of jumpable geometry stay separated from the
background by value contrast, not just colour.

---

## Baseline facts

| | |
|---|---|
| Renderer | Three.js 0.169, WebGL, EffectComposer (bloom + injected grade), adaptive resolution |
| Physics | Rapier 0.14, kinematic character controller, trimesh colliders |
| Loop | fixed 60Hz sim, interpolated render (`core/loop.ts`) |
| World | flat 400×400 plane, JSON levels of placements, in-game React editor |
| Assets | ~200 `apoc_*` props + `trees_and_bush_pack.glb` (14MB), modular character + Universal Animation Library |
| Generators | **all three API keys MISSING** — see blockers |

Known gaps against the bar: flat single-plane ground; clear midday blue sky
(opposite of canopy light); no vegetation system; no ambient occlusion, light
shafts, or DOF; no wind; no wetness/moss layering; no decals.

---

## Build order

### S0 — Baseline & measurement harness
Install, typecheck, run, and *measure* before changing anything. Capture
baseline screenshots, canvas-inspector metrics, renderer diagnostics, and the
before-scores for all ten scorecard categories. Decide the Three.js upgrade
question (0.169 → current) here, because `GradedOutputPass` deliberately throws
if three's OutputShader changes — that is a deliberate tripwire, not a bug.
**Done when:** dev server runs, baseline metrics + screenshots captured.

### S1 — World structure & level plan
Gameplay before visual depth. Replace the flat plane with a designed vertical
climb: ruined structures, landmarks, escalation, recovery beats, readable
sightlines up. Spatial format, first decision, first threat, first reward.
**Done when:** level plan written, blockout playable start to summit.

### S2 — Player feel & camera
Tune the existing jump arc, coyote time, buffering, air control against the new
verticality. Camera framing for a climb — what the player must see to commit to
a jump.
**Done when:** climb feels fair; feel checklist reported.

### S3 — Terrain & ground materials
Kill the flat plane. Displaced ground, multi-surface blend (moss, mud, wet
stone, rubble), triplanar projection, decals.
**Done when:** no flat-arena failure remains.

### S4 — Vegetation system
Instanced foliage from the existing tree/bush pack, ground cover, vines on
ruins, wind vertex animation, density scattering, LOD.
**Done when:** dense growth at budget, readability constraint holds.

### S5 — Lighting & atmosphere
The single biggest lever for the nature-doc bar. Canopy-filtered light, dappled
shadow, humid layered fog, revised sky and environment.
**Done when:** lighting reads as jungle interior, not open field.

### S6 — Surface detail on ruins
Moss on upward faces, wetness, grime, edge wear, staining on the apoc props so
they read as reclaimed rather than dropped in.
**Done when:** props read as part of the environment.

### S7 — Post pipeline
Ambient occlusion, light shafts, depth of field, better AA, humid regrade.
**Done when:** budget met, no readability regression.

### S8 — VFX & readability pass
Dust motes, pollen, drips, landing puffs — plus the explicit readability audit
of everything S3–S7 added.
**Done when:** readability audit passes.

### S9 — Audio
Jungle ambience, footsteps by surface, jump/land. *Blocked on ElevenLabs key.*

### S10 — UI / HUD
Height meter and states, fitted to the art direction.

### S11 — Performance
Instancing/LOD/culling budget, mobile DPR, shadow and post tradeoffs.

### S12 — QA & release
Bot playtest, visual harness decision, production build, final scorecard.

---

## Ledgers

**Skill-loading:** Director `SKILL.md` loaded; `references/phase-playbook.md`
loaded. Siblings deliberately loaded *at phase entry*, one at a time, to honour
the sequential rule and preserve context across a multi-hour session.

**Credential probe** (run 2026-08-03, both Git Bash and PowerShell User/Machine
scopes, no populated `.env` anywhere in the tree):

```
TRIPO_API_KEY=MISSING
GEMINI_API_KEY=MISSING
ELEVENLABS_API_KEY=MISSING
```

**Phase ledger:** S0–S12 all `pending`.

---

## Open blockers — how they resolved

1. **~~All three generator keys are missing.~~** Resolved differently: there is
   a **fal.ai** account instead of Tripo/Gemini/ElevenLabs. `scripts/fal.mjs` is
   the adapter, and foliage, 3D models, textures and audio are all generated
   through it. ~$1.56 spent.
2. **~~Asset library contradicts the quality bar.~~** Confirmed and worked
   around. Measuring all 299 assets showed only 34 have a metre-wide plateau and
   the foliage is 8–52 triangle cards. The structural layer became authored
   boxes with a broken silhouette, and the foliage was regenerated at 1024px.
3. **The original prompt body was never supplied.** The build order above was
   derived from the codebase and followed as written.
