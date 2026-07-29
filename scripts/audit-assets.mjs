#!/usr/bin/env node
/**
 * Report what each optimized asset actually costs.
 *
 * File size tells you about download time and nothing else. What decides
 * whether a level runs on a laptop is triangle count, how many draw calls a
 * model needs, and above all texture memory — a WebP is small on disk and
 * enormous once the GPU expands it to RGBA with mips, which is the number
 * nobody sees until the machine starts swapping.
 *
 *   npm run audit-assets            # table, worst first
 *   npm run audit-assets -- --json  # machine readable
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';

const DIRS = [path.resolve('public/assets/3d'), path.resolve('public/assets/character')];
const MANIFEST = path.resolve('public/assets/manifest.json');
const asJson = process.argv.includes('--json');

/**
 * Bytes a texture occupies on the GPU once decoded.
 *
 * Uncompressed RGBA, plus a third again for the mip chain. This is what the
 * driver allocates regardless of how well the PNG or WebP compressed.
 */
function vramBytes(width, height) {
  return width * height * 4 * (4 / 3);
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

async function main() {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

  let manifest = { entries: [] };
  try {
    manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  } catch {
    // Auditing raw files without a manifest is still useful.
  }
  const colliderById = new Map(manifest.entries.map((e) => [e.id, e.asset?.collider]));

  const files = [];
  for (const dir of DIRS) {
    let names;
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const n of names) if (n.endsWith('.glb')) files.push(path.join(dir, n));
  }

  const rows = [];
  for (const file of files) {
    const id = path.basename(file, '.glb');
    let doc;
    try {
      doc = await io.read(file);
    } catch (e) {
      console.error(`  ${id}: unreadable (${e.message})`);
      continue;
    }
    const root = doc.getRoot();

    let triangles = 0;
    let vertices = 0;
    let primitives = 0;
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        primitives++;
        const pos = prim.getAttribute('POSITION');
        const idx = prim.getIndices();
        if (pos) vertices += pos.getCount();
        triangles += (idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3;
      }
    }

    let vram = 0;
    const sizes = [];
    for (const tex of root.listTextures()) {
      const size = tex.getSize();
      if (!size) continue;
      sizes.push(`${size[0]}x${size[1]}`);
      vram += vramBytes(size[0], size[1]);
    }

    rows.push({
      id,
      bytes: (await stat(file)).size,
      triangles: Math.round(triangles),
      vertices,
      primitives,
      textures: sizes.length,
      textureSizes: sizes,
      vram,
      collider: colliderById.get(id) ?? '-',
    });
  }

  rows.sort((a, b) => b.vram + b.triangles * 200 - (a.vram + a.triangles * 200));

  if (asJson) {
    console.log(JSON.stringify(rows, null, 1));
    return;
  }

  const total = rows.reduce(
    (acc, r) => ({
      bytes: acc.bytes + r.bytes,
      triangles: acc.triangles + r.triangles,
      vram: acc.vram + r.vram,
    }),
    { bytes: 0, triangles: 0, vram: 0 },
  );

  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  console.log(
    `${pad('asset', 46)} ${num('file', 8)} ${num('tris', 8)} ${num('prims', 6)} ${num('vram', 8)}  textures`,
  );
  console.log('-'.repeat(110));
  for (const r of rows) {
    console.log(
      `${pad(r.id.slice(0, 46), 46)} ${num(fmt(r.bytes), 8)} ${num(r.triangles.toLocaleString(), 8)} ` +
        `${num(r.primitives, 6)} ${num(fmt(r.vram), 8)}  ${r.textureSizes.join(' ') || '-'}`,
    );
  }
  console.log('-'.repeat(110));
  console.log(
    `${pad(`${rows.length} assets`, 46)} ${num(fmt(total.bytes), 8)} ${num(total.triangles.toLocaleString(), 8)} ` +
      `${num('', 6)} ${num(fmt(total.vram), 8)}  <- if every asset were resident`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
