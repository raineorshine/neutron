/**
 * Categorization orchestration (spec §3.2). For each newly fetched email:
 * fetch → skip-if-known → classify → act now (immediate write) → automate the
 * future (durable sieve rule) → log.
 */
const { deriveSenderPattern, extractAddress } = require('./patterns')
const { resolveAction } = require('./actions')
const { buildChunks } = require('./build')
const collection = require('./collection')

/**
 * @typedef {Object} CategorizeResult
 * @property {{ id: string, from: string, subject: string }} email
 * @property {string} status  'skipped-existing' | 'labeled' | 'labeled-low-confidence' | 'error'
 * @property {string|null} label
 * @property {string|null} action
 * @property {string} pattern
 * @property {number} [confidence]
 * @property {boolean} ruleAdded
 * @property {string} [reason]
 */

/**
 * Runs the full flow.
 *
 * @param {Object} deps
 * @param {import('protonmail-client').ProtonMailClient} deps.client
 * @param {(email: any) => Promise<{label: string|null, action: string, confidence: number, reasoning: string}>} deps.classify
 * @param {Object} [options]
 * @param {number} [options.limit=20]
 * @param {string} [options.folder='inbox']
 * @param {number} [options.minConfidence=0.6] below this: apply label immediately but add NO durable rule
 * @param {boolean} [options.dryRun=false] classify + log only; no writes
 * @param {string} [options.filtersPath]
 * @param {(msg: string) => void} [options.log=console.info]
 * @returns {Promise<CategorizeResult[]>}
 */
async function categorize(deps, options = {}) {
  const { client, classify } = deps
  const { limit = 20, folder = 'inbox', minConfidence = 0.6, dryRun = false, filtersPath, log = console.info } = options

  const emails = await client.getRecentEmails({ limit, folder })
  log(`Fetched ${emails.length} email(s) from ${folder}.`)

  let filters = collection.loadFilters(filtersPath)
  const results = []
  let anyRuleAdded = false

  for (const email of emails) {
    const address = extractAddress(email.from)
    const domain = address.split('@')[1] || ''
    const pattern = deriveSenderPattern(email.from)

    // 2. Skip if a matching filter already exists (sender already handled).
    if (collection.hasPattern(filters, pattern) || collection.hasDomain(filters, domain)) {
      results.push({
        email,
        status: 'skipped-existing',
        label: null,
        action: null,
        pattern,
        ruleAdded: false,
      })
      log(`↷ skip ${address || email.from} (already filtered)`)
      continue
    }

    let decision
    try {
      // 3. Classify.
      decision = await classify(email)
    } catch (err) {
      results.push({
        email,
        status: 'error',
        label: null,
        action: null,
        pattern,
        ruleAdded: false,
        reason: err.message,
      })
      log(`✗ classify failed for ${address || email.from}: ${err.message}`)
      continue
    }

    const { label, action, confidence, reasoning } = decision
    const resolved = resolveAction(label, action)

    // 4. Act now — immediate write path (handles the message already in inbox).
    if (!dryRun) {
      try {
        if (resolved.label) await client.applyLabel(email.id, resolved.label)
        if (resolved.move) await client.moveToFolder(email.id, resolved.move)
      } catch (err) {
        results.push({
          email,
          status: 'error',
          label,
          action,
          pattern,
          confidence,
          ruleAdded: false,
          reason: err.message,
        })
        log(`✗ apply failed for ${address || email.from}: ${err.message}`)
        continue
      }
    }

    // 5. Automate the future — durable write path, only when confident enough.
    let ruleAdded = false
    const lowConfidence = confidence < minConfidence
    if (!lowConfidence) {
      const entry = {
        comment: senderComment(email),
        from: pattern,
        fileinto: resolved.fileinto,
      }
      if (!dryRun) {
        const { added } = collection.addFilter(entry, { filtersPath })
        ruleAdded = added
        if (added) {
          anyRuleAdded = true
          filters = collection.loadFilters(filtersPath)
        }
      } else {
        ruleAdded = true // would have been added
      }
    }

    const status = lowConfidence ? 'labeled-low-confidence' : 'labeled'
    results.push({
      email,
      status,
      label,
      action,
      pattern,
      confidence,
      ruleAdded,
      reason: reasoning,
    })
    log(`✓ ${address || email.from} → ${label || action} [${action}] conf=${confidence.toFixed(2)}${ruleAdded ? ' +rule' : lowConfidence ? ' (low conf, no rule)' : ''}`)
  }

  // 5 (cont.) Build + deploy once if the collection changed.
  if (anyRuleAdded && !dryRun) {
    const chunks = buildChunks(collection.loadFilters(filtersPath))
    log(`Deploying ${chunks.length} sieve chunk(s): ${chunks.map(c => c.name).join(', ')}`)
    await client.deploy(chunks)
  }

  return results
}

/** A concise comment for the filter entry, from the sender name if present. */
function senderComment(email) {
  const name = (email.from || '').split('<')[0].trim().replace(/^"|"$/g, '')
  return name || extractAddress(email.from) || undefined
}

module.exports = { categorize }
