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

  const total = (cap) =>
    sizes.reduce((sum, [w, h]) => sum + vramBytes(Math.min(w, cap), Math.min(h, cap)), 0);

  const budget = budgetMb * 1024 * 1024;
  for (let cap = MAX_TEX; cap > MIN_TEX; cap /= 2) {
    if (total(cap) <= budget) return cap;
  }
  return MIN_TEX;
}
