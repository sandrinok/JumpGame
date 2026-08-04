# JumpGame V2 — handover

State of the project as of 2026-08-03. Start here; the other documents are
referenced from this one.

- **[DESIGN.md](DESIGN.md)** — the game design: brief, core loop, level plan,
  measured jump envelope, fun-factor tests.
- **[BUILD_ORDER.md](BUILD_ORDER.md)** — the system-by-system plan this was
  built against.
- **[BASELINE_S0.md](BASELINE_S0.md)** — what the game measured like before any
  of this, and the two regressions the Three.js upgrade caused.
- **[README.md](README.md)** / **[ASSETS.md](ASSETS.md)** / **[DEPLOY.md](DEPLOY.md)**
  — inherited from V1, still accurate for running, assets and deployment.

---

## What this is now

A third-person vertical platformer: climb as high as you can without falling.
Three.js 0.185, Rapier physics, TypeScript, Vite.

**You land in a hub** — a room with one portal per map and that map's high score
table on the board beside it. Walking into a portal plays that map.

| Map | Built | Summit | Open | What it is |
|---|---|---|---|---|
| **AI Jungle** | generated | 183.6 m | yes | A flooded, overgrown ruin. 474 placements, six route shapes, four kinds of interactive platform, three risk lines, ~6,000 instanced plants. Audited three ways. |
| **Scrapheap** | hand-built | 168.7 m | **coming soon** | Sushi, traffic cones, wooden chairs, desk lamps. 76 placements, 33 assets. |
| **The Long Way Up** | hand-built | 263.6 m | **coming soon** | Roads, cargo containers, street lamps. 256 placements, 52 assets. The tallest. |

`"available": false` in `public/levels/index.json` closes a map. Its portal is
still built, dressed and labelled — desaturated, with "coming soon" on the board
and on a plate set into the pad — because the hub's job is to say what is coming
as well as what is here, and three doorways with one lit says something a single
doorway cannot. It gates **the hub only**: `/play.html?map=…` still loads a
closed map, or the only way to work on a level would be to first declare it
finished.

Two pages: `/` is the hub, `/play.html?map=<id>` is a map. Choosing a map
navigates rather than swapping the level in place — everything the game builds
is created once at module scope from the level it loaded, so hot-swapping would
mean tearing down the renderer, physics world, scene graph and network identity
to save a page load of about a second.

The hub is a **clifftop villa**: portals along a covered loggia at the back, and
everything in front of them open over a sixty-metre drop to a valley with a
mountain range beyond it. Somewhere to stand still before a run was the brief,
so the seating faces the view and not the menu.

Three things about it were each wrong once and are worth not repeating. **The
god rays have to be off** — they exist for shafts through a canopy, and over an
open terrace they stack on a bright sky and bleach the entire frame; that, not
the lighting, was what turned the first version white. **The range starts 340m
out**, because a two-hundred-metre peak a hundred and fifty metres away fills
sixty degrees of frame and reads as a wall rather than a view. And **the terrain
palette has to match the heights actually generated** — thresholds set for a
200m range painted a 400m range entirely in snow.

**The furniture is editable with F2, the architecture is not.** The villa's
dressing lives in `public/levels/hub.json` and is instantiated by the same
loader the maps use, so the editor opens on the hub page and can drag, rotate,
scale, add and delete any of it, then save straight back to that file. The
terrace, loggia, columns, balustrade, portals, boards and mountains stay in
code: they carry the colliders the room depends on and their own materials, and
neither survives a trip through the level format. That split is also what makes
the editor safe here — the scenery you might drag into the valley by accident
is not selectable.

`npm run hub` regenerates the starting layout **and overwrites whatever the
editor last saved**, which is why it refuses to run without `--force` if the
file already exists. It measures each model's bounding box from the shipped
`.glb` rather than from `data/platforms.json`, which records the *source*
assets.

