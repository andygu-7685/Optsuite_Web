// Fails fast before dev/build if the generated static files are missing.
// Without them Vite's SPA fallback serves index.html for /models/*.onnx and
// the model load fails with an unhelpful parse error.
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const problems = []

if (!existsSync(join(publicDir, 'ort', 'ort-wasm-simd-threaded.wasm'))) {
  problems.push('public/ort is missing: run `npm install` or `npm run copy-ort`')
}

const modelsDir = join(publicDir, 'models')
const hasModel = existsSync(modelsDir) && readdirSync(modelsDir).some((f) => f.endsWith('.onnx'))
if (!hasModel) {
  problems.push('public/models has no .onnx: restore it from git or re-export (see root README)')
}

if (problems.length) {
  console.error(['Missing generated static files:', ...problems.map((p) => `  - ${p}`)].join('\n'))
  process.exit(1)
}
