/**
 * Turning a file someone picked into something a shirt can wear.
 *
 * Two constraints shape all of this. The picture has to survive being sent to
 * everybody else in the world, so it has a hard byte ceiling rather than a
 * pixel one — a 128px photograph and a 128px logo differ by an order of
 * magnitude once encoded. And it arrives from a file picker, so nothing about
 * it can be trusted: it is decoded in an <img>, drawn into a canvas at a size
 * this module chooses, and re-encoded. Whatever came in, what leaves here is a
 * small square of our own making.
 */

/** Longest edge of the stored image, in pixels. */
export const PRINT_IMAGE_SIZE = 128;

/**
 * Ceiling on the encoded data URL, in characters.
 *
 * This is the number that matters, because it is what crosses the network. At
 * 24kB a full room of sixteen players costs under 400kB of one-off transfers,
 * and no single upload can wedge the socket.
 */
export const PRINT_IMAGE_MAX_CHARS = 24_000;

/** What the server will accept, and so what this must produce. */
export const PRINT_IMAGE_PREFIX = /^data:image\/(webp|png);base64,[A-Za-z0-9+/=]+$/;

/** Largest file accepted before decoding, as a first cheap guard. */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

export class PrintImageError extends Error {}

/**
 * Read, shrink and re-encode a picked file.
 *
 * Quality is stepped down until the result fits the ceiling rather than picked
 * once and hoped for: a flat logo lands far under it at full quality, while a
 * photograph needs several passes, and choosing a single conservative quality
 * for both would make the logo look worse than it needs to.
 */
export async function preparePrintImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new PrintImageError('That is not an image.');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new PrintImageError('That image is too large to read.');
  }

  const source = await decode(file);
  const scale = Math.min(
    1,
    PRINT_IMAGE_SIZE / Math.max(source.width, source.height),
  );
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PrintImageError('Could not prepare the image.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);

  // WebP first: it keeps alpha, which a logo on a coloured shirt needs, and is
  // a third the size of the equivalent PNG. PNG is the fallback for anything
  // that cannot encode it.
  for (const quality of [0.9, 0.75, 0.6, 0.45, 0.3]) {
    const url = canvas.toDataURL('image/webp', quality);
    if (url.startsWith('data:image/webp') && url.length <= PRINT_IMAGE_MAX_CHARS) return url;
  }
  const png = canvas.toDataURL('image/png');
  if (png.length <= PRINT_IMAGE_MAX_CHARS) return png;

  throw new PrintImageError('That image is too detailed to fit on a shirt.');
}

function decode(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PrintImageError('That image could not be read.'));
    };
    img.src = url;
  });
}
