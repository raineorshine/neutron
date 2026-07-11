/**
 * protonmail-client
 *
 * Sole owner of all ProtonMail web automation and the persistent Playwright
 * auth session. Everything that touches ProtonMail's brittle selectors or login
 * state lives here so there is exactly one place to maintain it.
 *
 * ProtonMail has no public API for these operations; this is UI automation and
 * is inherently brittle. All selectors are centralized in SELECTORS below.
 */
const path = require('path')
const { chromium } = require('playwright')

const ACCOUNT_FILTERS_URL = 'https://account.proton.me/u/0/mail/filters'
const MAIL_URL = 'https://mail.proton.me/u/0'

/** Persistent Playwright profile dir at the neutron repo root (gitignored). */
const USER_DATA_DIR = path.join(__dirname, '..', '..', '.playwright-user-data')

const FILTER_NAME_PREFIX = 'sieve-builder-'

/**
 * Centralized selectors. ProtonMail ships no stable API, so these are the most
 * brittle part of the whole project. Update them here and nowhere else.
 */
const SELECTORS = {
  // Mail list view
  mailItem: '[data-testid="message-list"] [data-element-id], .items-column-list [data-element-id]',
  itemSender: '[data-testid="message-column:sender-address"], .item-senders',
  itemSubject: '[data-testid="message-column:subject"], .subject',
  itemSnippet: '.item-subfolders, [data-testid="message-list:message-snippet"], .subject-preview',
  itemTime: 'time',
  // Message toolbar actions (visible when a message/conversation is open)
  labelButton: 'button[data-testid="toolbar:label-dropdown"], button[aria-label="Label as"]',
  moveButton: 'button[data-testid="toolbar:moveto-dropdown"], button[aria-label="Move to"]',
  dropdownOption: '[role="menuitem"], [role="checkbox"]',
  dropdownApply: 'button[data-testid="label-dropdown:apply"], button[type="submit"]',
  // Filters view
  filterEditButton: name => `button[aria-label*="${name}"]`,
  filterTextarea: 'textarea',
  filterSaveButton: 'Save',
}

/**
 * Opens one persistent browser context and returns a client bound to a single
 * page. Callers perform multiple operations (read + label + deploy) and then
 * call `close()` once. First run requires an interactive login; the session
 * persists in USER_DATA_DIR for subsequent (headless) runs.
 *
 * @param {{ headless?: boolean, viewport?: { width: number, height: number } }} [options]
 * @returns {Promise<ProtonMailClient>}
 */
