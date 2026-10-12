// Nudging the fitted transform onto the bars.
//
// The 4-point model's outline keypoints land within a few percent of the target
// width, which is plenty to name an element but not to measure one: a coarse
// element is under a tenth of the target across, so a 3% slip puts the scanline
// off the bars and reads as lost contrast. The Python re-registers against the
// image for the same reason (classic_warp.py, sift_warp.py); this is the small
// version of that, a bounded search for the scale and shift that puts the most
// bar under the scanlines.
//
// The objective is the same scanline contrast the score is made of
// (lib/scan.js), so alignment and measurement cannot disagree about what a
// well-placed scanline looks like. Bounds are deliberately tight: the fit is
// already close, so this only polishes it, and it can never slide the layout
// onto a neighbouring element.

import { apply } from './homography'
import { contrastOf } from './scan'

// Target units and fraction of scale, either side of the fitted transform.
const MAX_SHIFT = 0.35
const MAX_SCALE = 0.06

// Coarse to fine; each pass re-centres on the previous winner and searches a
// little past its grid spacing. Finer grids than this move the answer by less
// than a tenth of a bar width, so they only cost time.
const PASSES = [
  { span: 1, steps: 3 },
  { span: 1 / 3, steps: 2 },
  { span: 1 / 6, steps: 2 },
]

// Only elements this wide on screen carry enough bar to steer the search; the
// finest sit inside the nested pattern and would just follow the rest anyway.
const MIN_BOX_PX = 24

/** How wide the box is on screen, to drop the ones too small to measure. */
function widthPx(transform, box) {
  const a = apply(transform, [box.x1, box.y1])
  const b = apply(transform, [box.x2, box.y1])
  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0
}

/** `transform` with a scale about the target origin and a shift folded in. */
function adjust(transform, scale, dx, dy) {
  return [
    transform[0] * scale,
    transform[1] * scale,
    transform[0] * dx + transform[1] * dy + transform[2],
    transform[3] * scale,
    transform[4] * scale,
    transform[3] * dx + transform[4] * dy + transform[5],
    transform[6] * scale,
    transform[7] * scale,
    transform[6] * dx + transform[7] * dy + transform[8],
  ]
}

/**
 * `transform` adjusted so the scanlines sit on the bars, plus the correction
 * that got it there. `moved` is false when there was nothing to align to — no
 * frame, too few elements big enough to steer with, or no correction that found
 * more contrast than the fit already had.
 */
export function refine(transform, pixels, layout) {
  const unchanged = { transform, scale: 1, dx: 0, dy: 0, moved: false }
  if (!transform || !pixels) return unchanged

  const steering = layout.filter((element) => widthPx(transform, element.box) * pixels.scale >= MIN_BOX_PX)
  if (steering.length < 3) return unchanged

  const start = contrastOf(transform, pixels, steering)
  let best = { scale: 1, dx: 0, dy: 0, value: start }

  for (const pass of PASSES) {
    const from = { ...best }
    const shift = (MAX_SHIFT * pass.span) / pass.steps
    const step = (MAX_SCALE * pass.span) / pass.steps
    for (let i = -pass.steps; i <= pass.steps; i += 1) {
      const scale = from.scale * (1 + step * i)
      if (Math.abs(scale - 1) > MAX_SCALE) continue
      for (let j = -pass.steps; j <= pass.steps; j += 1) {
        const dx = from.dx + shift * j
        for (let k = -pass.steps; k <= pass.steps; k += 1) {
          const dy = from.dy + shift * k
          if (Math.hypot(dx, dy) > MAX_SHIFT) continue
          const value = contrastOf(adjust(transform, scale, dx, dy), pixels, steering)
          if (value > best.value) best = { scale, dx, dy, value }
        }
      }
    }
  }

  if (!(best.value > start)) return unchanged
  const { scale, dx, dy } = best
  return { transform: adjust(transform, scale, dx, dy), scale, dx, dy, moved: true, gain: best.value / start }
}
