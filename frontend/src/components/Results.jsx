import {
  formatGroupElement,
  formatLineWidthUm,
  formatLpPerMm,
  lpPerMm,
  parseGroupElement,
} from '../lib/usaf'

const DASH = '—'

function Tile({ label, hint, value }) {
  return (
    <div className="tile">
      <span className="tile-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      <strong className="tile-value">{value}</strong>
    </div>
  )
}

/** One row per detection; classify models use top-1 as the only row. */
function toRows(results) {
  if (results.boxes.length === 0 && results.probs) {
    const { name, top1conf } = results.probs
    return [{ name, conf: top1conf, groupElement: parseGroupElement(name), points: [] }]
  }
  return results.boxes.map((box, index) => ({
    name: box.name,
    conf: box.conf,
    box,
    groupElement: parseGroupElement(box.name),
    points: results.keypoints?.[index]?.points ?? [],
  }))
}

/** Finest group/element across detections. */
function finest(rows) {
  let best = null
  for (const row of rows) {
    if (!row.groupElement) continue
    const { group, element } = row.groupElement
    if (!best || lpPerMm(group, element) > lpPerMm(best.group, best.element)) best = row.groupElement
  }
  return best
}

/** Detections in USAF terms. Group/element comes from class labels only. */
export default function Results({ results, predicting, conf, keypointThreshold }) {
  const rows = toRows(results)
  const best = finest(rows)
  const count = results.boxes.length

  return (
    <section className="results">
      <header>
        <h2>Results</h2>
        <p className="status">
          {predicting
            ? 'running…'
            : `${count} detection${count === 1 ? '' : 's'}`}
          {!predicting && count === 0 && !results.probs && ` · nothing above conf ${conf.toFixed(2)}`}
        </p>
      </header>

      {best ? (
        <div className="tiles">
          <Tile label="Group" value={best.group} />
          <Tile label="Element" value={best.element} />
          <Tile
            label="Resolution"
            hint="lp/mm"
            value={formatLpPerMm(best.group, best.element)}
          />
          <Tile
            label="Bar width"
            hint="µm"
            value={formatLineWidthUm(best.group, best.element)}
          />
        </div>
      ) : (
        <p className="results-note">
          {'No group/element in this model’s labels: '}
          <code>{rows[0]?.name ?? 'no detections'}</code>
          {' is the registration step, and scoring to a group/element runs in Python, in '}
          <code>score_pattern_crops</code>
          {'. A model whose classes are named per element — '}
          <code>g3e4</code>
          {' — fills these in.'}
        </p>
      )}

      {rows.length > 0 && (
        <div className="results-scroll">
          <table className="results-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Class</th>
                <th>Conf</th>
                <th>Group/element</th>
                <th>lp/mm</th>
                <th>Bar µm</th>
                <th>Box xyxy</th>
                <th>Size</th>
                <th>Keypoints</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const { box, groupElement: ge, points } = row
                const above = points.filter(([, , c]) => c >= keypointThreshold).length
                return (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>{row.name}</td>
                    <td>{row.conf.toFixed(3)}</td>
                    <td>{ge ? formatGroupElement(ge) : DASH}</td>
                    <td>{ge ? formatLpPerMm(ge.group, ge.element) : DASH}</td>
                    <td>{ge ? formatLineWidthUm(ge.group, ge.element) : DASH}</td>
                    <td>
                      {box
                        ? `${box.x1.toFixed(0)}, ${box.y1.toFixed(0)}, ${box.x2.toFixed(0)}, ${box.y2.toFixed(0)}`
                        : DASH}
                    </td>
                    <td>
                      {box ? `${(box.x2 - box.x1).toFixed(0)} × ${(box.y2 - box.y1).toFixed(0)}` : DASH}
                    </td>
                    <td
                      title={points
                        .map(([x, y, c], kp) => `k${kp} ${x.toFixed(0)},${y.toFixed(0)} conf ${c.toFixed(2)}`)
                        .join('\n')}
                    >
                      {points.length ? `${above} / ${points.length}` : DASH}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="results-meta">
        {`${results.width} × ${results.height} px · ${results.speed.preprocess.toFixed(1)} ms pre · `}
        {`${results.speed.inference.toFixed(1)} ms inference · ${results.speed.postprocess.toFixed(1)} ms post`}
      </p>

      <details>
        <summary>Raw results</summary>
        <pre>{JSON.stringify({ boxes: results.boxes, keypoints: results.keypoints, speed: results.speed }, null, 2)}</pre>
      </details>
    </section>
  )
}
