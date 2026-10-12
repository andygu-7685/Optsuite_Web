// Where every scanned element sits on a USAF 1951 target, mirroring
// usaf_registration/constants.py `UsafConfig.group_positions`.
//
// Target space: origin at the centre of the target's centre square, +x right,
// +y up, one unit = that square's side length. constants.py calls these the
// "usaf coordinates"; transforms.py `usaf2screen_classic` is the Python side of
// the same mapping. Keeping the table here mirrors how lib/usaf.js mirrors
// helper.py — the model sidecar carries per-model numbers, this is the target's
// fixed geometry.

import { lineWidthUmOf } from './usaf'

// Column centres and per-group trims, verbatim from constants.py.
const g2_x = -3.2
const g3_x = 2.5
const g4_x = -0.56
const g5_x = 0.87
const g6_x = 0.112

const g2y_scale = 1.03
const g3y_scale = 1.03
const g4y_scale = 1.026
const g5y_scale = 1.023
const g6y_scale = 1.027

const g2x_scale = 1.06
const g3x_scale = 1.015
const g4x_scale = 1.13
const g5x_scale = 1.0
const g6x_scale = 0.922

const g7x_offset = -0.01
const g7y_offset = -0.08
const g7y_scale = 1.019

/**
 * Scanline endpoints, two per segment, in constants.py order. Segments 0-32
 * cross the horizontal-bar half of each element, 33-65 the vertical-bar half;
 * within each half the order is the scan order of `initialize_score_table`, so
 * segment `i` and segment `i + 33` are the two halves of score-table row `i`.
 */
