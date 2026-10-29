import { useEffect, useRef, useState } from 'react'
import { getAnalysis, getOverlayObjectUrl, uploadAnalysis } from './api.js'
import AccountControls from './AccountControls.jsx'
import { saveCharacterizationReport } from './saveReport.js'
import { supabase } from './supabaseClient.js'
import './App.css'

const overlayStyles = [
  { id: 'classic', name: 'Yellow', detail: '2 px lines · 2 px labels', line: '#ffe600', label: '#ffe600' },
  { id: 'cyan_white', name: 'Cyan + white', detail: '3 px lines · 2 px labels', line: '#2ee6ff', label: '#ffffff' },
  { id: 'magenta_yellow', name: 'Magenta + yellow', detail: '4 px lines · 3 px labels', line: '#ff3fd2', label: '#ffe600' },
  { id: 'green_white', name: 'Green + white', detail: '2 px lines · 2 px labels', line: '#4dff6a', label: '#ffffff' },
]

function formatSize(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`
}

function formatResolution(value) {
  const mm = Number(value)
  return `${mm.toFixed(4)} mm (${(mm * 1000).toFixed(1)} µm)`
}

export default function App() {
  const fileInputRef = useRef(null)
  const uploadRequestRef = useRef(0)
  const previewObjectUrlRef = useRef(null)
  const overlayObjectUrlRef = useRef(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [imageDimensions, setImageDimensions] = useState('')
  const [overlayUrl, setOverlayUrl] = useState(null)
  const [overlayStyle, setOverlayStyle] = useState('classic')
  const [flipSetting, setFlipSetting] = useState('auto')
  const [analysisJob, setAnalysisJob] = useState(null)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [view, setView] = useState('original')
  const [zoom, setZoom] = useState('fit')
  const [dragging, setDragging] = useState(false)
  const [overlayLoading, setOverlayLoading] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [session, setSession] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(Boolean(supabase))
  const [savePending, setSavePending] = useState(false)
  const [savedReportKey, setSavedReportKey] = useState(null)
  const [saveNotice, setSaveNotice] = useState(null)

  const busy = ['uploading', 'queued', 'running'].includes(phase)
  const done = phase === 'done'
  const currentReportKey = session?.user && analysisJob ? `${session.user.id}:${analysisJob.id}` : null
  const selectedStyle = overlayStyles.find((style) => style.id === overlayStyle)
  const statusText = errorMessage || {
    idle: 'Ready — open an image to begin',
    ready: 'Image loaded — press Analyze',
    uploading: 'Uploading image…',
    queued: 'Waiting in queue…',
    running: 'Analyzing image…',
    done: 'Analysis complete',
    error: 'Analysis failed',
  }[phase]

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setSessionLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  function replaceOverlayUrl(url) {
    if (overlayObjectUrlRef.current) URL.revokeObjectURL(overlayObjectUrlRef.current)
    overlayObjectUrlRef.current = url
    setOverlayUrl(url)
  }

  function replacePreviewUrl(url) {
    if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current)
    previewObjectUrlRef.current = url
    setPreviewUrl(url)
  }

  useEffect(() => () => {
    if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current)
    if (overlayObjectUrlRef.current) URL.revokeObjectURL(overlayObjectUrlRef.current)
  }, [])

  useEffect(() => {
    if (!previewUrl) return
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled) setImageDimensions(`${image.naturalWidth} × ${image.naturalHeight}`)
    }
    image.src = previewUrl
    return () => { cancelled = true }
  }, [previewUrl])

  useEffect(() => {
    if (!analysisJob) return
    let cancelled = false
    let timeoutId
    async function poll() {
      try {
        const response = await getAnalysis(analysisJob.id, analysisJob.token)
        if (cancelled) return
        if (response.status === 'completed') {
          setAnalysisResult(response.result)
          setPhase('done')
          setView('overlay')
          setOverlayLoading(true)
        } else if (response.status === 'failed') {
          setPhase('error')
          setErrorMessage(response.error || 'Analysis failed')
        } else {
          setPhase(response.status === 'running' ? 'running' : 'queued')
          timeoutId = window.setTimeout(poll, 2000)
        }
      } catch (error) {
        if (!cancelled) {
          setPhase('error')
          setErrorMessage(`Analysis request failed: ${error.message}`)
        }
      }
    }
    poll()
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [analysisJob])

  useEffect(() => {
    if (!analysisJob || !analysisResult) return
    let cancelled = false
    getOverlayObjectUrl(analysisJob.id, analysisJob.token, overlayStyle)
      .then((url) => {
        if (cancelled) URL.revokeObjectURL(url)
        else replaceOverlayUrl(url)
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(`Overlay request failed: ${error.message}`)
      })
      .finally(() => {
        if (!cancelled) setOverlayLoading(false)
      })
    return () => { cancelled = true }
  }, [analysisJob, analysisResult, overlayStyle])

  function loadFile(file) {
    if (!file || savePending) return
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Choose an image file to continue.')
      return
    }
    ++uploadRequestRef.current
    setSelectedFile(file)
    replacePreviewUrl(URL.createObjectURL(file))
    replaceOverlayUrl(null)
    setImageDimensions('')
    setAnalysisJob(null)
    setAnalysisResult(null)
    setOverlayLoading(false)
    setPhase('ready')
    setErrorMessage('')
    setView('original')
    setZoom('fit')
    setJsonOpen(false)
    setSaveNotice(null)
    setSavedReportKey(null)
  }

  function submitImage() {
    if (!selectedFile || busy || savePending) return
    const requestId = ++uploadRequestRef.current
    setPhase('uploading')
    setErrorMessage('')
    setAnalysisJob(null)
    setAnalysisResult(null)
    setOverlayLoading(false)
    replaceOverlayUrl(null)
    setView('original')
    setSaveNotice(null)
    setSavedReportKey(null)
    uploadAnalysis(selectedFile, overlayStyle, flipSetting === 'auto' ? null : flipSetting === 'yes')
      .then((job) => {
        if (requestId === uploadRequestRef.current) {
          setAnalysisJob(job)
          setPhase('queued')
        }
      })
      .catch((error) => {
        if (requestId === uploadRequestRef.current) {
          setPhase('error')
          setErrorMessage(`Upload failed: ${error.message}`)
        }
      })
  }

  function changeFlipSetting(value) {
    if (value === flipSetting || savePending) return
    ++uploadRequestRef.current
    setFlipSetting(value)
    setAnalysisJob(null)
    setAnalysisResult(null)
    replaceOverlayUrl(null)
    setOverlayLoading(false)
    setView('original')
    setPhase(selectedFile ? 'ready' : 'idle')
    setErrorMessage('')
    setSaveNotice(null)
    setSavedReportKey(null)
  }

  async function saveReport() {
    if (!supabase || !currentReportKey || !selectedFile || !overlayUrl || !analysisResult || savePending || savedReportKey === currentReportKey) return
    setSavePending(true)
    setSaveNotice(null)
    try {
      await saveCharacterizationReport({
        client: supabase,
        userId: session.user.id,
        file: selectedFile,
        overlayUrl,
        result: analysisResult,
        overlayStyle,
        flipped: flipSetting === 'auto' ? null : flipSetting === 'yes',
      })
      setSavedReportKey(currentReportKey)
      setSaveNotice({ type: 'success', text: 'Report saved to your account.' })
    } catch (error) {
      setSaveNotice({ type: 'error', text: `Could not save report: ${error.message || 'Please try again.'}` })
    } finally {
      setSavePending(false)
    }
  }

  useEffect(() => {
    function onKeyDown(event) {
      if (event.target.closest?.('[role="dialog"]')) return
      if (savePending) return
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        fileInputRef.current?.click()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        submitImage()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function downloadResults() {
    if (!analysisResult || !analysisJob) return
    const blob = new Blob([JSON.stringify(analysisResult, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `usaf-analysis-${analysisJob.id}-results.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function copyResults() {
    if (!analysisResult) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(analysisResult, null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  const currentStep = !selectedFile ? 0 : done ? 3 : busy ? 2 : 1
  const steps = ['Open an image', 'Set image options', 'Analyze and export']
  const best = analysisResult?.best
  const resultRows = best ? [
    ['Group', best.group],
    ['Element', best.element],
    ['lp/mm', Number(best.lp_per_mm).toFixed(3)],
    ['Resolution', formatResolution(best.resolution_mm)],
    ['Image', analysisResult.image ? `${analysisResult.image.width} × ${analysisResult.image.height}` : imageDimensions],
  ] : []
  const shownImage = view === 'overlay' && overlayUrl ? overlayUrl : previewUrl

  return (
    <main className="workspace">
      <header className="toolbar">
        <div className="brand">OptiSuite Web</div>
        <span className="toolbar-divider" />
        <button className="tool-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={busy || savePending} title="Ctrl+O">Open image…</button>
        <button className="tool-button primary" type="button" onClick={submitImage} disabled={!selectedFile || busy || savePending} title="Ctrl+Enter"><span className="play-icon" />{busy ? 'Analyzing…' : done ? 'Re-analyze' : 'Analyze'}</button>
        <span className="toolbar-divider" />
        <a className={`tool-button ${!overlayUrl || overlayLoading ? 'disabled' : ''}`} href={overlayUrl || undefined} download={analysisJob ? `usaf-analysis-${analysisJob.id}-overlay.png` : undefined} aria-disabled={!overlayUrl || overlayLoading} onClick={(event) => { if (!overlayUrl || overlayLoading) event.preventDefault() }}>Export overlay</a>
        <button className="tool-button" type="button" onClick={downloadResults} disabled={!analysisResult}>Export JSON</button>
        {session?.user && <button className="tool-button account-sign-up" type="button" onClick={saveReport} disabled={!done || !overlayUrl || overlayLoading || savePending || savedReportKey === currentReportKey}>{savePending ? 'Saving…' : savedReportKey === currentReportKey ? 'Saved' : 'Save report'}</button>}
        <div className="toolbar-spacer" />
        <div className="segmented" aria-label="Image view">
          <button type="button" className={view === 'overlay' && done ? 'active' : ''} onClick={() => setView('overlay')} disabled={!overlayUrl}>Overlay</button>
          <button type="button" className={view === 'original' ? 'active' : ''} onClick={() => setView('original')} disabled={!selectedFile}>Original</button>
        </div>
        <div className="segmented" aria-label="Image zoom">
          <button type="button" className={zoom === 'fit' ? 'active' : ''} onClick={() => setZoom('fit')} disabled={!selectedFile}>Fit</button>
          <button type="button" className={zoom === 'actual' ? 'active' : ''} onClick={() => setZoom('actual')} disabled={!selectedFile}>1:1</button>
        </div>
        <AccountControls session={session} sessionLoading={sessionLoading} signOutDisabled={savePending} />
      </header>

      <div className="workspace-body">
        <aside className="side-panel left-panel">
          <section className="panel-section workflow-section">
            <h2>Workflow</h2>
            <ol className="workflow-list">
              {steps.map((step, index) => (
                <li className={index === currentStep ? 'current' : index < currentStep ? 'complete' : ''} key={step}>
                  <span className="step-mark">{index < currentStep ? '✓' : index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="panel-section input-section">
            <h2>Input</h2>
            {selectedFile ? (
              <dl className="input-details">
                <dt>Name</dt><dd title={selectedFile.name}>{selectedFile.name}</dd>
                <dt>Size</dt><dd>{formatSize(selectedFile.size)}</dd>
                <dt>Type</dt><dd>{(selectedFile.type.split('/')[1] || 'Image').toUpperCase()}</dd>
                <dt>Pixels</dt><dd>{imageDimensions || '—'}</dd>
              </dl>
            ) : <p className="muted">No image loaded</p>}
          </section>
          <section className="panel-section flip-section">
            <h2>Image flipped?</h2>
            <div className="flip-options" role="radiogroup" aria-label="Image flipped">
              {[['auto', 'Auto'], ['yes', 'Yes'], ['no', 'No']].map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={flipSetting === value} className={flipSetting === value ? 'selected' : ''} onClick={() => changeFlipSetting(value)} disabled={busy || savePending}>
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section className="panel-section style-section">
            <h2>Overlay style</h2>
            <div className="style-options" role="radiogroup" aria-label="Overlay style">
              {overlayStyles.map((style) => (
                <button key={style.id} type="button" role="radio" aria-checked={style.id === overlayStyle} className={`style-option ${style.id === overlayStyle ? 'selected' : ''}`} onClick={() => { setOverlayStyle(style.id); if (analysisResult) { replaceOverlayUrl(null); setOverlayLoading(true) } }} disabled={savePending}>
                  <span className="radio-ring"><span /></span>
                  <span className="style-label"><span>{style.name}</span><small>{style.detail}</small></span>
                  <span className="style-swatch"><span className="swatch-label" style={{ color: style.label }}>G3E6</span><span className="swatch-line" style={{ background: style.line }} /></span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className={`viewer ${dragging ? 'dragging' : ''}`} aria-label="Image viewer" onDragOver={(event) => { event.preventDefault(); if (!savePending) setDragging(true) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) }} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!busy && !savePending) loadFile(event.dataTransfer.files[0]) }}>
          <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" onChange={(event) => { loadFile(event.target.files?.[0]); event.target.value = '' }} />
          {!selectedFile ? (
            <button className="drop-zone" type="button" onClick={() => fileInputRef.current?.click()}>
              <strong>{dragging ? 'Release to open' : 'Drop an image here or click to browse'}</strong>
              <span>PNG, TIFF or JPG with a USAF 1951 target in frame</span>
              <span className="shortcut">or press <kbd>Ctrl</kbd> <kbd>O</kbd></span>
            </button>
          ) : <img className={`viewer-image ${zoom === 'fit' ? 'fit' : 'actual'}`} src={shownImage} alt={view === 'overlay' && overlayUrl ? 'USAF group and element overlay' : 'Selected microscope image'} />}
          {busy && <div className="viewer-progress" />}
          {(busy || overlayLoading) && <span className="viewer-status">{overlayLoading ? 'Rendering overlay…' : statusText}</span>}
        </section>

        <aside className="side-panel right-panel">
          <section className="panel-section results-section">
            <h2>Results</h2>
            {!best ? <p className="muted">{busy ? 'Analyzing…' : selectedFile ? 'Press Analyze to measure this image.' : 'No results yet.'}</p> : (
              <div className="results-content">
                <div className="power-card"><span>Resolving power</span><div><strong>{Number(best.lp_per_mm).toFixed(2)}</strong><span>lp/mm</span></div></div>
                <dl className="result-table">{resultRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={String(value)}>{value}</dd></div>)}</dl>
              </div>
            )}
          </section>
          {analysisResult && <section className="json-section"><div className="json-heading"><button type="button" onClick={() => setJsonOpen(!jsonOpen)} aria-expanded={jsonOpen}><span className={jsonOpen ? 'chevron open' : 'chevron'}>▸</span> Raw JSON</button><button type="button" className="copy-button" onClick={copyResults}>{copied ? 'Copied' : 'Copy'}</button></div>{jsonOpen && <pre>{JSON.stringify(analysisResult, null, 2)}</pre>}</section>}
        </aside>
      </div>

      <footer className="status-bar"><span className={`status-dot ${busy ? 'busy' : done ? 'done' : selectedFile ? 'ready' : ''}`} /><span className="status-message" title={statusText}>{statusText}</span><span className="status-spacer" /><span>Overlay: {selectedStyle.name}</span>{imageDimensions && <span>{imageDimensions} px</span>}</footer>
      {saveNotice && <div className={`save-notice ${saveNotice.type}`} role={saveNotice.type === 'error' ? 'alert' : 'status'}>{saveNotice.text}<button type="button" aria-label="Dismiss save message" onClick={() => setSaveNotice(null)}>×</button></div>}
    </main>
  )
}
