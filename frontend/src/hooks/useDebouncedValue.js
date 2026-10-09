import { useEffect, useState } from 'react'

/** Trails `value` by `delay` ms, so a slider drag triggers one run, not thirty. */
export function useDebouncedValue(value, delay) {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return settled
}
