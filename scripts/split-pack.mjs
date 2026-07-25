#!/usr/bin/env node
/**
 * Split an asset pack into individual placeable models.
 *
 * Sketchfab packs arrive as one .glb holding dozens of props laid out side by
 * side. Dropped into the level as a single asset that is useless — you get the
 * entire pack in one placement. This extracts each prop into its own file under
 * 3dassets/, where the normal pipeline (optimize-assets) picks it up: WebP,
 * meshopt, a manifest entry, and a credits entry.
 *
 * Each extracted prop is:
 *   - flattened, so the transform it had inside the pack is baked in
 *   - recentred on X/Z and dropped so its base sits at y=0, which is what the
 *     editor's place-on-surface expects
 *   - given the pack's author/licence, so attribution survives the split
 *
 * Usage:
 *   node scripts/split-pack.mjs "<pack.glb>" --dry            # list what it would produce
 *   node scripts/split-pack.mjs "<pack.glb>" --depth 2       # descend one level of folders
 *   node scripts/split-pack.mjs "<pack.glb>" --prefix city    # write the files
 *   node scripts/split-pack.mjs "<pack.glb>" --only "Building"
 *   node scripts/split-pack.mjs "<pack.glb>" --min-size 0.2   # skip tiny fragments
 */

import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { clearNodeParent, getBounds, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const SRC = argv.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const DRY = argv.includes('--dry');
const OUT = path.resolve(flag('out', '3dassets'));
const ONLY = flag('only', null);
const MIN_SIZE = Number(flag('min-size', 0));
const PREFIX = flag('prefix', null);
const DEPTH = Number(flag('depth', 1));
/**
 * Scale the whole pack so the median prop's largest dimension is this many
 * world units. Packs arrive in whatever unit their author used — one has
 * benches 134 units long, another has buildings 0.2 units tall — and the player
 * capsule is about 2 units. Deriving one factor from the median normalises the
 * pack without flattening the size differences inside it, which is what scaling
 * each prop to a fixed size would do.
 */
const AUTO_SCALE = flag('auto-scale', null) === null ? null : Number(flag('auto-scale'));

if (!SRC) {
  console.error('usage: split-pack.mjs <pack.glb> [--dry] [--prefix p] [--only regex] [--min-size n]');
  process.exit(1);
}

/**
 * Walk down to the node whose children are the actual props.
 *
 * Exporters bury everything under a chain of single-child wrappers
 * (Sketchfab_model > root > GLTF_SceneRootNode > ...), which carry no meaning.
 */
function findContainer(scene) {
  let node = scene.listChildren()[0];
  if (!node) return null;
  while (node.listChildren().length === 1 && !node.getMesh()) {
    node = node.listChildren()[0];
  }
  return node;
}

function hasGeometry(node) {
  if (node.getMesh()) return true;
  return node.listChildren().some(hasGeometry);
}

/**
 * Collect the nodes exactly `depth` levels below the container.
 *
 * Depth is explicit rather than inferred because "is this a prop or a folder"
 * is a semantic question, not a structural one. TinyLiving_MurphyBed is a
 * named group wrapping a mesh node called Object_4; Buildings is a folder
 * wrapping nine of those. They look identical to a heuristic, and guessing
 * wrong either fragments props into parts or leaves whole categories glued
 * together. Run with --dry to see what a given depth produces.
 */
function collectProps(node, depth) {
  if (depth <= 0) return hasGeometry(node) ? [node] : [];
  const children = node.listChildren();
  if (children.length === 0) return hasGeometry(node) ? [node] : [];
  return children.flatMap((c) => collectProps(c, depth - 1));
}

function slug(name, fallback) {
  const cleaned = (name || '')
    // Strip the pack name repeated on every object, and exporter index suffixes.
    .replace(/^(TinyLiving|TinytLiving|Props with out snow|Low_?Poly_?Simple_?Urban_?City)[_\s-]*/i, '')
    .replace(/[_.]\d+$/, '')
    .replace(/\.\d+$/, '')
    // CamelCase -> spaced, so MurphyBed becomes murphy_bed
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return cleaned || fallback;
}

async function main() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  // Read once to enumerate; each extraction re-reads so it starts from a clean
  // document rather than one already mutated by the previous prop.
  const probe = await io.read(SRC);
  probe.setLogger(new Logger(Logger.Verbosity.ERROR));
  const probeScene = probe.getRoot().getDefaultScene() ?? probe.getRoot().listScenes()[0];
  const container = findContainer(probeScene);
  if (!container) {
    console.error('no scene content found');
    process.exit(1);
  }
  const probeProps = collectProps(container, DEPTH);
  const names = probeProps.map((n) => n.getName());
  const extras = probe.getRoot().getExtras() ?? {};

  let factor = 1;
  if (AUTO_SCALE !== null) {
    const spans = probeProps
      .map((n) => {
        const b = getBounds(n);
        return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      })
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    const median = spans[Math.floor(spans.length / 2)];
    if (median > 0) factor = AUTO_SCALE / median;
    console.log(
      `[split] median prop spans ${median.toFixed(2)}u -> scaling pack by ${factor.toFixed(4)}`,
    );
  }

  const base = PREFIX ?? slug(path.basename(SRC, path.extname(SRC)), 'pack');
  const re = ONLY ? new RegExp(ONLY, 'i') : null;

  console.log(`[split] ${path.basename(SRC)} at depth ${DEPTH} -> ${names.length} props`);
  if (extras.license) console.log(`[split] licence: ${String(extras.license).split(' ')[0]}`);

  if (!DRY) await mkdir(OUT, { recursive: true });

  const used = new Set();
  let written = 0;
  let skipped = 0;

  for (let i = 0; i < names.length; i++) {
    if (re && !re.test(names[i] ?? '')) continue;

    const doc = await io.read(SRC);
    doc.setLogger(new Logger(Logger.Verbosity.ERROR));
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
    const props = collectProps(findContainer(scene), DEPTH);
    const target = props[i];
    if (!target) continue;

    // Detach from the pack hierarchy, baking the accumulated parent transform
    // into the node itself, then drop everything else.
    clearNodeParent(target);
    for (const child of scene.listChildren()) {
      if (child !== target) child.dispose();
    }
    await doc.transform(prune());

    if (factor !== 1) {
      const s0 = target.getScale();
      target.setScale([s0[0] * factor, s0[1] * factor, s0[2] * factor]);
      const t0 = target.getTranslation();
      target.setTranslation([t0[0] * factor, t0[1] * factor, t0[2] * factor]);
    }

    const box = getBounds(scene);
    const size = [
      box.max[0] - box.min[0],
      box.max[1] - box.min[1],
      box.max[2] - box.min[2],
    ];
    const largest = Math.max(...size);
    if (!Number.isFinite(largest) || largest <= 0 || largest < MIN_SIZE) {
      skipped++;
      continue;
    }

    // Recentre horizontally and stand it on y=0, so dropping it in the editor
    // lands it on the surface instead of floating or half-buried.
    const t = target.getTranslation();
    target.setTranslation([
      t[0] - (box.min[0] + box.max[0]) / 2,
      t[1] - box.min[1],
      t[2] - (box.min[2] + box.max[2]) / 2,
    ]);

    // Attribution has to travel with the split, or the credits screen loses it.
    doc.getRoot().setExtras({ ...extras });

    let id = `${base}_${slug(names[i], `part_${i}`)}`;
    let n = 2;
    while (used.has(id)) id = `${base}_${slug(names[i], `part_${i}`)}_${n++}`;
    used.add(id);

    const dims = size.map((v) => v.toFixed(1)).join('x');
    if (DRY) {
      console.log(`   ${id.padEnd(46)} ${dims}`);
    } else {
      await io.write(path.join(OUT, `${id}.glb`), doc);
      written++;
    }
  }

  if (DRY) console.log(`[split] dry run: ${names.length - skipped} file(s) would be written`);
  else console.log(`[split] wrote ${written} file(s) to ${path.relative(process.cwd(), OUT)}`);
  if (skipped > 0) console.log(`[split] skipped ${skipped} empty or sub-${MIN_SIZE} prop(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
