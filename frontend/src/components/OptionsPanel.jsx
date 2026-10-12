import { DEVICES } from '../lib/options'
import { METHODS } from '../lib/scan'
import { RULES } from '../lib/score'

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      {children}
    </label>
  )
}

function Slider({ label, hint, value, min, max, step, format, disabled, onChange }) {
  return (
    <Field label={label} hint={hint}>
      <span className="slider">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <output>{format(value)}</output>
      </span>
    </Field>
  )
}

function Toggle({ label, hint, checked, disabled, onChange }) {
  return (
    <label className="field field-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="field-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
    </label>
  )
}

function Choice({ label, hint, value, options, onChange }) {
  return (
    <Field label={label} hint={hint}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </Field>
  )
}

const ratio = (value) => value.toFixed(2)

/**
 * Model, inference, scoring and overlay options. Class and keypoint controls
 * show only when the model supports them, and the scoring controls only for the
 * pose model, since measuring needs an outline to place the scanlines against.
 *
 * The scoring four are constants.py by another name: SCORE_METHOD,
 * SCORE_THRESHOLD, FOCUS_GROUP_LAST_ABOVE_THRESHOLD and GRADIENT_MIN.
 */
export default function OptionsPanel({ settings, names, task, busy, onChange, onReset }) {
  const classIds = Object.keys(names ?? {})
    .map(Number)
    .sort((a, b) => a - b)
  const showClasses = classIds.length > 1
  const selected = settings.classes
  const isPose = task === 'pose'

  function toggleClass(id, checked) {
    const current = new Set(selected ?? classIds)
    if (checked) current.add(id)
    else current.delete(id)
    const next = [...current].sort((a, b) => a - b)
    // All or none means no filter.
    onChange({ classes: next.length === 0 || next.length === classIds.length ? null : next })
  }

  return (
    <section className="options">
      <header>
        <h2>Model options</h2>
        <button type="button" className="button" onClick={onReset} disabled={busy}>
          Reset
        </button>
      </header>

      <div className="options-grid">
        <Field label="Device" hint="reloads the page">
          <select
            value={settings.device}
            disabled={busy}
            onChange={(event) => onChange({ device: event.target.value })}
          >
            {DEVICES.map((device) => (
              <option key={device} value={device}>
                {device}
              </option>
            ))}
          </select>
        </Field>

        <Slider
          label="Confidence"
          hint="conf"
          value={settings.conf}
          min={0}
          max={1}
          step={0.01}
          format={ratio}
          onChange={(conf) => onChange({ conf })}
        />

        <Slider
          label="NMS IoU"
          hint="iou"
          value={settings.iou}
          min={0}
          max={1}
          step={0.01}
          format={ratio}
          onChange={(iou) => onChange({ iou })}
        />

        <Slider
          label="Line width"
          hint="overlay"
          value={settings.lineWidth}
          min={0}
          max={24}
          step={1}
          format={(value) => (value === 0 ? 'auto' : `${value} px`)}
          onChange={(lineWidth) => onChange({ lineWidth })}
        />

        {isPose && (
          <Slider
            label="Keypoint threshold"
            hint="fit"
            value={settings.keypointThreshold}
            min={0}
            max={1}
            step={0.01}
            format={ratio}
            onChange={(keypointThreshold) => onChange({ keypointThreshold })}
          />
        )}

        {isPose && (
          <Slider
            label="Contrast threshold"
            hint="score"
            value={settings.threshold}
            min={0}
            max={1}
            step={0.01}
            format={ratio}
            onChange={(threshold) => onChange({ threshold })}
          />
        )}

        {isPose && (
          <Choice
            label="Merge directions"
            hint="score"
            value={settings.method}
            options={METHODS}
            onChange={(method) => onChange({ method })}
          />
        )}

        {isPose && (
          <Choice
            label="Cutoff rule"
            hint="score"
            value={settings.rule}
            options={RULES}
            onChange={(rule) => onChange({ rule })}
          />
        )}

        <div className="options-toggles">
          <Toggle
            label="Labels"
            hint="class + conf"
            checked={settings.labels}
            onChange={(labels) => onChange({ labels })}
          />
          {isPose && (
            <Toggle
              label="Keypoints"
              hint="and skeleton"
              checked={settings.keypoints}
              onChange={(keypoints) => onChange({ keypoints })}
            />
          )}
          {isPose && (
            <Toggle
              label="Elements"
              hint="group + lp/mm"
              checked={settings.elements}
              onChange={(elements) => onChange({ elements })}
            />
          )}
          {isPose && (
            <Toggle
              label="Scanlines"
              hint="what was measured"
              checked={settings.scanlines}
              disabled={!settings.elements}
              onChange={(scanlines) => onChange({ scanlines })}
            />
          )}
          {isPose && (
            <Toggle
              label="Require dips"
              hint="one per gap"
              checked={settings.dipRule}
              onChange={(dipRule) => onChange({ dipRule })}
            />
          )}
        </div>

        {showClasses && (
          <fieldset className="classes">
            <legend>Classes</legend>
            {classIds.map((id) => (
              <Toggle
                key={id}
                label={names[id] ?? `class ${id}`}
                checked={selected ? selected.includes(id) : true}
                onChange={(checked) => toggleClass(id, checked)}
              />
            ))}
          </fieldset>
        )}
      </div>
    </section>
  )
}
