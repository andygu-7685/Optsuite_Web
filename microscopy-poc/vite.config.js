import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Both ship wasm + workers that the dependency optimizer rewrites incorrectly.
  optimizeDeps: { exclude: ['@ultralytics/yolo', 'onnxruntime-web'] },
})