const POINTS = [
  [g2_x, 0.35], [g2_x, -0.37],
  [g2_x, -1.31], [g2_x, -1.96],
  [g2_x, -2.8], [g2_x, -3.40],

  [g3_x, 0.43], [g3_x, 0.01],
  [g3_x, -0.5], [g3_x, -0.88],
  [g3_x, -1.37], [g3_x, -1.70],
  [g3_x, -2.08 - 0.05], [g3_x, -2.38 - 0.05],
  [g3_x, -2.73 - 0.05], [g3_x, -3.01 - 0.05],
  [g3_x, -3.32 - 0.07], [g3_x, -3.57 - 0.07],

  [0.79, -3.15 - 0.057], [0.79, -3.37 - 0.057],
  [g4_x, -1.84 - 0.03], [g4_x, -2.04 - 0.03],
  [g4_x, -2.26 - 0.05], [g4_x, -2.44 - 0.05],
  [g4_x, -2.63 - 0.05], [g4_x, -2.79 - 0.05],
  [g4_x, -2.97 - 0.05], [g4_x, -3.1 - 0.05],
  [g4_x, -3.26 - 0.05], [g4_x, -3.39 - 0.05],

  [g5_x, -1.838 - 0.03], [g5_x, -1.944 - 0.03],
  [g5_x, -2.072 - 0.038], [g5_x, -2.168 - 0.038],
  [g5_x, -2.277 - 0.04], [g5_x, -2.365 - 0.04],
  [g5_x, -2.468 - 0.037], [g5_x, -2.538 - 0.044],
  [g5_x, -2.64 - 0.04], [g5_x, -2.696 - 0.04],
  [g5_x, -2.782 - 0.045], [g5_x, -2.836 - 0.045],

  [0.44, -2.78 - 0.01], [0.44, -2.82 - 0.01],
  [g6_x, -2.453], [g6_x, -2.49],
  [g6_x, -2.557], [g6_x, -2.59],
  [g6_x, -2.654], [g6_x, -2.681],
  [g6_x - 0.003, -2.735], [g6_x - 0.003, -2.755],
  [g6_x - 0.005, -2.812], [g6_x - 0.005, -2.83],

  [0.3997 + g7x_offset, (-2.3382 + g7y_offset) * g7y_scale], [0.4274 + g7x_offset, (-2.3384 + g7y_offset) * g7y_scale],
  [0.4097 + g7x_offset, (-2.3914 + g7y_offset) * g7y_scale], [0.4337 + g7x_offset, (-2.3912 + g7y_offset) * g7y_scale],
  [0.4158 + g7x_offset, (-2.4394 + g7y_offset) * g7y_scale], [0.438 + g7x_offset, (-2.4398 + g7y_offset) * g7y_scale],
  [0.4226 + g7x_offset, (-2.4828 + g7y_offset) * g7y_scale], [0.443 + g7x_offset, (-2.4832 + g7y_offset) * g7y_scale],
  [0.4294 + g7x_offset, (-2.522 + g7y_offset) * g7y_scale], [0.4462 + g7x_offset, (-2.5223 + g7y_offset) * g7y_scale],
  [0.4352 + g7x_offset, (-2.557 + g7y_offset) * g7y_scale], [0.4493 + g7x_offset, (-2.557 + g7y_offset) * g7y_scale],

  [-2.05 * g2x_scale, -0.003 * g2y_scale], [-1.26 * g2x_scale, 0.005 * g2y_scale],
  [-2.19 * g2x_scale, -1.625 * g2y_scale], [-1.51 * g2x_scale, -1.617 * g2y_scale],
  [-2.33 * g2x_scale, -3.04 * g2y_scale], [-1.71 * g2x_scale, -3.046 * g2y_scale],

  [1.3 * g3x_scale, 0.2 * g3y_scale], [1.75 * g3x_scale, 0.2 * g3y_scale],
  [1.435 * g3x_scale, -0.707 * g3y_scale], [1.835 * g3x_scale, -0.707 * g3y_scale],
  [1.563 * g3x_scale, -1.498 * g3y_scale], [1.92 * g3x_scale, -1.496 * g3y_scale],
  [1.68 * g3x_scale, -2.218 * g3y_scale], [1.99 * g3x_scale, -2.213 * g3y_scale],
  [1.775 * g3x_scale, -2.85 * g3y_scale], [2.062 * g3x_scale, -2.85 * g3y_scale],
  [1.867 * g3x_scale, -3.42 * g3y_scale], [2.118 * g3x_scale, -3.422 * g3y_scale],

  [0.218 * g4x_scale, -3.234 * g4y_scale], [0.444 * g4x_scale, -3.227 * g4y_scale],
  [-0.258 * g4x_scale, -1.929 * g4y_scale], [-0.056 * g4x_scale, -1.931 * g4y_scale],
  [-0.289 * g4x_scale, -2.331 * g4y_scale], [-0.112 * g4x_scale, -2.333 * g4y_scale],
  [-0.329 * g4x_scale, -2.692 * g4y_scale], [-0.16 * g4x_scale, -2.691 * g4y_scale],
  [-0.351 * g4x_scale, -3.007 * g4y_scale], [-0.211 * g4x_scale, -3.005 * g4y_scale],
  [-0.38 * g4x_scale, -3.29 * g4y_scale], [-0.253 * g4x_scale, -3.289 * g4y_scale],

  [0.583 * g5x_scale, -1.8684 * g5y_scale], [0.7 * g5x_scale, -1.87 * g5y_scale],
  [0.6256 * g5x_scale, -2.0996 * g5y_scale], [0.72 * g5x_scale, -2.1 * g5y_scale],
  [0.65 * g5x_scale, -2.3 * g5y_scale], [0.74 * g5x_scale, -2.3 * g5y_scale],
  [0.68 * g5x_scale, -2.48 * g5y_scale], [0.76 * g5x_scale, -2.48 * g5y_scale],
  [0.71 * g5x_scale, -2.64 * g5y_scale], [0.78 * g5x_scale, -2.64 * g5y_scale],
  [0.7355 * g5x_scale, -2.7845 * g5y_scale], [0.785 * g5x_scale, -2.786 * g5y_scale],

  [0.336 * g6x_scale, -2.731 * g6y_scale], [0.390 * g6x_scale, -2.7295 * g6y_scale],
  [0.198 * g6x_scale, -2.4046 * g6y_scale], [0.2464 * g6x_scale, -2.4054 * g6y_scale],
  [0.1885 * g6x_scale, -2.506 * g6y_scale], [0.2324 * g6x_scale, -2.507 * g6y_scale],
  [0.1796 * g6x_scale, -2.5945 * g6y_scale], [0.2195 * g6x_scale, -2.5933 * g6y_scale],
  [0.173 * g6x_scale, -2.6736 * g6y_scale], [0.208 * g6x_scale, -2.6738 * g6y_scale],
  [0.166 * g6x_scale, -2.744 * g6y_scale], [0.1975 * g6x_scale, -2.7446 * g6y_scale],

  [0.4615 + g7x_offset, (-2.3234 + g7y_offset) * g7y_scale], [0.461 + g7x_offset, (-2.352 + g7y_offset) * g7y_scale],
  [0.4615 + g7x_offset, (-2.3808 + g7y_offset) * g7y_scale], [0.4618 + g7x_offset, (-2.404 + g7y_offset) * g7y_scale],
  [0.4654 + g7x_offset, (-2.4287 + g7y_offset) * g7y_scale], [0.464 + g7x_offset, (-2.451 + g7y_offset) * g7y_scale],
  [0.466 + g7x_offset, (-2.474 + g7y_offset) * g7y_scale], [0.4662 + g7x_offset, (-2.492 + g7y_offset) * g7y_scale],
  [0.468 + g7x_offset, (-2.515 + g7y_offset) * g7y_scale], [0.467 + g7x_offset, (-2.53 + g7y_offset) * g7y_scale],
  [0.47 + g7x_offset, (-2.55 + g7y_offset) * g7y_scale], [0.4705 + g7x_offset, (-2.5622 + g7y_offset) * g7y_scale],
]

