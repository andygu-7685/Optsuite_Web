// Turning a prediction into a measured USAF reading.
//
// The pipeline is usaf_algo.py `find_usaf_score`, with the registration the
// browser can actually do. The four-point pose model finds the corners of the
// target's outline, which fits target space onto the image (lib/homography.js);
// lib/refine.js settles that fit onto the bars; lib/scan.js reads every element
// the way `calculate_scanline_contrast_scores` does; lib/score.js picks the
// rung and describes the curve.
//
// The model finds every nested copy of the target, not just the outermost one,
// and each copy gets its own fit. That matters because a copy is a quarter the
// size of the one around it: placing its elements from the outer corners
// multiplies the fit's error by four per level, which is the difference between
// a scanline on the bars and one beside them.
//
// What changed: the score used to come from the detections alone, so a model
// that only finds whole patterns named no element and every element read as
// resolved — a blurred frame and a sharp one scored the same because nothing
// ever looked at the pixels. Now the detections place the target and the
// pixels decide what it resolves.

import { applyBox, fit } from './homography'
import { sharpnessOf } from './pixels'
import { refine } from './refine'
import { characterise, focusIndex } from './score'
import { measure, nyquistLpPerMm } from './scan'
import { ELEMENTS, PATTERN_CORNERS, nestedRow } from './targetLayout'
import { lpPerMmOf, resolveGroupElement, usafScoreTable } from './usaf'

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

// The target's own outline, to window the blur measure to the target rather
// than the empty background it floats in.
const OUTLINE = {
  x1: Math.min(...PATTERN_CORNERS.map(([x]) => x)),
  y1: Math.min(...PATTERN_CORNERS.map(([, y]) => y)),
  x2: Math.max(...PATTERN_CORNERS.map(([x]) => x)),
  y2: Math.max(...PATTERN_CORNERS.map(([, y]) => y)),
}

function area(box) {
  return Math.max(0, box.x2 - box.x1) * Math.max(0, box.y2 - box.y1)
}

// A nested copy is a quarter the size of the one around it; allow for a loose
// box and a detection that clipped an edge before calling it a nesting level.
const NEST_MIN = 0.15
const NEST_MAX = 0.45

function centre({ x1, y1, x2, y2 }) {
  return [(x1 + x2) / 2, (y1 + y2) / 2]
}

function inside({ x1, y1, x2, y2 }, [x, y]) {
  return x >= x1 && x <= x2 && y >= y1 && y <= y2
}

/**
 * The target and every nested copy of it the model found, outermost first, each
 * with the transform fitted from its own four corners.
 *
 * Detections are taken as a nesting chain only where they actually nest: each
 * one has to sit inside the last and be about a quarter of its size, so a
 * spurious box cannot shift the whole table by two groups. How long the chain
 * is names the first group, as usaf_algo.py `G1 = 8 - pattern_count * 2` does.
 */
function patternChain(results, threshold) {
  const found = []
  results.boxes.forEach((box, index) => {
    const points = results.keypoints?.[index]?.points ?? []
    // Two keypoints are a pair of scanline ends, not outline corners.
    if (points.length < PATTERN_CORNERS.length) return
    const { src, dst } = corners(points, threshold)
    const transform = fit(src, dst)
    if (transform) found.push({ index, box, transform, used: src.length })
  })

  found.sort((a, b) => area(b.box) - area(a.box))
  const chain = found.slice(0, 1)
  for (const candidate of found.slice(1)) {
    const parent = chain[chain.length - 1].box
    const ratio = Math.sqrt(area(candidate.box) / area(parent))
    if (ratio < NEST_MIN || ratio > NEST_MAX) continue
    if (!inside(parent, centre(candidate.box))) continue
    chain.push(candidate)
  }
  // Every pattern detection, so a whole-pattern box is not mistaken for an element.
  return { chain, patterns: new Set(found.map((entry) => entry.index)) }
}

