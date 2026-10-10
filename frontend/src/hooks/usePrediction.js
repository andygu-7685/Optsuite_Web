import { useEffect, useRef, useState } from 'react'
import { runExclusive } from '../lib/runtime'

// Marks a queued run that was superseded.
const SKIPPED = Symbol('skipped')

/** Re-runs predict on model/image/options change. `options` must be memoized. */
export function usePrediction(model, image, options) {
  const [settled, setSettled] = useState(null)
  const runRef = useRef(0)

  useEffect(() => {
    // Also drops runs queued against a model about to be freed.
    const run = ++runRef.current
    if (!model || !image) return

    runExclusive(() => (run === runRef.current ? model.predict(image, options) : SKIPPED))
      .then((results) => {
        if (results !== SKIPPED && run === runRef.current) {
          setSettled({ model, image, options, results, error: null })
        }
      })
      .catch((error) => {
        if (run === runRef.current) setSettled({ model, image, options, results: null, error })
      })
  }, [model, image, options])

  const sameInput = settled?.model === model && settled?.image === image
  const current = sameInput && settled.options === options
  return {
    // Kept across option changes to avoid flicker; cleared on new image/model.
    results: sameInput ? settled.results : null,
    error: current ? settled.error : null,
    predicting: Boolean(model && image) && !current,
  }
}
