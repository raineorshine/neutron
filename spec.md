# neutron — Spec

An AI-driven email categorizer for ProtonMail. On each incoming email, neutron
classifies it, applies a label to the existing message, and generates a durable
sieve rule so future mail from the same sender self-categorizes. Sieve
generation is delegated to the existing [`sieve-builder`](https://github.com/raineorshine/sieve-builder)
project; ProtonMail web automation lives in a dedicated package.

Single-user tool. Optimize for simplicity over generality.

---

## 1. Project structure

Two repositories.

### `sieve-builder` (existing public repo — slimmed to a pure builder)

`sieve-builder` is an **external dependency**, not part of this repo. It is a
pure builder: declarative filter spec → sieve script chunks, with no ProtonMail
or Playwright code. It is being slimmed down to that role in its own repo (the
ProtonMail deployment scripts and the `add-email-filter` skill are moving here);
that work is tracked separately and is out of scope for this spec.

neutron consumes it via a GitHub dependency and relies on this API (present or
being added in `sieve-builder`):

- `Sieve(filters)` → full sieve script string.
- `Header`, `MultiRule` — building blocks.
- `outDir` — default output directory.
- A callable chunking function (not just the `bin.js` CLI) so neutron can build
  chunks in-process (see §3.1).
- `addFilter(entry)` — append a rule to the collection programmatically (see §3.1).

### `neutron` (new public monorepo — npm workspaces)

```
neutron/
├── package.json                # workspaces root, private
├── .gitignore                  # filters.js, .playwright-user-data, out/, node_modules
├── spec.md
├── packages/
│   ├── protonmail-client/      # ProtonMail web automation + auth
│   └── email-categorizer/      # AI classification + rule collection + orchestration
```

- Public repo. Personal data stays out of git via `.gitignore` (same pattern
  `sieve-builder` already uses successfully).
- npm workspaces: one `npm install` at the root, workspace-local dependency
  resolution, **no npm publish and no version churn** between the two packages.
- `email-categorizer` consumes `sieve-builder` via a GitHub dependency:
  `"sieve-builder": "github:raineorshine/sieve-builder"`. No npm publish needed.

**Dependency graph:**

```
sieve-builder (pure, public repo)
        ▲
        │ github: dep
        │
email-categorizer ──workspace dep──▶ protonmail-client
```

`protonmail-client` does **not** depend on `sieve-builder` — it only pushes
opaque sieve text chunks. `email-categorizer` is the only thing that pulls both
together.

---

## 2. Package: `protonmail-client`

Sole owner of all ProtonMail web automation and the persistent Playwright auth
session. Everything that touches ProtonMail's brittle selectors or login state
lives here so there is exactly one place to maintain it. Consumed by the
categorizer and by the plain deploy flow.

### 2.1 Auth / session

- Reuse the existing persistent-context approach from the current
  `deploy-filters.js`: `chromium.launchPersistentContext(userDataDir, …)`.
- `userDataDir` is `.playwright-user-data` at the neutron repo root (gitignored).
  First run requires a manual interactive login; the session persists for
  subsequent headless runs.
- Expose a single browser/context lifecycle helper so callers open one context,
  perform multiple operations (read + label + deploy), and close once.

### 2.2 API surface

Read:

- `getRecentEmails({ limit, folder })` → array of
  `{ id, from, subject, receivedAt, snippet }`. Reads the Mail view.
- `parseFilters()` → existing ProtonMail custom filters (port of
  `parse-protonmail-filters.js`). Used to detect duplicates / current state.

Write (per-email, Mail view):

- `applyLabel(emailId, label)` — label the existing message.
- `moveToFolder(emailId, folder)` — e.g. move to `archive` / a folder.
  (Model archive/trash as folders to match the sieve `fileinto` semantics.)

Write (filters, Settings view):

- `deploy(namedChunks)` where `namedChunks` is
  `[{ name: 'sieve-builder-1', content: '…' }, …]`. Port the existing
  `deploySieveFilter()` logic: open each named filter, replace textarea
  content, save, confirm. Preserve the `sieve-builder-N` naming and the
  one-time manual setup of those filters in ProtonMail.

### 2.3 Notes / risks

- ProtonMail has no public API for these operations; this is UI automation and
  is inherently brittle. Keep selectors centralized here.
- The Mail view (labeling) and the Settings/Filters view (deploy) are different
  screens of the same app under the same auth — both belong in this package.
- Confirm ProtonMail label/folder semantics: a "label" vs a "folder/move" may be
  distinct UI actions. Match them to the sieve actions the categorizer emits
  (`fileinto "<Label>"`, `fileinto "archive"`, `fileinto "trash"`).

---

## 3. Package: `email-categorizer`

Owns AI classification, the `filters.js` rule collection, and orchestration.
Depends on `protonmail-client` (workspace) and `sieve-builder` (github:).
Contains no Playwright code and no ProtonMail selectors — it calls
`protonmail-client` for all mail I/O.

### 3.1 The rule collection (`filters.js`)

- `filters.js` lives in this package and is **gitignored** (personal data).
- It is the same format `sieve-builder` consumes today (array of
  `{ conditions, actions }`), and the same file the categorizer appends to and
  builds/deploys from.
- Provide `addFilter(entry)` (backed by `sieve-builder`'s helper or implemented
  here) that appends a new filter object to `filters.js` programmatically —
  handling section placement, wildcard patterns, and duplicate checks per the
  rules currently encoded in the `add-email-filter` skill (§4).
- Build in-process: call `sieve-builder`'s chunking function to produce
  `[{ name, content }]`, then hand to `protonmailClient.deploy()`. (Replaces the
  old `execSync('node bin.js filters.js')` shell-out.)

### 3.2 Categorization flow

For each newly fetched email:

1. **Fetch** — `protonmailClient.getRecentEmails()`.
2. **Skip** if a matching filter already exists (sender already handled).
3. **Classify** — AI decides a `label` and an `action`
   (`categorize-only` | `categorize-and-archive` | `trash`) from the email's
   sender, subject, and snippet. Reuse the label taxonomy and archive-behavior
   conventions from the existing skill (Art, Birds, …, Work; `['Label']` vs
   `['Label', 'archive']` vs `['trash']`).
4. **Act now (immediate write path)** —
   `protonmailClient.applyLabel(email.id, label)` and, if archiving,
   `moveToFolder(email.id, 'archive')`. This handles the message already in the
   inbox.
5. **Automate the future (durable write path)** — derive the most general safe
   sender pattern (wildcard rules from §4), `addFilter()` it into `filters.js`,
   then build + `deploy()` so future mail from that sender auto-files.
6. **Log / report** — which label, which pattern, which emails were acted on.

The label chosen in step 3 is shared between step 4 (applied to the current
email) and step 5 (encoded in the sieve rule) so present and future behavior
match.

### 3.3 AI integration (to be detailed)

- Model/provider choice: TBD (open question §6).
- Prompt takes `{ from, subject, snippet }` and returns structured
  `{ label, action, senderPattern, reasoning }`.
- Wildcard/pattern derivation should follow the deterministic table in §4
  rather than being left entirely to the model; the model picks the *label*,
  code derives the safe *pattern*.

### 3.4 Trigger model (to be detailed)

How incoming email is detected/triggered is an open question (§6). Candidates:

- Manual/on-demand run over the last N inbox emails.
- Scheduled poll (cron) that processes anything new since the last run.
- (No push webhook available from ProtonMail.)

Start with on-demand, add polling later if desired.

---

## 4. Skill + plain deploy flow (moved from `sieve-builder`)

- The `add-email-filter` skill moves into neutron (categorizer package). Its
  logic — sender extraction, wildcard-pattern table, label/archive decision,
  placement, duplicate check, "do not commit `filters.js`", and final deploy —
  becomes the basis for both the manual skill and the categorizer's automated
  `addFilter()` + build + deploy.
- The **plain deploy flow** (edit `filters.js` → build → deploy, no AI) still
  works and lives in neutron since `filters.js` lives there. Provide a
  `deploy` script at the categorizer package (and/or root) that builds chunks
  via `sieve-builder` and pushes via `protonmail-client`.

---

## 5. Migration checklist

The ProtonMail scripts and the `add-email-filter` skill have already been moved
out of `sieve-builder` into this repo (unwired):

- `packages/protonmail-client/deploy-filters.js`
- `packages/protonmail-client/parse-protonmail-filters.js`
- `packages/email-categorizer/skills/add-email-filter/SKILL.md`

Remaining work:

1. `neutron`: init workspaces root `package.json`, `.gitignore`
   (`filters.js`, `.playwright-user-data`, `out/`, `node_modules`), and the two
   package `package.json`s.
2. `protonmail-client`: refactor the two moved scripts into the API in §2.2;
   centralize the persistent-context auth.
3. `email-categorizer`: create the (gitignored) `filters.js`; wire
   `sieve-builder` (github:) + `protonmail-client` (workspace); implement
   `addFilter()`, in-process build, and the plain deploy script. Decide the
   skill's final home (package vs `.github/skills/` for Copilot discovery).
4. Implement the categorization flow (§3.2) + AI integration (§3.3).
5. Decide + implement the trigger model (§3.4).

> Note: the `sieve-builder` slim-down (removing its `deploy` script, `playwright`
> dep, README deploy sections; adding `addFilter()` / exposed chunking) is
> tracked in the `sieve-builder` repo and is out of scope here.

---

## 6. Open questions

- **AI provider/model** for classification (local vs hosted; cost; latency).
- **Trigger**: on-demand vs scheduled poll; how "new since last run" is tracked.
- **Label vs move** exact ProtonMail UI semantics for the immediate write path.
- **Confidence handling**: what to do on low-confidence classifications
  (skip? queue for manual review? label only, no sieve rule?).
- **Idempotency**: ensure re-running doesn't double-label or duplicate rules
  (leaning on `parseFilters()` + `filters.js` duplicate checks).