**That measurement was wrong for every asset, and the whole villa was invisible
because of it.** The generator read `accessor.getMin()/getMax()` off the
POSITION attribute — but the shipped models are meshopt-compressed, so those are
normalized 16-bit integers and the extremes come back as ±32767 rather than as
the positions they stand for. Every bounding box measured about 65,000 units
across, `round(width / longest)` produced `0.000`, and all 26 furnishings were
written into `hub.json` at **scale zero**: present in the file, present in the
scene graph, occupying no pixels. The room documented as "40.6k triangles of
dressing" was drawing none of it. It now uses glTF-Transform's own `getBounds`,
which denormalizes the accessor and composes the node transforms — cross-checked
against `data/platforms.json`, where `tree2` reads 6.368 x 5.747 x 6.136 from
both. Regenerating replaced the 26 zero-scale placements and kept the five props
that had been positioned by hand (they had real scales, which is what
distinguishes them).

There is a `wardrobe` and a `shop` corner built and labelled "not open yet",
with their positions exported as `STATION_ANCHORS`. Neither does anything.
Cutting them into a finished terrace later would be much more work than leaving
the space now.

**The start screen's masthead sits above the panels, not inside one.** The
title used to be the middle panel's heading, which put the name of the game at
the same level as the controls for a t-shirt; and the way back to the hub was at
the bottom of that panel under the Play button, reading as one more thing to do
here rather than as the door. Both are now in a header row over the whole block —
title centred on it, hub button hard left and aligned to the first panel's edge.
The character panel also finally has `:hover` / `:focus-visible` / `:active`
states (`ui/startScreenStyles.ts`), which no amount of `style.cssText` can
express: every control on it was inert to the touch, and that absence is most of
what made a panel of working controls feel unfinished.

**The colonnade is laid out from the portal positions, not stepped along the
terrace.** A fixed stride put columns at -17, -8, 1 and 10 against portals at
-10.5, 0 and 10.5 — three metres in front of each doorway and nearly centred on
it, so every portal was viewed through a column and the emblem beside it was
hidden. `createVillaShell` now takes the portal x list and puts one column in
each gap between doorways plus one at each end.

**The hillsides have trees on them**, instanced from four models in the
`trees_and_bush_pack` — 8 to 16 triangles each, so a few hundred cost five draw
calls. Two things about where they go were each got wrong first. The player
stands 2.6m above a terrace ringed by a solid 1.1m balustrade 19m away, and the
valley floor is 62m below that — so the sight line grazing the rail is already
19m under the clifftop at 340m out, and **the entire valley floor and cliff face
are hidden behind the railing the player is leaning on**. Successive versions
planted 46% and then 76% of the forest down there, all correctly placed and none
of it ever drawn. Placement is now "sample the whole landscape, keep what clears
the rail". And the clifftop ring has to stay out of the 55° cone the terrace
looks down, or fourteen-metre pines thirty metres away become a fence across the
view the villa exists to have.

The far range gets a **forest colour band on the terrain** rather than trees. At
340–820m the range is 1.7 km² of annulus; a thousand trees there is one per
eighty metres and each is a couple of pixels. What reads as forest at that
distance is colour, and it costs three numbers in a lerp that already ran.

The structure is boxes with matching colliders, and
**furniture from the same 305-asset library the maps are built from** for the
dressing — a lounge behind the spawn, shelves and planters along the walls,
street lamps down the middle, and one emblem per portal so the hub says what is
through a doorway before you read the board. The dressing carries no colliders,
like the jungle's vegetation, and sits off every walking line. **40.6k triangles
in 32 draw calls**, so none of it costs anything worth measuring. Read it with
`window.__hub` in dev.

The portal surface is a shader rather than a texture, and the motion is polar on
purpose: anything panning in x or y looks like a screen hung in a hoop, where a
doorway to somewhere else has to swirl around its own centre. It brightens and
spins up as you stand on the pad, which is what makes walking in feel like a
decision the game noticed rather than a trigger volume that fired.

