const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { categorize } = require('../lib/categorize')
const { loadFilters } = require('../lib/collection')

/** A fake protonmail-client that records calls and returns canned emails. */
function fakeClient(emails) {
  const calls = { applyLabel: [], moveToFolder: [], deploy: [] }
  return {
    calls,
    getRecentEmails: async () => emails,
    parseFilters: async () => [],
    applyLabel: async (id, label) => calls.applyLabel.push({ id, label }),
    moveToFolder: async (id, folder) => calls.moveToFolder.push({ id, folder }),
    deploy: async chunks => calls.deploy.push(chunks),
    close: async () => {},
  }
}

function tmpFilters(initial = 'module.exports = []\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neutron-'))
  const file = path.join(dir, 'filters.js')
  fs.writeFileSync(file, initial)
  return {
    file,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}

test('categorize: labels, archives, writes a durable rule, and deploys', async () => {
  const { file, cleanup } = tmpFilters()
  const client = fakeClient([
    {
      id: 'e1',
      from: 'Sweetgreen <no-reply@sweetgreen.com>',
      subject: 'Order',
      snippet: '',
    },
  ])
  const classify = async () => ({
    label: 'Receipts',
    action: 'categorize-and-archive',
    confidence: 0.9,
    reasoning: 'receipt',
  })

  const results = await categorize({ client, classify }, { filtersPath: file, log: () => {} })

  assert.equal(results[0].status, 'labeled')
  assert.equal(results[0].pattern, '*@sweetgreen.com')
  assert.equal(results[0].ruleAdded, true)
  assert.deepEqual(client.calls.applyLabel, [{ id: 'e1', label: 'Receipts' }])
  assert.deepEqual(client.calls.moveToFolder, [{ id: 'e1', folder: 'archive' }])
  assert.equal(client.calls.deploy.length, 1)

  const filters = loadFilters(file)
  assert.equal(filters.length, 1)
  assert.deepEqual(filters[0].actions, [{ fileinto: ['archive', 'Receipts'] }])
  cleanup()
})

test('categorize: skips a sender already present in filters.js', async () => {
  const { file, cleanup } = tmpFilters("module.exports = [{ conditions: ['*@sweetgreen.com'], actions: [{ fileinto: ['Receipts'] }] }]\n")
  const client = fakeClient([{ id: 'e1', from: 'no-reply@sweetgreen.com', subject: 'x', snippet: '' }])
  let classified = false
  const classify = async () => ((classified = true), { label: 'Receipts', action: 'categorize-only', confidence: 1 })

  const results = await categorize({ client, classify }, { filtersPath: file, log: () => {} })

  assert.equal(results[0].status, 'skipped-existing')
  assert.equal(classified, false)
  assert.equal(client.calls.applyLabel.length, 0)
  assert.equal(client.calls.deploy.length, 0)
  cleanup()
})

test('categorize: low confidence labels immediately but adds no durable rule', async () => {
  const { file, cleanup } = tmpFilters()
  const client = fakeClient([{ id: 'e1', from: 'foo@newthing.com', subject: 'hi', snippet: '' }])
  const classify = async () => ({
    label: 'Work',
    action: 'categorize-only',
    confidence: 0.3,
    reasoning: 'unsure',
  })

  const results = await categorize({ client, classify }, { filtersPath: file, minConfidence: 0.6, log: () => {} })

  assert.equal(results[0].status, 'labeled-low-confidence')
  assert.equal(results[0].ruleAdded, false)
  assert.deepEqual(client.calls.applyLabel, [{ id: 'e1', label: 'Work' }])
  assert.equal(client.calls.deploy.length, 0)
  assert.equal(loadFilters(file).length, 0)
  cleanup()
})

test('categorize: trash moves to trash without labeling', async () => {
  const { file, cleanup } = tmpFilters()
  const client = fakeClient([{ id: 'e1', from: 'spam@junk.com', subject: 'buy', snippet: '' }])
  const classify = async () => ({
    label: null,
    action: 'trash',
    confidence: 0.95,
    reasoning: 'spam',
  })

  const results = await categorize({ client, classify }, { filtersPath: file, log: () => {} })

  assert.equal(results[0].action, 'trash')
  assert.equal(client.calls.applyLabel.length, 0)
  assert.deepEqual(client.calls.moveToFolder, [{ id: 'e1', folder: 'trash' }])
  assert.deepEqual(loadFilters(file)[0].actions, [{ fileinto: ['trash'] }])
  cleanup()
})

test('categorize: dry run classifies but writes nothing', async () => {
  const { file, cleanup } = tmpFilters()
  const client = fakeClient([{ id: 'e1', from: 'foo@shop.com', subject: 'x', snippet: '' }])
  const classify = async () => ({
    label: 'Products',
    action: 'categorize-only',
    confidence: 1,
  })

  const results = await categorize({ client, classify }, { filtersPath: file, dryRun: true, log: () => {} })

  assert.equal(results[0].status, 'labeled')
  assert.equal(client.calls.applyLabel.length, 0)
  assert.equal(client.calls.deploy.length, 0)
  assert.equal(loadFilters(file).length, 0)
  cleanup()
})

test('categorize: a classify error is captured per-email and does not abort the run', async () => {
  const { file, cleanup } = tmpFilters()
  const client = fakeClient([
    { id: 'e1', from: 'a@one.com', subject: 'x', snippet: '' },
    { id: 'e2', from: 'b@two.com', subject: 'y', snippet: '' },
  ])
  let n = 0
  const classify = async () => {
    n++
    if (n === 1) throw new Error('boom')
    return { label: 'Work', action: 'categorize-only', confidence: 1 }
  }

  const results = await categorize({ client, classify }, { filtersPath: file, log: () => {} })

  assert.equal(results[0].status, 'error')
  assert.equal(results[1].status, 'labeled')
  cleanup()
})
