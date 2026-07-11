/**
 * AI classification (spec §3.3). Given `{ from, subject, snippet }` the model
 * returns a structured `{ label, action, confidence, reasoning }`. It picks the
 * *label* and *action* only — the sender *pattern* is derived deterministically
 * in patterns.js.
 *
 * The provider is Anthropic Claude, read from `ANTHROPIC_API_KEY`. A client can
 * be injected for testing so the decision logic runs without network or a key.
 */
const { ACTIONS } = require('./actions')

/** Label taxonomy (from the add-email-filter skill §3). */
const LABELS = ['Art', 'Birds', 'Cybersemics', 'Development', 'Dog', 'Education', 'Events', 'Family', 'Fashion', 'Film', 'Finance', 'Friends', 'Health', 'Legal', 'Products', 'Receipts', 'Taxes', 'Travel', 'Work']

const DEFAULT_MODEL = 'claude-3-5-sonnet-latest'

const SYSTEM_PROMPT = `You are an email triage assistant for a single user's ProtonMail inbox.
Classify one email into exactly one label and one action.

Allowed labels: ${LABELS.join(', ')}.
Allowed actions:
- "categorize-only": file under the label, keep in inbox (important mail to see).
- "categorize-and-archive": file under the label and archive (reference/receipts/newsletters worth keeping but not in inbox).
- "trash": junk/spam that cannot be unsubscribed; the label is ignored.

Respond with ONLY a JSON object, no prose, of the form:
{"label": "<one label>", "action": "<one action>", "confidence": <0..1>, "reasoning": "<short>"}
Set confidence to your certainty in the label+action (0 = guess, 1 = certain).`

/**
 * Lazily constructs the default Anthropic client. Throws a helpful error if the
 * SDK or API key is unavailable.
 * @returns {{ messages: { create: Function } }}
 */
function defaultClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Set it, or pass a `client` to classify() (see lib/classifier.js).')
  }
  let Anthropic
  try {
    Anthropic = require('@anthropic-ai/sdk')
  } catch (err) {
    throw new Error('Could not load @anthropic-ai/sdk. Run `npm install`. Original: ' + err.message)
  }
  return new Anthropic({ apiKey })
}

/** Extracts the JSON object from a model text response. */
function parseResponse(text) {
  const match = text && text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Classifier returned no JSON: ' + text)
  const parsed = JSON.parse(match[0])
  if (!ACTIONS.includes(parsed.action)) throw new Error(`Classifier returned invalid action: ${parsed.action}`)
  if (parsed.action !== 'trash' && !LABELS.includes(parsed.label)) {
    throw new Error(`Classifier returned invalid label: ${parsed.label}`)
  }
  return {
    label: parsed.action === 'trash' ? null : parsed.label,
    action: parsed.action,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    reasoning: parsed.reasoning || '',
  }
}

/**
 * Classifies one email.
 * @param {{ from: string, subject: string, snippet: string }} email
 * @param {{ client?: any, model?: string }} [opts]
 * @returns {Promise<{ label: string|null, action: string, confidence: number, reasoning: string }>}
 */
async function classify(email, opts = {}) {
  const client = opts.client || defaultClient()
  const model = opts.model || DEFAULT_MODEL

  const response = await client.messages.create({
    model,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `From: ${email.from}\nSubject: ${email.subject}\nSnippet: ${email.snippet || ''}`,
      },
    ],
  })

  const text = Array.isArray(response.content) ? response.content.map(c => c.text || '').join('') : String(response.content || '')
  return parseResponse(text)
}

module.exports = {
  classify,
  parseResponse,
  LABELS,
  DEFAULT_MODEL,
  SYSTEM_PROMPT,
}
