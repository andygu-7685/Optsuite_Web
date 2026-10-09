import { useEffect, useRef, useState } from 'react'
import { runExclusive } from '../lib/runtime'

// Returned instead of a Results when a queued run was superseded before it got
// its turn, so the caller can tell "skipped" from "finished".
const SKIPPED = Symbol('skipped')

/**
 * Re-runs `model.predict` whenever the model, the image or `options` changes,
 * so moving a threshold re-scores the current image on its own.
 *
 * `options` has to be referentially stable (memoize it) or this loops. Runs go
 * through the shared runtime chain rather than overlapping, and a run that
 * another supersedes while queued is dropped instead of executed.
 */
export function usePrediction(model, image, options) {
  const [settled, setSettled] = useState(null)
  const runRef = useRef(0)

  useEffect(() => {
    // Bumping the counter also drops anything still queued against a model
    // that is about to be freed.
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
    // Held across threshold changes so the overlay doesn't blink while the new
    // run is in flight, dropped on a new image or model so stale boxes are
    // never drawn over the wrong picture.
    results: sameInput ? settled.results : null,
    error: current ? settled.error : null,
    predicting: Boolean(model && image) && !current,
  }
}
