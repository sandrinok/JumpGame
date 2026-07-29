#!/usr/bin/env node
/**
 * Optimize raw glTF/GLB assets for web delivery.
 *
 *   Source: 3dassets/ (raw Sketchfab downloads, gitignored)
 *   Output: public/assets/3d/ (committed, served by Vite)
 *
 * Per asset:
 *   - dedup, prune, weld, resample
 *   - re-encode textures to WebP (resized to <= MAX_TEX)
 *   - apply EXT_meshopt_compression (runtime decoded by MeshoptDecoder)
 *
 * Also appends new entries to public/assets/manifest.json with
 * sensible defaults (kind: gltf, collider: trimesh). Existing
 * manifest entries are NEVER modified — tweak collider / tags by hand.
 *
 * Usage:
 *   npm run optimize-assets                # default paths
 *   npm run optimize-assets -- src/ out/   # override paths
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  prune,
  weld,
  resample,
  metalRough,
  textureCompress,
  meshopt,
  flatten,
  join,
  palette,
  simplify,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { flattenSolidTextures } from './lib/flatten-solid-textures.mjs';
import { MAX_TEX, textureCapFor } from './lib/texture-budget.mjs';
import sharp from 'sharp';
import { readdir, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SRC = path.resolve(process.argv[2] ?? '3dassets');
const OUT = path.resolve(process.argv[3] ?? 'public/assets/3d');
const MANIFEST = path.resolve('public/assets/manifest.json');
const PUBLIC_PREFIX = '/assets/3d';

/**
 * Texture memory one prop may occupy on the GPU, in megabytes. See
 * scripts/lib/texture-budget.mjs for why this is a memory figure and not a
 * resolution. An audit before this existed found 711MB across 129 props, with
 * one crane accounting for 272MB of it.
 */
const TEXTURE_BUDGET_MB = 8;

/**
 * Triangles above which a model is simplified, and the count it is aimed at.
 *
 * Generous on purpose: this is a safety net for the occasional photoscanned or
 * CAD-derived download, not a general quality reduction.
 */
const SIMPLIFY_ABOVE_TRIS = 25000;
const SIMPLIFY_TARGET_TRIS = 15000;

/**
 * Bumped whenever the steps below change in a way that should invalidate what
 * is already in public/assets/3d. Without it the mtime check would consider
 * every asset up to date and a pipeline improvement would reach nothing.
 */
const PIPELINE_VERSION = 2;
/**
 * Subdirectories of SRC this script ignores.
 *
 * `character` is the player rig: a skeleton and clip set with its own
 * requirements, handled by scripts/optimize-character.mjs. Without this it
 * would land in the level palette as a few dozen placeable body parts.
 *
 * `packs` holds multi-object asset packs, which are useless as a single
 * placement — the whole pack would drop into the level as one object. Run
 * scripts/split-pack.mjs on those; it writes the individual props to the
 * SRC root, where they are picked up normally.
 */
const EXCLUDE_DIRS = new Set(['character', 'packs']);

