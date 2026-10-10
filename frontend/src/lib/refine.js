// Nudging the fitted transform onto the bars.
//
// The 4-point model's outline keypoints land within a few percent of the target
// width, which is plenty to name an element but not to draw a box around one:
// a coarse element is under a tenth of the target across, so a 3% slip shows.
// The Python pipeline re-registers against the image for the same reason
// (classic_warp.py, sift_warp.py); this is the small version of that, a bounded
// search for the scale and shift that puts the most bar inside the boxes.
//
// Bounds are deliberately tight. The fit is already close, so this only polishes
// it — it can never slide the layout onto a neighbouring element.

import { apply } from './homography'

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

// Only elements this wide in sampled pixels carry enough bar to score; the
// finest sit inside the nested pattern and would just follow the rest anyway.
const MIN_BOX_PX = 24
const GRID = 9

/**
 * Luminance lookup over an ImageData, clamped to the frame. Takes full-frame
 * coordinates, since that is what the transform produces, and applies the
 * buffer's own `scale` (lib/pixels.js reads a smaller copy).
 */
function sampler({ data, width, height, scale = 1 }) {
  return (fx, fy) => {
    const x = fx * scale
    const y = fy * scale
    const px = x < 0 ? 0 : x >= width ? width - 1 : x | 0
    const py = y < 0 ? 0 : y >= height ? height - 1 : y | 0
    const i = (py * width + px) << 2
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
  }
}

/**
 * Mean brightness inside the element boxes, each sampled on its own grid so a
 * big element does not outvote a small one.
 */
function brightness(transform, boxes, luminance, scale, dx, dy) {
  let total = 0
  let counted = 0
  for (const box of boxes) {
    let sum = 0
    let n = 0
    for (let i = 0; i < GRID; i += 1) {
      const u = (i + 0.5) / GRID
      for (let j = 0; j < GRID; j += 1) {
        const v = (j + 0.5) / GRID
        const x = (box.x1 + u * (box.x2 - box.x1)) * scale + dx
        const y = (box.y1 + v * (box.y2 - box.y1)) * scale + dy
        const point = apply(transform, [x, y])
        if (!point) continue
        sum += luminance(point[0], point[1])
        n += 1
      }
    }
    if (n === 0) continue
    total += sum / n
    counted += 1
  }
  return counted === 0 ? -1 : total / counted
}

/** How wide the box is on screen, to drop the ones too small to score. */
function widthPx(transform, box) {
  const a = apply(transform, [box.x1, box.y1])
  const b = apply(transform, [box.x2, box.y1])
  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0
}

/**
 * `transform` adjusted so the layout sits on the bars, plus the correction that
 * got it there. `moved` is false when there was nothing to align to — no frame,
 * too few elements big enough to score, or no shift that captured more bar.
 */
export function refine(transform, image, layout) {
  if (!transform || !image) return { transform, scale: 1, dx: 0, dy: 0, moved: false }

  const sampled = image.scale ?? 1
  const boxes = layout
    .map((element) => element.box)
    .filter((box) => widthPx(transform, box) * sampled >= MIN_BOX_PX)
  if (boxes.length < 3) return { transform, scale: 1, dx: 0, dy: 0, moved: false }

  const luminance = sampler(image)
  let best = { scale: 1, dx: 0, dy: 0, value: brightness(transform, boxes, luminance, 1, 0, 0) }
  const start = best.value

  for (const pass of PASSES) {
    const from = { ...best }
    const shift = (MAX_SHIFT * pass.span) / pass.steps
    const step = (MAX_SCALE * pass.span) / pass.steps
    for (let i = -pass.steps; i <= pass.steps; i += 1) {
      const scale = from.scale * (1 + step * i)
      for (let j = -pass.steps; j <= pass.steps; j += 1) {
        const dx = from.dx + shift * j
        for (let k = -pass.steps; k <= pass.steps; k += 1) {
          const dy = from.dy + shift * k
          if (Math.abs(scale - 1) > MAX_SCALE || Math.hypot(dx, dy) > MAX_SHIFT) continue
          const value = brightness(transform, boxes, luminance, scale, dx, dy)
          if (value > best.value) best = { scale, dx, dy, value }
        }
      }
    }
  }

  if (!(best.value > start)) return { transform, scale: 1, dx: 0, dy: 0, moved: false }
  const { scale, dx, dy } = best
  // Fold the correction into the transform so callers see one matrix.
  const corrected = [
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
  return { transform: corrected, scale, dx, dy, moved: true, gain: best.value / start }
}
