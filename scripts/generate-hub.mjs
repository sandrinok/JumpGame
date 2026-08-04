#!/usr/bin/env node
/**
 * Emit the villa's furniture as an editable level.
 *
 *   node scripts/generate-hub.mjs public/levels/hub.json
 *
 * The hub's architecture — terrace, loggia, columns, balustrade — stays in
 * code, because it carries the colliders the room depends on and its own
 * materials. Its *dressing* has no such constraints, and being able to drag the
 * sofa somewhere else without editing TypeScript is worth more than keeping it
 * next to the walls it sits between.
 *
 * This exists rather than a hand-written JSON because placements are authored
 * here in the units a person thinks in — "put a sofa at x=-9, three and a half
 * metres wide" — and the file wants them in the units the loader reads: a raw
 * scale multiplier, and an origin already offset so the model's feet land on
 * the floor. Both conversions need each asset's measured bounding box, which is
 * in data/platforms.json. Doing that arithmetic by hand once per prop is how a
 * chair ends up half-sunk into the terrace.
 *
 * Re-running it overwrites whatever the editor last saved. That is the trade:
 * this file is the starting layout, and the editor owns it afterwards.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

/**
 * Bounding boxes, measured from the models the game actually loads.
 *
 * data/platforms.json has sizes too, and using them was wrong: it records the
 * *source* assets, and the shipped ones are re-exported and optimised. For most
 * models the two agree; for the bushes the source says the geometry starts at
 * y=0 and the shipped one starts 0.7m lower, so every bush was planted more
 * than half a metre into the terrace. Reading the real file removes the whole
 * class of that bug rather than the two instances of it.
 */
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const MANIFEST = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8'));
const URL_BY_ID = new Map(
  MANIFEST.entries
    .filter((e) => e.asset?.kind === 'gltf' && e.asset.url)
    .map((e) => [e.id, e.asset.url]),
);

const boxCache = new Map();

/**
 * World-space bounds of a glTF.
 *
 * Uses glTF-Transform's own `getBounds` rather than walking the node tree and
 * reading each accessor's min/max, which is what this did and which was silently
 * wrong for **every single asset in the hub**.
 *
 * The shipped models are meshopt-compressed, so their POSITION accessors are
 * normalized 16-bit integers with the real scale carried in the node matrix.
 * `accessor.getMin()` returns the *storage* extreme — ±32767 — not the position
 * it stands for, so every bounding box came out about 65,000 units across, the
 * scale `width / longest` rounded to three decimals as `0.000`, and the entire
 * villa was furnished with objects scaled to nothing. Twenty-six sofas, lamps,
 * shelves, bushes and a moai, all present in the level file, all in the scene
 * graph, none of them occupying a single pixel. The room had been "dressed"
 * with 40k triangles of furniture that could not be seen.
 *
 * `getBounds` denormalizes the accessor and composes the node transforms, which
 * is exactly the arithmetic that was being reimplemented here — the reason to
 * reimplement it was to match what three does, and three gets this right by
 * running the same decode. Cross-checked against data/platforms.json, which
 * measures the *source* models: tree2 reads 6.368 x 5.747 x 6.136 from both.
 */
