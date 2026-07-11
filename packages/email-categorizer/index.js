/**
 * email-categorizer — public API.
 * AI classification + the filters.js rule collection + orchestration.
 */
module.exports = {
  ...require('./lib/patterns'),
  ...require('./lib/actions'),
  ...require('./lib/build'),
  ...require('./lib/classifier'),
  ...require('./lib/categorize'),
  collection: require('./lib/collection'),
}
