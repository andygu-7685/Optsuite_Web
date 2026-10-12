import CtfChart from './CtfChart'
import { formatGroupElement, formatLineWidthUm, formatLpPerMm } from '../lib/usaf'

const DASH = '—'

function number(value, digits = 2, unit = '') {
  return value === null || value === undefined || !Number.isFinite(value) ? DASH : `${value.toFixed(digits)}${unit}`
}

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

function Stat({ label, value, hint }) {
  return (
    <div>
      <dt>
        {label}
        {hint && <em> {hint}</em>}
      </dt>
      <dd>{value}</dd>
    </div>
  )
}

function Scroll({ children }) {
  return <div className="scroll">{children}</div>
}

/**
 * What the frame resolved, how well, and the raw data behind both.
 *
 * The score is one rung of a 12%-per-step ladder, so it is paired with the
 * frequency the measured contrast actually crosses the threshold at: that one
 * moves with focus where the rung only steps, and is the number to watch
 * between two frames of the same target.
 */
export default function Results({ results, analysis, predicting, conf, keypointThreshold, settings }) {
  const { elements, rows, score, scoreFrom, scoreIndex, characteristic, anchorCorners, patternCount, refined } =
    analysis
  const classes = byClass(rows)
  const { preprocess, inference, postprocess } = results.speed
  const count = results.boxes.length
  const c = characteristic

  return (
    <section className="results">
      <header>
        <h2>Results</h2>
        <p className="status">
          {predicting ? 'running…' : `${count} detection${count === 1 ? '' : 's'}`}
          {!predicting && count === 0 && !results.probs && ` · nothing above conf ${conf.toFixed(2)}`}
          {!predicting && elements.length > 0 &&
            ` · ${elements.length} elements measured across ${patternCount} nested pattern${
              patternCount === 1 ? '' : 's'
            }, outermost from ${anchorCorners} corners${refined ? `, ${refined} aligned to the frame` : ''}`}
          {!predicting && elements.length === 0 && count > 0 && ' · no outline to measure against'}
        </p>
      </header>

      <dl className="stats">
        <Stat label="Group/element" hint={scoreFrom ?? ''} value={score ? formatGroupElement(score) : DASH} />
        <Stat label="lp/mm" value={score ? formatLpPerMm(score) : DASH} />
        <Stat label="Bar µm" value={score ? formatLineWidthUm(score) : DASH} />
        <Stat label="Cutoff" hint="lp/mm" value={number(c?.cutoffLpPerMm, 1)} />
        <Stat label="Cutoff bar" hint="µm" value={number(c?.cutoffUm, 2)} />
        <Stat label="Half contrast" hint="lp/mm" value={number(c?.halfContrastLpPerMm, 1)} />
        <Stat label="Sampling limit" hint="lp/mm" value={number(c?.nyquistLpPerMm, 1)} />
        <Stat label="Limited by" value={c?.limitedBy ?? DASH} />
        <Stat label="Sharpness" hint="∇²" value={number(c?.sharpness, 4)} />
        <Stat label="Margin" value={number(c?.margin, 3)} />
        <Stat label="Falling" value={c?.falling === null || c === null ? DASH : `${Math.round(c.falling * 100)}%`} />
        <Stat label="Patterns" hint="nested" value={patternCount || DASH} />
        <Stat label="Image" value={`${results.width} × ${results.height} px`} />
        <Stat label="Detections" value={count} />
        <Stat label="Inference" value={`${inference.toFixed(1)} ms`} />
        <Stat label="Total" value={`${(preprocess + inference + postprocess).toFixed(1)} ms`} />
      </dl>

      {elements.length > 1 && (
        <CtfChart
          elements={elements}
          characteristic={c}
          threshold={settings.threshold}
          method={settings.method}
          scoreIndex={scoreIndex}
        />
      )}

      {elements.length > 0 && (
        <details open>
          <summary>Measured elements</summary>
          <Scroll>
            <table>
              <thead>
                <tr>
                  <th>Scan</th>
                  <th>Nest</th>
                  <th>Group/element</th>
                  <th>lp/mm</th>
                  <th>Bar µm</th>
                  <th>Bar px</th>
                  <th>Horizontal</th>
                  <th>Vertical</th>
                  <th>{settings.method}</th>
                  <th>Modulation</th>
                  <th>Dips</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {elements.map((element) => (
                  <tr key={element.index} className={element.index === scoreIndex ? 'chosen' : undefined}>
                    <td>{element.index === scoreIndex ? `${element.index} ◂` : element.index}</td>
                    <td>{element.depth}</td>
                    <td>{formatGroupElement(element)}</td>
                    <td>{formatLpPerMm(element)}</td>
                    <td>{formatLineWidthUm(element)}</td>
                    <td>{number(element.barWidthPx)}</td>
                    <td>{element.horizontal.contrast.toFixed(3)}</td>
                    <td>{element.vertical.contrast.toFixed(3)}</td>
                    <td>{element.contrast.toFixed(3)}</td>
                    <td>{element.modulation.toFixed(3)}</td>
                    <td>{element.dips}</td>
                    <td>{element.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        </details>
      )}

      {classes.length > 0 && (
        <details>
          <summary>Classes</summary>
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
                  <th>Box xyxy</th>
                  <th>Size</th>
                  <th>Keypoints</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const { box, groupElement: ge, points } = row
                  const above = points.filter(([, , c2]) => c2 >= keypointThreshold).length
                  return (
                    <tr key={index}>
                      <td>{index + 1}</td>
                      <td>{row.name}</td>
                      <td>{row.conf.toFixed(3)}</td>
                      <td>{ge ? formatGroupElement(ge) : DASH}</td>
                      <td>{row.from ?? DASH}</td>
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
                          .map(([x, y, kc], kp) => `k${kp} ${x.toFixed(0)},${y.toFixed(0)} conf ${kc.toFixed(2)}`)
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
