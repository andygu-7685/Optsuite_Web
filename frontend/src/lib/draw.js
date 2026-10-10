// Drawing identified elements over the annotated frame.
//
// @ultralytics/yolo `annotate` draws boxes, keypoints and `class conf%` labels;
// these elements are not detections, so they go on afterwards in a style that
// reads as derived: thinner strokes, and dashes for anything past the score.

import { formatGroupElement, formatLpPerMm } from './usaf'

const RESOLVED = '#c084fc'
const UNRESOLVED = '#8b8b96'
const SHADOW = 'rgba(0, 0, 0, 0.75)'

function boundingBox(quad) {
  const xs = quad.map(([x]) => x)
  const ys = quad.map(([, y]) => y)
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

/**
 * Outline every element and name the ones there is room to name.
 *
 * `lineWidth` and `font` default to the image size the same way `annotate` does,
 * so the two layers stay in proportion on a 640px crop and a 4000px frame alike.
 */
export function drawElements(canvas, elements, { labels = true, lineWidth = 0 } = {}) {
  const context = canvas.getContext('2d')
  if (!context || elements.length === 0) return

  const base = lineWidth > 0 ? lineWidth : Math.max(1, Math.round(Math.min(canvas.width, canvas.height) / 640))
  const fontSize = Math.max(10, Math.round(base * 9))

  context.save()
  context.lineJoin = 'round'
  context.textBaseline = 'bottom'
  context.font = `${fontSize}px ui-monospace, Consolas, monospace`

  for (const element of elements) {
    const colour = element.resolved ? RESOLVED : UNRESOLVED
    context.strokeStyle = colour
    context.lineWidth = base
    context.setLineDash(element.resolved ? [] : [base * 3, base * 2])

    context.beginPath()
    element.quad.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)))
    context.closePath()
    context.stroke()

    const { x1, y1, x2 } = boundingBox(element.quad)
    if (!labels) continue

    // Dashes are for the box only; a dashed glyph outline is unreadable.
    context.setLineDash([])
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