async function bounds(id) {
  if (boxCache.has(id)) return boxCache.get(id);
  const url = URL_BY_ID.get(id);
  if (!url) return null;
  const file = join('public', url.replace(/^\//, ''));
  if (!existsSync(file)) return null;

  const doc = await io.read(file);
  let box = null;
  for (const scene of doc.getRoot().listScenes()) {
    const b = getBounds(scene);
    if (!Number.isFinite(b.min[0]) || !Number.isFinite(b.max[0])) continue;
    box = {
      min: b.min,
      size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
    };
    break;
  }
  boxCache.set(id, box);
  return box;
}

/** Mirrors src/hub/villa.ts. Kept in step by hand; there are two numbers. */
const TERRACE = { w: 44, d: 38 };
const LOGGIA_Z = -15;

/**
 * The layout, in the units it was authored in.
 *
 * `width` is the size across the model's longest horizontal axis, in metres —
 * the same thing the code's `prop()` helper took, so the starting layout is
 * identical to what was there before it moved into this file.
 */
const DRESSING = [
  // The lounge, facing the view.
  ['tiny_contemporary_carpet', -9, 9, 10, 0],
  ['tiny_lovely_loveseat', -9, 5.4, 3.6, 0],
  ['tiny_lovely_armchair', -14.2, 9.5, 1.8, -1.2],
  ['tiny_lovely_armchair', -3.8, 9.5, 1.8, 1.2],
  ['tiny_sir_cumference_coffee_table', -9, 9.2, 1.6, 0],
  ['tiny_modern_pouffe', -6.4, 12.6, 1.0, 0],

  // A table by the rail.
  ['tiny_orbital_high_dining', TERRACE.w / 2 - 8, 16.2, 1.4, 0],
  ['tiny_lovely_dining_chair', TERRACE.w / 2 - 9.6, 16.2, 1.0, 1.5],
  ['tiny_lovely_dining_chair', TERRACE.w / 2 - 6.4, 16.2, 1.0, -1.5],

  // The wardrobe corner.
  ['tiny_miracle_mirror', -TERRACE.w / 2 + 3.1, LOGGIA_Z + 7.5, 0.9, 0.5],
  ['tiny_open_shelf', -TERRACE.w / 2 + 6.0, LOGGIA_Z + 7.6, 1.4, -0.4],

  // The kiosk corner.
  ['tiny_power_tower_bookcase', TERRACE.w / 2 - 2.9, LOGGIA_Z + 7.4, 1.6, -0.3],

  /*
   * Greenery.
   *
   * The four trees are the only things on the terrace taller than the player,
   * and that is what they are for. Everything else here is furniture height, so
   * the villa's whole silhouette was the loggia roof and a flat rail against
   * the sky — the eye had nothing between "waist high" and "building". Trees at
   * the corners give the terrace a middle, and standing under one on the way to
   * a portal is the only shade on the walk.
   *
   * Corners specifically, and never the middle: the walk from the spawn to any
   * pad runs up the centre of the terrace, and the one thing a hub must not do
   * is put scenery between the player and the doorway they picked. These sit
   * behind the lamps, outside the pool, and clear of both unfinished corners.
   */
  ['trees_and_bush_pack_tree2', -20, -1.5, 3.4, 0.4],
  ['trees_and_bush_pack_tree_small', -20, 16, 3.0, -0.8],
  ['trees_and_bush_pack_tree_small', 20, -0.5, 3.0, 1.1],
  ['trees_and_bush_pack_tree2', 5.5, 16.5, 3.4, -0.3],

  ['trees_and_bush_pack_bush_big2', -TERRACE.w / 2 + 3, 15.5, 2.4, 0],
  ['trees_and_bush_pack_bush_big2', TERRACE.w / 2 - 3, 15.5, 2.4, 0],
  ['trees_and_bush_pack_bush_med', -TERRACE.w / 2 + 4, 1.5, 1.8, 0],
  ['trees_and_bush_pack_bush_small', TERRACE.w / 2 - 4, 2.0, 1.3, 0],
  ['tiny_vertical_mini_garden', -TERRACE.w / 2 + 2.5, LOGGIA_Z + 4, 0.9, 0],
  ['tiny_vertical_mini_garden', TERRACE.w / 2 - 2.5, LOGGIA_Z + 4, 0.9, 0],

  // Lamps down the walk to the portals.
  ['japanese_street_lamp', -17, -4, 1.1, 0],
  ['japanese_street_lamp', -17, 2, 1.1, 0],
  ['japanese_street_lamp', 17, -4, 1.1, 0],
  ['japanese_street_lamp', 17, 2, 1.1, 0],

  // The jokes.
  ['garden_gnome', -TERRACE.w / 2 + 5.5, 15.0, 0.55, 0.6],
  ['moai_low_poly_game_ready', TERRACE.w / 2 - 5.5, -2.0, 2.0, -0.9],
];

/** Sitting on a table rather than the floor, so their y is given outright. */
const ON_FURNITURE = [
  ['tiny_the_modern_desk_lamp', -9.9, 0.62, 9.2, 0.45, 0],
  ['rubber_duck', -8.2, 0.62, 9.0, 0.4, -0.9],
];

const round = (n) => Math.round(n * 1000) / 1000;
let uid = 0;
const nextUid = () => `h${(uid++).toString(36)}`;

const missing = [];

/**
 * One placement, converted from authored units into the loader's.
 *
 * The scale is `width / longest horizontal extent`, and the origin is lifted by
 * the model's own minimum y so it stands on the surface rather than through it.
 */
async function place(id, x, y, z, width, yaw) {
  const m = await bounds(id);
  if (!m) {
    missing.push(id);
    return null;
  }
  const longest = Math.max(m.size[0], m.size[2]) || 1;
  const s = round(width / longest);
  return {
    id,
    uid: nextUid(),
    pos: [round(x), round(y - m.min[1] * s), round(z)],
    rot: [0, round(yaw), 0],
    scale: [s, s, s],
  };
}

const placements = (
  await Promise.all([
    ...DRESSING.map(([id, x, z, w, yaw]) => place(id, x, 0, z, w, yaw)),
    ...ON_FURNITURE.map(([id, x, y, z, w, yaw]) => place(id, x, y, z, w, yaw)),
  ])
).filter(Boolean);

const level = {
  // The hub has no run and no fail state, so neither of these is used by the
  // villa itself — but the level format requires them, and the editor will show
  // a spawn marker, so they are set to something that makes sense if anyone
  // ever loads this file in the game page by mistake.
  spawn: { pos: [0, 1.2, 2.5], yaw: round(Math.PI) },
  killY: -400,
  placements,
};

const out = resolve(process.argv[2] ?? 'public/levels/hub.json');
if (existsSync(out) && !process.argv.includes('--force')) {
  console.error(`[hub] ${out} already exists. Re-running would discard whatever`);
  console.error('[hub] the editor last saved there. Pass --force if that is the intent.');
  process.exitCode = 1;
} else {
  writeFileSync(out, `${JSON.stringify(level, null, 1)}\n`);
  console.log(`[hub] ${placements.length} furnishings -> ${out}`);
  console.log(`[hub] ${new Set(placements.map((p) => p.id)).size} distinct models, measured from the shipped glb`);
  if (missing.length) console.error(`[hub] MISSING from data/platforms.json: ${missing.join(', ')}`);
}
