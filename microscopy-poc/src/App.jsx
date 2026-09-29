import {useEffect, useRef, useState } from 'react'
import YOLO, { annotate } from '@ultralytics/yolo'
import './App.css'

export default function App() {
  const modelRef = useRef(null)
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [results, setResults] = useState(null)

  useEffect(() => {
    let cancelled = false
    YOLO.load('/models/4p_detect_ultra_pro_max.onnx', {
      device: 'auto',
      // Without this it fetches ORT from cdn.pyke.io at runtime.
      ortBaseUrl: new URL('/ort/', window.location.origin),
    })
      .then((m) => {
        if (cancelled) return m.free()
        modelRef.current = m
        setStatus(`ready · ${m.task} · ${m.device}`)
      })
      .catch((err) => setStatus(`failed: ${err.message}`))

    return () => {
      cancelled = true
      modelRef.current?.free()
    }
  }, [])

  async function onFile(event) {
    const file = event.target.files?.[0]
    if (!file || !modelRef.current) return

    const out = await modelRef.current.predict(file, { conf: 0.3, iou: 0.3 })
    await annotate(canvasRef.current, file, out, { keypoints: true })
    setResults(out)
  }

  return (
    <main>
      <p>{status}</p>
      <input type="file" accept="image/*" onChange={onFile} />
      <canvas ref={canvasRef} style={{ maxWidth: '100%' }} />
      {results && (
        <pre>{JSON.stringify({ boxes: results.boxes, speed: results.speed }, null, 2)}</pre>
      )}
    </main>
  )
}