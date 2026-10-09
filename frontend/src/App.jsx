import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { annotate } from '@ultralytics/yolo'
import ModelPicker from './components/ModelPicker'
import OptionsPanel from './components/OptionsPanel'
import { useDebouncedValue } from './hooks/useDebouncedValue'
import { useModel } from './hooks/useModel'
import { usePrediction } from './hooks/usePrediction'
import {
  DEFAULTS,
  LOCAL_MODEL,
  annotateOptions,
  predictOptions,
  readSettings,
  writeSettings,
} from './lib/options'
import './App.css'

const DEFAULT_MODEL = '4p_detect_ultra_pro_max.onnx'
// Sliders fire on every pixel of a drag; wait for the drag to settle before
// re-running inference.
const SLIDER_DEBOUNCE_MS = 150

export default function App() {
  const canvasRef = useRef(null)
  // Redraws are chained so overlapping ones land in the order requested.
  const drawRef = useRef(Promise.resolve())

  const [settings, setSettings] = useState(readSettings)
  const [models, setModels] = useState([])
  const [localModel, setLocalModel] = useState(null)
  const [image, setImage] = useState(null)
  const [listError, setListError] = useState(null)
  const [imageError, setImageError] = useState(null)

  // The backend ONNX Runtime came up with on this page load. It can't be
  // swapped in place, so changing it has to go through a reload.
  const bootDevice = useRef(settings.device)

  const update = useCallback((patch) => setSettings((previous) => ({ ...previous, ...patch })), [])

  useEffect(() => {
    writeSettings(settings)
  }, [settings])

  useEffect(() => {
    if (settings.device === bootDevice.current) return
    // Already persisted above, and the query string carries it across the
    // reload, so the new backend comes up with the same settings.
    window.location.reload()
  }, [settings.device])

  // public/models/index.json is written by scripts/list-models.mjs before dev/build.
  useEffect(() => {
    fetch('/models/index.json')
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        return response.json()
      })
      .then((list) => {
        setModels(list)
        if (!list.length) {
          setListError(new Error('no models in public/models'))
          return
        }
        // Keep a model restored from the URL or localStorage if it still exists.
        setSettings((previous) => {
          if (list.some((model) => model.file === previous.model)) return previous
          const initial = list.find((model) => model.file === DEFAULT_MODEL) ?? list[0]
          return { ...previous, model: initial.file }
        })
      })
      .catch((error) => setListError(new Error(`failed to list models: ${error.message}`)))
  }, [])

  const source = useMemo(() => {
    if (settings.model === LOCAL_MODEL) {
      return localModel ? { key: LOCAL_MODEL, label: localModel.name, src: localModel } : null
    }
    if (!settings.model) return null
    return { key: settings.model, label: settings.model, src: `/models/${settings.model}` }
  }, [settings.model, localModel])

  const { model, task, names, ranOn, loading, error: loadError } = useModel(source, settings.device)

  // Debounced so dragging a threshold queues one run; `classes` and the drawing
  // options are discrete clicks and apply immediately.
  const conf = useDebouncedValue(settings.conf, SLIDER_DEBOUNCE_MS)
  const iou = useDebouncedValue(settings.iou, SLIDER_DEBOUNCE_MS)
  const classesKey = settings.classes?.join(',') ?? ''
  const predictOpts = useMemo(
    () =>
      predictOptions({
        conf,
        iou,
        classes: classesKey ? classesKey.split(',').map(Number) : null,
      }),
    [conf, iou, classesKey],
  )

  const { results, predicting, error: predictError } = usePrediction(model, image, predictOpts)

  const { labels, keypoints, keypointThreshold, lineWidth } = settings
  const annotateOpts = useMemo(
    () => annotateOptions({ labels, keypoints, keypointThreshold, lineWidth }),
    [labels, keypoints, keypointThreshold, lineWidth],
  )

  useEffect(() => {
    window.__dbg = { model, image, predictOpts, loading, predicting }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image || !results) return
    drawRef.current = drawRef.current
      .then(() => annotate(canvas, image, results, annotateOpts))
      .catch((error) => setImageError(new Error(`draw failed: ${error.message}`)))
  }, [image, results, annotateOpts])

  async function onImageFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setImageError(null)
    try {
      // Decoded once up front, so re-running on a threshold change doesn't
      // re-decode a multi-megabyte capture every time.
      const bitmap = await createImageBitmap(file)
      setImage((previous) => {
        previous?.close()
        return bitmap
      })
    } catch (error) {
      setImageError(new Error(`could not decode ${file.name}: ${error.message}`))
    }
  }

  function onModelFile(event) {
    const file = event.target.files?.[0]
    // Cleared so picking the same file again still fires onChange.
    event.target.value = ''
    if (!file) return
    setLocalModel(file)
    update({ model: LOCAL_MODEL })
  }

  function onReset() {
    // The chosen model is a separate concern from how it is run.
    update({ ...DEFAULTS, model: settings.model })
  }

  // Freeing a model mid-predict breaks the in-flight call, so lock the pickers.
  const busy = loading || predicting
  const error = listError ?? loadError ?? predictError ?? imageError

  let status
  if (loading) status = `loading ${source.label}…`
  else if (error) status = error.message
  else if (model) status = `ready · ${source.label} · ${task} · ${ranOn}`
  else status = 'loading models…'

  return (
    <main>
      <ModelPicker
        models={models}
        value={settings.model}
        localModel={localModel}
        disabled={busy}
        onSelect={(key) => update({ model: key })}
        onLocalFile={onModelFile}
      />

      <p className={error ? 'status status-error' : 'status'}>{status}</p>

      <OptionsPanel
        settings={settings}
        names={names}
        task={task}
        busy={busy}
        onChange={update}
        onReset={onReset}
      />

      <input type="file" accept="image/*" disabled={busy} onChange={onImageFile} />

      {results && (
        <p className="status">
          {predicting
            ? 'running…'
            : `${results.boxes.length} detection${results.boxes.length === 1 ? '' : 's'}`}
          {` · ${results.speed.inference.toFixed(1)} ms inference`}
          {results.boxes.length === 0 &&
            !predicting &&
            ` · nothing above conf ${settings.conf.toFixed(2)}`}
        </p>
      )}

      <canvas ref={canvasRef} style={{ maxWidth: '100%' }} />

      {results && (
        <pre>{JSON.stringify({ boxes: results.boxes, speed: results.speed }, null, 2)}</pre>
      )}
    </main>
  )
}
