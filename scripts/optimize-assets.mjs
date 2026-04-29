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
  textureCompress,
  meshopt,
} from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { readdir, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SRC = path.resolve(process.argv[2] ?? '3dassets');
const OUT = path.resolve(process.argv[3] ?? 'public/assets/3d');
const MANIFEST = path.resolve('public/assets/manifest.json');
const PUBLIC_PREFIX = '/assets/3d';
const MAX_TEX = 2048;

async function main() {
  await mkdir(OUT, { recursive: true });

  const sources = await collectGltfFiles(SRC);
  if (sources.length === 0) {
    console.log(`[optimize] no .glb / .gltf in ${path.relative(process.cwd(), SRC)}; nothing to do.`);
    return;
  }

  // build the work list first so we can short-circuit if everything is fresh
  const work = [];
  const allItems = [];
  for (const src of sources) {
    const rel = path.relative(SRC, src).replace(/\\/g, '/');
    const id = makeId(rel);
    const outFile = path.join(OUT, `${id}.glb`);
    allItems.push({ id, file: `${id}.glb` });
    if (await isUpToDate(src, outFile)) continue;
    work.push({ src, rel, id, outFile });
  }

  if (work.length === 0) {
    console.log(`[optimize] ${sources.length} asset(s) already up to date.`);
    await updateManifest(allItems, /* silent */ true);
    return;
  }

  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  console.log(`[optimize] processing ${work.length} of ${sources.length} asset(s)...`);
  const processed = [];
  for (const { src, rel, id, outFile } of work) {
    const before = (await stat(src)).size;

    process.stdout.write(`  ${rel}  …  `);
    try {
      const doc = await io.read(src);
      await doc.transform(
        dedup(),
        prune(),
        weld(),
        resample(),
        textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [MAX_TEX, MAX_TEX] }),
        meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
      );
      await io.write(outFile, doc);
      const after = (await stat(outFile)).size;
      const saved = (1 - after / before) * 100;
      console.log(`${fmt(before)} → ${fmt(after)} (-${saved.toFixed(0)}%)`);
      processed.push({ id, file: `${id}.glb` });
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
  }

  // Manifest gets the full list so previously-processed items stay registered.
  await updateManifest(allItems);
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
      if (e.isDirectory()) await walk(p);
      else if (/\.(glb|gltf)$/i.test(e.name)) out.push(p);
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
