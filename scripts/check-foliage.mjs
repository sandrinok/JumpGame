#!/usr/bin/env node
/**
 * Audit generated foliage cutouts.
 *
 * Two failure modes are invisible until the card is in the scene and then
 * impossible to miss:
 *
 *   - No alpha at all. The keying step silently fell through and the card is a
 *     solid rectangle. In a jungle this is a white box hanging in a tree.
 *   - A pale halo. Keying kept a rim of near-white background around every
 *     leaf, which against dark foliage reads as a glowing outline.
 *
 * Also reports baked shadows: mid-grey pixels that survived keying are almost
 * always a cast shadow the generator drew despite being told not to, and a
 * shadow inside a card fights the scene's own lighting.
 */

import { readdirSync } from 'node:fs';
import sharp from 'sharp';

const DIR = 'public/assets/foliage';

const files = readdirSync(DIR).filter((f) => f.endsWith('.png'));
let bad = 0;

for (const file of files) {
  const img = sharp(`${DIR}/${file}`);
  const meta = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;

  let opaque = 0;
  let edge = 0; // partially transparent: the antialiased rim
  let halo = 0; // bright pixels that are still visible
  let shadow = 0; // mid-grey visible pixels with no colour

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a > 250) opaque++;
    else if (a > 8) edge++;
    if (a > 128) {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (min > 200) halo++;
      // Desaturated and mid-toned: grey, not leaf.
      if (max - min < 18 && min > 60 && max < 205) shadow++;
    }
  }

  const cover = (opaque / px) * 100;
  const haloPct = (halo / px) * 100;
  const shadowPct = (shadow / px) * 100;
  const hasAlpha = meta.hasAlpha && cover < 92;

  const problems = [];
  if (!hasAlpha) problems.push('NO ALPHA (solid rectangle)');
  if (haloPct > 1.2) problems.push(`white halo ${haloPct.toFixed(1)}%`);
  if (shadowPct > 3.5) problems.push(`baked shadow ${shadowPct.toFixed(1)}%`);
  if (cover < 3) problems.push('almost nothing left');
  if (problems.length) bad++;

  console.log(
    `${problems.length ? 'FAIL' : ' ok '}  ${file.padEnd(24)} ` +
      `${meta.width}x${meta.height} cover ${cover.toFixed(1)}% edge ${((edge / px) * 100).toFixed(1)}%` +
      (problems.length ? `  <- ${problems.join(', ')}` : ''),
  );
}

console.log(`\n${files.length - bad}/${files.length} usable`);
if (bad) process.exitCode = 1;
