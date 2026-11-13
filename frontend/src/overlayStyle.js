const PRESETS = {
  classic: { color: '#ffe600', width: 2, name: 'Yellow' },
  cyan_white: { color: '#2ee6ff', width: 3, name: 'Cyan + white' },
  magenta_yellow: { color: '#ff3fd2', width: 4, name: 'Magenta + yellow' },
  green_white: { color: '#4dff6a', width: 2, name: 'Green + white' },
}

const CUSTOM_STYLE = /^custom:(#[0-9a-f]{6}):([1-9]|1[0-9]|20)$/i

export function parseOverlayStyle(style) {
  const match = CUSTOM_STYLE.exec(style || '')
  if (match) return { color: match[1].toLowerCase(), width: Number(match[2]), name: 'Custom' }
  return PRESETS[style] || PRESETS.classic
}

export function customOverlayStyle(color, width) {
  return `custom:${color.toLowerCase()}:${width}`
}

export function overlayStyleLabel(style) {
  const parsed = parseOverlayStyle(style)
  return parsed.name === 'Custom' ? `${parsed.color.toUpperCase()} · ${parsed.width} px` : parsed.name
}
