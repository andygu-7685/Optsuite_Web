// Drawing the measured elements over the annotated frame.
//
// @ultralytics/yolo `annotate` draws boxes, keypoints and `class conf%` labels;
// these elements are not detections, so they go on afterwards in a style that
// reads as derived: thinner strokes, and dashes for anything the pixels did not
// hold. The scanlines are the actual measurement, so they can be shown too —
// the Python draws its own the same way, in `calculate_scanline_contrast_scores`.

import { formatGroupElement, formatLpPerMm } from './usaf'

// Resolved reuses the app accent; the other two have to stay legible on a frame
// that is mostly black, and distinct from the detection overlay underneath.
const STATE = {
  resolved: { colour: '#c084fc', dash: null },
  unresolved: { colour: '#8b8b96', dash: [3, 2] },
  // Past the sampling limit, where the pixels cannot answer either way.
  undersampled: { colour: '#eb6834', dash: [1, 2] },
}

const SHADOW = 'rgba(0, 0, 0, 0.75)'

function boundingBox(quad) {
  const xs = quad.map(([x]) => x)
  const ys = quad.map(([, y]) => y)
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

/**
 * Outline every element, name the ones there is room to name, and optionally
 * show the two scanlines each one was measured along.
 *
 * `lineWidth` and `font` default to the image size the same way `annotate` does,
 * so the two layers stay in proportion on a 640px crop and a 4000px frame alike.
 */
export function drawElements(canvas, elements, { labels = true, lineWidth = 0, scanlines = false } = {}) {
  const context = canvas.getContext('2d')
  if (!context || elements.length === 0) return

  const base = lineWidth > 0 ? lineWidth : Math.max(1, Math.round(Math.min(canvas.width, canvas.height) / 640))
  const fontSize = Math.max(10, Math.round(base * 9))

  context.save()
  context.lineJoin = 'round'
  context.textBaseline = 'bottom'
  context.font = `${fontSize}px ui-monospace, Consolas, monospace`

  for (const element of elements) {
    const { colour, dash } = STATE[element.state] ?? STATE.unresolved
    context.strokeStyle = colour
    context.lineWidth = base
    context.setLineDash(dash ?? [])

    context.beginPath()
    element.quad.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)))
    context.closePath()
    context.stroke()

    if (scanlines) {
      context.setLineDash([])
      context.beginPath()
      for (const scan of [element.horizontal, element.vertical]) {
        context.moveTo(scan.a[0], scan.a[1])
        context.lineTo(scan.b[0], scan.b[1])
      }
      context.stroke()
    }

    if (!labels) continue

    // Dashes are for the box only; a dashed glyph outline is unreadable.
    context.setLineDash([])
    const { x1, y1, x2 } = boundingBox(element.quad)
    const text = `${formatGroupElement(element)} ${formatLpPerMm(element)} lp/mm`
    // Elements pack tighter the finer they get, so a label only earns its place
    // when the box it names is at least as wide as the label itself.
    if (context.measureText(text).width > x2 - x1) continue
    context.lineWidth = base * 2
    context.strokeStyle = SHADOW
    context.strokeText(text, x1, y1 - base)
    context.fillStyle = colour
    context.fillText(text, x1, y1 - base)
  }

  context.restore()
}
