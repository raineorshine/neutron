const { test } = require('node:test')
const assert = require('node:assert')
const { deriveSenderPattern, extractAddress, registrableDomain } = require('../lib/patterns')

test('extractAddress handles Name <addr> and bare addr', () => {
  assert.equal(extractAddress('Sweetgreen <no-reply@sweetgreen.com>'), 'no-reply@sweetgreen.com')
  assert.equal(extractAddress('no-reply@sweetgreen.com'), 'no-reply@sweetgreen.com')
  assert.equal(extractAddress('MixedCase@Example.COM'), 'mixedcase@example.com')
  assert.equal(extractAddress(''), '')
})

test('registrableDomain strips subdomains and honors multi-part TLDs', () => {
  assert.equal(registrableDomain('sweetgreen.com'), 'sweetgreen.com')
  assert.equal(registrableDomain('email.nordstrom.com'), 'nordstrom.com')
  assert.equal(registrableDomain('marketing.mail.chase.com'), 'chase.com')
  assert.equal(registrableDomain('foo.co.uk'), 'foo.co.uk')
  assert.equal(registrableDomain('news.foo.co.uk'), 'foo.co.uk')
})

test('unique domain, any local part → *@domain.com', () => {
  assert.equal(deriveSenderPattern('no-reply@sweetgreen.com'), '*@sweetgreen.com')
})

test('subdomain varies → *@*.domain.com', () => {
  assert.equal(deriveSenderPattern('deals@email.nordstrom.com'), '*@*.nordstrom.com')
})

test('shared domain → exact address', () => {
  assert.equal(deriveSenderPattern('Someone <someone@gmail.com>'), 'someone@gmail.com')
  assert.equal(deriveSenderPattern('friend@proton.me'), 'friend@proton.me')
  assert.equal(deriveSenderPattern('billing@stripe.com'), 'billing@stripe.com')
})

test('empty / malformed input is handled', () => {
  assert.equal(deriveSenderPattern(''), '')
  assert.equal(deriveSenderPattern('not-an-email'), 'not-an-email')
})
