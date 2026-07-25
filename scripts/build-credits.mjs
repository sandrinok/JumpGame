#!/usr/bin/env node
/**
 * Generate public/assets/credits.json from the assets themselves.
 *
 * Sketchfab embeds attribution in every download under glTF `asset.extras`,
 * and gltf-transform carries it through the optimizer untouched. So the
 * credits are derived from the files that actually ship rather than from a
 * hand-maintained list that silently rots the moment someone adds a model.
 *
 * Anything without embedded metadata (the character rig, which came from a
 * pack rather than Sketchfab) is declared in MANUAL below.
 *
 * Runs automatically on dev/build. Output is sorted and timestamp-free, so
 * regenerating it produces no diff unless the assets actually changed.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ASSET_DIR = path.resolve('public/assets/3d');
const OUT = path.resolve('public/assets/credits.json');

/** Assets whose licence is not embedded in the file. */
const MANUAL = [
  {
    title: 'Universal Base Character',
    author: 'Quaternius',
    authorUrl: 'https://quaternius.com',
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    source: 'https://quaternius.com',
  },
  {
    title: 'Universal Animation Library',
    author: 'Quaternius',
    authorUrl: 'https://quaternius.com',
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    source: 'https://quaternius.com',
  },
];

/** Sketchfab writes "Name (url)" for author and "LICENSE (url)" for license. */
function splitNameAndUrl(value) {
  if (typeof value !== 'string') return { name: '', url: '' };
  const m = value.match(/^(.*?)\s*\((https?:\/\/[^)]+)\)\s*$/);
  return m ? { name: m[1].trim(), url: m[2] } : { name: value.trim(), url: '' };
}

/** Read the JSON chunk of a .glb without pulling in a glTF library. */
async function readGlbJson(file) {
  const buf = await readFile(file);
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return null; // 'glTF'
  const jsonLength = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
}

async function main() {
  const entries = [...MANUAL];
  const missing = [];

  let files = [];
  try {
    files = (await readdir(ASSET_DIR)).filter((f) => f.toLowerCase().endsWith('.glb'));
  } catch {
    console.warn(`[credits] ${path.relative(process.cwd(), ASSET_DIR)} not found; nothing to do.`);
  }

  for (const file of files.sort()) {
    const gltf = await readGlbJson(path.join(ASSET_DIR, file)).catch(() => null);
    const extras = gltf?.asset?.extras;
    if (!extras?.author) {
      missing.push(file);
      continue;
    }
    const author = splitNameAndUrl(extras.author);
    const license = splitNameAndUrl(extras.license);
    entries.push({
      title: extras.title || file.replace(/\.glb$/i, ''),
      author: author.name,
      authorUrl: author.url,
      license: license.name || 'Unknown',
      licenseUrl: license.url,
      source: extras.source || '',
    });
  }

  entries.sort((a, b) => a.title.localeCompare(b.title) || a.author.localeCompare(b.author));
  await writeFile(OUT, JSON.stringify({ entries }, null, 2) + '\n');

  const byLicense = entries.reduce((acc, e) => {
    acc[e.license] = (acc[e.license] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `[credits] ${entries.length} entries -> ${path.relative(process.cwd(), OUT)}  (` +
      Object.entries(byLicense)
        .map(([l, n]) => `${l}: ${n}`)
        .join(', ') +
      ')',
  );

  if (missing.length > 0) {
    // Loud on purpose: an uncredited asset on a public site is the exact
    // problem this file exists to prevent.
    console.warn(
      `[credits] WARNING: no embedded attribution in ${missing.length} file(s): ${missing.join(', ')}\n` +
        '[credits] Add them to MANUAL in scripts/build-credits.mjs.',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
