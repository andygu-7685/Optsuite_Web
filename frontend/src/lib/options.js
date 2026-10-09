// Everything the UI can hand the model, in one record: LoadOptions.device,
// PredictOptions (conf / iou / classes) and AnnotateOptions. Persisted to
// localStorage and mirrored into the query string, so a tuned configuration
// survives a reload and can be shared as a link.

const STORAGE_KEY = 'optsuite:settings'

// <select> value for a model loaded from the user's disk instead of
// public/models. Never persisted: a File can't be named in a URL or reopened
// on reload.
export const LOCAL_MODEL = 'local'

export const DEVICES = ['auto', 'webgpu', 'cpu']

export const DEFAULTS = {
  // Which .onnx from public/models to load; filled in once the list arrives.
  model: null,
  // LoadOptions.device. Changing it reloads the model.
  device: 'auto',
  // PredictOptions. The library defaults are conf 0.25 / iou 0.7; these are the
  // values the app used to pass hardcoded.
  conf: 0.3,
  iou: 0.3,
  // PredictOptions.classes. null keeps every class, which is what omitting the
  // option does.
  classes: null,
  // AnnotateOptions.
  labels: true,
  keypoints: true,
  keypointThreshold: 0.25,
  // AnnotateOptions.lineWidth. 0 leaves it out so the library scales it to the
  // image.
  lineWidth: 0,
}

// Each coercer takes either a native value (from localStorage JSON) or a string
// (from the query string) and returns undefined to fall back to the default.
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
    // Unparseable or unavailable (private mode): fall through to the defaults.
  }
  const query = Object.fromEntries(new URLSearchParams(window.location.search))
  // The query string wins, so a shared link overrides what is stored locally.
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
    // Quota or private mode. The in-memory settings still apply.
  }

  // Only what differs from the defaults, to keep the shared link short.
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