Each map has **its own leaderboard**, its own personal best, and its own
multiplayer room: two people climbing different maps share a server but not a
sky. A single pooled board would rank a 260 m climb up the tallest map above a
180 m climb up the hardest one, which tells nobody anything.

The hand-built maps also get **their own environment**. The flood and the jungle
canopy are AI Jungle's setting, not the game's: drawn over a scrapyard they put
a waterline through its lowest footholds and palms over its cargo containers.
`env` in the map index decides. Their `killY` is deliberately left where it was
— both start on open ground with the first foothold a metre up, so they were
built without a fail state, and adding one would change how they play.

---

## Commands

Maps are listed in **`public/levels/index.json`** — one list, read by the client
and by the server when it decides which score file a submission belongs to.
Keeping two lists is how a map ends up playable but unable to record a score.

```sh
npm run dev            # Vite dev server, editor unlocked (F2)
npm run build          # typecheck + production build
npm run level          # generate the level, audit it, then play it
```

The level pipeline is three independent stages and all three must pass:

```sh
npm run level:generate   # scripts/generate-level.mjs   -> public/levels/ruins.json
npm run level:check      # scripts/check-level.mjs      -> geometry audit
npm run level:sim        # scripts/simulate-route.mjs   -> plays every jump
npm run level:platforms  # scripts/check-platforms.mjs  -> rides every dynamic platform
```

Asset generation (needs `FAL_KEY`, see below). All skip existing files, so a
re-run costs nothing:

```sh
npm run gen:foliage    # jungle cutouts   -> public/assets/foliage
npm run gen:models     # 3D ruin pieces   -> 3dassets/generated
npm run gen:textures   # surface textures -> public/assets/textures
npm run gen:audio      # ambience + SFX   -> public/assets/audio
npm run optimize-assets  # compress + register generated models in the manifest
```

## Current pipeline output

```
[level] 474 placements, summit 183.63m
[level] apex 1.546m, off a bounce pad 4.375m
[level] route: spiral -> switchback -> traverse -> shaft -> bridge -> scatter
[level] 311 moves — 179 static, 50 risk, 39 moving, 24 crumbling, 12 bounce, 7 rotating
[level] 3 movers had their travel cut short of solid geometry, 2 made static outright
[level] 3/5 risk lines placed, 47 footholds, skipping 62.7m
[check] PASS: no overlaps, no trivial moves, nothing out of envelope
[sim]   305 landed, 0 failed
[sim]   forgiveness p05 0.188 · median 0.563 · p95 0.938
[sim]   0 jumps land on 1-2 inputs only, 7 on 6 or fewer
[platforms] 82 dynamic placements ridden for 30s each
[platforms]   12/12 bounce · 24/24 crumbling
[platforms]   39/39 moving   (slide 0.066m, judder 4.2mm/step)
[platforms]    7/7  rotating (slide 0.079m, judder 0.1mm/step)
[platforms] PASS: every rider stayed put, every pad fired, every fuse blew
```

---

## Live tuning handles

Exposed on `window.__jg` in dev builds only (`import.meta.env.DEV`).

| Call | What it does |
|---|---|
| `__jg.warp(120)` | Stand the player on the foothold nearest 120 m |
| `__jg.ruinScale(80)` | World units per texture repeat on the ruins; higher = more magnified |
| `__jg.ruinScale(80, 60)` | Concrete and moss separately |
| `__jg.postFx.bloom.strength = 0.05` | Bloom, live. **Null below `high`** — see Performance |
| `__jg.postFx.godRays.pass.uniforms.uExposure.value = 0.2` | Light shafts, live. Null below `high`, and always null in the hub |
| `await __jg.bench(50)` | GPU frame time via driver timer queries |
| `__jg.dynamics.carry(feet, out)` | What the platform under `feet` is imparting this step |
| `__jg.renderer` / `.scene` / `.level` / `.registry` | The live objects |

