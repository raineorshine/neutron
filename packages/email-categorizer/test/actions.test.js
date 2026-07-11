const { test } = require('node:test')
const assert = require('node:assert')
const { resolveAction, ACTIONS } = require('../lib/actions')
const { parseResponse } = require('../lib/classifier')

test('resolveAction: categorize-only labels and keeps in inbox', () => {
  assert.deepEqual(resolveAction('Health', 'categorize-only'), {
    fileinto: ['Health'],
    label: 'Health',
    move: null,
  })
})

test('resolveAction: categorize-and-archive labels and archives', () => {
  assert.deepEqual(resolveAction('Receipts', 'categorize-and-archive'), {
    fileinto: ['archive', 'Receipts'],
    label: 'Receipts',
    move: 'archive',
  })
})

test('resolveAction: trash moves to trash, ignores label', () => {
  assert.deepEqual(resolveAction(null, 'trash'), {
    fileinto: ['trash'],
    label: null,
    move: 'trash',
  })
})

test('resolveAction: label-requiring actions throw without a label', () => {
  assert.throws(() => resolveAction(null, 'categorize-only'), /requires a label/)
})

test('ACTIONS enum is the documented set', () => {
  assert.deepEqual(ACTIONS, ['categorize-only', 'categorize-and-archive', 'trash'])
})

test('parseResponse extracts JSON and normalizes trash label to null', () => {
  const r = parseResponse('here you go {"label":"Work","action":"trash","confidence":0.9,"reasoning":"spam"} done')
  assert.equal(r.label, null)
  assert.equal(r.action, 'trash')
  assert.equal(r.confidence, 0.9)
})

test('parseResponse validates action and label', () => {
  assert.throws(() => parseResponse('{"label":"Work","action":"nope","confidence":1}'), /invalid action/)
  assert.throws(() => parseResponse('{"label":"Nonsense","action":"categorize-only","confidence":1}'), /invalid label/)
})

test('parseResponse throws when no JSON present', () => {
  assert.throws(() => parseResponse('no json here'), /no JSON/)
})
