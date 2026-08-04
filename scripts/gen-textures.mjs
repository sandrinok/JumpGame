#!/usr/bin/env node
/**
 * Generate surface textures for the ruin material with fal.
 *
 *   node scripts/gen-textures.mjs
 *
 * The ruin material currently invents its surface from value noise in the
 * shader. That is fine at a distance and obviously synthetic up close: noise
 * has no *structure*, so concrete has no aggregate, no cracks and no staining
 * that runs anywhere. These are photographic surfaces to replace it.
 *
 * Two things are done to them here rather than in the engine:
 *
 * **Made tileable.** Generators do not produce seamless textures, and a visible
 * seam repeating across a 180m tower is worse than noise. Each is mirrored into
 * a quarter of itself, which is seamless by construction — the edges match
 * because they *are* the same pixels.
 *
 * **A normal map derived from luminance.** Not physically correct: it assumes
 * darker means lower, which is true for crevices and staining and false for a
 * dark stone next to a light one. For weathered concrete it is right often
 * enough, and it costs one pass over the image instead of a second generation.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { run, imageUrls } from './fal.mjs';

const OUT_DIR = 'public/assets/textures';
const SIZE = 1024;

const SHARED =
  'flat overhead photograph of the surface only, perfectly perpendicular to the camera, ' +
  'evenly lit with no shadows and no highlights, no objects, no horizon, no sky, ' +
  'fills the entire frame edge to edge, sharp focus, high detail, photorealistic';

const TEXTURES = [
  {
    name: 'concrete_wet',
    prompt: `Weathered damp grey concrete with fine aggregate, hairline cracks and dark water staining, ${SHARED}`,
  },
  {
    name: 'moss_bed',
    prompt: `Thick damp green moss growing over stone, uneven clumps with darker crevices between them, ${SHARED}`,
  },
];

const NEGATIVE =
  'perspective, angle, horizon, sky, plant, tree, object, person, text, watermark, ' +
  'vignette, shadow, border, frame, blurry, tiled pattern, repeating grid';

/**
 * Mirror a quarter of the image out to the full size.
 *
 * Seamless by construction: opposite edges are literally the same pixels, so
 * they cannot mismatch. The cost is a visible axis of symmetry, which the
 * material hides by sampling triplanar at a scale where the mirror period is
 * larger than anything the eye tracks.
 */
async function makeTileable(buf) {
  const half = SIZE / 2;
  const q = await sharp(buf).resize(half, half, { fit: 'fill' }).toBuffer();
  const flipX = await sharp(q).flop().toBuffer();
  const flipY = await sharp(q).flip().toBuffer();
  const flipXY = await sharp(q).flip().flop().toBuffer();
  return sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: '#000' } })
    .composite([
      { input: q, left: 0, top: 0 },
      { input: flipX, left: half, top: 0 },
      { input: flipY, left: 0, top: half },
      { input: flipXY, left: half, top: half },
    ])
    .png()
    .toBuffer();
}

/** Sobel over luminance, packed into a tangent-space normal map. */
async function toNormalMap(buf, strength = 2.4) {
  const { data, info } = await sharp(buf)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const at = (x, y) => data[((y + h) % h) * w + ((x + w) % w)] / 255;

  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
      const nx = dx * strength;
      const ny = dy * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 3;
      out[i] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

async function main() {
  const force = process.argv.includes('--force');
  mkdirSync(OUT_DIR, { recursive: true });

  const todo = TEXTURES.filter((t) => force || !existsSync(`${OUT_DIR}/${t.name}.png`));
  if (!todo.length) {
    console.log('[tex] everything already generated; nothing to spend');
    return;
  }
  console.log(`[tex] generating ${todo.length}, estimated ~$${(todo.length * 0.03).toFixed(2)}`);

  for (const t of todo) {
    process.stdout.write(`[tex] ${t.name} ... `);
    const result = await run('fal-ai/flux/dev', {
      prompt: t.prompt,
      negative_prompt: NEGATIVE,
      image_size: { width: SIZE, height: SIZE },
      num_inference_steps: 30,
      guidance_scale: 3.5,
      num_images: 1,
      enable_safety_checker: false,
    });
    const [url] = imageUrls(result);
    if (!url) {
      console.log('no image');
      continue;
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    const raw = Buffer.from(await res.arrayBuffer());

    const albedo = await makeTileable(raw);
    writeFileSync(`${OUT_DIR}/${t.name}.png`, albedo);
    const normal = await toNormalMap(albedo);
    writeFileSync(`${OUT_DIR}/${t.name}_n.png`, normal);
    console.log(`${(albedo.length / 1024).toFixed(0)}kB + normal ${(normal.length / 1024).toFixed(0)}kB`);
  }
  console.log(`[tex] done -> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(String(err.message));
  process.exitCode = 1;
});
