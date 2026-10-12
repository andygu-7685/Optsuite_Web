// Reading a line of pixels and deciding whether it crosses bars.
//
// This is the measurement the browser was missing. usaf_algo.py scores a USAF
// element by laying a scanline across its three bars and asking two questions of
// the pixels underneath: how far apart are the light and dark ends of the
// profile (helper.py `sample_line_profile` plus the percentile spread in
// `calculate_scanline_contrast_scores`), and does the profile still dip once per
// bar (the `GRADIENT_MIN` block, savgol-smoothed and counted by sign change).
//
// Both answers come from the same sampled profile, so they live together here.

/**
 * Bilinear sample along `a`-`b`, mirroring helper.py `sample_line_profile`.
 * Coordinates are full-frame pixels; `buffer.scale` maps them onto the smaller
 * copy lib/pixels.js actually reads. Out-of-frame samples clamp to the edge,
 * which is cv2.BORDER_REFLECT's behaviour for the one-pixel case.
 */
export function sampleLine({ grey, width, height, scale }, [ax, ay], [bx, by], count, out) {
  const samples = out ?? new Float32Array(count)
  const x0 = ax * scale
  const y0 = ay * scale
  const stepX = (bx * scale - x0) / (count - 1)
  const stepY = (by * scale - y0) / (count - 1)

  for (let i = 0; i < count; i += 1) {
    const x = Math.min(width - 1.001, Math.max(0, x0 + stepX * i))
    const y = Math.min(height - 1.001, Math.max(0, y0 + stepY * i))
    const px = x | 0
    const py = y | 0
    const fx = x - px
    const fy = y - py
    const row = py * width + px
    const top = grey[row] + (grey[row + 1] - grey[row]) * fx
    const bottom = grey[row + width] + (grey[row + width + 1] - grey[row + width]) * fx
    samples[i] = top + (bottom - top) * fy
  }
  return samples
}

/** The i-th smallest of `values`, for the percentile spread below. */
function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.round(fraction * (sorted.length - 1)))]
}

/**
 * How far apart the bars and the gaps read, as the 2nd-to-98th percentile spread
 * of the profile — `p95 - p5` in `calculate_scanline_contrast_scores`, named for
 * the percentiles it actually passes. Percentiles rather than min/max so one hot
 * pixel cannot carry an element.
 *
 * `modulation` is the same spread as a Michelson ratio, which is the ordinate a
 * contrast transfer function is usually plotted against: independent of
 * exposure, where the raw spread still tracks it.
 */
export function spread(samples) {
  const sorted = Float32Array.from(samples).sort()
  const high = percentile(sorted, 0.98)
  const low = percentile(sorted, 0.02)
  const sum = high + low
  return { contrast: high - low, modulation: sum > 1e-6 ? (high - low) / sum : 0 }
}

// Savitzky-Golay smoothing, window 15 and cubic, as scipy's savgol_filter is
// called in usaf_algo.py. For a cubic (or quadratic) fit the weights have a
// closed form, so there is no matrix to invert: with a half-window of m,
// c_i = 3(3m² + 3m - 1 - 5i²) / ((2m+3)(2m+1)(2m-1)).
const HALF_WINDOW = 7
const WEIGHTS = (() => {
  const m = HALF_WINDOW
  const scale = (2 * m + 3) * (2 * m + 1) * (2 * m - 1)
  return Array.from({ length: 2 * m + 1 }, (_, k) => {
    const i = k - m
    return (3 * (3 * m * m + 3 * m - 1 - 5 * i * i)) / scale
  })
})()

/** Smoothed copy of `samples`; the ends clamp rather than extrapolate. */
function smooth(samples) {
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    let sum = 0
    for (let k = -HALF_WINDOW; k <= HALF_WINDOW; k += 1) {
      const j = Math.min(samples.length - 1, Math.max(0, i + k))
      sum += samples[j] * WEIGHTS[k + HALF_WINDOW]
    }
    out[i] = sum
  }
  return out
}

// Gradient either side of a turning point has to clear this to count, so a flat
// stretch of noise does not read as a dip. From the same block in usaf_algo.py.
const FLAT = 1e-4

/**
 * How many times the smoothed profile dips — one dip per gap between bars, so a
 * three-bar element that is still resolved shows at least two.
 *
 * Mirrors the `GRADIENT_MIN` block: smooth, take the gradient, find where it
 * crosses from falling to rising, and collapse neighbouring crossings so a
 * single broad minimum is not counted twice.
 */
export function dips(samples) {
  if (samples.length < 3) return 0
  const values = smooth(samples)
  const last = values.length - 1

  // np.gradient: central differences inside, one-sided at the ends.
  const slope = new Float32Array(values.length)
  slope[0] = values[1] - values[0]
  slope[last] = values[last] - values[last - 1]
  for (let i = 1; i < last; i += 1) slope[i] = (values[i + 1] - values[i - 1]) / 2

  let count = 0
  let previous = -2
  for (let i = 0; i < last; i += 1) {
    if (!(slope[i] < -FLAT && slope[i + 1] > FLAT)) continue
    if (i !== previous + 1) count += 1
    previous = i
  }
  return count
}
