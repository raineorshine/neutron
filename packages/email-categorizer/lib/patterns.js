/**
 * Deterministic sender-pattern derivation (spec §4 table).
 *
 * The AI model picks the *label*; this code derives the safe *pattern*. Given a
 * `From` value it returns the most general wildcard that still only matches the
 * intended sender.
 */

/**
 * Domains shared by many unrelated senders. For these we must use the exact
 * address — a `*@domain` wildcard would over-match. (From the add-email-filter
 * skill.)
 */
const SHARED_DOMAINS = new Set(['gmail.com', 'outlook.com', 'yahoo.com', 'protonmail.com', 'proton.me', 'icloud.com', 'hotmail.com', 'substack.com', 'ccsend.com', 'stripe.com'])

/** Known multi-part public suffixes so we don't treat `co.uk` as the domain. */
const MULTI_PART_TLDS = new Set(['co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'co.nz', 'co.za'])

/**
 * Extracts a bare, lowercased email address from a `From` value that may be
 * `Name <addr@x.com>` or just `addr@x.com`.
 * @param {string} from
 * @returns {string} the address, or '' if none found
 */
function extractAddress(from) {
  if (!from) return ''
  const angle = from.match(/<([^>]+)>/)
  const raw = (angle ? angle[1] : from).trim().toLowerCase()
  const at = raw.match(/[^\s<>]+@[^\s<>]+/)
  return at ? at[0] : ''
}

/**
 * Returns the registrable domain of a host, honoring known multi-part TLDs.
 * `email.nordstrom.com` → `nordstrom.com`; `foo.co.uk` → `foo.co.uk`.
 * @param {string} host
 * @returns {string}
 */
function registrableDomain(host) {
  const labels = host.split('.')
  if (labels.length <= 2) return host
  const lastTwo = labels.slice(-2).join('.')
  if (MULTI_PART_TLDS.has(lastTwo)) return labels.slice(-3).join('.')
  return lastTwo
}

/**
 * Derives the most general safe sender pattern for a `From` value.
 *
 * - Shared domain (gmail, etc.) → exact address.
 * - Sender on a subdomain (marketing subdomains vary) → `*@*.domain.com`.
 * - Otherwise → `*@domain.com`.
 *
 * @param {string} from a `From` header value or bare address
 * @returns {string} the sieve `from` pattern
 */
function deriveSenderPattern(from) {
  const address = extractAddress(from)
  if (!address) return from ? from.trim().toLowerCase() : ''

  const host = address.split('@')[1]
  if (!host) return address

  if (SHARED_DOMAINS.has(host)) return address

  const domain = registrableDomain(host)
  if (SHARED_DOMAINS.has(domain)) return address

  // Host has a subdomain beyond the registrable domain → wildcard the subdomain.
  if (host !== domain) return `*@*.${domain}`

  return `*@${domain}`
}

module.exports = {
  deriveSenderPattern,
  extractAddress,
  registrableDomain,
  SHARED_DOMAINS,
}
