# Adding models

## Single models

1. Drop the `.glb` / `.gltf` (and its textures) anywhere under `3dassets/`,
   except in `packs/` or `character/`.
2. `npm run optimize-assets`
3. It writes an optimized `.glb` to `public/assets/3d/` and appends an entry to
   `public/assets/manifest.json`. Existing entries are never touched, so re-runs
   are safe.
4. The asset shows up in the editor palette. Drag it into the world.

## Asset packs

A pack is one `.glb` holding dozens of props side by side. Optimized as-is it
becomes a single asset, so placing it drops the entire pack into the level as
one object. Put packs in `3dassets/packs/` — which `optimize-assets` skips —
and split them first:

```sh
# See what it would produce before writing anything
node scripts/split-pack.mjs "3dassets/packs/mypack.glb" --dry --prefix tiny

# Write the individual props to 3dassets/, then optimize as usual
node scripts/split-pack.mjs "3dassets/packs/mypack.glb" --prefix tiny --auto-scale 1.5
npm run optimize-assets
```

Each prop is detached with its in-pack transform baked in, recentred on X/Z,
and stood on y=0 so it lands on the surface you drop it on. The pack's
author and licence travel with every piece, so credits still work.

Two flags matter:

- **`--depth`** (default 1) — how many levels below the wrapper nodes the props
  live. A pack of loose props is depth 1; one organised into folders
  (`Buildings`, `Vehicles`, `Props`) is depth 2. This is not auto-detected,
  because a named group wrapping one mesh and a folder wrapping nine of them
  are structurally identical. Use `--dry` and look at the names.
- **`--auto-scale <units>`** — packs arrive in whatever unit their author used;
  one here had benches 134 units long, another buildings 0.2 units tall, and
  the player is about 2 units. This derives a single factor from the median
  prop so the pack lands at a sane size *without* flattening the size
  differences inside it. Rough targets: small props 2, furniture 1.5,
  buildings 6, terrain chunks 8.

Also useful: `--only <regex>` to extract one category, and `--min-size <units>`
to drop degenerate fragments.

A pack with meaningless object names (`Cube.014`, `Object_23`) is a poor
candidate — you get dozens of palette entries nobody can identify. Check with
`--dry` first.

Nothing under `3dassets/` is committed — only the optimized output is. Keep the
raw downloads, though: they are the only way to re-run the pipeline with
different settings.

## What actually works in this game

The pipeline caps textures at 2048px, converts them to WebP, and meshopt-
compresses geometry, so a 40MB download usually lands around 1–2MB. That part
is handled. What it cannot fix:

**Collider shape matters more than polycount.** New assets default to
`collider: trimesh` — exact, but the most expensive shape and the least
forgiving to land on. For anything you jump *onto*, switch it to Box or Convex
in the inspector (it applies to every instance of that asset). Keep trimesh for
scenery you only brush past.

**Avoid photoscans.** Anything tagged "photoscanned" or "photogrammetry" comes
with dense, irregular geometry and a bounding box that rarely matches what you
see. `concrete_road_barrier_photoscanned` in this project is the cautionary
example.

**Watch the scale.** Models arrive in wildly different units — some are 100x
too big, some are millimetres. That is fine, the editor scales placements, but
a prop you have to scale by 0.001 usually has other problems too.

**Silhouette over detail.** From a platformer camera you read shape, not
texture. A clean chunky object beats a detailed one every time.

## Licensing

Most free Sketchfab models are **CC-BY**: free to use, but they *require*
visible attribution wherever the work is published.

**This is handled automatically.** Sketchfab embeds the author, licence and
source URL in every download under glTF `asset.extras`, and the optimizer
carries that through untouched. `scripts/build-credits.mjs` reads it back out
of the shipped files and writes `public/assets/credits.json`, which the Credits
button on the start screen renders. It runs as part of `npm run dev` and
`npm run build`, so a new model credits itself.

Two things to still watch for:

- **Assets without embedded metadata.** The build-credits script prints a loud
  warning listing them; add those to `MANUAL` in the script by hand. An
  uncredited asset on a public site is exactly the problem it exists to catch.
- **Licences that are not plain CC-BY.** The script reports the breakdown per
  licence every run. Three to be careful with:
  - **CC-BY-NC** — non-commercial only. Fine for a hobby build, but it has to
    go the moment there is any revenue. The `Crane` model is one.
  - **CC-BY-ND** — no derivatives, which arguably includes re-encoding through
    the optimizer.
  - **Sketchfab Standard** — not a Creative Commons licence at all, and it
    restricts redistributing the model itself. A web build serves the `.glb`
    straight to the browser, which is hard to argue is not redistribution. The
    `Low-Poly Telephone Booth` is on this licence.

Separately, the Sketchfab licence only covers the *model*, never the underlying
intellectual property. A fan model of someone else's character or brand is
still their character or brand — the `Fortnite - Pizza Planet Delivery Truck`
is CC-BY as a model and someone else's trademark as a subject.

Prefer **CC0** where you can: no attribution required, no restrictions, nothing
to track.

## Places to look

Packs first — one download, many props, one consistent art style, which matters
more than it sounds when props sit next to each other:

- [Ultimate Platformer Pack (100+ models), quaternius](https://sketchfab.com/3d-models/ultimate-platformer-pack-100-models-8e016bc1b79f4c6aa58d430daa299f1e)
  — **CC0**, purpose-built for platformers, includes moving platforms and
  hazards. The best starting point by a distance.
- [Simple Cartoon Platformer Pack, SimplePolygon](https://sketchfab.com/3d-models/free-simple-cartoon-platformer-pack-b25da5c882ee42d19b032822dd04e12b)
  — CC-BY-ND. Note the **ND**: no modifications, which arguably includes
  re-encoding through the optimizer. Check before using.
- [25 Low Poly Props, Your 3D Character](https://sketchfab.com/3d-models/free-25-low-poly-props-game-ready-ee1a3701499b4c4c92afaaeedac86bba)
- [HyperCasual Platformer Assets, DevPoly3D](https://sketchfab.com/3d-models/hypercasual-platformer-assets-gameready-71f9f44e4d734702b4567a81bbafa784)
  — ramps, rings, obstacles.

For the oversized-everyday-object look this level already has (rubber duck,
sushi, cookiecat, pizza truck), browse these tags and filter to **Downloadable +
CC0**:

- [everyday-objects](https://sketchfab.com/tags/everyday-objects)
- [funny](https://sketchfab.com/tags/funny)
- [low-poly-game-assets](https://sketchfab.com/tags/low-poly-game-assets)

Search terms that reliably surface jumpable, silly props: *low poly food*,
*kawaii*, *desk clutter*, *breakfast*, *arcade cabinet*, *traffic props*,
*bathroom*, *kitchen appliance*, *garden gnome*, *musical instrument*,
*stationery*.
