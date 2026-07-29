/**
 * Choose a texture resolution from a memory budget rather than a flat cap.
 *
 * File size is about download time. What decides whether a level runs on a
 * laptop is that the driver expands every texture to uncompressed RGBA with a
 * mip chain, so a single 1024 map costs 5.3MB of video memory however small the
 * WebP was. A flat "no bigger than N" rule cannot see that: it treats a prop
 * with one map and a model arriving with thirty as the same problem.
 *
 * Budgeting per asset and deriving the resolution makes it a sliding scale
 * instead — few maps keep their full size, many get scaled until they fit —
 * so detail is spent where there is least competition for it.
 */

/** Ceiling on any single texture, whatever the budget allows. */
export const MAX_TEX = 1024;
/** Textures are never shrunk below this; past it they read as flat colour. */
export const MIN_TEX = 256;

/** Uncompressed RGBA plus a third again for mips — what the driver allocates. */
export function vramBytes(width, height) {
  return width * height * 4 * (4 / 3);
}

/**
 * How much of its texture a model's UVs actually touch, as a fraction of area.
 *
 * A prop split out of a pack keeps the pack's whole atlas while using a corner
 * of it — one crate measured at 2% — so a hundred props each hold a full-size
 * texture for a thumbnail's worth of pixels. Sizing to the used region turns
 * that from 5.3MB apiece into a few hundred kilobytes.
 *
 * Returns 1 when the answer is not trustworthy: UVs outside the unit square
 * mean tiling, where the visible detail is not bounded by the UV range at all.
 */
function usedUvFraction(document) {
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  let seen = false;
  const element = [0, 0];

  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const uv = prim.getAttribute('TEXCOORD_0');
      if (!uv) continue;
      seen = true;
      for (let i = 0; i < uv.getCount(); i++) {
        uv.getElement(i, element);
        for (let k = 0; k < 2; k++) {
          if (element[k] < -0.001 || element[k] > 1.001) return 1;
          lo[k] = Math.min(lo[k], element[k]);
          hi[k] = Math.max(hi[k], element[k]);
        }
      }
    }
  }
  if (!seen) return 1;
  const area = Math.max(hi[0] - lo[0], 0) * Math.max(hi[1] - lo[1], 0);
  return Math.min(Math.max(area, 0), 1);
}

/**
 * Largest power-of-two cap that keeps this document inside `budgetMb`.
 *
 * Steps down by halves rather than solving for a size, because textures should
 * stay powers of two: the GPU stores them more efficiently and mip generation
 * stays exact.
 */
export function textureCapFor(document, budgetMb) {
  const sizes = document
    .getRoot()
    .listTextures()
    .map((t) => t.getSize())
    .filter(Boolean);
  if (sizes.length === 0) return MAX_TEX;

  // Detail is bounded by the used region, so a model touching a quarter of its
  // atlas by area needs half the resolution in each direction to look the same.
  const fraction = usedUvFraction(document);
  let ceiling = MAX_TEX;
  if (fraction < 0.9) {
    const scaled = MAX_TEX * Math.sqrt(fraction);
    while (ceiling > MIN_TEX && ceiling / 2 >= scaled) ceiling /= 2;
  }

  const total = (cap) =>
    sizes.reduce((sum, [w, h]) => sum + vramBytes(Math.min(w, cap), Math.min(h, cap)), 0);

  const budget = budgetMb * 1024 * 1024;
  for (let cap = ceiling; cap > MIN_TEX; cap /= 2) {
    if (total(cap) <= budget) return cap;
  }
  return MIN_TEX;
}
