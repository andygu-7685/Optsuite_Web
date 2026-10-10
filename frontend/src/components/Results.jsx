import { formatGroupElement, formatLineWidthUm, formatLpPerMm } from '../lib/usaf'

const DASH = '—'

/** Detections per class, with the confidence spread, most detections first. */
function byClass(rows) {
  const classes = new Map()
  for (const row of rows) {
    let entry = classes.get(row.name)
    if (!entry) {
      entry = { name: row.name, groupElement: row.groupElement, count: 0, total: 0, min: 1, max: 0 }
      classes.set(row.name, entry)
    }
    entry.count += 1
    entry.total += row.conf
    entry.min = Math.min(entry.min, row.conf)
    entry.max = Math.max(entry.max, row.conf)
  }
  return [...classes.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

function Stat({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function Scroll({ children }) {
  return <div className="scroll">{children}</div>
}

/** Run statistics, what the target resolved to, per-class counts, and the raw data. */
export default function Results({ results, identified, predicting, conf, keypointThreshold }) {
  const { elements, rows, score, anchorCorners, refined } = identified
  const classes = byClass(rows)
  const { preprocess, inference, postprocess } = results.speed
  const count = results.boxes.length

  return (
    <section className="results">
      <header>
        <h2>Results</h2>
        <p className="status">
          {predicting ? 'running…' : `${count} detection${count === 1 ? '' : 's'}`}
          {!predicting && count === 0 && !results.probs && ` · nothing above conf ${conf.toFixed(2)}`}
          {!predicting && elements.length > 0 &&
            ` · ${elements.length} elements from ${anchorCorners} corners${refined ? ', aligned to the frame' : ''}`}
        </p>
      </header>

      <dl className="stats">
        <Stat label="Group/element" value={score ? formatGroupElement(score) : DASH} />
        <Stat label="lp/mm" value={score ? formatLpPerMm(score) : DASH} />
        <Stat label="Bar µm" value={score ? formatLineWidthUm(score) : DASH} />
        <Stat label="Image" value={`${results.width} × ${results.height} px`} />
        <Stat label="Detections" value={count} />
        <Stat label="Classes" value={classes.length} />
        <Stat label="Preprocess" value={`${preprocess.toFixed(1)} ms`} />
        <Stat label="Inference" value={`${inference.toFixed(1)} ms`} />
        <Stat label="Postprocess" value={`${postprocess.toFixed(1)} ms`} />
        <Stat label="Total" value={`${(preprocess + inference + postprocess).toFixed(1)} ms`} />
      </dl>

      {classes.length > 0 && (
        <Scroll>
          <table>
            <thead>
              <tr>
                <th>Class</th>
                <th>Group/element</th>
                <th>Count</th>
                <th>Mean conf</th>
                <th>Min</th>
                <th>Max</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((entry) => (
                <tr key={entry.name}>
                  <td>{entry.name}</td>
                  <td>{entry.groupElement ? formatGroupElement(entry.groupElement) : DASH}</td>
                  <td>{entry.count}</td>
                  <td>{(entry.total / entry.count).toFixed(3)}</td>
                  <td>{entry.min.toFixed(3)}</td>
                  <td>{entry.max.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      )}

      {elements.length > 0 && (
        <details open>
          <summary>Identified elements</summary>
          <Scroll>
            <table>
              <thead>
                <tr>
                  <th>Scan</th>
                  <th>Group/element</th>
                  <th>lp/mm</th>
                  <th>Bar µm</th>
                  <th>Bar px</th>
                  <th>Centre</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {elements.map((element) => (
                  <tr key={element.index}>
                    <td>{element.index}</td>
                    <td>{formatGroupElement(element)}</td>
                    <td>{formatLpPerMm(element)}</td>
                    <td>{formatLineWidthUm(element)}</td>
                    <td>{element.barWidthPx === null ? DASH : element.barWidthPx.toFixed(2)}</td>
                    <td>{`${element.center[0].toFixed(0)}, ${element.center[1].toFixed(0)}`}</td>
                    <td>{element.resolved ? 'resolved' : 'unresolved'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        </details>
      )}

      {rows.length > 0 && (
        <details>
          <summary>Detections</summary>
          <Scroll>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Class</th>
                  <th>Conf</th>
                  <th>Group/element</th>
                  <th>From</th>
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
                      <td>{row.from ?? DASH}</td>
                      <td>{ge ? formatLpPerMm(ge) : DASH}</td>
                      <td>{ge ? formatLineWidthUm(ge) : DASH}</td>
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
          </Scroll>
        </details>
      )}

      <details>
        <summary>Raw results</summary>
        <pre>
          {JSON.stringify(
            {
              width: results.width,
              height: results.height,
              speed: results.speed,
              probs: results.probs,
              boxes: results.boxes,
              keypoints: results.keypoints,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  )
}
