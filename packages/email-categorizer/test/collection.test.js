const { test } = require('node:test')
const assert = require('node:assert')
const { addFilterEntry, hasPattern, hasDomain, serializeFilters, loadFilters, addFilter } = require('../lib/collection')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test('addFilterEntry creates a new block when no matching action exists', () => {
  const { filters, added, merged } = addFilterEntry([], {
    from: '*@sweetgreen.com',
    comment: 'Sweetgreen',
    fileinto: ['archive', 'Receipts'],
  })
  assert.equal(added, true)
  assert.equal(merged, false)
  assert.equal(filters.length, 1)
  assert.deepEqual(filters[0].actions, [{ fileinto: ['archive', 'Receipts'] }])
  assert.deepEqual(filters[0].conditions, [{ comment: 'Sweetgreen', from: '*@sweetgreen.com' }])
})

test('addFilterEntry merges into an existing block with identical fileinto', () => {
  const start = [{ conditions: ['*@a.com'], actions: [{ fileinto: ['Work'] }] }]
  const { filters, added, merged } = addFilterEntry(start, {
    from: '*@b.com',
    fileinto: ['Work'],
  })
  assert.equal(added, true)
  assert.equal(merged, true)
  assert.equal(filters.length, 1)
  assert.deepEqual(filters[0].conditions, ['*@a.com', '*@b.com'])
})

test('addFilterEntry is idempotent for an exact duplicate pattern', () => {
  const start = [{ conditions: ['*@a.com'], actions: [{ fileinto: ['Work'] }] }]
  const { added, merged } = addFilterEntry(start, {
    from: '*@a.com',
    fileinto: ['Work'],
  })
  assert.equal(added, false)
  assert.equal(merged, false)
})

test('addFilterEntry uses string shorthand when only from is present', () => {
  const { filters } = addFilterEntry([], {
    from: '*@x.com',
    fileinto: ['Work'],
  })
  assert.deepEqual(filters[0].conditions, ['*@x.com'])
})

test('hasPattern and hasDomain detect existing filters', () => {
  const filters = [
    { conditions: ['*@sweetgreen.com'], actions: [{ fileinto: ['Receipts'] }] },
    {
      conditions: [{ from: '*@*.nordstrom.com' }],
      actions: [{ fileinto: ['Fashion'] }],
    },
    { conditions: ['exact@stripe.com'], actions: [{ fileinto: ['Finance'] }] },
  ]
  assert.equal(hasPattern(filters, '*@sweetgreen.com'), true)
  assert.equal(hasPattern(filters, '*@SWEETGREEN.COM'), true)
  assert.equal(hasPattern(filters, '*@unknown.com'), false)
  assert.equal(hasDomain(filters, 'sweetgreen.com'), true)
  assert.equal(hasDomain(filters, 'nordstrom.com'), true)
  assert.equal(hasDomain(filters, 'stripe.com'), true)
  assert.equal(hasDomain(filters, 'other.com'), false)
})

test('serializeFilters round-trips through require', () => {
  const filters = [
    {
      conditions: [{ comment: "O'Brien & Co", from: '*@obrien.com' }],
      actions: [{ fileinto: ['Work'] }],
    },
    {
      conditions: ['*@a.com', { from: '*@b.com', subject: 'Deal' }],
      actions: [{ fileinto: ['archive', 'Products'] }],
    },
  ]
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neutron-'))
  const file = path.join(dir, 'filters.js')
  fs.writeFileSync(file, serializeFilters(filters))
  const loaded = loadFilters(file)
  assert.equal(loaded.length, 2)
  assert.equal(loaded[0].conditions[0].comment, "O'Brien & Co")
  assert.deepEqual(loaded[1].actions, [{ fileinto: ['archive', 'Products'] }])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('addFilter writes to disk and dedupes on second call', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neutron-'))
  const file = path.join(dir, 'filters.js')
  fs.writeFileSync(file, 'module.exports = []\n')

  const first = addFilter({ from: '*@z.com', comment: 'Z', fileinto: ['Work'] }, { filtersPath: file })
  assert.equal(first.added, true)
  const second = addFilter({ from: '*@z.com', comment: 'Z', fileinto: ['Work'] }, { filtersPath: file })
  assert.equal(second.added, false)

  const loaded = loadFilters(file)
  assert.equal(loaded.length, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})