/**
 * Which copy of the target each row of the scan table is read from, and which
 * row of the layout it is there.
 *
 * Rows descend as far as the chain goes: the finer the element, the deeper the
 * copy it belongs to, and the deeper copy is the one whose corners place it
 * accurately. Rows with no counterpart further in stay where they are.
 */
function placementsFor(chain) {
  return ELEMENTS.map((_, index) => {
    let row = index
    let depth = 0
    while (depth + 1 < chain.length) {
      const next = nestedRow(row)
      if (next === null) break
      row = next
      depth += 1
    }
    return { index, depth, layout: ELEMENTS[row] }
  })
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

/** Finest measured element covering `point`; boxes overlap where they crowd. */
function elementAt(elements, point) {
  let best = null
  for (const element of elements) {
    if (!contains(element.quad, point)) continue
    if (!best || lpPerMmOf(element) > lpPerMmOf(best)) best = element
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

const EMPTY = {
  transform: null,
  anchor: null,
  anchorCorners: 0,
  patternCount: 0,
  refined: 0,
  elements: [],
  rows: [],
  score: null,
  scoreFrom: null,
  scoreIndex: null,
  characteristic: null,
  table: [],
}

/**
 * Everything the app knows about one frame: where the target is, what each
 * scanned element measured, which rung that makes the score, and how well the
 * frame resolves the target either side of that rung.
 *
 * Measuring needs both a pattern to anchor to and a readable frame. Without an
 * anchor the model found no outline to place the layout against, and the score
 * falls back to whatever the detections name themselves — which is how the
 * single-element and classify models have always worked. Without a frame there
 * is nothing to measure against at all.
 */
export function analyze(results, usaf, pixels, options = {}) {
  if (!results) return EMPTY
  const { keypointThreshold = 0.25, method, threshold = 0.2, dipRule, rule } = options

  const { chain, patterns } = patternChain(results, keypointThreshold)
  const anchor = chain[0] ?? null
  const table = usafScoreTable(usaf, chain.length)
  const placements = placementsFor(chain)

  // The corners place each copy of the layout; the frame itself settles it.
  // Every copy is refined against the elements it owns, so a correction found
  // on the coarse bars is not applied to a pattern it was never measured on.
  let refined = 0
  const transforms = chain.map((pattern, depth) => {
    if (!pixels) return pattern.transform
    const owned = placements.filter((placement) => placement.depth === depth).map((placement) => placement.layout)
    const adjusted = refine(pattern.transform, pixels, owned)
    if (adjusted.moved) refined += 1
    return adjusted.transform
  })

  const elements =
    pixels && chain.length
      ? measure(
          placements.map((placement) => ({ ...placement, transform: transforms[placement.depth] })),
          pixels,
          table,
          { method, threshold, dipRule },
        )
      : []
  const index = elements.length ? focusIndex(elements, { threshold, rule }) : null

  const rows = detections(results, usaf, { patterns }, elements)
  const named = rows.reduce((best, row) => finer(best, row.groupElement), null)
  const measured = index === null ? null : elements[index]

  const transform = transforms[0] ?? anchor?.transform ?? null
  const outline = transform && pixels ? applyBox(transform, OUTLINE) : null

  return {
    transform,
    anchor: anchor?.index ?? null,
    // Corners the outermost transform was fitted from: 4 is exact, fewer assumes a rectangle.
    anchorCorners: anchor?.used ?? 0,
    // Nesting levels, which is what names the first group.
    patternCount: chain.length,
    // How many of those the frame moved off where the keypoints put them.
    refined,
    elements,
    rows,
    score: measured ?? named,
    scoreFrom: measured ? 'measured' : named ? 'class' : null,
    scoreIndex: index,
    characteristic: elements.length
      ? characterise(elements, {
          threshold,
          index,
          nyquist: nyquistLpPerMm(elements),
          sharpness: outline ? sharpnessOf(pixels, outline) : null,
        })
      : null,
    table,
  }
}
