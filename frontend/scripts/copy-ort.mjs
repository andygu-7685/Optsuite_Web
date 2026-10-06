// Copies onnxruntime-web's runtime files into public/ort so they're served
// same-origin (App.jsx points ortBaseUrl at /ort/). Runs on postinstall, so
// the copy always matches the installed onnxruntime-web version.
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'onnxruntime-web', 'dist')
const dest = join(root, 'public', 'ort')

if (!existsSync(src)) {
  console.error(`copy-ort: ${src} not found; run npm install first`)
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true, filter: (file) => !file.endsWith('.map') })
console.log(`copy-ort: copied onnxruntime-web runtime to ${dest}`)
