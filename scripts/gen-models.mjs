#!/usr/bin/env node
/**
 * Generate 3D models with fal: text -> image -> mesh.
 *
 *   node scripts/gen-models.mjs                 # anything missing
 *   node scripts/gen-models.mjs --only=slab_a   # just one
 *   node scripts/gen-models.mjs --force         # all of them again (costs money)
 *
 * Image-to-3D rather than text-to-3D on purpose: the image step is cheap and
 * fast to iterate, and it is where the look is actually decided. A bad concept
 * image reliably produces a bad mesh, and finding that out for the price of an
 * image beats finding it out for the price of a mesh.
 *
 * What these are for: the structural layer of the level is box primitives with
 * exactly-matching cuboid colliders, which is right for gameplay — what you see
 * is what you stand on — and looks like a stack of boxes. These meshes are
 * dropped over those boxes as *visuals only*. The collider stays a perfect
 * cuboid, so landings stay honest, while the thing the player sees is a broken
 * slab of concrete.
 *
 * Output lands in 3dassets/generated/ so the existing optimiser picks it up and
 * writes the compressed, manifest-registered copy into public/assets/.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { run, imageUrls } from './fal.mjs';

const OUT_DIR = '3dassets/generated';

/** Rough: flux dev ~$0.025, trellis ~$0.10 per mesh. */
const EST_COST_EACH = 0.13;

const SHARED = [
  'single isolated object, three-quarter view from slightly above',
  'centred on a pure flat white background',
  'floating in empty space with nothing beneath it, no ground plane, no shadow',
  'even neutral lighting, no strong highlights',
  'photorealistic, sharp focus, high detail',
  'no text, no people, no other objects',
].join(', ');

const MODELS = [
  {
    name: 'slab_broken_a',
    prompt: `A broken rectangular chunk of reinforced concrete floor slab, cracked edges with exposed rusted rebar, damp grey concrete with patches of green moss on its upper face, ${SHARED}`,
  },
  {
    name: 'slab_broken_b',
    prompt: `A thick shattered concrete platform section, one corner broken away, weathered grey surface heavily overgrown with moss and small ferns on top, ${SHARED}`,
  },
  {
    name: 'column_broken',
    prompt: `A broken stone column snapped off partway up, weathered and cracked, wrapped in climbing jungle vines, ${SHARED}`,
  },
  {
    name: 'rubble_pile',
    prompt: `A pile of broken concrete rubble and shattered masonry chunks, dusty grey, a few weeds growing between the pieces, ${SHARED}`,
  },
  {
    name: 'ruined_arch',
    prompt: `A crumbling stone archway from an ancient overgrown temple, carved weathered stone, half collapsed, covered in moss and hanging vines, ${SHARED}`,
  },
  {
    name: 'idol_head',
    prompt: `A large weathered carved stone head from an ancient jungle temple, moss in the crevices, broken at the neck, solemn expression, ${SHARED}`,
  },
];

const NEGATIVE =
  'shadow, cast shadow, ground, floor, grass, table, pedestal, base plate, ' +
  'multiple objects, cropped, cut off, text, watermark, blurry, cartoon, ' +
  'low quality, plain cube, plain box';

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

/** Key the flat white background out so the mesher sees only the subject. */
async function keyWhite(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, o = 0; i < data.length; i += info.channels, o += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const neutral = max - min < 16 && min > 205;
    const a = neutral ? 0 : Math.max(0, Math.min(1, (255 - min) / 45));
    if (a <= 0.004) continue;
    out[o] = clamp255((r - 255 * (1 - a)) / a);
    out[o + 1] = clamp255((g - 255 * (1 - a)) / a);
    out[o + 2] = clamp255((b - 255 * (1 - a)) / a);
    out[o + 3] = Math.round(a * 255);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

/** Upload bytes to fal's CDN so the mesher can fetch them back. */
async function uploadPng(buf, name) {
  const res = await fetch('https://fal.run/fal-ai/imageutils/marker', { method: 'HEAD' }).catch(
    () => null,
  );
  void res;
  // fal accepts data URIs anywhere it accepts an image_url, which avoids
  // needing the storage API and a second set of credentials.
  return `data:image/png;base64,${buf.toString('base64')}`;
}

/** Find a mesh url in whatever shape the mesher returned. */
function meshUrl(result) {
  const candidates = [
    result?.model_mesh?.url,
    result?.model_glb?.url,
    result?.mesh?.url,
    result?.glb?.url,
    typeof result?.model_mesh === 'string' ? result.model_mesh : null,
    Array.isArray(result?.meshes) ? result.meshes[0]?.url : null,
  ];
  return candidates.find(Boolean) ?? null;
}

const MESHERS = ['fal-ai/trellis', 'fal-ai/hunyuan3d/v2', 'fal-ai/triposr'];

async function toMesh(imageUrl) {
  const errors = [];
  for (const model of MESHERS) {
    try {
      const out = await run(model, { image_url: imageUrl }, { timeoutMs: 600_000 });
      const url = meshUrl(out);
      if (url) return { url, model };
      errors.push(`${model}: no mesh in ${Object.keys(out).join(',')}`);
    } catch (err) {
      errors.push(`${model}: ${String(err.message).split('\n')[0]}`);
    }
  }
  throw new Error(`no mesher succeeded:\n  ${errors.join('\n  ')}`);
}

async function main() {
  const force = process.argv.includes('--force');
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  mkdirSync(OUT_DIR, { recursive: true });

  const todo = MODELS.filter((m) =>
    only ? only.includes(m.name) : force || !existsSync(`${OUT_DIR}/${m.name}.glb`),
  );
  if (!todo.length) {
    console.log('[models] everything already generated; nothing to spend');
    return;
  }
  console.log(
    `[models] generating ${todo.length}, estimated ~$${(todo.length * EST_COST_EACH).toFixed(2)}`,
  );

  for (const m of todo) {
    process.stdout.write(`[models] ${m.name} ... concept `);
    const img = await run('fal-ai/flux/dev', {
      prompt: m.prompt,
      negative_prompt: NEGATIVE,
      image_size: { width: 1024, height: 1024 },
      num_inference_steps: 30,
      guidance_scale: 3.5,
      num_images: 1,
      enable_safety_checker: false,
    });
    const [raw] = imageUrls(img);
    if (!raw) {
      console.log('no concept image');
      continue;
    }

    const res = await fetch(raw, { signal: AbortSignal.timeout(120_000) });
    const png = await keyWhite(Buffer.from(await res.arrayBuffer()));
    writeFileSync(`${OUT_DIR}/${m.name}.concept.png`, png);
    process.stdout.write('-> mesh ');

    const dataUri = await uploadPng(png, m.name);
    const { url, model } = await toMesh(dataUri);
    const glb = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!glb.ok) throw new Error(`mesh download -> ${glb.status}`);
    const bytes = Buffer.from(await glb.arrayBuffer());
    writeFileSync(`${OUT_DIR}/${m.name}.glb`, bytes);
    console.log(`${(bytes.length / 1024 / 1024).toFixed(2)}MB via ${model.split('/').slice(1).join('/')}`);
  }

  console.log(`[models] done -> ${OUT_DIR}`);
  console.log('[models] run `npm run optimize-assets` to compress and register them');
}

main().catch((err) => {
  console.error(String(err.message));
  process.exitCode = 1;
});
