import './ContrastCharts.css'

const WIDTH = 320
const HEIGHT = 184
const PLOT = { left: 38, right: 12, top: 15, bottom: 43 }
const COLORS = { combined: '#6d3ff0', vertical: '#087f8c', horizontal: '#d06a22' }

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function finiteScore(value) {
  const score = finiteNumber(value)
  return score !== null && score >= 0 ? score : null
}

function formatTick(value) {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)
}

function ScoreChart({ title, rows, series, maxScore, selectedFrequency }) {
  const frequencies = rows.map((row) => row.frequency)
  const minFrequency = Math.min(...frequencies)
  const maxFrequency = Math.max(...frequencies)
  const plotWidth = WIDTH - PLOT.left - PLOT.right
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom
  const minLog = Math.log2(minFrequency)
  const logSpan = Math.log2(maxFrequency) - minLog
  const x = (frequency) => PLOT.left + (logSpan ? (Math.log2(frequency) - minLog) / logSpan : 0.5) * plotWidth
  const y = (score) => PLOT.top + (1 - score / maxScore) * plotHeight
  const ticks = logSpan ? [minFrequency, 2 ** ((minLog + Math.log2(maxFrequency)) / 2), maxFrequency] : [minFrequency]

  return <figure className="contrast-chart">
    <figcaption>{title}</figcaption>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${title} against USAF spatial frequency in line pairs per millimeter`}>
      {[0, 0.5, 1].map((fraction) => <g key={fraction}>
        <line className="contrast-grid" x1={PLOT.left} x2={WIDTH - PLOT.right} y1={y(fraction * maxScore)} y2={y(fraction * maxScore)} />
        <text className="contrast-tick" x={PLOT.left - 6} y={y(fraction * maxScore) + 3} textAnchor="end">{(fraction * maxScore).toFixed(2)}</text>
      </g>)}
      {selectedFrequency && <line className="contrast-selected" x1={x(selectedFrequency)} x2={x(selectedFrequency)} y1={PLOT.top} y2={HEIGHT - PLOT.bottom} />}
      {series.map(({ key, label }) => {
        const points = rows.filter((row) => row[key] !== null)
        return <g key={key}>
          {points.length > 1 && <polyline className="contrast-line" stroke={COLORS[key]} points={points.map((row) => `${x(row.frequency)},${y(row[key])}`).join(' ')} />}
          {points.map((row) => <circle key={`${row.group}-${row.element}`} cx={x(row.frequency)} cy={y(row[key])} r={row.selected ? 4.2 : 2.7} fill={COLORS[key]} stroke={row.selected ? '#1c1c21' : '#fff'} strokeWidth={row.selected ? 1.2 : 0.8}>
            <title>{`G${row.group} E${row.element} · ${formatTick(row.frequency)} lp/mm · ${label}: ${row[key].toFixed(3)}${row.selected ? ' · selected' : ''}`}</title>
          </circle>)}
        </g>
      })}
      {ticks.map((tick, index) => <text key={index} className="contrast-tick" x={x(tick)} y={HEIGHT - 25} textAnchor={index === 0 && logSpan ? 'start' : index === 2 ? 'end' : 'middle'}>{formatTick(tick)}</text>)}
      <text className="contrast-axis-label" x={WIDTH / 2} y={HEIGHT - 6} textAnchor="middle">Spatial frequency (lp/mm{logSpan ? ', log scale' : ''})</text>
    </svg>
    <div className="contrast-legend">{series.map(({ key, label }) => <span key={key}><i style={{ background: COLORS[key] }} />{label}</span>)}{selectedFrequency && <span className="contrast-legend-selected">Dashed: selected element</span>}</div>
  </figure>
}

export default function ContrastCharts({ elements }) {
  const rows = (elements || []).map((element) => ({
    group: element.group,
    element: element.element,
    frequency: finiteNumber(element.lp_per_mm),
    combined: finiteScore(element.contrast_score),
    vertical: finiteScore(element.vertical?.score),
    horizontal: finiteScore(element.horizontal?.score),
    selected: Boolean(element.selected),
  })).filter((row) => row.frequency > 0 && [row.combined, row.vertical, row.horizontal].some((score) => score !== null))
    .sort((a, b) => a.frequency - b.frequency)

  if (!rows.length) return null

  const maxValue = Math.max(...rows.flatMap((row) => [row.combined, row.vertical, row.horizontal].filter((score) => score !== null)))
  const maxScore = Math.max(0.1, Math.ceil(maxValue * 10) / 10)
  const selectedFrequency = rows.find((row) => row.selected)?.frequency

  return <section className="contrast-charts" aria-label="Contrast measurements">
    <h3>Contrast measurements</h3>
    {rows.some((row) => row.combined !== null) && <ScoreChart title="Combined score" rows={rows} series={[{ key: 'combined', label: 'Combined' }]} maxScore={maxScore} selectedFrequency={selectedFrequency} />}
    {rows.some((row) => row.vertical !== null || row.horizontal !== null) && <ScoreChart title="Directional scores" rows={rows} series={[{ key: 'vertical', label: 'Vertical' }, { key: 'horizontal', label: 'Horizontal' }]} maxScore={maxScore} selectedFrequency={selectedFrequency} />}
  </section>
}
