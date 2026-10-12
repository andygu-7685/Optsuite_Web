import { useMemo, useState } from 'react'
import { formatGroupElement, lpPerMmOf } from '../lib/usaf'

// The contrast transfer curve: what each element measured, against how fine it
// is. A group/element is a rung on a ladder with 12% steps, so it cannot show
// how far past the last resolved element a frame got, or how close it came to
// the next one — the curve can, and it is where defocus actually shows.

const WIDTH = 720
const HEIGHT = 240
const PAD = { top: 16, right: 76, bottom: 34, left: 44 }
const PLOT = {
  x1: PAD.left,
  y1: PAD.top,
  x2: WIDTH - PAD.right,
  y2: HEIGHT - PAD.bottom,
}

const SERIES = [
  { key: 'horizontal', label: 'Horizontal bars' },
  { key: 'vertical', label: 'Vertical bars' },
]

/** Elements are spaced geometrically, so the frequency axis is a log axis. */
function scaleX(lpPerMm, low, high) {
  const span = Math.log(high) - Math.log(low)
  if (span <= 0) return PLOT.x1
  return PLOT.x1 + ((Math.log(lpPerMm) - Math.log(low)) / span) * (PLOT.x2 - PLOT.x1)
}

function scaleY(contrast) {
  return PLOT.y2 - Math.min(1, Math.max(0, contrast)) * (PLOT.y2 - PLOT.y1)
}

/** Powers of two inside the range: each one is the first element of a group. */
function ticks(low, high) {
  const out = []
  for (let power = -2; power <= 10; power += 1) {
    const value = 2 ** power
    if (value >= low && value <= high) out.push(value)
  }
  return out
}

function format(value) {
  return value >= 100 ? value.toFixed(0) : value.toFixed(value >= 10 ? 1 : 2)
}

/**
 * Measured contrast against spatial frequency, with the threshold it is scored
 * against and the frequency it crosses there.
 *
 * Two series, one per bar direction, because the directions coming apart is
 * astigmatism rather than defocus and the merged number hides it.
 */