Keyboard, dev only: **PageUp/PageDown** ±15 m through the climb (Shift for
±45 m), **Home** back to the bottom. **F2** editor, **F3** debug overlay.

**Texture scale is unresolved and deliberately left as a knob.** It is a pure
judgement call with no measurement behind it — see *Open items*.

---

## Architecture — what was added

Everything below is new in V2. The V1 structure (`core/`, `physics/`,
`editor/`, `persistence/`, `net/`) is unchanged and still accurate in README.md.

### Level generation (`scripts/`)

| File | Role |
|---|---|
| `generate-level.mjs` | Emits the climb from the jump envelope and a band spec |
| `check-level.mjs` | Audits the geometry. **Shares no code with the generator** |
| `simulate-route.mjs` | Plays every jump with the real integrator |
| `check-platforms.mjs` | Stands a rider on every dynamic platform for 30s, in real Rapier |
| `measure-platforms.mjs` | (V1) Measures each asset's landable surface |
| `fal.mjs` | Minimal fal.ai client |
| `gen-foliage.mjs` / `gen-models.mjs` / `gen-textures.mjs` / `gen-audio.mjs` | Asset generation |
| `check-foliage.mjs` | Audits generated cutouts for alpha, halos and baked shadows |

`check-platforms.mjs` is the one check that imports from `src/` rather than
reimplementing what it verifies — see below.

### Runtime (`src/`)

| File | Role |
|---|---|
| `world/maps.ts` | The map list, and which one this page is playing |
| `hub.ts` / `hub/room.ts` | The villa you choose a map from |
| `hub/villa.ts` | Its terrace, loggia, columns and balustrade |
| `hub/landscape.ts` | The valley and mountain range it looks out over |
| `hub/portalMaterial.ts` | The swirling surface inside a portal ring |
| `world/dynamics.ts` | Moving / crumbling / bounce / rotating platforms, and carrying the player |
| `game/platformCarry.ts` | The carry top-up. Imported by the game *and* by `check-platforms.mjs` |
| `world/vegetation.ts` | ~6,000 instanced plants, canopy layer, vines, debris |
| `render/ruinMaterial.ts` | Triplanar weathered concrete + moss for the structure |
| `render/brokenSlab.ts` | 12 procedural broken-slab silhouettes |
| `render/godRays.ts` | Screen-space light shafts |
| `render/water.ts` | The flooded street level |
| `render/particles.ts` | Drifting motes, dust and splash bursts |
| `game/feel.ts` | Speed-driven field of view |
| `ui/hud.ts` | Vertical climb gauge |
| `render/effects.ts` | Per-effect switches, stored per browser, folded into the tier |
| `ui/startScreenStyles.ts` | The start screen's `:hover` / `:focus` states, which inline styles cannot express |
| `audio/sfx.ts` | Sample playback with the original synth as fallback |

---

## Decisions worth not re-litigating

These each cost several attempts. The reasoning is in the file comments; this is
the index.

**The jungle's look is the jungle's, and had leaked onto everything.** Three
separate treatments were being applied globally because there was only ever one
map to apply them to:

- `registry.ts`'s `weather()` desaturates every imported model to 40%, darkens
  it, and multiplies it by `(0.82, 0.9, 0.72)` — a green. It exists so a
  fluorescent-yellow crane does not read as pasted into a mossy ruin, and it is
  right for that map. Everywhere else it gave every object the same cold tint:
  a scrapyard of sushi, cones and chairs came out looking carved from one
  material, every base colour reading `#dddddd`. Now `new AssetRegistry({
  weather })`, and only the ruin asks for it. Measured after: 8 distinct
  saturated hues across 96° instead of one.
- The **colour grade** in `postFx.ts` pushes shadows blue (`coolShadow`). Now
  `postFx.setGrade()`, with `JUNGLE_GRADE` and `NEUTRAL_GRADE` and a `look`
  field per map. Worth knowing this one measured as *almost irrelevant* — 25%
  blue-over-red against 23.5% — so do not go looking here first.