async function main() {
  await mkdir(OUT, { recursive: true });

  const sources = await collectGltfFiles(SRC);
  if (sources.length === 0) {
    console.log(`[optimize] no .glb / .gltf in ${path.relative(process.cwd(), SRC)}; nothing to do.`);
    return;
  }

  // build the work list first so we can short-circuit if everything is fresh
  const stale = await pipelineChanged();
  if (stale) console.log(`[optimize] pipeline v${PIPELINE_VERSION}: reprocessing everything.`);
  const work = [];
  const allItems = [];
  for (const src of sources) {
    const rel = path.relative(SRC, src).replace(/\\/g, '/');
    const id = makeId(rel);
    const outFile = path.join(OUT, `${id}.glb`);
    allItems.push({ id, file: `${id}.glb` });
    if (!stale && (await isUpToDate(src, outFile))) continue;
    work.push({ src, rel, id, outFile });
  }

  if (work.length === 0) {
    console.log(`[optimize] ${sources.length} asset(s) already up to date.`);
    await updateManifest(allItems, /* silent */ true);
    return;
  }

  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    // The decoder is registered as well as the encoder so the script can read
    // its own output. Raw downloads are never meshopt-compressed, so this looks
    // unnecessary until an asset's original goes missing and the only copy left
    // is the optimized one — at which point without it the file cannot be
    // opened at all.
    .registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptDecoder,
    });

  console.log(`[optimize] processing ${work.length} of ${sources.length} asset(s)...`);
  const processed = [];
  for (const { src, rel, id, outFile } of work) {
    const before = (await stat(src)).size;

    process.stdout.write(`  ${rel}  …  `);
    try {
      const doc = await io.read(src);
      const report = {};

      await doc.transform(
        // Some Sketchfab downloads still use KHR_materials_pbrSpecularGlossiness,
        // which three.js dropped support for — it logs "Unknown extension" and
        // renders the model with default grey materials. Convert to metallic
        // roughness before anything touches the textures.
        metalRough(),
        dedup(),
        // Before anything else looks at textures: drop the ones that hold a
        // single colour. It both frees the memory and turns their materials
        // into factor-only ones, which is what lets palette() and join() below
        // collapse them together.
        flattenSolidTextures(report),
        prune(),
      );

      // Fewer draw calls. Each primitive is one call per placement, and a
      // download built from separately-modelled parts arrives with dozens —
      // the crane had twenty-five. Flattening the hierarchy first is what
      // allows join() to see that they share a material.
      const primitivesBefore = countPrimitives(doc);
      await doc.transform(
        flatten(),
        palette({ min: 3 }),
        join(),
        dedup(),
      );

      await doc.transform(weld());
      const triangles = countTriangles(doc);
      if (triangles > SIMPLIFY_ABOVE_TRIS) {
        await doc.transform(
          simplify({
            simplifier: MeshoptSimplifier,
            ratio: SIMPLIFY_TARGET_TRIS / triangles,
            // Bounded by visual error rather than the ratio alone, so a model
            // that cannot lose detail without deforming keeps its triangles.
            error: 0.005,
          }),
        );
      }

      const texCap = textureCapFor(doc, TEXTURE_BUDGET_MB);
      await doc.transform(
        resample(),
        textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texCap, texCap] }),
        prune(),
        meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
      );

      await io.write(outFile, doc);
      const after = (await stat(outFile)).size;
      const saved = (1 - after / before) * 100;
      const notes = [];
      if (report.solidTexturesRemoved) notes.push(`-${report.solidTexturesRemoved} flat tex`);
      if (texCap < MAX_TEX) notes.push(`tex→${texCap}`);
      const primitivesAfter = countPrimitives(doc);
      if (primitivesAfter < primitivesBefore) notes.push(`${primitivesBefore}→${primitivesAfter} draws`);
      const trianglesAfter = countTriangles(doc);
      if (trianglesAfter < triangles) notes.push(`${fmtCount(triangles)}→${fmtCount(trianglesAfter)} tris`);
      console.log(
        `${fmt(before)} → ${fmt(after)} (-${saved.toFixed(0)}%)` +
          (notes.length ? `  [${notes.join(', ')}]` : ''),
      );
      processed.push({ id, file: `${id}.glb` });
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
  }

  // Manifest gets the full list so previously-processed items stay registered.
  await updateManifest(allItems);
  await markPipelineVersion();
  console.log(`[optimize] ${processed.length} asset(s) written to ${path.relative(process.cwd(), OUT)}.`);
}

async function isUpToDate(src, out) {
  try {
    const [a, b] = await Promise.all([stat(src), stat(out)]);
    return b.mtimeMs >= a.mtimeMs;
  } catch {
    return false;
  }
}

/**
 * Has the pipeline itself changed since these outputs were written?
 *
 * The mtime check answers "is the source newer than the output", which is the
 * wrong question after the steps change: every source is older, so nothing is
 * reprocessed and an improvement to this script silently reaches no asset.
 */
async function pipelineChanged() {
  try {
    const stamp = await readFile(path.join(OUT, '.pipeline-version'), 'utf8');
    return Number(stamp.trim()) !== PIPELINE_VERSION;
  } catch {
    return true;
  }
}

async function markPipelineVersion() {
  await writeFile(path.join(OUT, '.pipeline-version'), `${PIPELINE_VERSION}\n`);
}

function countPrimitives(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) n += mesh.listPrimitives().length;
  return n;
}

function countTriangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      n += (idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3;
    }
  }
  return Math.round(n);
}

function fmtCount(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
}

async function collectGltfFiles(dir) {
  const out = [];
  const walk = async (d) => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (d === dir && EXCLUDE_DIRS.has(e.name)) continue;
        await walk(p);
      } else if (/\.(glb|gltf)$/i.test(e.name)) out.push(p);
    }
  };
  await walk(dir);
  return out;
}

function makeId(rel) {
  return rel
    .replace(/\.(glb|gltf)$/i, '')
    .replace(/[\\/]/g, '_')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .toLowerCase();
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

async function updateManifest(items, silent = false) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  } catch {
    manifest = { version: 1, entries: [] };
  }
  const existing = new Set(manifest.entries.map((e) => e.id));
  let added = 0;
  for (const { id, file } of items) {
    if (existing.has(id)) continue;
    manifest.entries.push({
      id,
      asset: {
        kind: 'gltf',
        url: `${PUBLIC_PREFIX}/${file}`,
        collider: 'trimesh',
      },
      tags: ['imported'],
    });
    added++;
  }
  if (added > 0) {
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    if (!silent) console.log(`[optimize] added ${added} new entries to manifest.json (existing untouched).`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
