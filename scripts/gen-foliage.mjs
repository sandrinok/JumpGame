#!/usr/bin/env node
/**
 * Generate the jungle foliage atlas with fal.
 *
 *   node scripts/gen-foliage.mjs           # generate anything missing
 *   node scripts/gen-foliage.mjs --force   # regenerate everything (costs money)
 *
 * The foliage that ships in the asset library is 8-52 triangle crossed planes
 * with low-resolution textures. Scaled up to tree size they read as torn paper,
 * and no amount of shader work fixes eight triangles — the geometry is fine,
 * it is the *texture* on the cards that has to carry the detail. So these are
 * alpha cutouts painted at 1024px and mapped onto the same cheap crossed
 * planes.
 *
 * Two things matter in the prompts and both are easy to get wrong:
 *
 *   - Flat, even, shadowless lighting. Any baked directional light or cast
 *     shadow fights the scene's own sun, and a leaf lit from the left inside a
 *     card lit from the right looks broken in a way that is hard to name.
 *   - The whole plant, centred, nothing cropped at the frame edge. A clipped
 *     leaf becomes a hard straight edge in the alpha, and a straight edge is
 *     the one thing that instantly reads as "flat card".
 *
 * Generated files are committed; this script skips anything already on disk so
 * a re-run is free.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { run, imageUrls } from './fal.mjs';

const OUT_DIR = 'public/assets/foliage';

/** ~$0.025/MP for flux dev at 1024x1024, plus a fraction of a cent to key it. */
const EST_COST_EACH = 0.027;

const SHARED = [
  'photographed perfectly straight on, orthographic front view',
  'isolated on a pure flat white background',
  // "no shadow" alone does not hold — flux drew a cast shadow on the palm
  // anyway, because a plant photographed on a surface implies one. Removing the
  // *surface* from the description is what removes the shadow: nothing to cast
  // onto means nothing to cast.
  'floating in empty space with nothing beneath it, no surface, no ground plane',
  'completely flat even shadowless lighting from the front, no cast shadow anywhere',
  'entire plant visible and centred with clear space around it, nothing cropped',
  'no pot, no soil, no hands, no text',
  'sharp focus, high detail, natural colour',
].join(', ');

const ASSETS = [
  {
    // The forest silhouette. Everything else is a crown or a shrub; without a
    // trunk-to-canopy tree there is nothing to build a treeline out of, and an
    // open horizon is what makes a jungle read as a field.
    name: 'jungle_tree',
    prompt: `A single tall tropical rainforest tree, slender straight trunk rising to a broad dense leafy canopy, entire tree visible from the base of the trunk to the top of the crown, tall narrow vertical composition, ${SHARED}`,
  },
  {
    name: 'canopy_broadleaf',
    prompt: `A dense cluster of tropical rainforest canopy foliage, broad glossy deep-green leaves layered over each other, ${SHARED}`,
  },
  {
    name: 'canopy_palm',
    prompt: `A spray of large tropical palm fronds radiating from a central point, deep green, ${SHARED}`,
  },
  {
    name: 'fern_large',
    prompt: `A large tropical fern, finely divided arching fronds, rich green, ${SHARED}`,
  },
  {
    name: 'vine_hanging',
    // Densified: the first pass came out as a single sparse strand covering
    // 3.7% of the frame, which on a card is mostly empty texture being sampled
    // for nothing.
    prompt: `A thick curtain of long hanging jungle vines trailing straight downward, many overlapping strands densely covered in heart-shaped leaves along their full length, filling the frame vertically, ${SHARED}`,
  },
  {
    name: 'undergrowth_bush',
    prompt: `A low dense jungle undergrowth shrub, many small overlapping leaves, dark green, wider than tall, ${SHARED}`,
  },
  {
    name: 'elephant_ear',
    prompt: `Two or three huge elephant ear tropical leaves on upright stems, enormous heart-shaped blades with visible veins, ${SHARED}`,
  },
];

