const { test } = require('node:test')
const assert = require('node:assert')
const { buildChunks } = require('../lib/build')

// Fake sieve-builder so the test needs no github dependency.
const fakeSieve = {
  Header: 'HEADER\n',
  MultiRule: f => `RULE[${f.conditions.join(',')}]`,
}

test('buildChunks produces a single named chunk for small input', () => {
  const filters = [
    { conditions: ['a'], actions: [] },
    { conditions: ['b'], actions: [] },
  ]
  const chunks = buildChunks(filters, { sieve: fakeSieve })
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].name, 'sieve-builder-1')
  assert.ok(chunks[0].content.startsWith('HEADER\n'))
  assert.ok(chunks[0].content.includes('RULE[a]'))
  assert.ok(chunks[0].content.includes('RULE[b]'))
})

test('buildChunks splits into multiple chunks past maxSize, each with header', () => {
  const filters = [
    { conditions: ['a'], actions: [] },
    { conditions: ['b'], actions: [] },
    { conditions: ['c'], actions: [] },
  ]
  // Header is 7 chars; each rule ~8 chars. maxSize 20 forces ~1 rule per chunk.
  const chunks = buildChunks(filters, { sieve: fakeSieve, maxSize: 20 })
  assert.ok(chunks.length >= 2)
  chunks.forEach((c, i) => {
    assert.equal(c.name, `sieve-builder-${i + 1}`)
    assert.ok(c.content.startsWith('HEADER\n'))
  })
  const joined = chunks.map(c => c.content).join('')
  assert.ok(joined.includes('RULE[a]') && joined.includes('RULE[b]') && joined.includes('RULE[c]'))
})

test('buildChunks returns empty for no filters', () => {
  assert.deepEqual(buildChunks([], { sieve: fakeSieve }), [])
})

test('buildChunks respects a custom prefix', () => {
  const chunks = buildChunks([{ conditions: ['a'], actions: [] }], {
    sieve: fakeSieve,
    prefix: 'custom-',
  })
  assert.equal(chunks[0].name, 'custom-1')
})
