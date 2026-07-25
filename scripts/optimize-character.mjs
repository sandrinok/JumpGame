#!/usr/bin/env node
/**
 * Optimize the player character + animation library for web delivery.
 *
 *   Source: 3dassets/character/ (raw asset-pack download, gitignored)
 *   Output: public/assets/character/ (committed, served by Vite)
 *
 * The raw pack ships every format (fbx / gltf / glb), every body variant and
 * uncompressed 4K PNGs — ~165MB of which we use one body and one clip set.
 * This produces two self-contained GLBs instead:
 *
 *   player.glb      the male full-body rig, WebP textures, meshopt-compressed
 *   animations.glb  the standard clip set with all mesh data stripped; only the
 *                   node hierarchy and the AnimationClips are needed, since the
 *                   clips are retargeted onto player.glb's skeleton at runtime.
 *
 * Both are meshopt-compressed, so any loader reading them must have
 * MeshoptDecoder registered (see src/game/character/rig.ts).
 *
 * Usage:
 *   npm run optimize-character
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, resample, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SRC = path.resolve('3dassets/character');
const OUT = path.resolve('public/assets/character');
const MAX_TEX = 1024;

const JOBS = [
  {
    name: 'player.glb',
    src: 'Universal Base Character/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf',
    stripMeshes: false,
  },
  {
    name: 'animations.glb',
    src: 'Universal Animation Library Standard/Unreal-Godot/UAL1_Standard.glb',
    stripMeshes: true,
  },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  await MeshoptEncoder.ready;

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  for (const job of JOBS) {
    const src = path.join(SRC, job.src);
    const outFile = path.join(OUT, job.name);

    let before;
    try {
      before = await sourceSize(src);
    } catch {
      console.log(`[character] source missing, skipping: ${job.src}`);
      continue;
    }
    if (await isUpToDate(src, outFile)) {
      console.log(`[character] ${job.name} already up to date.`);
      continue;
    }

    process.stdout.write(`  ${job.name}  …  `);
    const doc = await io.read(src);

    if (job.stripMeshes) {
      // Detach every mesh + skin; prune() then drops the orphaned meshes,
      // materials and textures. Node names survive, which is all the
      // AnimationClips reference.
      for (const node of doc.getRoot().listNodes()) {
        node.setMesh(null);
        node.setSkin(null);
      }
    }

    const transforms = [dedup(), prune(), resample()];
    if (!job.stripMeshes) {
      transforms.push(
        weld(),
        textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [MAX_TEX, MAX_TEX] }),
      );
    }
    transforms.push(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

    await doc.transform(...transforms);
    await io.write(outFile, doc);

    const after = (await stat(outFile)).size;
    const clips = doc.getRoot().listAnimations().length;
    console.log(
      `${fmt(before)} → ${fmt(after)} (-${((1 - after / before) * 100).toFixed(0)}%)` +
        (clips > 0 ? `, ${clips} clips` : ''),
    );
  }
}

/**
 * Real on-disk footprint of a source asset. A .glb is self-contained, but a
 * .gltf is a few KB of JSON pointing at a .bin and a pile of PNGs — reporting
 * only the JSON size would claim the pipeline made things bigger.
 */
async function sourceSize(src) {
  let total = (await stat(src)).size;
  if (!/\.gltf$/i.test(src)) return total;
  const dir = path.dirname(src);
  const json = JSON.parse(await readFile(src, 'utf8'));
  const uris = [...(json.buffers ?? []), ...(json.images ?? [])]
    .map((x) => x.uri)
    .filter((u) => u && !u.startsWith('data:'));
  for (const uri of new Set(uris)) {
    try {
      total += (await stat(path.join(dir, decodeURIComponent(uri)))).size;
    } catch {
      // referenced file missing on disk — nothing to count
    }
  }
  return total;
}

async function isUpToDate(src, out) {
  try {
    const [a, b] = await Promise.all([stat(src), stat(out)]);
    return b.mtimeMs >= a.mtimeMs;
  } catch {
    return false;
  }
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
