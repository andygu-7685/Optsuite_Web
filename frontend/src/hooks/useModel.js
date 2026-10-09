import { useEffect, useState } from 'react'
import YOLO from '@ultralytics/yolo'
import { runExclusive } from '../lib/runtime'

// Without ortBaseUrl the library fetches ONNX Runtime from cdn.pyke.io at
// runtime. scripts/copy-ort.mjs puts the same-origin copy in public/ort.
const ORT_BASE_URL = new URL('/ort/', window.location.origin)

/**
 * Loads `source.src` and frees it whenever the source or device changes. Both
 * run through the shared runtime chain, so a free never overlaps a load — see
 * lib/runtime.js for why that matters.
 *
 * `task`, `names` and the device that actually engaged are read once here and
 * returned as plain values. They look like ordinary properties, but each getter
 * borrows the model inside wasm and throws if a predict is in flight, so
 * nothing outside this hook may touch the model object.
 */
export function useModel(source, device) {
  // What the last settled load produced. `loading` is derived from it rather
  // than tracked, which also means a model is never handed out after the
  // cleanup below has freed it.
  const [settled, setSettled] = useState(null)

  useEffect(() => {
    if (!source) return

    let cancelled = false
    let loaded = null

    runExclusive(async () => {
      const model = await YOLO.load(source.src, { device, ortBaseUrl: ORT_BASE_URL })
      // Freeing inside this step covers a teardown that happened before the
      // load settled, when the cleanup below had nothing to free yet.
      if (cancelled) {
        model.free()
        return
      }
      loaded = model
      setSettled({
        source,
        device,
        model,
        task: model.task,
        names: model.names,
        ranOn: model.device,
        error: null,
      })
    }).catch((error) => {
      if (!cancelled) setSettled({ source, device, model: null, error })
    })

    return () => {
      cancelled = true
      if (loaded) runExclusive(() => loaded.free())
    }
  }, [source, device])

  const current = settled?.source === source && settled?.device === device ? settled : null
  return {
    model: current?.model ?? null,
    task: current?.task ?? null,
    names: current?.names ?? null,
    // Which backend actually engaged: "auto" only resolves at load time, and
    // WebGPU falls back to CPU silently.
    ranOn: current?.ranOn ?? null,
    error: current?.error ?? null,
    loading: Boolean(source) && !current,
  }
}
