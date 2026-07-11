/**
 * filters.sample.js — template for the (gitignored) filters.js rule collection.
 *
 * Copy to filters.js (the categorizer does this automatically on first run):
 *   cp filters.sample.js filters.js
 *
 * Format is the array of { conditions, actions } that sieve-builder consumes.
 * A condition may be a bare string (from-only shorthand) or an object
 * { comment, from, subject }. Actions carry a `fileinto` array whose entries
 * are label names plus the special folders `archive` and `trash`.
 */
const filters = [
  // Receipts (archive)
  {
    conditions: [
      {
        comment: 'Grubhub Receipt',
        from: 'noreply@grubhub.com',
        subject: 'Here is your Grubhub Receipt',
      },
    ],
    actions: [{ fileinto: ['archive', 'Receipts'] }],
  },
]

module.exports = filters
