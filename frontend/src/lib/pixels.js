// Reading a decoded frame back as grey levels, for the scanline measurement.
//
// The model runs on the bitmap, so nothing else in the app needs the samples;
// this is the one place that pays for a readback, and only on a new image.
//
// What comes back is a single normalized plane rather than RGBA, because that
// is what usaf_algo.py scores against: `normalize_image_contrast` stretches the
// frame globally, and `calculate_scanline_contrast_scores` then divides by the
// brightest pixel — together, a global min-to-max stretch onto 0..1.

// Only enormous frames are downscaled, and only to keep the readback from
// exhausting memory. Resolution here is not a detail budget: it sets the
// sampling limit the whole measurement is read against, and the finest
// elements of a well-framed target sit within a few pixels of it. Halving the
// side halves the lp/mm the frame can carry, which turns an optics
// measurement into a measurement of the downscale.
const MAX_SIDE = 4096

/**
 * `{ grey, width, height, scale }` for an ImageBitmap, or null if it cannot be
 * read. `grey` is Rec. 601 luminance stretched onto 0..1; `scale` maps
 * full-frame coordinates onto the smaller copy, since detections are in
 * full-frame pixels and carrying the scale is cheaper than undoing it.
 */
export function pixelsOf(image) {
  if (!image) return null
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  let data
  try {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0, width, height)
    ;({ data } = context.getImageData(0, 0, width, height))
  } catch {
    // A tainted or oversized frame just means no measurement.
    return null
  }

  const grey = new Float32Array(width * height)
  let low = Infinity
  let high = -Infinity
  for (let i = 0, p = 0; i < grey.length; i += 1, p += 4) {
    const value = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114
    grey[i] = value
    if (value < low) low = value
    if (value > high) high = value
  }

  const range = high - low
  if (range > 0) for (let i = 0; i < grey.length; i += 1) grey[i] = (grey[i] - low) / range

  return { grey, width, height, scale }
}

/**
 * Variance of the Laplacian over a region, the blur measure `is_image_clear`
 * gates on in helper.py. Windowed to the target rather than the whole frame, so
 * a target floating in empty background is not read as blurred by the
 * background's own flatness.
 *
 * Reported rather than enforced: a frame can be sharp and still resolve
 * nothing, and the scanlines say which. Units are the square of a grey step on
 * the normalized 0..1 plane, so they only compare between frames of one setup.
 */
export function sharpnessOf({ grey, width, height, scale }, quad) {
  const xs = quad.map(([x]) => x * scale)
  const ys = quad.map(([, y]) => y * scale)
  const x1 = Math.max(1, Math.floor(Math.min(...xs)))
  const y1 = Math.max(1, Math.floor(Math.min(...ys)))
  const x2 = Math.min(width - 2, Math.ceil(Math.max(...xs)))
  const y2 = Math.min(height - 2, Math.ceil(Math.max(...ys)))
  if (x2 <= x1 || y2 <= y1) return null

  let sum = 0
  let squares = 0
  let count = 0
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const i = y * width + x
      const value =
        grey[i - width] + grey[i + width] + grey[i - 1] + grey[i + 1] - 4 * grey[i]
      sum += value
      squares += value * value
      count += 1
    }
  }
  if (count === 0) return null
  const mean = sum / count
  return squares / count - mean * mean
}