- **God rays** are for shafts through a canopy. Over open ground they stack on a
  bright sky and bleach the frame; off in the hub.

The lesson is the shape of it rather than any one setting: everything that made
the ruin look like a ruin was hung on the renderer, and the moment a second map
existed it was wearing the first one's clothes.

**The structural layer is authored boxes, not library props.** Measuring all 299
assets settled it: only 34 have a metre-wide plateau, and those are almost all
4 cm road decals. Filtering for real mass leaves 16, all crates and barrels. Box
primitives also get an exactly-matching cuboid collider, so what you see is what
you stand on. `brokenSlab.ts` replaces only the *silhouette*, and its jitter is
inward-only — the visual must never exceed the collider, or you fall through
something that looks solid.

**The jump envelope is simulated, not solved.** `core/loop.ts` steps at a fixed
1/60 s and applies gravity *before* the position update. The continuous apex is
1.62 m; the reachable apex is **1.546 m**. A ledge placed at 1.60 m "by the
formula" is unreachable.

**Two verifiers, deliberately not sharing code.** The first generator verified
its own arithmetic with its own arithmetic and printed *"every jump verified"*
over a 176 m staircase. `check-level.mjs` re-derives everything from the emitted
JSON.

**…except `check-platforms.mjs`, which imports `platformCarry.ts` on purpose.**
That rule is right when the question is arithmetic and wrong when the question
is what the physics engine does with it, and the exception was paid for: the
check kept its own copy of the carry formula, the shipped one was changed
underneath it, riders started falling off 23 of 39 platforms, and every stage
still printed PASS. The ordering and the measurement are still the check's own
— only the formula is shared, because a formula the check does not run is a
formula the check does not test.

**Risk lines are circular arcs of prescribed length.** A straight line cannot
hold the hops — a 21 m climb needs 17, and 10 m of ground over 17 hops is a
negative gap. An arc with a given chord and length has exactly one solution.
A branch is committed whole or not at all.

**`killY` sits *above* the ground collider.** At −20 it was under a solid
200-unit floor, so a fall landed on grass and cost nothing. The water makes that
rule visible rather than something you learn by dying to it.

**No landing shake or landing particles.** They were there and were removed.
`JUMP_VELOCITY` is 9 m/s, so an ordinary jump lands at 5.6–9 m/s — at or above
the "hard landing" threshold, meaning every single jump fired the full effect.
There is also no good threshold available: in a game where falling any real
distance ends the run, a landing worth announcing is one you do not survive.

**The platform carry is a top-up, not an addition.** Rapier's character
controller already carries a character standing on a kinematic body — but only
on the steps where its ground cast finds it, which on this level's 1.5–2.5m
ledges is roughly half of them. So the rider keeps about half the platform's
travel and slides off the back. Adding the travel ourselves does not fix that,
it doubles it on every step the controller *did* fire and you slide off the
front instead. The engine's contribution cannot be switched off: it comes from
the platform's own velocity, so neither committing the platform's motion after
the controller runs nor zeroing its `linvel` changes anything (both measured).
`platformCarry.ts` therefore measures how far the controller moved us beyond
what we asked for, projects that onto the platform's direction of travel, and
adds only the remainder.

**Do not "improve" that by resolving the remainder.** Handing it back through
`computeColliderMovement` so it gets collision handling is the obvious
refinement and it is much worse — riders fell off **23 of the 39 movers**,
against none the raw way. The second call reads the collider's position, which
the first call has not written back yet, so it re-answers a question already
asked and the owed movement evaporates. Folding the carry into the first call's
`desired` instead is worse still: 27 of 39, and the capsule wobbles most of a
metre vertically. Being carried into scenery is prevented in the generator,
which is the layer that can actually do something about it. Also: **do not apply the carry with `setTranslation` first.** The
controller reads the *collider's* position, which a `setTranslation` does not
update until the next `world.step`, so it would resolve collisions from a
position the player no longer occupies.

