// Fitting a 3x3 plane-to-plane transform and applying it, so target-space
// coordinates can be pushed into image pixels.
//
// Everything returns the same 3x3 row-major matrix, so callers do not care
// whether four, three or two correspondences were available. A mirrored target
// needs no flag the way transforms.py `usaf2screen_classic` does: the fit sees
// the mirrored corners and bakes the reflection into the matrix.

/** Solve `A x = b` in place by Gauss-Jordan with partial pivoting, or null if singular. */
function solve(A, b) {
  const n = b.length
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row
    }
    if (Math.abs(A[pivot][col]) < 1e-12) return null
    ;[A[col], A[pivot]] = [A[pivot], A[col]]
    ;[b[col], b[pivot]] = [b[pivot], b[col]]

    const diagonal = A[col][col]
    for (let k = col; k < n; k += 1) A[col][k] /= diagonal
    b[col] /= diagonal

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = A[row][col]
      if (factor === 0) continue
      for (let k = col; k < n; k += 1) A[row][k] -= factor * A[col][k]
      b[row] -= factor * b[col]
    }
  }
  return b
}

/** Four correspondences, so perspective is recoverable. */
function fitHomography(src, dst) {
  const A = []
  const b = []
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = src[i]
    const [u, v] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v])
    b.push(v)
  }
  const h = solve(A, b)
  if (!h) return null
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

/** Three correspondences: rotation, scale, shear and translation, but no perspective. */
function fitAffine(src, dst) {
  const A = []
  const b = []
  for (let i = 0; i < 3; i += 1) {
    const [x, y] = src[i]
    const [u, v] = dst[i]
    A.push([x, y, 1, 0, 0, 0])
    b.push(u)
    A.push([0, 0, 0, x, y, 1])
    b.push(v)
  }
  const a = solve(A, b)
  if (!a) return null
  return [a[0], a[1], a[2], a[3], a[4], a[5], 0, 0, 1]
}

/**
 * Two correspondences, assuming the outline really is a rectangle: the remaining
 * freedom is rotation, uniform scale and translation. This is the reconstruction
 * yolo_model.py `yolo_4pt_calculation` falls back to when keypoints drop out.
 *
 * Two points cannot say which way round the target is, so this assumes it reads
 * the right way round — target space is y-up and the image is y-down, so the fit
 * runs against reflected source points and folds the reflection back in. A
 * mirrored target needs three corners to come out right, the same way the Python
 * needs its `FLIPED_TARGET` flag.
 */
function fitSimilarity(src, dst) {
  const [[sx0, sy0], [sx1, sy1]] = src
  const [[dx0, dy0], [dx1, dy1]] = dst
  const su = sx1 - sx0
  const sv = -(sy1 - sy0)
  const denominator = su * su + sv * sv
  if (denominator < 1e-12) return null

  const du = dx1 - dx0
  const dv = dy1 - dy0
  // Complex division: the rotation-and-scale that takes (su, sv) to (du, dv).
  const a = (du * su + dv * sv) / denominator
  const b = (dv * su - du * sv) / denominator
  return [a, b, dx0 - a * sx0 - b * sy0, b, -a, dy0 - b * sx0 + a * sy0, 0, 0, 1]
}

/**
 * Best transform the available correspondences support. `src`/`dst` must be the
 * same length and already paired up; 4+ uses the first four, and fewer than two
 * is not enough to place anything.
 */
export function fit(src, dst) {
  if (src.length !== dst.length) return null
  if (src.length >= 4) return fitHomography(src, dst)
  if (src.length === 3) return fitAffine(src, dst)
  if (src.length === 2) return fitSimilarity(src, dst)
  return null
}

export function apply(matrix, [x, y]) {
  const w = matrix[6] * x + matrix[7] * y + matrix[8]
  if (Math.abs(w) < 1e-12) return null
  return [(matrix[0] * x + matrix[1] * y + matrix[2]) / w, (matrix[3] * x + matrix[4] * y + matrix[5]) / w]
}

/** A target-space box as its four image-space corners, clockwise from the top left. */
export function applyBox(matrix, { x1, y1, x2, y2 }) {
  const corners = [
    [x1, y2],
    [x2, y2],
    [x2, y1],
    [x1, y1],
  ].map((corner) => apply(matrix, corner))
  return corners.every(Boolean) ? corners : null
}

/** How many image pixels one target unit covers near `point`, as the mean of both axes. */
export function scaleAt(matrix, point) {
  const origin = apply(matrix, point)
  const alongX = apply(matrix, [point[0] + 0.5, point[1]])
  const alongY = apply(matrix, [point[0], point[1] + 0.5])
  if (!origin || !alongX || !alongY) return null
  return Math.hypot(alongX[0] - origin[0], alongX[1] - origin[1]) + Math.hypot(alongY[0] - origin[0], alongY[1] - origin[1])
}
