import { useEffect, useRef, useState } from 'react'
import { getAnalysis, getOverlayObjectUrl, uploadAnalysis } from './api.js'
import './App.css'

export default function App() {
  const uploadRequestRef = useRef(0)
  const overlayObjectUrlRef = useRef(null)
  const [analysisJob, setAnalysisJob] = useState(null)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [analysisStatus, setAnalysisStatus] = useState('Select an image to run USAF analysis.')
  const [overlayUrl, setOverlayUrl] = useState(null)
  const [overlayStyle, setOverlayStyle] = useState('classic')

  function replaceOverlayUrl(url) {
    if (overlayObjectUrlRef.current) URL.revokeObjectURL(overlayObjectUrlRef.current)
    overlayObjectUrlRef.current = url
    setOverlayUrl(url)
  }

  useEffect(() => () => {
    if (overlayObjectUrlRef.current) URL.revokeObjectURL(overlayObjectUrlRef.current)
  }, [])

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
          setAnalysisStatus('Analysis complete')
        } else if (response.status === 'failed') {
          setAnalysisStatus(response.error || 'Analysis failed')
        } else {
          setAnalysisStatus(response.status === 'running' ? 'Analyzing image…' : 'Waiting in queue…')
          timeoutId = window.setTimeout(poll, 2000)
        }
      } catch (error) {
        if (!cancelled) setAnalysisStatus(`Analysis request failed: ${error.message}`)
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
        else {
          replaceOverlayUrl(url)
          setAnalysisStatus('Analysis complete')
        }
      })
      .catch((error) => {
        if (!cancelled) setAnalysisStatus(`Overlay request failed: ${error.message}`)
      })
    return () => { cancelled = true }
  }, [analysisJob, analysisResult, overlayStyle])

  function onFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const requestId = ++uploadRequestRef.current
    setAnalysisJob(null)
    setAnalysisResult(null)
    replaceOverlayUrl(null)
    setAnalysisStatus('Uploading image…')
    uploadAnalysis(file, overlayStyle)
      .then((job) => {
        if (requestId === uploadRequestRef.current) setAnalysisJob(job)
      })
      .catch((error) => {
        if (requestId === uploadRequestRef.current) {
          setAnalysisStatus(`Upload failed: ${error.message}`)
        }
      })
  }

  function downloadResults() {
    if (!analysisResult || !analysisJob) return
    const blob = new Blob([JSON.stringify(analysisResult, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `usaf-analysis-${analysisJob.id}-results.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <main>
      <label className="overlay-style-select">
        Overlay style
        <select value={overlayStyle} onChange={(event) => setOverlayStyle(event.target.value)}>
          <option value="classic">Yellow scanlines (2 px), yellow labels (2 px)</option>
          <option value="cyan_white">Cyan scanlines (3 px), white labels (2 px)</option>
          <option value="magenta_yellow">Magenta scanlines (4 px), yellow labels (3 px)</option>
          <option value="green_white">Green scanlines (2 px), white labels (2 px)</option>
        </select>
      </label>
      <input type="file" accept="image/*" onChange={onFile} />
      <section style={{ width: '100%', maxWidth: 1100 }}>
        <h2>Server USAF analysis</h2>
        <p>{analysisStatus}</p>
        {analysisResult?.best && (
          <p>
            Group {analysisResult.best.group}, element {analysisResult.best.element} ·{' '}
            {Number(analysisResult.best.lp_per_mm).toFixed(2)} lp/mm
          </p>
        )}
        {analysisResult && (
          <div className="download-actions">
            {overlayUrl && (
              <a href={overlayUrl} download={`usaf-analysis-${analysisJob.id}-overlay.png`}>
                Download overlay (PNG)
              </a>
            )}
            <button type="button" onClick={downloadResults}>
              Download results (JSON)
            </button>
          </div>
        )}
        {overlayUrl && (
          <img
            className="analysis-image"
            src={overlayUrl}
            alt="USAF group and element scanline overlay"
          />
        )}
        {analysisResult?.elements?.length > 0 && (
          <pre>{JSON.stringify(analysisResult.elements.map(({ group, element, lp_per_mm, contrast_score, selected }) => ({
            group, element, lp_per_mm, contrast_score, selected,
          })), null, 2)}</pre>
        )}
      </section>
    </main>
  )
}
