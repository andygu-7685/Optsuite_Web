import { useEffect, useRef, useState } from 'react'
import AccountControls from './AccountControls.jsx'
import FftResponseChart from './FftResponseChart.jsx'
import { supabase } from './supabaseClient.js'
import './ReportsPage.css'

const PAGE_SIZE = 20
const BUCKET = 'characterization-images'

function formattedDate(value) {
  return new Date(value).toLocaleString()
}

function formattedNumber(value, digits = 3) {
  return Number(value).toFixed(digits)
}

function ReportDetail({ userId, selectedId }) {
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(true)
  const [detailError, setDetailError] = useState('')
  const [images, setImages] = useState(null)
  const [imageMode, setImageMode] = useState('overlay')
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const urls = []
    async function loadDetail() {
      try {
        const { data: report, error: reportError } = await supabase
          .from('characterization_reports')
          .select('*')
          .eq('id', selectedId)
          .eq('user_id', userId)
          .single()
        if (reportError) throw reportError
        if (cancelled) return
        setDetail(report)

        const bucket = supabase.storage.from(BUCKET)
        const [original, overlay] = await Promise.all([
          bucket.download(report.original_path),
          bucket.download(report.overlay_path),
        ])
        if (overlay.error) throw overlay.error
        if (cancelled) return
        const overlayUrl = URL.createObjectURL(overlay.data)
        urls.push(overlayUrl)
        const originalUrl = original.error ? null : URL.createObjectURL(original.data)
        if (originalUrl) urls.push(originalUrl)
        setImages({ original: originalUrl, overlay: overlayUrl })
        if (original.error) setDetailError(`Original image unavailable: ${original.error.message}`)
      } catch (error) {
        if (!cancelled) setDetailError(error.message || 'Could not load this report.')
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    }
    loadDetail()
    return () => {
      cancelled = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [userId, selectedId])

  const selectedImage = images?.[imageMode]

  return <>
    <div className="reports-heading">
      <div><h2 title={detail?.original_name}>{detail?.original_name || 'Report'}</h2><span>{detail ? formattedDate(detail.created_at) : 'Loading…'}</span></div>
      {images && <div className="reports-actions">{images.original && <a className="tool-button" href={images.original} download={detail.original_name}>Download original</a>}<a className="tool-button" href={images.overlay} download="overlay.png">Download overlay</a></div>}
    </div>
    {detailError && <div className="reports-alert" role="alert">{detailError}</div>}
    {detailLoading && <p className="reports-muted reports-loading">Loading report and images…</p>}
    {detail && <div className="reports-detail-grid">
      <div className="reports-image-panel">
        <div className="reports-image-toolbar">
          <div className="segmented" aria-label="Saved image view">
            <button type="button" className={imageMode === 'overlay' ? 'active' : ''} onClick={() => { setImageMode('overlay'); setImageError(false) }}>Overlay</button>
            <button type="button" className={imageMode === 'original' ? 'active' : ''} onClick={() => { setImageMode('original'); setImageError(false) }} disabled={!images?.original}>Original</button>
          </div>
          <span>{detail.image_width} × {detail.image_height} px</span>
        </div>
        <div className="reports-image-viewer">
          {selectedImage && !imageError ? <img src={selectedImage} alt={imageMode === 'overlay' ? 'Saved characterization overlay' : 'Original characterization image'} onError={() => setImageError(true)} /> :
            <p>{imageError ? 'This image format cannot be previewed here. Download it to view it.' : detailLoading ? 'Loading image…' : 'Image unavailable.'}</p>}
        </div>
      </div>
      <aside className="reports-data">
        <h3>Characterization</h3>
        <dl className="reports-facts">
          <div><dt>Best group / element</dt><dd>G{detail.best_group} E{detail.best_element}</dd></div>
          <div><dt>Resolving power</dt><dd>{formattedNumber(detail.lp_per_mm)} lp/mm</dd></div>
          <div><dt>Resolution</dt><dd>{formattedNumber(detail.resolution_mm, 4)} mm</dd></div>
          <div><dt>Overlay style</dt><dd>{detail.overlay_style}</dd></div>
          <div><dt>Image flipped</dt><dd>{detail.flipped === null ? 'Auto' : detail.flipped ? 'Yes' : 'No'}</dd></div>
        </dl>
        {detail.result?.elements?.some((element) => element.fft_orientations?.horizontal_bars || element.fft_orientations?.vertical_bars) && (
          <>
            <h3>FFT frequency response</h3>
            <FftResponseChart elements={detail.result.elements} threshold={detail.result.fft?.mtf_threshold} detectDb={detail.result.fft?.detect_db} />
          </>
        )}
        <h3>Measured elements</h3>
        {detail.result?.elements?.length ? <div className="reports-table-wrap"><table className="reports-elements"><thead><tr><th>Element</th><th>lp/mm</th><th>Score</th></tr></thead><tbody>
          {detail.result.elements.map((element, index) => <tr key={`${element.group}-${element.element}-${index}`} className={element.selected ? 'best' : ''}><td>G{element.group} E{element.element}</td><td>{formattedNumber(element.lp_per_mm)}</td><td>{formattedNumber(element.contrast_score, 2)}</td></tr>)}
        </tbody></table></div> : <p className="reports-muted">No element details saved.</p>}
        <details className="reports-json"><summary>Raw result JSON</summary><pre>{JSON.stringify(detail.result, null, 2)}</pre></details>
      </aside>
    </div>}
  </>
}

function ReportsContent({ userId }) {
  const [reports, setReports] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const listRequestRef = useRef(null)

  useEffect(() => {
    const request = { active: true }
    listRequestRef.current = request
    async function loadFirstPage() {
      const { data, error } = await supabase
        .from('characterization_reports')
        .select('id,created_at,original_name,best_group,best_element,lp_per_mm')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(0, PAGE_SIZE - 1)
      if (!request.active) return
      if (error) setListError(error.message)
      else {
        setReports(data || [])
        setSelectedId(data?.[0]?.id || null)
        setHasMore((data || []).length === PAGE_SIZE)
      }
      setListLoading(false)
    }
    loadFirstPage()
    return () => {
      request.active = false
    }
  }, [userId, refreshKey])

  async function loadMore() {
    if (listLoading || !hasMore) return
    const request = listRequestRef.current
    setListLoading(true)
    setListError('')
    const { data, error } = await supabase
      .from('characterization_reports')
      .select('id,created_at,original_name,best_group,best_element,lp_per_mm')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(reports.length, reports.length + PAGE_SIZE - 1)
    if (!request?.active) return
    if (error) setListError(error.message)
    else {
      setReports((current) => [...current, ...(data || [])])
      setHasMore((data || []).length === PAGE_SIZE)
    }
    setListLoading(false)
  }

  function retry() {
    setReports([])
    setSelectedId(null)
    setHasMore(false)
    setListError('')
    setListLoading(true)
    setRefreshKey((value) => value + 1)
  }

  return <main className="reports-layout">
    <aside className="reports-sidebar" aria-label="Saved reports">
      <div className="reports-sidebar-heading"><h1>Saved reports</h1><span>{reports.length}{hasMore ? '+' : ''}</span></div>
      {listError && <div className="reports-alert" role="alert">Could not load reports: {listError}<button type="button" onClick={retry}>Retry</button></div>}
      {listLoading && reports.length === 0 && <p className="reports-muted">Loading reports…</p>}
      {!listLoading && !listError && reports.length === 0 && <p className="reports-muted">No saved reports yet. Analyze an image in the workspace and choose Save report.</p>}
      <div className="reports-list">
        {reports.map((report) => <button key={report.id} className={`reports-list-item ${report.id === selectedId ? 'selected' : ''}`} type="button" aria-pressed={report.id === selectedId} onClick={() => setSelectedId(report.id)}>
          <strong title={report.original_name}>{report.original_name}</strong>
          <span>{formattedDate(report.created_at)}</span>
          <small>G{report.best_group} E{report.best_element} · {formattedNumber(report.lp_per_mm)} lp/mm</small>
        </button>)}
      </div>
      {hasMore && <button className="reports-load-more" type="button" onClick={loadMore} disabled={listLoading}>{listLoading ? 'Loading…' : 'Load more'}</button>}
    </aside>

    <section className="reports-main" aria-label="Report details">
      {selectedId ? <ReportDetail key={selectedId} userId={userId} selectedId={selectedId} /> : <div className="reports-centered reports-empty">Select a report to view it.</div>}
    </section>
  </main>
}

export default function ReportsPage({ session, sessionLoading }) {
  const userId = session?.user?.id
  return <div className="reports-page">
    <header className="toolbar reports-toolbar">
      <div className="brand">OptiSuite Web</div>
      <span className="toolbar-divider" />
      <a className="tool-button" href="#/">← Workspace</a>
      <strong className="reports-toolbar-title">My reports</strong>
      <div className="toolbar-spacer" />
      <AccountControls session={session} sessionLoading={sessionLoading} />
    </header>
    {sessionLoading ? <div className="reports-centered">Loading account…</div> : userId ? (
      <ReportsContent key={userId} userId={userId} />
    ) : <div className="reports-centered"><h1>My reports</h1><p>Sign in to view your saved characterization reports.</p></div>}
  </div>
}