export default function CtfChart({ elements, characteristic, threshold, method, scoreIndex }) {
  const [hover, setHover] = useState(null)

  const chart = useMemo(() => {
    if (elements.length < 2) return null
    const frequencies = elements.map(lpPerMmOf)
    const low = Math.min(...frequencies)
    const high = Math.max(...frequencies)
    const points = elements.map((element) => ({ element, x: scaleX(lpPerMmOf(element), low, high) }))
    return {
      low,
      high,
      points,
      paths: SERIES.map(({ key }) =>
        points.map(({ element, x }, i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${scaleY(element[key].contrast).toFixed(1)}`).join(' '),
      ),
    }
  }, [elements])

  if (!chart) return null
  const { low, high, points, paths } = chart

  const cutoff = characteristic?.cutoffLpPerMm ?? null
  const nyquist = characteristic?.nyquistLpPerMm ?? null
  const active = hover === null ? null : points[hover]
  const chosen = scoreIndex === null ? null : points[scoreIndex]

  function onMove(event) {
    const box = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * WIDTH
    let nearest = 0
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(points[i].x - x) < Math.abs(points[nearest].x - x)) nearest = i
    }
    setHover(nearest)
  }

  return (
    <figure className="ctf">
      <figcaption>
        <h3>Contrast transfer</h3>
        <ul className="ctf-legend">
          {SERIES.map(({ key, label }, index) => (
            <li key={key}>
              <span className={`ctf-key ctf-s${index + 1}`} /> {label}
            </li>
          ))}
        </ul>
      </figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Measured contrast against spatial frequency for ${elements.length} elements${
          cutoff ? `, crossing the ${threshold} threshold at ${format(cutoff)} line pairs per millimetre` : ''
        }`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Past the sampling limit the pixel grid, not the optics, is what ran out. */}
        {nyquist !== null && nyquist < high && (
          <g className="ctf-limit">
            <rect
              x={scaleX(Math.max(low, nyquist), low, high)}
              y={PLOT.y1}
              width={Math.max(0, PLOT.x2 - scaleX(Math.max(low, nyquist), low, high))}
              height={PLOT.y2 - PLOT.y1}
            />
            {nyquist > low && (
              <text x={scaleX(nyquist, low, high) + 4} y={PLOT.y1 + 10}>
                under-sampled
              </text>
            )}
          </g>
        )}

        <g className="ctf-axis">
          {[0, 0.25, 0.5, 0.75, 1].map((value) => (
            <g key={value}>
              <line x1={PLOT.x1} y1={scaleY(value)} x2={PLOT.x2} y2={scaleY(value)} />
              <text x={PLOT.x1 - 8} y={scaleY(value) + 4} textAnchor="end">
                {value.toFixed(2)}
              </text>
            </g>
          ))}
          {ticks(low, high).map((value) => (
            <text key={value} x={scaleX(value, low, high)} y={PLOT.y2 + 16} textAnchor="middle">
              {value}
            </text>
          ))}
          <text x={PLOT.x2} y={HEIGHT - 4} textAnchor="end">
            lp/mm
          </text>
        </g>

        {/* The level the score is read against, and where the curve crosses it. */}
        <g className="ctf-rule">
          <line x1={PLOT.x1} y1={scaleY(threshold)} x2={PLOT.x2} y2={scaleY(threshold)} />
          <text x={PLOT.x1 + 4} y={scaleY(threshold) - 5}>
            threshold {threshold.toFixed(2)}
          </text>
        </g>
        {cutoff !== null && cutoff >= low && cutoff <= high && (
          <g className="ctf-cutoff">
            <line x1={scaleX(cutoff, low, high)} y1={PLOT.y1} x2={scaleX(cutoff, low, high)} y2={PLOT.y2} />
            <circle cx={scaleX(cutoff, low, high)} cy={scaleY(threshold)} r="4.5" />
          </g>
        )}

        {paths.map((path, index) => (
          <path key={SERIES[index].key} className={`ctf-line ctf-s${index + 1}`} d={path} />
        ))}

        {/* The rung the score landed on, the one point worth naming outright. */}
        {chosen && (
          <g className="ctf-chosen">
            <circle cx={chosen.x} cy={scaleY(chosen.element.contrast)} r="4.5" />
            <text x={chosen.x} y={scaleY(chosen.element.contrast) - 10} textAnchor="middle">
              {formatGroupElement(chosen.element)}
            </text>
          </g>
        )}

        {active && (
          <g className="ctf-hover">
            <line x1={active.x} y1={PLOT.y1} x2={active.x} y2={PLOT.y2} />
            {SERIES.map(({ key }, index) => (
              <circle key={key} className={`ctf-s${index + 1}`} cx={active.x} cy={scaleY(active.element[key].contrast)} r="4" />
            ))}
          </g>
        )}
      </svg>

      <p className="ctf-read" aria-live="polite">
        {active ? (
          <>
            <strong>{formatGroupElement(active.element)}</strong> · {format(lpPerMmOf(active.element))} lp/mm ·{' '}
            horizontal {active.element.horizontal.contrast.toFixed(3)} · vertical{' '}
            {active.element.vertical.contrast.toFixed(3)} · {method}{' '}
            {active.element.contrast.toFixed(3)} ·{' '}
            {active.element.barWidthPx === null ? '—' : `${active.element.barWidthPx.toFixed(2)} px/bar`} ·{' '}
            {active.element.state}
          </>
        ) : (
          <>
            Merged by <strong>{method}</strong>.
            {cutoff === null
              ? ' The curve never crosses the threshold inside the table.'
              : ` Crosses ${threshold.toFixed(2)} at ${format(cutoff)} lp/mm.`}{' '}
            Hover for an element.
          </>
        )}
      </p>
    </figure>
  )
}
