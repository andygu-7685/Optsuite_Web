// Turning a prediction into named USAF elements.
//
// The 4-point pose model finds the corners of the target's outline, which is
// enough to fit target space onto the image (lib/homography.js) and read off
// where every scanned element landed (lib/targetLayout.js). That is what makes
// the group/element automatic: the model needs no per-element class, the way
// yolo_model.py `yolo_4pt_calculation` works from the same four points.

import { apply, applyBox, fit, scaleAt } from './homography'
import { refine } from './refine'
import { ELEMENTS, PATTERN_CORNERS, micronsPerUnit } from './targetLayout'
import { lineWidthUmOf, lpPerMmOf, resolveGroupElement, usafScoreTable } from './usaf'

/** Keypoints that can stand in for outline corners, paired with the corner they name. */
function corners(points, threshold) {
  const src = []
  const dst = []
  points.forEach(([x, y, conf], index) => {
    if (index >= PATTERN_CORNERS.length || conf < threshold) return
    src.push(PATTERN_CORNERS[index])
    dst.push([x, y])
  })
  return { src, dst }
}

function area(box) {
  return Math.max(0, box.x2 - box.x1) * Math.max(0, box.y2 - box.y1)
}

/**
 * The detection to read target space from: the largest pattern whose keypoints
 * still fit a transform. A USAF target nests smaller copies of itself, so the
 * model reports several patterns; the outermost one is the one whose scan table
 * covers the rest of them.
 */
function findAnchor(results, threshold) {
  let best = null
  const patterns = new Set()
  results.boxes.forEach((box, index) => {
    const points = results.keypoints?.[index]?.points ?? []
    // Two keypoints are a pair of scanline ends, not outline corners.
    if (points.length < PATTERN_CORNERS.length) return
    patterns.add(index)
    const { src, dst } = corners(points, threshold)
    const transform = fit(src, dst)
    if (!transform) return
    if (!best || area(box) > area(best.box)) best = { index, box, transform, used: src.length }
  })
  return best && { ...best, patterns }
}

function contains(quad, [x, y]) {
  let inside = false
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i, i += 1) {
    const [xi, yi] = quad[i]
    const [xj, yj] = quad[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Finest projected element covering `point`; boxes overlap where they crowd. */
function elementAt(elements, point) {
  let best = null
  for (const element of elements) {
    if (!contains(element.quad, point)) continue
    if (!best || element.lpPerMm > best.lpPerMm) best = element
  }
  return best
}

function finer(a, b) {
  if (!a) return b
  if (!b) return a
  return lpPerMmOf(b) > lpPerMmOf(a) ? b : a
}

/**
 * One row per detection, with the group/element each resolved to and how.
 * Classify models have no boxes, so their top-1 class is the only row.
 */
function detections(results, usaf, anchor, elements) {
  if (!results) return []
  if (results.boxes.length === 0 && results.probs) {
    const { name, top1, top1conf } = results.probs
    const groupElement = resolveGroupElement(usaf, top1, name)
    return [{ name, conf: top1conf, groupElement, from: groupElement ? 'class' : null, points: [] }]
  }
  return results.boxes.map((box, index) => {
    const labelled = resolveGroupElement(usaf, box.cls, box.name)
    // Only detections that are single elements get matched by position. A whole
    // pattern sits over many elements at once, so calling it the one under its
    // centre would invent a score out of a nested copy of the target.
    const matched =
      !labelled && anchor && !anchor.patterns.has(index)
        ? elementAt(elements, [(box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2])
        : null
    return {
      name: box.name,
      conf: box.conf,
      box,
      groupElement: labelled ?? matched ?? null,
      from: labelled ? 'class' : matched ? 'geometry' : null,
      points: results.keypoints?.[index]?.points ?? [],
    }
  })
}

/**
 * Group/element for every element the target carries and every detection that
 * names one.
 *
 * `elements` is empty when no detection carries four keypoints — a model that
 * finds single elements has nothing to anchor target space to, and those
 * detections fall back to the sidecar class map the way they did before.
 * `score` is the finest group/element any detection resolved to, which is what
 * splits the elements into resolved and unresolved.
 */
export function identify(results, usaf, keypointThreshold = 0.25, image = null) {
  const table = usafScoreTable(usaf)
  const anchor = results ? findAnchor(results, keypointThreshold) : null
  // The keypoints place the layout; the frame itself settles it.
  const adjusted = anchor ? refine(anchor.transform, image, ELEMENTS) : null
  const transform = adjusted?.transform ?? anchor?.transform ?? null

  const elements = []
  if (anchor) {
    const unitUm = micronsPerUnit(table)
    for (const layout of ELEMENTS) {
      const row = table[layout.index]
      if (!row) continue
      const middle = [(layout.box.x1 + layout.box.x2) / 2, (layout.box.y1 + layout.box.y2) / 2]
      const quad = applyBox(transform, layout.box)
      const center = apply(transform, middle)
      if (!quad || !center) continue
      // Read the scale where the element sits, so perspective is accounted for.
      const unitPx = scaleAt(transform, middle)
      elements.push({
        ...row,
        quad,
        center,
        // How many image pixels one bar covers: whether the element is even sampled.
        barWidthPx: unitPx === null || !unitUm ? null : (lineWidthUmOf(row) / unitUm) * unitPx,
      })
    }
  }

  const rows = detections(results, usaf, anchor, elements)
  const score = rows.reduce((best, row) => finer(best, row.groupElement), null)

  const limit = score ? lpPerMmOf(score) : null
  for (const element of elements) {
    // No score means nothing to split on, so every element reads as identified.
    element.resolved = limit === null || lpPerMmOf(element) <= limit + 1e-9
  }

  return {
    transform,
    anchor: anchor?.index ?? null,
    // Whether the frame moved the layout off where the keypoints put it.
    refined: adjusted?.moved ?? false,
    // Corners the transform was fitted from: 4 is exact, fewer assumes a rectangle.
    anchorCorners: anchor?.used ?? 0,
    elements,
    rows,
    score,
  }
}
