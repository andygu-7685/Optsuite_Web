// Reading a decoded frame back as pixels, for lib/refine.js.
//
// The model runs on the bitmap, so nothing else in the app needs the samples;
// this is the one place that pays for a readback, and only on a new image.

// Beyond this the readback costs more than the extra detail buys, and refining
// only has to find a few percent of the target width.
const MAX_SIDE = 1600

/** `{ data, width, height }` for an ImageBitmap, or null if it cannot be read. */
export function pixelsOf(image) {
  if (!image) return null
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  try {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0, width, height)
    const { data } = context.getImageData(0, 0, width, height)
    // Detections are in full-frame pixels, so carry the scale rather than undo it.
    return { data, width, height, scale }
  } catch {
    // A tainted or oversized frame just means no refinement.
    return null
  }
}
