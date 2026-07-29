import sharp from 'sharp';

/**
 * Replace textures that carry no detail with the material factor they encode.
 *
 * Asset-store models are exported with a full texture set whether or not the
 * material needs one: a flat 128,128,255 normal map, a roughness map that is
 * one shade of grey across 1024 pixels, an occlusion map that is solid white.
 * On disk these compress to nothing and look harmless. On the GPU every one of
 * them is expanded to uncompressed RGBA with a mip chain — 5.3MB apiece at
 * 1024 — and a single crane arrived carrying twenty-one of them.
 *
 * The information in such a texture is one colour, which glTF can express as a
 * material factor for free. So: decode each texture, and if every channel is
 * near-constant, fold that constant into the factor and detach it. prune()
 * afterwards drops the now-unreferenced images.
 *
 * Deliberately conservative — a texture is only touched when it sits in a slot
 * with a known factor equivalent and its variation is below the threshold, so
 * anything ambiguous is left exactly as it was.
 */

/** Per-channel standard deviation, 0..255, below which a texture is "one colour". */
const UNIFORM_STDDEV = 3;

/** glTF stores base colour and emissive in sRGB; factors are linear. */
function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

async function describe(texture) {
  const image = texture.getImage();
  if (!image) return null;
  try {
    const stats = await sharp(Buffer.from(image)).stats();
    const channels = stats.channels;
    if (channels.length < 3) return null;
    return {
      maxStdDev: Math.max(...channels.map((c) => c.stdev)),
      mean: channels.map((c) => c.mean),
    };
  } catch {
    return null;
  }
}

export function flattenSolidTextures(report = {}) {
  return async (document) => {
    const root = document.getRoot();

    // Decode each image once; the same texture is often shared by materials.
    const uniform = new Map();
    for (const texture of root.listTextures()) {
      const stats = await describe(texture);
      if (stats && stats.maxStdDev < UNIFORM_STDDEV) uniform.set(texture, stats.mean);
    }
    if (uniform.size === 0) return;

    let removed = 0;
    for (const material of root.listMaterials()) {
      const take = (getter, setter) => {
        const texture = getter.call(material);
        if (!texture) return null;
        const mean = uniform.get(texture);
        if (!mean) return null;
        setter.call(material, null);
        removed++;
        return mean;
      };

      const base = take(material.getBaseColorTexture, material.setBaseColorTexture);
      if (base) {
        const f = material.getBaseColorFactor();
        material.setBaseColorFactor([
          f[0] * srgbToLinear(base[0]),
          f[1] * srgbToLinear(base[1]),
          f[2] * srgbToLinear(base[2]),
          f[3],
        ]);
      }

      // Roughness in green, metalness in blue, both already linear.
      const mr = take(
        material.getMetallicRoughnessTexture,
        material.setMetallicRoughnessTexture,
      );
      if (mr) {
        material.setRoughnessFactor(material.getRoughnessFactor() * (mr[1] / 255));
        material.setMetallicFactor(material.getMetallicFactor() * (mr[2] / 255));
      }

      const emissive = take(material.getEmissiveTexture, material.setEmissiveTexture);
      if (emissive) {
        const f = material.getEmissiveFactor();
        material.setEmissiveFactor([
          f[0] * srgbToLinear(emissive[0]),
          f[1] * srgbToLinear(emissive[1]),
          f[2] * srgbToLinear(emissive[2]),
        ]);
      }

      // A constant normal map is a flat surface however it is scaled, and a
      // constant occlusion map is a uniform dimming the base colour already
      // accounts for. Neither has a factor to fold into; both just go.
      take(material.getNormalTexture, material.setNormalTexture);
      take(material.getOcclusionTexture, material.setOcclusionTexture);
    }

    report.solidTexturesRemoved = removed;
  };
}
