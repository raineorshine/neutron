# neutron

An AI-driven email categorizer for ProtonMail. On each incoming email, neutron
classifies it, applies a label to the existing message, and generates a durable
sieve rule so future mail from the same sender self-categorizes. See
[`spec.md`](./spec.md) for the full design.

## Packages

- **`packages/protonmail-client`** — all ProtonMail web automation and the
  persistent Playwright auth session (read mail, label/move, deploy sieve
  filters). The only place selectors live.
- **`packages/email-categorizer`** — AI classification, the `filters.js` rule
  collection, in-process sieve build, and orchestration. Depends on
  `protonmail-client` (workspace) and
  [`sieve-builder`](https://github.com/raineorshine/sieve-builder) (github dep).

## Setup

```sh
npm install
npx playwright install chromium
export ANTHROPIC_API_KEY=sk-...        # used by the classifier
```

The first ProtonMail run needs an interactive login (the persistent session is
saved to `.playwright-user-data`, gitignored). Run any command once with
`--headed` and complete the login:

```sh
npm run categorize --workspace=email-categorizer -- --headed --dry-run
```

You must also create the `sieve-builder-1`, `sieve-builder-2`, … custom filters
once in ProtonMail Settings (deploy replaces their contents by name).

## Usage

Categorize recent inbox mail (classify → label/move now → write + deploy a
durable rule):

```sh
npm run categorize            # from repo root
# options: --limit N  --folder inbox  --min-confidence 0.6  --dry-run  --headed
```

Plain deploy flow (no AI): edit `packages/email-categorizer/filters.js` by hand,
then:

```sh
npm run deploy
```

## Personal data

`filters.js`, `.playwright-user-data`, and `out/` are gitignored and must never
be committed. `filters.js` is seeded from `filters.sample.js` on first run.

## Tests

```sh
npm test
```
