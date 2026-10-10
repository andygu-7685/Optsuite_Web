import { ELEMENTS, REFERENCE, toReference } from '../lib/targetLayout'
import { formatGroupElement, formatLineWidthUm, formatLpPerMm } from '../lib/usaf'
import reference from '../assets/usaf-reference.png'

// Reference-image pixels a box needs before its label fits over it without
// running into the elements packed around the nested pattern.
const MIN_LABEL_WIDTH = 34
const MIN_LABEL_HEIGHT = 11

/** Target-space box as reference-image pixels. */
function place({ x1, y1, x2, y2 }) {
  // y flips, so the target-space top edge is the smaller pixel y.
  const [left, top] = toReference([x1, y2])
  const [right, bottom] = toReference([x2, y1])
  return { x: left, y: top, width: right - left, height: bottom - top }
}

const BOXES = ELEMENTS.map((element) => ({ index: element.index, ...place(element.box) }))

/**
 * Where each scanned element sits on the target, drawn on the reference image
 * rather than the uploaded one so the layout reads the same whatever was
 * photographed. Solid elements are at or below the score, dashed are past it.
 */
export default function TargetOverlay({ elements, score }) {
  if (elements.length === 0) return null

  // Elements are in scan order, so index lines up with the reference layout.
  const rows = elements.map((element) => ({ ...element, ...BOXES[element.index] }))

  return (
    <section className="overlay">
      <h2>Target overlay</h2>
      <svg
        viewBox={`0 0 ${REFERENCE.width} ${REFERENCE.height}`}
        role="img"
        aria-label="USAF 1951 target with the identified elements marked"
      >
        <image href={reference} x="0" y="0" width={REFERENCE.width} height={REFERENCE.height} />
        {rows.map((row) => (
          <g key={row.index} className={row.resolved ? 'resolved' : 'unresolved'}>
            <rect x={row.x} y={row.y} width={row.width} height={row.height} rx="1">
              <title>
                {`${formatGroupElement(row)} · ${formatLpPerMm(row)} lp/mm · ${formatLineWidthUm(row)} µm bars`}
              </title>
            </rect>
            {row.width >= MIN_LABEL_WIDTH && row.height >= MIN_LABEL_HEIGHT && (
              <text x={row.x} y={row.y - 1.5}>
                {formatGroupElement(row)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <p className="status">
        Reference image ·{' '}
        {score
          ? `solid: at or below ${formatGroupElement(score)} · dashed: finer`
          : 'no score yet, every element identified'}
      </p>
    </section>
  )
}