**A mover's travel is checked against the level, late.** Travel is picked when
the platform is placed, before the slabs further up the route exist, so three of
them swept the rider straight into a pillar — and being scraped off by scenery
while the platform leaves without you is the one failure the player cannot
answer, because standing still is the correct input and it loses. A post-pass
(`clearMoverPaths`) shortens the travel until the corridor is clear, and makes
the platform static if nothing usable is left. It shortens rather than removing
the obstacle, the way `clearFlightPaths` does, because here the obstacle is
usually a route slab and the route outranks the platform. Nothing verified is
affected: the jumps on and off a mover are measured from `pos`, which does not
move.

**The editor's fog toggle moves the density, it does not detach the fog.**
Assigning or clearing `scene.fog` changes what every shader in the scene has to
compile: three compares `materialProperties.fog` against `scene.fog` on every
draw and rebuilds the program for each material that disagrees. On the jungle
that is a multi-hundred-millisecond compile stall in exchange for a fraction of
a millisecond of fog arithmetic — that was the reported "F stutters". The stall
is also long enough to cross the keyboard's auto-repeat threshold, so the key
that caused it fired again on the way out and the fog landed on whichever state
the last repeat left it in. Hence two fixes: density instead of detachment, and
**`if (e.repeat) return` on the editor hotkeys** — every one of them is a toggle
or a one-shot, and a held key should not mean anything (C was cycling the
collider view several modes at a time, X was re-firing delete). Leaving edit mode
now restores the fog unconditionally rather than restoring the editor's own
toggle state, so the editor's convenience can never leak into play.

**Light shafts fade as the sun approaches screen centre.** Every ray converges
on the sun, so dead centre they stack over the whole frame and white it out.
Physically correct, unplayable, and readability wins.

---

## Asset generation

`FAL_KEY` lives in `.env` (gitignored). Never printed — the probes only ever
report SET/MISSING.

**Spent so far: ~$1.56.**

One trap worth knowing: **`fal-ai/elevenlabs/sound-effects` is broken** — it
validates the request and then fails 400 upstream with `invalid_model_id:
eleven_text_to_sound_v0`, and passing `model_id` does not override it. Use
`fal-ai/elevenlabs/sound-effects/**v2**`. The generator scripts now print
`FELL BACK from …` whenever a generator fails, because the first version
swallowed those errors and silently produced the whole audio set from the
fallback.

Alpha cutouts are keyed **locally by luminance**, not by fal's `rembg`. Segmentation
decided a curtain of thin vines had no subject and returned 0.0% coverage, and
left a pale halo on everything else — which against dark jungle is a glowing
outline. The sources are generated on flat white, so a luminance key with
unpremultiply is both more reliable and free.

---

## Open items

**Texture scale on the ruins is unresolved.** Currently 42 m per repeat
(concrete) / 34 m (moss), which is magnified past legibility so no tiling period
is findable. It has been wrong in both directions: at 3.2 m the moss clumps read
as tree canopy from above; at 0.62 m the tiling grid became visible. Dial with
`__jg.ruinScale(n)` and bake the value into `ruinMaterial.ts`.

**Two risk lines are abandoned every generation** — "Canopy line" and "Long Fall
line" would overlap the main route. Named in the generator output. Either widen
their `bulge` in `BRANCHES` or accept three.

**No fork at the spawn slab.** The earliest route choice is a few jumps in, so
the "first 30 seconds contain a real decision" test is **Partial** in DESIGN.md.

**Fun is unproven.** The simulation shows the climb is *completable* — 305/305
jumps land. Whether it is enjoyable is not something a simulation can answer,
and no human has played more than the opening.

**Verified in the browser, mostly.** `npm run level:platforms` rides all 82 in
real Rapier for 30s each and they pass. In the game itself, measured with the
window in front (a background tab freezes `requestAnimationFrame` and the whole
loop stalls):

