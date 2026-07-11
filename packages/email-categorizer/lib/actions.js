/**
 * Maps the classifier's (label, action) into both the durable sieve `fileinto`
 * array and the immediate Mail-view operations, keeping present and future
 * behavior in sync (spec §3.2).
 */

/** The three actions the classifier may choose (spec §3.2 step 3). */
const ACTIONS = ['categorize-only', 'categorize-and-archive', 'trash']

/**
 * @typedef {Object} ResolvedAction
 * @property {string[]} fileinto  sieve fileinto destinations for the durable rule
 * @property {string|null} label  label to apply to the current message, or null
 * @property {string|null} move   folder to move the current message to, or null
 */

/**
 * @param {string} label taxonomy label (ignored for `trash`)
 * @param {string} action one of ACTIONS
 * @returns {ResolvedAction}
 */
function resolveAction(label, action) {
  switch (action) {
    case 'categorize-only':
      requireLabel(label, action)
      return { fileinto: [label], label, move: null }
    case 'categorize-and-archive':
      requireLabel(label, action)
      // sieve convention: ['archive', 'Label'] (see filters.sample.js)
      return { fileinto: ['archive', label], label, move: 'archive' }
    case 'trash':
      return { fileinto: ['trash'], label: null, move: 'trash' }
    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

function requireLabel(label, action) {
  if (!label) throw new Error(`Action "${action}" requires a label`)
}

module.exports = { ACTIONS, resolveAction }
