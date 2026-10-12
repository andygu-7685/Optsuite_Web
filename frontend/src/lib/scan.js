// Measuring every scanned element against the frame.
//
// This is the browser's version of usaf_algo.py `calculate_scanline_contrast_scores`:
// walk constants.py `group_positions` two points at a time, push each pair into
// the image, and read the pixels underneath. The Python gets its mapping from
// SIFT or the classic corner search; here the fitted homography (lib/homography.js)
// already is that mapping, so the loop is the same and the registration is not
// repeated.
//
// Two things the Python does are deliberately left out. `apply_point_adjustment_algorithm`
// is a no-op at its own defaults (`AUTO_ADJUST = False`), and the YOLO scanline
// replacement needs the two-keypoint single-element model, not the four-point
// one the app runs.

import { apply, applyBox, scaleAt } from './homography'
import { dips, sampleLine, spread } from './profile'
import { micronsPerUnit } from './targetLayout'
import { lineWidthUmOf } from './usaf'

/** constants.py `SCORE_METHOD`: how the two bar directions become one number. */
export const METHODS = ['min', 'mean', 'max']

// Samples per scanline. The scan spans five bar widths, so this is dense enough
// to carry the finest element the frame can hold and cheap enough to redo
// inside the alignment search.
const SAMPLES = 96

// usaf_algo.py extends the line by this fraction of its length at each end
// before counting dips, so the first and last bar have a gap to sit against.
const EXTEND = 0.2

// Below one pixel per bar the element is past the sensor's own limit: whatever
// the profile shows there is aliasing, not contrast, so it is reported as
// undersampled instead of unresolved.
const MIN_BAR_PX = 1

// One nesting level is two groups, so a quarter of the size.
const NESTED_SCALE = 0.25

function merge(values, method) {
  if (method === 'max') return Math.max(...values)
  if (method === 'mean') return values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.min(...values)
}

/** One scanline, pushed through `transform` and read off the frame. */
function scanline(transform, pixels, [from, to], buffer) {
  const a = apply(transform, from)
  const b = apply(transform, to)
  if (!a || !b) return null

  const measured = spread(sampleLine(pixels, a, b, SAMPLES, buffer))
  // Dips are counted on the extended line, as the Python does.
  const ax = a[0] + (a[0] - b[0]) * EXTEND
  const ay = a[1] + (a[1] - b[1]) * EXTEND
  const bx = b[0] + (b[0] - a[0]) * EXTEND
  const by = b[1] + (b[1] - a[1]) * EXTEND
  return {
    a,
    b,
    ...measured,
    dips: dips(sampleLine(pixels, [ax, ay], [bx, by], SAMPLES, buffer)),
  }
}

/**
 * Mean scanline contrast over `layout`, the objective lib/refine.js maximizes.
 * Kept here so the alignment search and the final measurement agree on what a
 * well-placed scanline looks like.
 */
export function contrastOf(transform, pixels, layout) {
  const buffer = new Float32Array(SAMPLES)
  let total = 0
  let counted = 0
  for (const element of layout) {
    for (const segment of element.segments) {
      const scan = scanline(transform, pixels, segment, buffer)
      if (!scan) continue
      total += scan.contrast
      counted += 1
    }
  }
  return counted === 0 ? -1 : total / counted
}

/**
 * Every scanned element: where it landed, what the pixels under its two
 * scanlines say, and whether that counts as resolved.
 *
 * `placements` pairs each row of the scan table with the layout entry to read
 * it from and the transform that puts that entry on the frame — one transform
 * per nested copy of the target, so the finest elements are placed by the
 * detection that actually sits around them. `threshold` is constants.py
 * `SCORE_THRESHOLD` and `dipRule` is its `GRADIENT_MIN`: with it on, an element
 * also has to still dip once per gap, not merely hold its contrast.
 */
export function measure(placements, pixels, table, { method = 'min', threshold = 0.2, dipRule = false } = {}) {
  const unitUm = micronsPerUnit(table)
  const buffer = new Float32Array(SAMPLES)
  const elements = []

  for (const { index, layout, transform, depth } of placements) {
    const row = table[index]
    if (!row) continue
    const middle = [(layout.box.x1 + layout.box.x2) / 2, (layout.box.y1 + layout.box.y2) / 2]
    const quad = applyBox(transform, layout.box)
    const center = apply(transform, middle)
    if (!quad || !center) continue

    // Read the scale where the element sits, so perspective is accounted for.
    // The layout entry may belong to a nested copy, whose own units are four
    // times smaller per level, so the micron scale has to come down with it.
    // Transforms are in full-frame pixels while the samples come off the
    // readback, so the buffer's own scale goes in too: what matters is how
    // many of the pixels actually being read cover one bar.
    const unitPx = scaleAt(transform, middle) * (pixels.scale ?? 1)
    const umPerPx = unitPx && unitUm ? (unitUm * NESTED_SCALE ** depth) / unitPx : null
    const barWidthPx = umPerPx ? lineWidthUmOf(row) / umPerPx : null

    // Index order is the same as the crop names in pattern_crop.py: the first
    // scanline runs down across the horizontal bars, the second across the vertical ones.
    const [horizontal, vertical] = layout.segments.map((segment) => scanline(transform, pixels, segment, buffer))
    if (!horizontal || !vertical) continue

    const scans = [horizontal, vertical]
    const contrast = merge(scans.map((scan) => scan.contrast), method)
    const sampled = barWidthPx === null || barWidthPx >= MIN_BAR_PX
    const holds = contrast >= threshold && (!dipRule || merge(scans.map((scan) => scan.dips), method) >= 2)

    elements.push({
      ...row,
      depth,
      quad,
      center,
      umPerPx,
      // How many image pixels one bar covers: whether the element is even sampled.
      barWidthPx,
      horizontal,
      vertical,
      contrast,
      modulation: merge(scans.map((scan) => scan.modulation), method),
      dips: merge(scans.map((scan) => scan.dips), method),
      state: !sampled ? 'undersampled' : holds ? 'resolved' : 'unresolved',
    })
  }

  return elements
}

/**
 * Pixels per millimetre where the target sits, from the bar width each element
 * is known to have. Every element gives the same answer up to the few percent
 * the hand-trimmed layout scatters by, so the median is the one to keep.
 */
export function pixelsPerMm(elements) {
  const samples = elements
    .map((element) => (element.umPerPx ? 1000 / element.umPerPx : null))
    .filter((value) => value !== null && Number.isFinite(value))
    .sort((a, b) => a - b)
  return samples.length ? samples[Math.floor(samples.length / 2)] : null
}

/** The finest line pairs the sampling grid itself can carry, two pixels each. */
export function nyquistLpPerMm(elements) {
  const pxPerMm = pixelsPerMm(elements)
  return pxPerMm === null ? null : pxPerMm / 2
}
