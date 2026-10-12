// USAF 1951 math, mirroring usaf_registration/helper.py.
// Group/element and lp/mm come from the model's exported `usaf` block
// (usaf_registration/export_model.py); class labels like "g3e4" are the fallback.

// constants.py UsafConfig.G1
export const FIRST_GROUP = 2

const ELEMENTS = [1, 2, 3, 4, 5, 6]

export function lpPerMm(group, element) {
  return 2 ** (group + (element - 1) / 6)
}

/** Single bar width in mm. */
export function lineWidthMm(group, element) {
  return 1 / (2 * lpPerMm(group, element))
}

export function lineWidthUm(group, element) {
  return lineWidthMm(group, element) * 1000
}

/**
 * Scan order of constants.py `initialize_score_table`: elements 2-4 of the
 * first group, then five full groups. Each row carries its lp/mm and bar width
 * as well, so a row is self-describing wherever it travels.
 */
export function scoreTable(firstGroup = FIRST_GROUP) {
  const rows = [2, 3, 4].map((element) => ({ group: firstGroup, element }))
  for (let offset = 1; offset <= 5; offset += 1) {
    for (const element of ELEMENTS) rows.push({ group: firstGroup + offset, element })
  }
  return rows.map(({ group, element }, index) => ({
    index,
    group,
    element,
    lpPerMm: lpPerMm(group, element),
    lineWidthUm: lineWidthUm(group, element),
  }))
}

/**
 * Which group the scan table starts at, from how many nested patterns the model
 * found: usaf_algo.py `G1 = 8 - pattern_count * 2`.
 *
 * A USAF target carries smaller copies of itself, each two groups finer than
 * the one around it, so how many are in frame says how far in the outermost one
 * already is. Without this a close-up of the inner pattern reads as group 2 when
 * its bars are really group 6, and every lp/mm with it is off by a factor of 16.
 */
export function firstGroupFor(patternCount) {
  if (!Number.isInteger(patternCount) || patternCount < 1) return null
  return Math.min(7, 8 - patternCount * 2)
}

/** The scan order to read rows off, given the sidecar and what the model saw. */
export function usafScoreTable(usaf, patternCount = null) {
  return scoreTable(firstGroupFor(patternCount) ?? usaf?.firstGroup ?? FIRST_GROUP)
}

// "g3e4", "G3_E4", "group 3 element 4"; "g-1e3" is group -1.
const LABELLED = /g(?:roup)?\s*(?:[-_ ](?!\d))?(-?\d+)\s*[-_ ]?e(?:lement)?\s*[-_ ]?([1-6])(?!\d)/i
// "3-4", "3 4", "[3, 4]"
const PAIR = /^\D*(-?\d+)\s*[-_/,\s]\s*([1-6])\D*$/

/** `{ group, element }` from a label, or null if absent or out of range. */
export function parseGroupElement(label) {
  if (typeof label !== 'string') return null
  const match = LABELLED.exec(label) ?? PAIR.exec(label)
  if (!match) return null
  const group = Number(match[1])
  const element = Number(match[2])
  if (!Number.isInteger(group) || group < -2 || group > 9) return null
  if (!Number.isInteger(element) || element < 1 || element > 6) return null
  return { group, element }
}

/** Group/element for one detection: the model's exported class map first, then its label. */
export function resolveGroupElement(usaf, cls, label) {
  const exported = usaf?.classes?.[cls]
  if (exported && Number.isInteger(exported.group) && Number.isInteger(exported.element)) return exported
  return parseGroupElement(label)
}

/** Exported lp/mm wins so the Python scorer stays the source of truth. */
export function lpPerMmOf({ group, element, lpPerMm: exported }) {
  return typeof exported === 'number' ? exported : lpPerMm(group, element)
}

export function lineWidthUmOf({ group, element, lineWidthUm: exported }) {
  return typeof exported === 'number' ? exported : lineWidthUm(group, element)
}

export function formatGroupElement({ group, element }) {
  return `G${group} E${element}`
}

function format(value) {
  return value >= 100 ? value.toFixed(0) : value.toFixed(2)
}

export function formatLpPerMm(groupElement) {
  return format(lpPerMmOf(groupElement))
}

export function formatLineWidthUm(groupElement) {
  return format(lineWidthUmOf(groupElement))
}
