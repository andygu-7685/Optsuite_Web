// @ultralytics/yolo initializes ONNX Runtime once per page and shares it across
// every model it loads, so its operations are not safe to overlap:
//
//   - a free() that lands while another load is still in flight leaves the
//     model that load returns wedged, and its predict never settles;
//   - reading model.task / .names / .device during a predict throws
//     "recursive use of an object ... unsafe aliasing" out of wasm, because a
//     predict borrows the model for its whole duration;
//   - the backend ("webgpu" or "cpu") is fixed by the first load for the
//     lifetime of the page, so switching it needs a reload.
//
// Everything that reaches the runtime goes through this one chain, so loads,
// frees and predicts run one at a time, in the order they were requested.
let chain = Promise.resolve()

export function runExclusive(work) {
  const result = chain.then(work)
  // Keep the chain usable after a step rejects.
  chain = result.then(
    () => {},
    () => {},
  )
  return result
}
