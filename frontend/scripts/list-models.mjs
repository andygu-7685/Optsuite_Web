// Writes public/models/index.json so the app can offer every exported model in
// its picker. Each .onnx is listed with its export_model.py sidecar (.json) if
// there is one; a bare .onnx still shows up, just without metadata.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const modelsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models')

const models = readdirSync(modelsDir)
  .filter((f) => f.endsWith('.onnx'))
  .sort()
  .map((file) => {
    const metaPath = join(modelsDir, file.replace(/\.onnx$/, '.json'))
    let meta = {}
    if (existsSync(metaPath)) {
      try {
        meta = JSON.parse(readFileSync(metaPath, 'utf8'))
      } catch (err) {
        console.warn(`list-models: ignoring unreadable ${metaPath}: ${err.message}`)
      }
    }
    return { ...meta, file }
  })

writeFileSync(join(modelsDir, 'index.json'), JSON.stringify(models, null, 2) + '\n')
console.log(`list-models: ${models.length} model(s) -> public/models/index.json`)
