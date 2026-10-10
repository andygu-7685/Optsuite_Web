import { useEffect, useState } from 'react'
import YOLO from '@ultralytics/yolo'
import { runExclusive } from '../lib/runtime'

// Same-origin ORT copied by scripts/copy-ort.mjs (default is a CDN).
const ORT_BASE_URL = new URL('/ort/', window.location.origin)

/**
 * Loads/frees the model via the shared runtime chain.
 * Model getters throw during predict, so `task`/`names`/`ranOn` are read once here.
 */
export function useModel(source, device) {
  const [settled, setSettled] = useState(null)

  useEffect(() => {
    if (!source) return

    let cancelled = false
    let loaded = null

    runExclusive(async () => {
      const model = await YOLO.load(source.src, { device, ortBaseUrl: ORT_BASE_URL })
      // Unmounted before load finished.
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
    // Actual backend; WebGPU may silently fall back to CPU.
    ranOn: current?.ranOn ?? null,
    error: current?.error ?? null,
    loading: Boolean(source) && !current,
  }
}
