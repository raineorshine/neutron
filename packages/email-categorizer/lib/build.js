/**
 * In-process sieve chunk builder (spec §3.1). Replaces the old
 * `execSync('node bin.js filters.js')` shell-out: builds named chunks directly
 * from sieve-builder's exported `Header` + `MultiRule` primitives and hands
 * them to `protonmailClient.deploy()`.
 */

const FILTER_NAME_PREFIX = 'sieve-builder-'
const MAX_FILE_SIZE = 50000 // 50k chars — matches sieve-builder's bin.js

/**
 * Builds named sieve chunks from a filters collection, splitting on the size
 * limit so each fits a single ProtonMail custom filter.
 *
 * @param {any[]} filters the { conditions, actions } collection
 * @param {{ sieve?: any, prefix?: string, maxSize?: number }} [opts]
 *   `sieve` is the sieve-builder module (injectable for tests); defaults to the
 *   installed `sieve-builder` github dependency.
 * @returns {{ name: string, content: string }[]}
 */
function buildChunks(filters, opts = {}) {
  const sieve = opts.sieve || require('sieve-builder')
  const prefix = opts.prefix || FILTER_NAME_PREFIX
  const maxSize = opts.maxSize || MAX_FILE_SIZE
  const { Header, MultiRule } = sieve

  const rules = filters.map(MultiRule)

  const chunks = []
  let content = Header
  let count = 0
  let index = 1

  for (const rule of rules) {
    const potential = content + rule + '\n'
    if (potential.length > maxSize && count > 0) {
      chunks.push({ name: `${prefix}${index}`, content })
      index++
      content = Header + rule + '\n'
      count = 1
    } else {
      content = potential
      count++
    }
  }

  if (count > 0) chunks.push({ name: `${prefix}${index}`, content })

  return chunks
}

module.exports = { buildChunks, FILTER_NAME_PREFIX, MAX_FILE_SIZE }