async function createClient(options = {}) {
  const { headless = true, viewport = { width: 1280, height: 900 } } = options

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless,
    viewport,
  })
  const page = context.pages()[0] || (await context.newPage())

  /** @typedef {{ id: string, from: string, subject: string, receivedAt: string, snippet: string }} Email */

  /**
   * Reads the Mail list view and returns recent messages.
   * @param {{ limit?: number, folder?: string }} [params]
   * @returns {Promise<Email[]>}
   */
  async function getRecentEmails({ limit = 20, folder = 'inbox' } = {}) {
    await page.goto(`${MAIL_URL}/${folder}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    })
    await page
      .locator(SELECTORS.mailItem)
      .first()
      .waitFor({ timeout: 30000 })
      .catch(() => {})

    // Only plain string selectors may cross into the browser context — $$eval
    // JSON-serializes args, so SELECTORS (which holds a function) can't be passed.
    const sel = {
      itemSender: SELECTORS.itemSender,
      itemSubject: SELECTORS.itemSubject,
      itemSnippet: SELECTORS.itemSnippet,
      itemTime: SELECTORS.itemTime,
    }
    const emails = await page.$$eval(
      SELECTORS.mailItem,
      (items, sel) =>
        items.map(item => {
          const text = s => {
            const el = item.querySelector(s)
            return el ? el.textContent.trim() : ''
          }
          const timeEl = item.querySelector(sel.itemTime)
          return {
            id: item.getAttribute('data-element-id') || item.id || '',
            from: text(sel.itemSender),
            subject: text(sel.itemSubject),
            receivedAt: timeEl ? timeEl.getAttribute('datetime') || timeEl.textContent.trim() : '',
            snippet: text(sel.itemSnippet),
          }
        }),
      sel,
    )

    return emails.filter(e => e.id).slice(0, limit)
  }

  /**
   * Parses existing ProtonMail custom filters. Port of
   * parse-protonmail-filters.js: reads the filters table and returns each
   * sender/label pair so callers can detect duplicates / current state.
   * @returns {Promise<{ from: string, label: string }[]>}
   */
  async function parseFilters() {
    await page.goto(ACCOUNT_FILTERS_URL, {
      waitUntil: 'networkidle',
      timeout: 30000,
    })

    return page.$$eval('td > [title]', cells =>
      cells
        .map(el => el.textContent)
        .filter(text => text.includes(' - '))
        .map(text => {
          const [from, label] = text.split(' - ')
          return { from: from.trim(), label: label.trim() }
        }),
    )
  }

  /** Opens a single message/conversation in the Mail view by its element id. */
  async function openEmail(emailId) {
    await page.locator(`[data-element-id="${emailId}"]`).first().click()
    await page.locator(`${SELECTORS.labelButton}, ${SELECTORS.moveButton}`).first().waitFor({ timeout: 10000 })
  }

  /**
   * Labels the existing message. Corresponds to the sieve `fileinto "<Label>"`
   * action the categorizer emits.
   * @param {string} emailId
   * @param {string} label
   */
  async function applyLabel(emailId, label) {
    await openEmail(emailId)
    await page.locator(SELECTORS.labelButton).first().click()
    await page
      .locator(SELECTORS.dropdownOption)
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`) })
      .first()
      .click()
    const apply = page.locator(SELECTORS.dropdownApply).first()
    if (await apply.count()) await apply.click()
  }

  /**
   * Moves the existing message to a folder. Archive/trash are modeled as
   * folders to match the sieve `fileinto "archive"` / `fileinto "trash"`
   * semantics.
   * @param {string} emailId
   * @param {string} folder e.g. 'archive', 'trash', or a custom folder name
   */
  async function moveToFolder(emailId, folder) {
    await openEmail(emailId)
    await page.locator(SELECTORS.moveButton).first().click()
    await page
      .locator(SELECTORS.dropdownOption)
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(folder)}\\s*$`, 'i') })
      .first()
      .click()
  }

  /**
   * Deploys named sieve chunks to the pre-existing `sieve-builder-N` custom
   * filters. Port of deploySieveFilter(): open each named filter, replace the
   * textarea content, save, confirm.
   * @param {{ name: string, content: string }[]} namedChunks
   */
  async function deploy(namedChunks) {
    if (!namedChunks || namedChunks.length === 0) throw new Error('deploy: no chunks provided')

    await page.goto(ACCOUNT_FILTERS_URL, {
      waitUntil: 'networkidle',
      timeout: 30000,
    })
    await page.locator(SELECTORS.filterEditButton(FILTER_NAME_PREFIX)).first().waitFor({ timeout: 120000 })

    for (const { name, content } of namedChunks) {
      const editButton = page.locator(SELECTORS.filterEditButton(name))
      await editButton.waitFor({ timeout: 30000 })
      await editButton.click()

      const textarea = page.locator(SELECTORS.filterTextarea)
      await textarea.waitFor({ timeout: 10000 })
      await textarea.press('ControlOrMeta+a')
      await textarea.fill(content)

      await page.getByRole('button', { name: SELECTORS.filterSaveButton }).click()
      await page.getByText(`Filter ${name} updated`).waitFor({ timeout: 10000 })
      console.info(`  ✓ ${name} updated`)
    }
  }

  async function close() {
    await context.close()
  }

  /**
   * @typedef {Object} ProtonMailClient
   * @property {typeof getRecentEmails} getRecentEmails
   * @property {typeof parseFilters} parseFilters
   * @property {typeof applyLabel} applyLabel
   * @property {typeof moveToFolder} moveToFolder
   * @property {typeof deploy} deploy
   * @property {typeof close} close
   * @property {import('playwright').Page} page
   * @property {import('playwright').BrowserContext} context
   */
  return {
    getRecentEmails,
    parseFilters,
    applyLabel,
    moveToFolder,
    deploy,
    close,
    page,
    context,
  }
}

/**
 * Convenience lifecycle wrapper: open one context, run `fn(client)`, always
 * close. Prefer this so a context is never leaked.
 * @template T
 * @param {(client: ProtonMailClient) => Promise<T>} fn
 * @param {Parameters<typeof createClient>[0]} [options]
 * @returns {Promise<T>}
 */
async function withClient(fn, options) {
  const client = await createClient(options)
  try {
    return await fn(client)
  } finally {
    await client.close()
  }
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

module.exports = {
  createClient,
  withClient,
  USER_DATA_DIR,
  FILTER_NAME_PREFIX,
  SELECTORS,
}