/** Scan-table rows the layout covers; the two halves live 33 segments apart. */
export const ELEMENT_COUNT = POINTS.length / 4

/**
 * Where the 4-point model puts its keypoints, in target units: the corners of
 * the target's outer outline, in the model's own keypoint order — top right,
 * top left, bottom left, bottom right.
 *
 * Measured by running the model on the reference image below and reading the
 * keypoints back through `toReference`, rather than assumed, so any slack in
 * that mapping cancels out: the same numbers that place the elements place the
 * corners. Edges are averaged to a rectangle because the outline is one, and
 * the bottom-left keypoint is the one the model is least sure of.
 *
 * Index order is what ties a detected keypoint to a corner; a mirrored target
 * needs no flag, since the fit sees mirrored corners and carries the reflection.
 */
export const PATTERN_CORNERS = [
  [2.739, 0.708],
  [-3.999, 0.708],
  [-3.999, -5.714],
  [2.739, -5.714],
]

/**
 * The same group and element, as a row of the layout one nesting level in — or
 * null where this row has no counterpart there.
 *
 * A USAF target carries a quarter-scale copy of itself, so the layout is
 * self-similar: two groups finer is the same pattern four times smaller. Row 15
 * of the table is the first element of the fifth group, and the nested copy's
 * own row 3 is the first element of its fifth group, which is the same bars.
 * The three rows that start the table are the odd ones out, since only elements
 * 2 to 4 of the first group are scanned.
 *
 * Checked against the table rather than assumed: fitting a similarity from each
 * row's box to its counterpart's gives a scale of 0.2494 and 0.19 degrees of
 * rotation, with every box landing within 0.2% of the target's width.
 */
export function nestedRow(index) {
  if (index >= 15) return index - 12
  if (index >= 10 && index <= 12) return index - 10
  return null
}

function segment(index) {
  return [POINTS[2 * index], POINTS[2 * index + 1]]
}

function length([[ax, ay], [bx, by]]) {
  return Math.hypot(bx - ax, by - ay)
}

/** A scanline's square footprint: the bars span about as far as the scan is long. */
function footprint(seg) {
  const [[ax, ay], [bx, by]] = seg
  const half = length(seg) / 2
  return [(ax + bx) / 2 - half, (ay + by) / 2 - half, (ax + bx) / 2 + half, (ay + by) / 2 + half]
}

/**
 * One entry per score-table row: both scanlines and the box around them, all in
 * target units. Row `index` lines up with the model sidecar's `scoreTable`.
 */
export const ELEMENTS = Array.from({ length: ELEMENT_COUNT }, (_, index) => {
  const segments = [segment(index), segment(index + ELEMENT_COUNT)]
  const boxes = segments.map(footprint)
  return {
    index,
    segments,
    // The element reads as one pattern, so the box covers both bar directions.
    box: {
      x1: Math.min(...boxes.map((b) => b[0])),
      y1: Math.min(...boxes.map((b) => b[1])),
      x2: Math.max(...boxes.map((b) => b[2])),
      y2: Math.max(...boxes.map((b) => b[3])),
    },
    // 3 bars and 2 gaps of one bar width each: the scan spans 5 bar widths.
    barWidthUnits: Math.min(...segments.map(length)) / 5,
  }
})

/**
 * Physical size of one target unit, in micrometres, read off the layout: each
 * element's bar width is known, and the scan across it spans five of them.
 *
 * The positions in constants.py are hand-trimmed against real targets, so the
 * per-element answers scatter by a few percent; the median is what keeps a
 * derived bar width on the same ladder as the lp/mm it sits next to. `table` is
 * the model's score table, since which element a row names depends on the
 * target's first group.
 */
export function micronsPerUnit(table) {
  const samples = ELEMENTS.map((element) => {
    const row = table[element.index]
    return row ? lineWidthUmOf(row) / element.barWidthUnits : null
  })
    .filter((value) => value !== null && Number.isFinite(value))
    .sort((a, b) => a - b)
  if (samples.length === 0) return null
  return samples[Math.floor(samples.length / 2)]
}

/**
 * The bundled reference target and its target-space mapping, from
 * constants.py `SIFT_CONFIG_LIST[2]` (SIFT_ref_image.png). The stored origin is
 * for an unmirrored target, which is how the image itself reads.
 */
export const REFERENCE = {
  width: 347,
  height: 337,
  origin: [195.0, 66.5],
  pixelsPerUnitX: 44.3,
  pixelsPerUnitY: 43.0,
}

/** Target units to reference-image pixels, mirroring transforms.py `usaf2ref`. */
export function toReference([x, y]) {
  return [REFERENCE.origin[0] + x * REFERENCE.pixelsPerUnitX, REFERENCE.origin[1] - y * REFERENCE.pixelsPerUnitY]
}
