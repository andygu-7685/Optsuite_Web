import { LOCAL_MODEL } from '../lib/options'

/**
 * Picks which .onnx to run: one of the exports listed in
 * public/models/index.json, or a file off the user's disk.
 */
export default function ModelPicker({ models, value, localModel, disabled, onSelect, onLocalFile }) {
  return (
    <div className="controls">
      <label>
        Model
        <select
          value={value ?? ''}
          onChange={(event) => onSelect(event.target.value)}
          disabled={disabled || (models.length === 0 && !localModel)}
        >
          {models.map((model) => (
            <option key={model.file} value={model.file}>
              {model.file.replace(/\.onnx$/, '')}
              {model.task ? ` (${model.task})` : ''}
            </option>
          ))}
          {localModel && <option value={LOCAL_MODEL}>{localModel.name} (local file)</option>}
        </select>
      </label>
      <label className="button" aria-disabled={disabled}>
        Load .onnx…
        <input type="file" accept=".onnx" hidden disabled={disabled} onChange={onLocalFile} />
      </label>
    </div>
  )
}
