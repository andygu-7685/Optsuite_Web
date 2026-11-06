const WIDTH = 260
const HEIGHT = 208
const PLOT = { left: 31, right: 10, top: 13, bottom: 42 }

const SERIES = [
  { key: 'horizontal_bars', label: 'Horizontal bars', color: '#5a2fd6' },
  { key: 'vertical_bars', label: 'Vertical bars', color: '#087e86' },
]

function measurement(element, key) {
  const row = element.fft_orientations?.[key]
  return row && ['resolved', 'unresolved'].includes(row.status) && Number.isFinite(row.mtf)
    ? row
    : null
}

function responsePath(elements, key, x, y) {
  let connected = false
  return elements.map((element) => {
    const row = measurement(element, key)
    if (!row) {
      connected = false
      return ''
    }
    const command = connected ? 'L' : 'M'
    connected = true
    return `${command}${x(element.lp_per_mm).toFixed(2)},${y(row.mtf).toFixed(2)}`
  }).filter(Boolean).join(' ')
}

export default function FftResponseChart({ elements, threshold }) {
  const ordered = [...elements]
    .filter((element) => Number.isFinite(element.lp_per_mm) && element.lp_per_mm > 0)
    .sort((a, b) => a.lp_per_mm - b.lp_per_mm)
  const measured = ordered.filter((element) => SERIES.some(({ key }) => measurement(element, key)))

  if (!measured.length) {
    return <p className="muted fft-chart-empty">Per-orientation FFT data is unavailable. Re-analyze the image to show the response curves.</p>
  }

  const minPower = Math.floor(Math.log2(measured[0].lp_per_mm))
  const maxPower = Math.max(minPower + 1, Math.ceil(Math.log2(measured.at(-1).lp_per_mm)))
  const plotWidth = WIDTH - PLOT.left - PLOT.right
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom
  const responseMax = Math.max(1, ...measured.flatMap((element) => SERIES.map(({ key }) => measurement(element, key)?.mtf ?? 0)))
  const yMax = Math.ceil(responseMax * 2) / 2
  const x = (frequency) => PLOT.left + ((Math.log2(frequency) - minPower) / (maxPower - minPower)) * plotWidth
  const y = (response) => PLOT.top + (1 - response / yMax) * plotHeight
  const xTicks = Array.from({ length: maxPower - minPower + 1 }, (_, index) => 2 ** (minPower + index))
  const yTicks = [0, yMax / 2, yMax]

  return (
    <figure className="fft-response">
      <div className="fft-chart-title">Response (MTF)</div>
      <div className="fft-chart-legend" aria-label="Bar orientations">
        {SERIES.map(({ key, label, color }) => <span key={key}><i style={{ background: color }} />{label}</span>)}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="FFT response versus spatial frequency for horizontal and vertical target bars">
        {yTicks.map((tick) => (
          <g key={tick}>
            <line className="fft-chart-grid" x1={PLOT.left} x2={WIDTH - PLOT.right} y1={y(tick)} y2={y(tick)} />
            <text className="fft-chart-tick" x={PLOT.left - 5} y={y(tick) + 3} textAnchor="end">{tick.toFixed(1)}</text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={tick}>
            <line className="fft-chart-grid" x1={x(tick)} x2={x(tick)} y1={PLOT.top} y2={HEIGHT - PLOT.bottom} />
            <text className="fft-chart-tick" x={x(tick)} y={HEIGHT - PLOT.bottom + 14} textAnchor="middle">{Number(tick.toPrecision(3))}</text>
          </g>
        ))}
        {Number.isFinite(threshold) && threshold >= 0 && threshold <= yMax && (
          <line className="fft-chart-threshold" x1={PLOT.left} x2={WIDTH - PLOT.right} y1={y(threshold)} y2={y(threshold)} />
        )}
        {SERIES.map(({ key, color }) => (
          <g key={key}>
            <path d={responsePath(ordered, key, x, y)} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
            {measured.map((element) => {
              const row = measurement(element, key)
              if (!row) return null
              return (
                <circle key={`${element.group}:${element.element}`} cx={x(element.lp_per_mm)} cy={y(row.mtf)} r="2.8" fill={color}>
                  <title>{`G${element.group}E${element.element} · ${element.lp_per_mm.toFixed(2)} lp/mm · MTF ${row.mtf.toFixed(3)} · ${row.detect_db.toFixed(1)} dB · ${row.status}`}</title>
                </circle>
              )
            })}
          </g>
        ))}
        <text className="fft-chart-axis-label" x={PLOT.left + plotWidth / 2} y={HEIGHT - 7} textAnchor="middle">Spatial frequency · lp/mm (log₂)</text>
      </svg>
    </figure>
  )
}