const NEGATIVE =
  'shadow, drop shadow, cast shadow, gradient background, grey background, ' +
  'vignette, pot, planter, soil, hands, person, text, watermark, border, frame, ' +
  'cropped leaves, cut off at edge, blurry, dark, moody lighting';

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

/**
 * Key the flat white background out locally.
 *
 * This replaced a call to fal's rembg, which is subject *segmentation* — it
 * finds the thing in the photo and cuts around it. That is the wrong tool for
 * these: on a curtain of thin vine strands it decided there was essentially no
 * subject and returned an image with 0.0% coverage, and on everything else it
 * left a pale rim of background around each leaf. A rim of near-white against
 * dark jungle is a glowing outline, and it is the most obvious possible tell
 * that foliage is a flat card.
 *
 * A luminance key is both more reliable and free. The background is known to be
 * flat white, so alpha comes from how far a pixel is from white, and the colour
 * is then unpremultiplied against white — which is what actually removes the
 * fringe rather than hiding it. Thin strands and soft leaf edges survive
 * because they are handled as partial alpha instead of a binary mask.
 */
async function keyWhite(buf) {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, o = 0; i < data.length; i += info.channels, o += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);

    // Bright and colourless is background — or a cast shadow on it, which is
    // the same thing as far as a card is concerned. Leaves are green, so they
    // always carry saturation; a stem dark enough to be neutral is also dark
    // enough to fail the brightness test.
    const neutral = max - min < 20 && min > 140;
    let a = neutral ? 0 : Math.max(0, Math.min(1, (255 - min) / 60));

    if (a <= 0.004) {
      o + 3 < out.length && (out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0);
      continue;
    }
    // Unpremultiply against white: recover what the leaf colour was before the
    // background bled into it at the edge.
    out[o] = clamp255((r - 255 * (1 - a)) / a);
    out[o + 1] = clamp255((g - 255 * (1 - a)) / a);
    out[o + 2] = clamp255((b - 255 * (1 - a)) / a);
    out[o + 3] = Math.round(a * 255);
  }

  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

async function main() {
  const force = process.argv.includes('--force');
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  mkdirSync(OUT_DIR, { recursive: true });

  const todo = ASSETS.filter((a) =>
    only ? only.includes(a.name) : force || !existsSync(`${OUT_DIR}/${a.name}.png`),
  );
  if (!todo.length) {
    console.log('[foliage] everything already generated; nothing to spend');
    return;
  }

  console.log(
    `[foliage] generating ${todo.length} asset(s), estimated ~$${(todo.length * EST_COST_EACH).toFixed(2)}`,
  );

  const made = [];
  for (const asset of todo) {
    process.stdout.write(`[foliage] ${asset.name} ... `);
    const result = await run('fal-ai/flux/dev', {
      prompt: asset.prompt,
      negative_prompt: NEGATIVE,
      image_size: { width: 1024, height: 1024 },
      num_inference_steps: 30,
      guidance_scale: 3.5,
      num_images: 1,
      enable_safety_checker: false,
    });
    const [raw] = imageUrls(result);
    if (!raw) {
      console.log('no image returned');
      continue;
    }

    const res = await fetch(raw, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`download ${asset.name} -> ${res.status}`);
    const png = await keyWhite(Buffer.from(await res.arrayBuffer()));
    writeFileSync(`${OUT_DIR}/${asset.name}.png`, png);
    console.log(`${(png.length / 1024).toFixed(0)}kB keyed`);
    made.push({ name: asset.name, keyed: true });
  }

  writeFileSync(
    `${OUT_DIR}/manifest.json`,
    `${JSON.stringify({ generator: 'fal-ai/flux/dev', assets: made.map((m) => m.name) }, null, 1)}\n`,
  );
  console.log(`[foliage] ${made.length} written to ${OUT_DIR}`);
  const opaque = made.filter((m) => !m.keyed);
  if (opaque.length) {
    console.log(`[foliage] WARNING: no alpha on ${opaque.map((m) => m.name).join(', ')}`);
  }
}

main().catch((err) => {
  console.error(String(err.message));
  process.exitCode = 1;
});
