#!/usr/bin/env node
/**
 * neutron-categorize — on-demand run of the AI categorization flow (spec §3.4:
 * start on-demand). Fetches the last N inbox emails, classifies each, applies
 * labels/moves immediately, writes durable sieve rules, and deploys.
 *
 * Usage:
 *   node bin/categorize.js [--limit N] [--folder inbox] [--min-confidence 0.6]
 *                          [--dry-run] [--headed]
 *
 * Requires ANTHROPIC_API_KEY (see lib/classifier.js). First ProtonMail run
 * requires an interactive login — pass --headed to complete it.
 */
const { withClient } = require('protonmail-client')
const { categorize } = require('../lib/categorize')
const { classify } = require('../lib/classifier')
const { ensureFiltersFile } = require('../lib/collection')

function parseArgs(argv) {
  const args = {
    limit: 20,
    folder: 'inbox',
    minConfidence: 0.6,
    dryRun: false,
    headed: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--limit') args.limit = parseInt(argv[++i], 10)
    else if (a === '--folder') args.folder = argv[++i]
    else if (a === '--min-confidence') args.minConfidence = parseFloat(argv[++i])
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--headed') args.headed = true
    else if (a === '--help' || a === '-h') {
      console.info('Usage: neutron-categorize [--limit N] [--folder inbox] [--min-confidence 0.6] [--dry-run] [--headed]')
      process.exit(0)
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  ensureFiltersFile()

  const results = await withClient(
    client =>
      categorize(
        {
          client,
          classify: email => classify(email, { model: process.env.NEUTRON_MODEL }),
        },
        {
          limit: args.limit,
          folder: args.folder,
          minConfidence: args.minConfidence,
          dryRun: args.dryRun,
        },
      ),
    { headless: !args.headed },
  )

  const summary = results.reduce((acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc), {})
  console.info('\nSummary:', JSON.stringify(summary))
  const rules = results.filter(r => r.ruleAdded).length
  console.info(`Durable rules added: ${rules}${args.dryRun ? ' (dry run — not written)' : ''}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
