// Turning the measured ladder into a score, and into a curve.
//
// Two answers come out of the same measurements. The score is the one the
// Python scorer returns — a group and element, picked by scoring.py
// `find_best_focus_group` walking the scan order until the contrast gives out.
// The curve is what the group and element cannot say: a group/element is a rung
// on a ladder with 12% steps, so two frames that differ by much less than one
// rung score identically. The contrast at each rung, and the frequency the
// contrast crosses the threshold at, move continuously instead.

import { lpPerMmOf } from './usaf'

/**
 * Which rung ends the walk. `inflection` and `threshold` are the two branches
 * of scoring.py `find_best_focus_group`; `cutoff` is this app's own, and the
 * default, for the reason given below.
 */
export const RULES = ['cutoff', 'inflection', 'threshold']

/**
 * How far up the ladder the measurement reaches, as an index into `elements`.
 *
 * The walk stops at the sampling limit either way. Past it a bar covers less
 * than a pixel, so whatever contrast the profile shows is aliasing rather than
 * a resolved element, and a rung read off it is not a measurement. The Python
 * has no equivalent because it scores full-resolution frames where this rarely
 * binds; in a browser, on a downscaled readback, it often does.
 *
 * `inflection` is the Python default: stop at the first element whose contrast
 * has fallen below the threshold, or jumped back up by a fifth — contrast that
 * climbs again at a finer element is the layout having slipped onto something
 * that is not the bars. `threshold` keeps the last rung above the threshold
 * anywhere in the table, the more forgiving reading of the same data. Both
 * start at the second rung, matching the Python's own starting index when no
 * detection has already claimed one.
 *
 * Both also turn on a single element, which makes them jump by two or three
 * rungs when one scanline lands badly. `cutoff` instead takes the finest rung
 * at or below the frequency the curve crosses the threshold at, so the rung
 * agrees with the curve the rest of the panel reports and one noisy element
 * moves it by a fraction of a rung rather than a whole one.
 */
export function focusIndex(elements, { threshold = 0.2, rule = 'cutoff' } = {}) {
  if (elements.length === 0) return null
  if (elements.length < 2) return 0

  const end = Math.max(1, sampledCount(elements))

  if (rule === 'cutoff') {
    const limit = crossing(elements.slice(0, end), threshold)
    if (limit === null) return end - 1
    let chosen = 0
    for (let i = 1; i < end; i += 1) {
      if (lpPerMmOf(elements[i]) <= limit) chosen = i
    }
    return chosen
  }

  if (rule === 'threshold') {
    let chosen = 0
    for (let i = 1; i < end; i += 1) {
      if (elements[i].contrast > threshold) chosen = i
    }
    return chosen
  }

  for (let i = 1; i < end; i += 1) {
    if (elements[i].contrast > elements[i - 1].contrast * 1.2 || elements[i].contrast < threshold) {
      return i - 1
    }
  }
  // Contrast never gave out before the sampling limit did.
  return end - 1
}

/** Rungs the pixel grid can still carry, up to the first that it cannot. */
function sampledCount(elements) {
  const limit = elements.findIndex((element) => element.state === 'undersampled')
  return limit === -1 ? elements.length : limit
}

/**
 * Where the contrast curve crosses `level`, in lp/mm.
 *
 * Elements are spaced geometrically — each is 2^(1/6) above the last — so the
 * interpolation runs in log frequency, which is also the axis a contrast
 * transfer function is read on. Returns null when the curve never crosses,
 * since a bound is not a measurement.
 */
function crossing(elements, level) {
  for (let i = 1; i < elements.length; i += 1) {
    const above = elements[i - 1].contrast
    const below = elements[i].contrast
    if (!(above >= level && below < level)) continue
    const fraction = (above - level) / (above - below)
    const low = Math.log(lpPerMmOf(elements[i - 1]))
    const high = Math.log(lpPerMmOf(elements[i]))
    return Math.exp(low + fraction * (high - low))
  }
  return null
}

/** How much of the ladder falls the way a contrast curve should: a sanity check on the fit. */
function monotonicity(elements) {
  if (elements.length < 2) return null
  let falling = 0
  for (let i = 1; i < elements.length; i += 1) {
    if (elements[i].contrast <= elements[i - 1].contrast) falling += 1
  }
  return falling / (elements.length - 1)
}

/**
 * How well this frame resolves the target, beyond which rung it reached.
 *
 * `cutoffLpPerMm` is the headline: the frequency the measured contrast falls
 * through the threshold at, interpolated between rungs, so defocus moves it
 * smoothly where the group/element only steps. `nyquistLpPerMm` is what the
 * pixel grid alone could carry, and `limitedBy` says which of the two the frame
 * ran into first — a target that is simply too small in frame is not the same
 * finding as one that is out of focus, and the group/element alone cannot tell
 * them apart.
 */
export function characterise(elements, { threshold = 0.2, nyquist = null, sharpness = null, index = null } = {}) {
  if (elements.length === 0) return null

  // Only the rungs the pixel grid can still carry: a crossing found among
  // aliased elements would be a reading of the sampling, not of the optics.
  const sampled = elements.slice(0, sampledCount(elements))

  const cutoff = crossing(sampled, threshold)
  const half = crossing(sampled, 0.5)
  const chosen = index === null ? null : elements[index]
  const undersampled = elements.length - sampled.length

  // Within a fifth of the sampling limit there is no headroom left for the
  // optics to be the thing that ran out.
  let limitedBy = null
  if (cutoff !== null && nyquist !== null) limitedBy = cutoff >= nyquist * 0.8 ? 'sampling' : 'optics'

  return {
    // Null where the curve never falls through the threshold before the
    // sampling limit: the frame resolved everything it could show, and the
    // sampling limit below is the bound to quote instead.
    cutoffLpPerMm: cutoff,
    // The bar width that frequency corresponds to, as the tables quote it.
    cutoffUm: cutoff === null ? null : 1000 / (2 * cutoff),
    halfContrastLpPerMm: half,
    nyquistLpPerMm: nyquist,
    limitedBy,
    sharpness,
    // How far the chosen rung clears the threshold: a thin margin is a coin toss
    // between it and the next one down.
    margin: chosen ? chosen.contrast - threshold : null,
    falling: monotonicity(elements),
    undersampled,
    measured: elements.length,
  }
}
