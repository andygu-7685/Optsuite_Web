// USAF 1951 math, mirroring usaf_registration/helper.py.
// Group/element is parsed from class labels (e.g. "g3e4"); models without such labels report none.

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

/** Scan order of constants.py `initialize_score_table`: elements 2-4 of the first group, then five full groups. */
export function scoreTable(firstGroup = FIRST_GROUP) {
  const rows = [2, 3, 4].map((element) => ({ group: firstGroup, element }))
  for (let offset = 1; offset <= 5; offset += 1) {
    for (const element of ELEMENTS) rows.push({ group: firstGroup + offset, element })
  }
  return rows.map((row, index) => ({ index, ...row }))
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

export function formatGroupElement({ group, element }) {
  return `G${group} E${element}`
}

export function formatLpPerMm(group, element) {
  const value = lpPerMm(group, element)
  return value >= 100 ? value.toFixed(0) : value.toFixed(2)
}

export function formatLineWidthUm(group, element) {
  const value = lineWidthUm(group, element)
  return value >= 100 ? value.toFixed(0) : value.toFixed(2)
}
