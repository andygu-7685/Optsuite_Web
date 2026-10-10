// App settings, persisted to localStorage and mirrored to the query string.

const STORAGE_KEY = 'optsuite:settings'

// Local-file model key; never persisted.
export const LOCAL_MODEL = 'local'

export const DEVICES = ['auto', 'webgpu', 'cpu']

export const DEFAULTS = {
  model: null,
  device: 'auto',
  conf: 0.3,
  iou: 0.3,
  // null = all classes
  classes: null,
  labels: true,
  keypoints: true,
  // Identified USAF elements over the frame.
  elements: true,
  keypointThreshold: 0.25,
  // 0 = auto
  lineWidth: 0,
}

// Coercers return undefined to fall back to the default.
const number = (min, max) => (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined
}

const boolean = (value) => {
  if (value === true || value === '1' || value === 'true') return true
  if (value === false || value === '0' || value === 'false') return false
  return undefined
}

const classList = (value) => {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null
  if (!raw) return undefined
  const ids = raw.map(Number).filter((id) => Number.isInteger(id) && id >= 0)
  return ids.length ? [...new Set(ids)].sort((a, b) => a - b) : null
}

const COERCE = {
  model: (value) => (typeof value === 'string' && value && value !== LOCAL_MODEL ? value : undefined),
  device: (value) => (DEVICES.includes(value) ? value : undefined),
  conf: number(0, 1),
  iou: number(0, 1),
  classes: classList,
  labels: boolean,
  keypoints: boolean,
  elements: boolean,
  keypointThreshold: number(0, 1),
  lineWidth: number(0, 24),
}

function coerce(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, parse] of Object.entries(COERCE)) {
    if (!(key in raw)) continue
    const value = parse(raw[key])
    if (value !== undefined) out[key] = value
  }
  return out
}

export function readSettings() {
  let stored = null
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
  } catch {
    // Use defaults.
  }
  const query = Object.fromEntries(new URLSearchParams(window.location.search))
  // Query string overrides storage.
  return { ...DEFAULTS, ...coerce(stored), ...coerce(query) }
}

function serialize(value) {
  if (Array.isArray(value)) return value.join(',')
  if (typeof value === 'boolean') return value ? '1' : '0'
  return String(value)
}

export function writeSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage unavailable.
  }

  // Only non-defaults, to keep URLs short.
  const params = new URLSearchParams()
  for (const key of Object.keys(COERCE)) {
    const value = settings[key]
    if (value === null || value === undefined || value === DEFAULTS[key]) continue
    if (key === 'model' && value === LOCAL_MODEL) continue
    params.set(key, serialize(value))
  }
  const search = params.toString()
  window.history.replaceState(null, '', search ? `?${search}` : window.location.pathname)
}

export function predictOptions({ conf, iou, classes }) {
  const options = { conf, iou }
  if (classes?.length) options.classes = classes
  return options
}

export function annotateOptions({ labels, keypoints, keypointThreshold, lineWidth }) {
  const options = { labels, keypoints, keypointThreshold }
  if (lineWidth > 0) options.lineWidth = lineWidth
  return options
}
