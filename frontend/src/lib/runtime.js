// ONNX Runtime is shared per page and unsafe to overlap (free during load wedges,
// getters during predict throw), so all loads/frees/predicts run serially here.
let chain = Promise.resolve()

export function runExclusive(work) {
  const result = chain.then(work)
  // Survive rejections.
  chain = result.then(
    () => {},
    () => {},
  )
  return result
}