| | measured |
|---|---|
| Movers, standing still | 25mm drift, 1.6mm/frame judder, over a slab travelling 5.7m |
| Bounce pad | 4.39m apex, against the 4.375m the generator claims |
| Crumbling ledge | held 0.68s against a 0.677s fuse |
| Rotators | 6 of 7 carry the rider exactly — slip under 3mm over three seconds |

**The seventh rotator, `g76` at 180m, does not carry its rider at all.** It is
worth knowing what has already been ruled out, because most of it looks like the
answer and is not. The rider is genuinely standing on it (feet 1cm above its top
face, inside its footprint, nothing else within the ray's reach). Its collider,
body and visual are at the same place and the right size. It is still turning,
and `dynamics.step()` and `carry()` are in the same gated block, so it cannot be
turning without being asked. `carry()` returns `launch: null` with a zero vector,
which is what `groundQuery` returns when the ray finds something *static* — yet
the same query 30cm away on the same slab returns the correct 9.6mm. Headless it
passes with 53mm of slip, so whatever it is lives in the live scene rather than
in the arithmetic. **Next step is the physics debug view (`F3`, `debugView.ts`),
which draws the actual colliders** — this is past the point where reading state
through the console pays.

**The weird-objects map is not built yet.** The plan is a fourth map generated
by the same verified machinery as AI Jungle, but placing props instead of boxes:
sushi, rubber duck, cake, pizza, gnome, moai, guitar. The groundwork is already
there — `data/platforms.json` holds a measured landable square and its centre
for all 305 assets, and **92 of the 302 GLTF assets clear a 1.1m standing square
once scaled to a 6m footprint**, at a median of 1352 triangles. Scaling up is the
point rather than a workaround: you are meant to be jumping onto a giant sushi.
Each prop would get an exact cuboid collider from its measured landable surface
via the level format's existing `assetOverrides`, so the geometry and route
checks keep working unchanged.

**The checkers are blind to props.** `check-level.mjs` sees "3 slabs, 2 supports"
in a 256-placement hand-built map and reports FAIL, because it only understands
`box_stone` and `box_wood`. That is why the two hand-built maps ship unaudited.
Making it prop-aware means reading landable surfaces out of `platforms.json` —
and for a hand-built map the useful question is not "is this route legal" but
"is every surface reachable from another one", which is a different check.

**Mobile is untested.** No touch controls, no mobile screenshots, no DPR check.

**Bundle:** `rapier.es` is 2.06 MB (761 kB gzipped) in a single chunk. Inherited,
not introduced.

---

## Performance

### The quality tiers decide what exists, not only how sharp it is

This is the change worth understanding. The tier used to move five numbers —
MSAA samples, shadow map size, bloom resolution, pixel ratio ceiling, minimum
render scale — and **every one of them is per-pixel**. Low therefore drew
exactly the same world as High: the same six thousand foliage cards, the same
nine hundred motes, the same three fullscreen post passes, at fewer pixels. On
the machines Low exists for, the frame was never bound on pixels.

There are now four tiers, and they differ in content:

| | low | medium | high | ultra |
|---|---|---|---|---|
| post chain | none | bloom | bloom, shafts, aberration | all of it, bigger |
| shadows | 512 hard | 1024 hard | 2048 soft (VSM) | 4096 soft |
| MSAA / pixel ratio | 0 / 1x | 0 / 1.25x | 4 / 2x | 8 / 2x |
| foliage | 18% | 55% | 100% | 135% |
| canopy ceiling, rubble, motes, clouds | no | yes | yes | yes |
| min render scale | 0.5 | 0.5 | 0.75 | 0.9 |

Measured with `__jg.bench(60)` from the spawn on AI Jungle, same machine, same
vantage point:

| tier | GPU median | buffer | draws | triangles | plant instances |
|---|---|---|---|---|---|
| low | **0.26 ms** | 1279×1289 | 136 | 170k | 781 |
| medium | **0.53 ms** | 1598×1611 | 184 | 503k | 3,424 |
| high | **1.86 ms** | 1918×1933 | 198 | 810k | 6,234 |
| ultra | **3.01 ms** | 1918×1933 | 198 | 924k | 8,095 |

Low is 7.2× cheaper than High, and still 3.2× cheaper after normalising for the
resolution difference — which is the part the old tiers could not deliver.
High is unchanged from the numbers this document used to quote; it is the
reference the jungle was tuned against and nothing about it moved.

### Effects switch individually, on top of the tier

A tier answers "how much can this machine afford"; an effect switch answers
"what do I want to look at". Bloom is the case that forced the split — it costs
a real slice of the frame *and* some people simply do not like it, and with only
a tier you had to give up the shadows, the foliage and the resolution to get rid
of the glow. Five switches, in `render/effects.ts`, stored per browser: **bloom,
light shafts, lens dispersion, dust motes, speed field-of-view**. Reachable from
the start screen and from the hub, since the preferences are global.

An absent preference follows the tier, so nobody who has not opened the panel is
pinned to today's defaults. An explicit one is folded into `qualityFor()` before
anything is built, which is what makes "off" cost nothing — the pass is never
constructed rather than constructed and skipped.

They apply **live**, because a pass can be skipped without reallocating
anything: `pass.enabled = false` and `EffectComposer` steps over it. Measured on
the jungle at High, switching bloom off took the frame from **1.72 ms to
1.48 ms** — 14%, which is the whole point of it being a switch rather than a
strength slider. The one case that cannot be live is turning something *on* that
this tier never built, and `EffectControls.set` returns false there so the panel
can offer a reload instead of flipping a switch that does nothing.

Three things are worth not re-litigating:

- **A pass the tier does not want is not built at all.** An `UnrealBloomPass` at
  strength 0 still runs its five-level downsample pyramid, and a god-ray pass at
  exposure 0 still marches its sample loop for every pixel. Both write the
  answer "nothing" at the price of the answer "something".
- **Chromatic aberration is spliced into the output pass**, not run as its own.
  As a separate pass it would be a full read and write of the frame for two
  extra texture reads. Its offset scales with distance from centre squared, so
  the middle of the frame — where the ledge you are aiming at almost always is —
  stays exactly sharp.
- **Auto never picks Ultra.** Nothing a browser reports distinguishes a card
  that holds 4096 shadows at 90% of a 4K panel from one that does not; both
  answer "NVIDIA GeForce". The settings panel says so.

Shadows are the one thing Low still pays for. Turning them off is tempting and
wrong: the contact shadow under the player's feet is what a landing is judged
by. It gets 512 and hard PCF instead — VSM blurs its map in two extra passes
every frame, and the light follows the player, so it moves every frame.

### Everything else

Instancing the 474 placements was considered and **not done** — the measurement
says it would be work without a win. Vegetation and debris are already instanced
(~6,000 instances in ~24 draw calls at High) because that was never affordable
any other way.

**`applyMatrix4` on a meshopt-compressed geometry destroys it.** Worth its own
line, because it is silent and it cost three rounds of debugging the wrong
thing. The shipped models store positions as normalized 16-bit integers spanning
[-1, 1] with the real size in the node's scale; `BufferGeometry.applyMatrix4`
transforms them and writes them back into that same 16-bit attribute, so
anything the scale pushed outside [-1, 1] is clamped at the edge. A 13.9m pine
with a node scale of 6.96 came out **1.3m tall and slightly crushed** — which,
on a mountainside, is indistinguishable from "the trees did not load", and is
why rebalancing the scatter three times changed nothing. `hub/landscape.ts` no
longer bakes anything: the node's world matrix is composed into the *instance*
matrix instead, and the decoded geometry is shared untouched.
`world/vegetation.ts` does the same bake and survives only because the rubble
props carry node scales at or below 1 — luck, not design — so it now widens the
attribute to floats first.
