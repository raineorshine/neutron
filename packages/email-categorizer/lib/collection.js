/**
 * The rule collection — read/append/serialize the (gitignored) filters.js
 * (spec §3.1). Same `{ conditions, actions }` array format that sieve-builder
 * consumes and the categorizer builds/deploys from.
 *
 * filters.js is personal data and MUST NOT be committed (it is gitignored).
 */
const fs = require('fs')
const path = require('path')

const DEFAULT_FILTERS_PATH = path.join(__dirname, '..', 'filters.js')
const DEFAULT_SAMPLE_PATH = path.join(__dirname, '..', 'filters.sample.js')

/**
 * Ensures filters.js exists, seeding it from filters.sample.js on first run.
 * @param {string} [filtersPath]
 * @param {string} [samplePath]
 */
function ensureFiltersFile(filtersPath = DEFAULT_FILTERS_PATH, samplePath = DEFAULT_SAMPLE_PATH) {
  if (!fs.existsSync(filtersPath)) fs.copyFileSync(samplePath, filtersPath)
}

/**
 * Loads the filters array fresh (bypasses the require cache so repeated
 * load/save cycles see the latest content).
 * @param {string} [filtersPath]
 * @returns {Array<{ conditions: any[], actions: Array<{ fileinto: string[] }> }>}
 */
function loadFilters(filtersPath = DEFAULT_FILTERS_PATH) {
  if (!fs.existsSync(filtersPath)) return []
  const resolved = require.resolve(filtersPath)
  delete require.cache[resolved]
  return require(resolved)
}

/** Normalizes a condition (string shorthand or object) to `{ from, subject?, comment? }`. */
function normalizeCondition(condition) {
  return typeof condition === 'string' ? { from: condition } : { ...condition }
}

/** Every `from` pattern present anywhere in the collection, lowercased. */
function allPatterns(filters) {
  return filters.flatMap(f =>
    (f.conditions || [])
      .map(c => normalizeCondition(c).from)
      .filter(Boolean)
      .map(s => s.toLowerCase()),
  )
}

/**
 * True if the exact `from` pattern already exists in the collection.
 * @param {any[]} filters
 * @param {string} pattern
 */
function hasPattern(filters, pattern) {
  const needle = (pattern || '').toLowerCase()
  return allPatterns(filters).includes(needle)
}

/**
 * True if any existing filter references the given bare domain (catches exact
 * addresses, `*@domain.com`, and `*@*.domain.com`). Mirrors the skill's
 * duplicate check (§4 step 6).
 * @param {any[]} filters
 * @param {string} domain e.g. 'example.com'
 */
function hasDomain(filters, domain) {
  if (!domain) return false
  const needle = domain.toLowerCase()
  return allPatterns(filters).some(p => p === needle || p.endsWith(`@${needle}`) || p.endsWith(`.${needle}`))
}

function eqFileinto(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/**
 * Appends a filter entry to the collection, merging into an existing block that
 * has the same `fileinto` actions when possible (produces tidy anyof rules).
 * Skips exact-duplicate patterns. Returns the updated array (does not write).
 *
 * @param {any[]} filters current collection
 * @param {{ from: string, comment?: string, subject?: string, fileinto: string[] }} entry
 * @returns {{ filters: any[], added: boolean, merged: boolean }}
 */
function addFilterEntry(filters, entry) {
  const { from, comment, subject, fileinto } = entry
  if (!from) throw new Error('addFilterEntry: `from` is required')
  if (!Array.isArray(fileinto) || fileinto.length === 0) throw new Error('addFilterEntry: `fileinto` must be a non-empty array')

  const next = filters.map(f => ({
    ...f,
    conditions: [...f.conditions],
    actions: f.actions,
  }))

  // Duplicate: same pattern already filed the same way → no-op.
  const condition = subject ? { comment, from, subject } : comment ? { comment, from } : from
  const normalized = normalizeCondition(condition)

  const target = next.find(f => f.actions.length === 1 && f.actions[0].fileinto && eqFileinto(f.actions[0].fileinto, fileinto))

  if (target) {
    const exists = target.conditions.some(c => {
      const n = normalizeCondition(c)
      return n.from?.toLowerCase() === normalized.from.toLowerCase() && (n.subject || '') === (normalized.subject || '')
    })
    if (exists) return { filters: next, added: false, merged: false }
    target.conditions.push(condition)
    return { filters: next, added: true, merged: true }
  }

  next.push({ conditions: [condition], actions: [{ fileinto }] })
  return { filters: next, added: true, merged: false }
}

/** Serializes a single condition to JS source. */
function serializeCondition(condition) {
  if (typeof condition === 'string') return quote(condition)
  const parts = []
  if (condition.comment) parts.push(`comment: ${quote(condition.comment)}`)
  if (condition.from) parts.push(`from: ${quote(condition.from)}`)
  if (condition.subject) parts.push(`subject: ${quote(condition.subject)}`)
  return `{ ${parts.join(', ')} }`
}

/** Serializes the whole collection to a valid, readable filters.js module. */
function serializeFilters(filters) {
  const blocks = filters
    .map(f => {
      const conditions = f.conditions.map(c => `      ${serializeCondition(c)},`).join('\n')
      const actions = f.actions.map(a => `      { fileinto: [${a.fileinto.map(quote).join(', ')}] },`).join('\n')
      const label = `  // ${f.actions.map(a => a.fileinto.join(' + ')).join(', ')}`
      return `${label}\n  {\n    conditions: [\n${conditions}\n    ],\n    actions: [\n${actions}\n    ],\n  },`
    })
    .join('\n')

  return `/**
 * filters.js — the neutron rule collection (PERSONAL DATA — gitignored, DO NOT COMMIT).
 * Managed by email-categorizer; also hand-editable. Array of sieve-builder filters.
 */
const filters = [
${blocks}
]

module.exports = filters
`
}

function quote(str) {
  return `'${String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/**
 * High-level append: load → add entry → serialize → write filters.js.
 * @param {{ from: string, comment?: string, subject?: string, fileinto: string[] }} entry
 * @param {{ filtersPath?: string }} [opts]
 * @returns {{ added: boolean, merged: boolean }}
 */
function addFilter(entry, { filtersPath = DEFAULT_FILTERS_PATH } = {}) {
  ensureFiltersFile(filtersPath)
  const current = loadFilters(filtersPath)
  const { filters, added, merged } = addFilterEntry(current, entry)
  if (added) fs.writeFileSync(filtersPath, serializeFilters(filters))
  return { added, merged }
}

module.exports = {
  DEFAULT_FILTERS_PATH,
  ensureFiltersFile,
  loadFilters,
  addFilter,
  addFilterEntry,
  hasPattern,
  hasDomain,
  allPatterns,
  serializeFilters,
  serializeCondition,
}
