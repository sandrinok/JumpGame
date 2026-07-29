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

/**
 * Assets whose licence is not embedded in the file.
 *
 * Sketchfab writes attribution into glTF `asset.extras`, but only for models
 * downloaded as glTF. Anything that arrived as FBX or OBJ and was converted
 * through Blender, or was split out of a pack, has lost it — the credit still
 * has to be given, so it is declared here instead.
 *
 * `files` says which files in ASSET_DIR an entry covers, so the warning below
 * can tell "credited by hand" from "not credited at all". A name ending in `*`
 * matches by prefix, which is how one pack entry covers the dozens of props
 * split out of it. An entry covering nothing is reported too: without that,
 * this list quietly rots as assets are renamed or removed.
 */
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

  // Sketchfab models downloaded as FBX, OBJ, or as glTF that arrived without
  // the usual asset.extras block. Looked up against Sketchfab's own API rather
  // than by matching titles: several slugs have a dozen unrelated models
  // sharing them, and the right one was settled by publish date against the
  // download's timestamp and by polygon count against its file size.
  {
    title: 'Camper ps1 spec',
    author: 'Arrangemonk',
    authorUrl: 'https://sketchfab.com/Arrangemonk9000',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/camper-ps1-spec-bf44c46b2d024819bfe6f289cb1b14a4',
    files: ['camper_ps1_spec.glb'],
  },
  {
    // The superscript is the real title; the slug flattens it to "1282".
    title: 'Camper with 128² texture',
    author: 'Arrangemonk',
    authorUrl: 'https://sketchfab.com/Arrangemonk9000',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/camper-with-1282-texture-f7e84c1f96e647f68ead3ca2ecf5c43a',
    files: ['camper_with_1282_texture.glb'],
  },
  {
    title: 'DDR2 memory low poly psx',
    author: 'DinixLowPoly',
    authorUrl: 'https://sketchfab.com/DinixGlasses',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/ddr2-memory-low-poly-psx-7f9445fe91724318b985aad275e5fb31',
    files: ['ddr2_memory_low_poly_psx.glb'],
  },
  {
    title: 'dirty Sink',
    author: 'Arrangemonk',
    authorUrl: 'https://sketchfab.com/Arrangemonk9000',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/dirty-sink-4ef085d237bf40bebeb6d3bd5080c943',
    files: ['dirty_sink.glb'],
  },
  {
    title: 'Garden Gnome',
    author: 'Arrangemonk',
    authorUrl: 'https://sketchfab.com/Arrangemonk9000',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/garden-gnome-49d2473cbab64bc2b334fa8dc42aa181',
    files: ['garden_gnome.glb'],
  },
  {
    title: 'hdd low poly psx',
    author: 'DinixLowPoly',
    authorUrl: 'https://sketchfab.com/DinixGlasses',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/hdd-low-poly-psx-459912a583e44bb3b76362dcec52a7c4',
    files: ['hdd_low_poly_psx.glb'],
  },
  {
    title: 'lowpoly notebook',
    author: 'Arrangemonk',
    authorUrl: 'https://sketchfab.com/Arrangemonk9000',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/lowpoly-notebook-fbb7a3d0a981473abf934415f5b91cfa',
    files: ['lowpoly_notebook.glb'],
  },
  {
    title: 'MOAI | Low Poly | Game-Ready',
    author: 'lynnthefigs',
    authorUrl: 'https://sketchfab.com/lynnthefigs',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/moai-low-poly-game-ready-e8821b6b54504268bd0ba2927fef9377',
    files: ['moai_low_poly_game_ready.glb'],
  },
  {
    title: 'PSX Birch Tree',
    author: 'Arimantos',
    authorUrl: 'https://sketchfab.com/Arimantos',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/psx-birch-tree-029c523a48054e05b95f1fbd9e987226',
    files: ['psx_birch_tree.glb'],
  },
  {
    // ShareAlike, unlike everything else here: adaptations have to carry the
    // same licence, and the optimizer does adapt them.
    title: 'PSX Low-poly Acoustic Guitar',
    author: 'korkskrew2000',
    authorUrl: 'https://sketchfab.com/korkskrew2000',
    license: 'CC-BY-SA-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by-sa/4.0/',
    source: 'https://sketchfab.com/3d-models/psx-low-poly-acoustic-guitar-cbfcf5f9f23645daa8bdc34ff6b84026',
    files: ['psx_low_poly_acoustic_guitar.glb'],
  },
  {
    title: 'PSX Low-poly Shopping Cart',
    author: 'korkskrew2000',
    authorUrl: 'https://sketchfab.com/korkskrew2000',
    license: 'CC-BY-SA-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by-sa/4.0/',
    source: 'https://sketchfab.com/3d-models/psx-low-poly-shopping-cart-d64b194a1f2c4715b334bde8d3b267ca',
    files: ['psx_low_poly_shopping_cart.glb'],
  },
  {
    // Display name and profile URL genuinely differ here; both are as
    // Sketchfab records them.
    title: 'PSX prop - Old Garage',
    author: 'Wardster',
    authorUrl: 'https://sketchfab.com/WardsterSAW',
    license: 'SKETCHFAB Standard',
    licenseUrl: 'https://sketchfab.com/licenses',
    source: 'https://sketchfab.com/3d-models/psx-prop-old-garage-192c06f284b5454f83ab081ef23f6567',
    files: ['psx_prop_old_garage.glb'],
  },
  {
    title: 'Emergency Power Station (PS1)',
    author: 'S1lMoon',
    authorUrl: 'https://sketchfab.com/s1lmoon',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/emergency-power-station-ps1-389f5331f49744dfa82a45fabb75d740',
    files: ['emergency_power_station_ps1.glb'],
  },
  {
    title: 'PS1/Lowpoly Gravestone',
    author: 'dro',
    authorUrl: 'https://sketchfab.com/drolavellan',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/ps1lowpoly-gravestone-acab7d41a2254cf9bde83bdff2f74890',
    files: ['ps1lowpoly_gravestone.glb'],
  },
  {
    title: 'ps1_tree_bulbus',
    author: 'Arrangemonk',
    authorUrl: 'https://sketchfab.com/Arrangemonk9000',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/ps1-tree-bulbus-f7e871f7b2484b88a26d1f97d34add5f',
    files: ['ps1_tree_bulbus.glb'],
  },
  {
    title: 'PSX Adrenaline Syringe',
    author: 'ZwiebelGames',
    authorUrl: 'https://sketchfab.com/ZwiebelGames',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/psx-adrenaline-syringe-97547a325dfc499cb3ffbb8abaa17c2a',
    files: ['psx_adrenaline_syringe.glb'],
  },
  {
    title: 'Retro Lowpoly Toilet Paper',
    author: 'lonesomeducky',
    authorUrl: 'https://sketchfab.com/lonesomeducky',
    license: 'SKETCHFAB Standard',
    licenseUrl: 'https://sketchfab.com/licenses',
    source: 'https://sketchfab.com/3d-models/retro-lowpoly-toilet-paper-c07d8e85f06444d3a7cd20b1d65d5316',
    files: ['retro_lowpoly_toilet_paper.glb'],
  },
  {
    title: 'S3 Trio64V2/DX Low poly psx',
    author: 'DinixLowPoly',
    authorUrl: 'https://sketchfab.com/DinixGlasses',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/s3-trio64v2dx-low-poly-psx-8b167ead5c3f4fd1b836597ad8655505',
    files: ['s3_trio64v2dx_low_poly_psx.glb'],
  },
  {
    title: 'PSX Retro Computer',
    author: 'Tomitos',
    authorUrl: 'https://sketchfab.com/Tomitos_',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/psx-retro-computer-7e7f8a9dfa1f4b34abde94bb02b9f46c',
    files: ['psx_retro_computer.glb'],
  },
  {
    // Six different models share this slug. This is the one with 28 triangles,
    // matching the file, and a publish time matching the download to the minute.
    title: 'Low Poly Pizza',
    author: 'Sleepless',
    authorUrl: 'https://sketchfab.com/spatka',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/low-poly-pizza-d8ab867392b44e309aa4133e9ff780c9',
    files: ['low_poly_pizza.glb'],
  },
  {
    // The author's display name really is the single letter H; the profile
    // link is what identifies them.
    title: 'LowPoly shawarma skewer PSX -- سيخ شاورما',
    author: 'H',
    authorUrl: 'https://sketchfab.com/Heereezz',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/lowpoly-shawarma-skewer-psx-9a68597ab8b2451eb6d086e1f7d7d359',
    files: ['lowpoly_shawarma_skewer_psx.glb'],
  },
  {
    title: 'PS1 Retro Concrete Mixer (PS1)',
    author: 'S1lMoon',
    authorUrl: 'https://sketchfab.com/s1lmoon',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/ps1-retro-concrete-mixer-ps1-9279ddc0fedc44a3a910ef75e339b773',
    files: ['ps1_retro_concrete_mixer.glb'],
  },
  {
    // Search engines still credit a former account name for this one; the
    // author renamed, and this is what Sketchfab returns today.
    title: 'Psx style pizza and coke',
    author: 'some random artist',
    authorUrl: 'https://sketchfab.com/ichi39',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/psx-style-pizza-and-coke-de3e8f3e203446628405bd130d381721',
    files: ['psx_style_pizza_and_coke.glb'],
  },
  {
    title: 'PSX Style Trees',
    author: 'wooolvie',
    authorUrl: 'https://sketchfab.com/wooolvie',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/psx-style-trees-c73818d0c15b49b49b5aacf685361c46',
    files: ['psx_style_trees.glb'],
  },
  {
    title: 'Stop Sign PSX',
    author: 'dohnjoe',
    authorUrl: 'https://sketchfab.com/raydevv',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/stop-sign-psx-4755443bd1884c5394e3eae1f8fb4019',
    files: ['stop_sign_psx.glb'],
  },
  {
    // One credit covering the 36 props split out of the pack.
    title: 'PSX Industrial Pack',
    author: 'Tomitos',
    authorUrl: 'https://sketchfab.com/Tomitos_',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/psx-industrial-pack-12cb749961974f94a4063e67dafb2d76',
    files: ['psx_industrial_pack_*'],
  },
  {
    title: 'Trees and bush Pack LOWPOLY',
    author: 'EFX',
    authorUrl: 'https://sketchfab.com/evan4129',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    source: 'https://sketchfab.com/3d-models/trees-and-bush-pack-lowpoly-f2a25ee70df440c9ab03d57aba2dc3f2',
    files: ['trees_and_bush_pack_*'],
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

  const covers = (pattern, file) =>
    pattern.endsWith('*') ? file.startsWith(pattern.slice(0, -1)) : file === pattern;
  const declared = MANUAL.filter((m) => Array.isArray(m.files));
  const coveredBy = (file) =>
    declared.some((m) => m.files.some((pattern) => covers(pattern, file)));

  for (const file of files.sort()) {
    const gltf = await readGlbJson(path.join(ASSET_DIR, file)).catch(() => null);
    const extras = gltf?.asset?.extras;
    if (!extras?.author) {
      if (!coveredBy(file)) missing.push(file);
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

  // One credit per work, not per file. Splitting a pack with split-pack.mjs
  // produces dozens of models that all carry the same attribution; the licence
  // is satisfied by naming the work once, and listing it 39 times would bury
  // every other creator.
  const seen = new Map();
  for (const e of entries) {
    // Title as well as source: two different works can share a source URL —
    // both Quaternius packs point at quaternius.com — and keying on the URL
    // alone silently drops one of them.
    const key = `${e.source}|${e.title}|${e.author}`;
    if (!seen.has(key)) seen.set(key, e);
  }
  const unique = [...seen.values()];
  const collapsed = entries.length - unique.length;
  entries.length = 0;
  entries.push(...unique);

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
      ')' +
      (collapsed > 0 ? `, ${collapsed} duplicate file credit(s) collapsed` : ''),
  );

  if (missing.length > 0) {
    // Loud on purpose: an uncredited asset on a public site is the exact
    // problem this file exists to prevent.
    console.warn(
      `[credits] WARNING: no attribution for ${missing.length} file(s): ${missing.join(', ')}\n` +
        '[credits] Add them to MANUAL in scripts/build-credits.mjs.',
    );
  }

  const stale = declared.filter((m) => !m.files.some((p) => files.some((f) => covers(p, f))));
  if (stale.length > 0) {
    console.warn(
      `[credits] WARNING: ${stale.length} MANUAL entr(y/ies) match no file — renamed or removed?\n` +
        stale.map((m) => `[credits]   ${m.title}: ${m.files.join(', ')}`).join('\n'),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
