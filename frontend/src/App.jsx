import {useEffect, useRef, useState } from 'react'
import YOLO, { annotate } from '@ultralytics/yolo'
import { getAnalysis, getOverlayObjectUrl, uploadAnalysis } from './api.js'
import './App.css'

const DEFAULT_MODEL = '4p_detect_ultra_pro_max.onnx'
// <select> value for a model loaded from the user's disk instead of public/models.
const LOCAL = 'local'
const LOAD_OPTIONS = {
  device: 'auto',
  // Without this it fetches ORT from cdn.pyke.io at runtime.
  ortBaseUrl: new URL('/ort/', window.location.origin),
}

function publicSource(file) {
  return { key: file, label: file, src: `/models/${file}` }
}

export default function App() {
  const modelRef = useRef(null)
  const imageRef = useRef(null)
  const canvasRef = useRef(null)
  const uploadRequestRef = useRef(0)
  const overlayObjectUrlRef = useRef(null)
  const [models, setModels] = useState([])
  const [localModel, setLocalModel] = useState(null)
  // The model being shown; loadedSource is the last one whose load settled.
  const [source, setSource] = useState(null)
  const [loadedSource, setLoadedSource] = useState(null)
  const [status, setStatus] = useState('loading models…')
  const [predicting, setPredicting] = useState(false)
  const [results, setResults] = useState(null)
  const [analysisJob, setAnalysisJob] = useState(null)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [analysisStatus, setAnalysisStatus] = useState('Select an image to run USAF analysis.')
  const [overlayUrl, setOverlayUrl] = useState(null)

  const loading = source !== loadedSource

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
          const url = await getOverlayObjectUrl(analysisJob.id, analysisJob.token)
          if (cancelled) URL.revokeObjectURL(url)
          else replaceOverlayUrl(url)
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

  async function runPredict(model, file) {
    setPredicting(true)
    try {
      const out = await model.predict(file, { conf: 0.3, iou: 0.3 })
      await annotate(canvasRef.current, file, out, { keypoints: true })
      setResults(out)
    } catch (err) {
      setStatus(`predict failed: ${err.message}`)
    } finally {
      setPredicting(false)
    }
  }

  // public/models/index.json is written by scripts/list-models.mjs before dev/build.
  useEffect(() => {
    fetch('/models/index.json')
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json()
      })
      .then((list) => {
        setModels(list)
        const initial = list.find((m) => m.file === DEFAULT_MODEL) ?? list[0]
        if (initial) setSource(publicSource(initial.file))
        else setStatus('no models in public/models')
      })
      .catch((err) => setStatus(`failed to list models: ${err.message}`))
  }, [])

  useEffect(() => {
    if (!source) return
    let cancelled = false
    let model = null

    YOLO.load(source.src, LOAD_OPTIONS)
      .then((m) => {
        if (cancelled) return m.free()
        model = m
        modelRef.current = m
        setLoadedSource(source)
        setStatus(`ready · ${source.label} · ${m.task} · ${m.device}`)
        // Re-run the current image so switching models compares them directly.
        if (imageRef.current) runPredict(m, imageRef.current)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadedSource(source)
        setStatus(`failed to load ${source.label}: ${err.message}`)
      })

    return () => {
      cancelled = true
      if (modelRef.current === model) modelRef.current = null
      model?.free()
    }
  }, [source])

  function onFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    // Remembered so it runs once a model finishes loading, and on every switch.
    imageRef.current = file
    if (modelRef.current) runPredict(modelRef.current, file)

    const requestId = ++uploadRequestRef.current
    setAnalysisJob(null)
    setAnalysisResult(null)
    replaceOverlayUrl(null)
    setAnalysisStatus('Uploading image…')
    uploadAnalysis(file)
      .then((job) => {
        if (requestId === uploadRequestRef.current) setAnalysisJob(job)
      })
      .catch((error) => {
        if (requestId === uploadRequestRef.current) {
          setAnalysisStatus(`Upload failed: ${error.message}`)
        }
      })
  }

  function onSelectModel(event) {
    const key = event.target.value
    setSource(
      key === LOCAL ? { key: LOCAL, label: localModel.name, src: localModel } : publicSource(key)
    )
  }

  function onModelFile(event) {
    const file = event.target.files?.[0]
    // Clear so picking the same file again still fires onChange.
    event.target.value = ''
    if (!file) return
    setLocalModel(file)
    setSource({ key: LOCAL, label: file.name, src: file })
  }

  // Freeing a model mid-predict breaks the in-flight call, so lock switching.
  const switchDisabled = loading || predicting

  return (
    <main>
      <div className="controls">
        <label>
          Model
          <select
            value={source?.key ?? ''}
            onChange={onSelectModel}
            disabled={switchDisabled || (models.length === 0 && !localModel)}
          >
            {models.map((m) => (
              <option key={m.file} value={m.file}>
                {m.file.replace(/\.onnx$/, '')}
                {m.task ? ` (${m.task})` : ''}
              </option>
            ))}
            {localModel && <option value={LOCAL}>{localModel.name} (local file)</option>}
          </select>
        </label>
        <label className="button" aria-disabled={switchDisabled}>
          Load .onnx…
          <input type="file" accept=".onnx" hidden onChange={onModelFile} disabled={switchDisabled} />
        </label>
      </div>
      <p>{loading ? `loading ${source.label}…` : status}</p>
      <input type="file" accept="image/*" onChange={onFile} disabled={predicting} />
      <canvas ref={canvasRef} style={{ maxWidth: '100%' }} />
      {results && (
        <pre>{JSON.stringify({ boxes: results.boxes, speed: results.speed }, null, 2)}</pre>
      )}
      <section style={{ width: '100%', maxWidth: 1100 }}>
        <h2>Server USAF analysis</h2>
        <p>{analysisStatus}</p>
        {analysisResult?.best && (
          <p>
            Group {analysisResult.best.group}, element {analysisResult.best.element} ·{' '}
            {Number(analysisResult.best.lp_per_mm).toFixed(2)} lp/mm
          </p>
        )}
        {overlayUrl && (
          <img
            src={overlayUrl}
            alt="USAF group and element scanline overlay"
            style={{ maxWidth: '100%', height: 'auto' }}
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
