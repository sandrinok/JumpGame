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
 *   animations.glb  the clips the game actually plays, with all mesh data
 *                   stripped; only the node hierarchy and the AnimationClips
 *                   are needed, since the clips are retargeted onto
 *                   player.glb's skeleton at runtime. See KEEP_CLIPS.
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
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { flattenSolidTextures } from './lib/flatten-solid-textures.mjs';
import { textureCapFor } from './lib/texture-budget.mjs';

const SRC = path.resolve('3dassets/character');
const OUT = path.resolve('public/assets/character');

/**
 * Texture memory the player rig may occupy, in megabytes.
 *
 * The rig arrived with five 1024 maps — 27MB, making it the single most
 * expensive asset in the game and the one guaranteed to be resident, since the
 * player is always on screen. In a third-person view the character covers a few
 * hundred pixels of a 1080p frame; five megapixels of texture to fill that is
 * roughly an order of magnitude more than the screen can show.
 */
const TEXTURE_BUDGET_MB = 8;

/**
 * Clips kept from the animation library.
 *
 * The pack ships forty-five — combat, swimming, sitting, spellcasting, driving.
 * The game has one movement state machine and reaches for six of them, but all
 * forty-five were downloaded, decoded and held in memory on every load.
 *
 * Names must match what src/game/character/rig.ts looks up; it searches
 * case-insensitively and takes the first hit, so these are the winning
 * alternates rather than the whole list it will try. Adding a character state
 * means adding its clip here and re-running this script.
 */
const KEEP_CLIPS = new Set(
  ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land'].map((n) =>
    n.toLowerCase(),
  ),
);

/**
 * Bumped when the steps below change in a way that should invalidate what is
 * already in public/assets/character. The mtime check alone would call every
 * output up to date and an improvement here would reach nothing.
 */
const PIPELINE_VERSION = 2;

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
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    // Decoder as well as encoder, so the script can read back its own output if
    // a raw source ever goes missing.
    .registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptDecoder,
    });

  const stale = await pipelineChanged();
  if (stale) console.log(`[character] pipeline v${PIPELINE_VERSION}: rebuilding.`);

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
    if (!stale && (await isUpToDate(src, outFile))) {
      console.log(`[character] ${job.name} already up to date.`);
      continue;
    }

    process.stdout.write(`  ${job.name}  …  `);
    const doc = await io.read(src);
    const notes = [];

    if (job.stripMeshes) {
      // Detach every mesh + skin; prune() then drops the orphaned meshes,
      // materials and textures. Node names survive, which is all the
      // AnimationClips reference.
      for (const node of doc.getRoot().listNodes()) {
        node.setMesh(null);
        node.setSkin(null);
      }
      const all = doc.getRoot().listAnimations();
      let dropped = 0;
      for (const clip of all) {
        if (KEEP_CLIPS.has(clip.getName().toLowerCase())) continue;
        // Channels and samplers have to go explicitly. Disposing only the clip
        // detaches it but leaves its samplers behind as orphans that still
        // reference their accessors, so prune() sees the keyframe data as live
        // and keeps every byte of it — the file loses its clip list and none of
        // its weight.
        for (const channel of clip.listChannels()) channel.dispose();
        for (const sampler of clip.listSamplers()) sampler.dispose();
        clip.dispose();
        dropped++;
      }
      if (dropped) notes.push(`${all.length}→${all.length - dropped} clips`);
    }

    const report = {};
    const transforms = [dedup()];
    if (!job.stripMeshes) transforms.push(flattenSolidTextures(report));
    transforms.push(prune(), resample());
    await doc.transform(...transforms);

    if (!job.stripMeshes) {
      const cap = textureCapFor(doc, TEXTURE_BUDGET_MB);
      await doc.transform(
        weld(),
        textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cap, cap] }),
        prune(),
      );
      if (report.solidTexturesRemoved) notes.push(`-${report.solidTexturesRemoved} flat tex`);
      notes.push(`tex→${cap}`);
    }
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

    await io.write(outFile, doc);

    const after = (await stat(outFile)).size;
    console.log(
      `${fmt(before)} → ${fmt(after)} (-${((1 - after / before) * 100).toFixed(0)}%)` +
        (notes.length ? `  [${notes.join(', ')}]` : ''),
    );
  }

  await writeFile(path.join(OUT, '.pipeline-version'), `${PIPELINE_VERSION}\n`);
}

async function pipelineChanged() {
  try {
    const stamp = await readFile(path.join(OUT, '.pipeline-version'), 'utf8');
    return Number(stamp.trim()) !== PIPELINE_VERSION;
  } catch {
    return true;
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
