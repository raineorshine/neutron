#!/usr/bin/env node
/**
 * neutron-deploy — plain deploy flow (spec §4), no AI. Edit filters.js by hand,
 * then run this to build sieve chunks in-process and push them to ProtonMail.
 *
 * Usage: node bin/deploy.js [--headed]
 */
const { withClient } = require('protonmail-client')
const { buildChunks } = require('../lib/build')
const { loadFilters, ensureFiltersFile } = require('../lib/collection')

async function main() {
  const headed = process.argv.includes('--headed')

  ensureFiltersFile()
  const filters = loadFilters()
  if (filters.length === 0) {
    console.error('filters.js is empty. Add filters before deploying.')
    process.exit(1)
  }

  const chunks = buildChunks(filters)
  console.info(`Built ${chunks.length} sieve chunk(s): ${chunks.map(c => c.name).join(', ')}`)

  await withClient(
    async client => {
      console.info('Deploying to ProtonMail...')
      await client.deploy(chunks)
      console.info('All filters deployed successfully!')
    },
    { headless: !headed },
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
