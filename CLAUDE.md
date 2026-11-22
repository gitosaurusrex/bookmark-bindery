# Notes for Claude Code

Bookmark Bindery: a bookmarks editor in one file, `index.html` (markup, CSS and one vanilla-JS IIFE; no framework, no
dependencies, no build), plus the optional Bindery Assist AI helper, a Cloudflare Worker in `worker/`. Start with
`README.md` for behaviour and `docs/technical.md` for internals and the code map.

## Commands

- Worker tests: `node --test worker/test/*.mjs` (no install needed). The app itself has no tests yet (#15).
- README screenshots: `node scripts/screenshots.mjs` (Playwright with Chromium; uses `scripts/demo-bookmarks.html`).
- Point the page at a Worker, or turn Assist off: `node scripts/set-ai-endpoint.mjs <https://origin> | off`. Never
  edit the `bindery-ai` meta tag or the CSP `connect-src` by hand; the script keeps them in step.

## Rules the code depends on

- The CSP's `connect-src` names only the Worker's origin (`'none'` when Assist is off). Don't add other origins.
- Every AI entry point goes through `withAI()` (the consent sheet). Bookmark data sent to the Worker goes through
  `aiItem()`/`sendableUrl()` (host and path only); the full-address exceptions are listed in the README's "What's sent"
  table. Update that table when what's sent changes.
- Every edit goes through `mutate()` so it's one undo step; replace `attrs` with `setAttr()`, never change them in
  place (undo snapshots share them).
- The sidebar storage note (`renderDevice()`) says "Nothing is uploaded" only while Assist is off.
- Worker fetches of outside pages go through `fetchPublic()`: `redirect: 'manual'`, every hop and icon address
  checked with `pageUrl()`. The test fake (`fakeWeb`) asserts `redirect: 'manual'`. Hostname-only checks are a known
  gap (#16).

## Docs

`README.md`, `docs/technical.md` and `worker/README.md` describe behaviour in detail, including limits and numbers
("Numbers worth knowing"). Keep them in step with code changes in the same PR. Prose is hard-wrapped at 120 columns.

## Deploying

- **Page:** Render serves `main` as a static site (https://bookmark-bindery.onrender.com). It picked up the #13
  merge on its own; after a merge, check with `curl` that the live `index.html` matches `main`.
- **Worker:** not automatic. Run `npx wrangler@4 deploy` from `worker/` after Worker changes reach `main`.
  - First compare the live bindings (Cloudflare API `GET /accounts/<id>/workers/scripts/bookmark-bindery-ai/settings`)
    with `wrangler.toml`: a deploy replaces plain variables with the file's.
  - In a cloud session whose proxy injects Cloudflare credentials: set `CLOUDFLARE_API_TOKEN` to a dummy value,
    `CLOUDFLARE_ACCOUNT_ID` from `GET /client/v4/accounts`, and `NODE_EXTRA_CA_CERTS` to the proxy's CA bundle.
  - To verify, download the deployed code from `.../scripts/bookmark-bindery-ai/content/v2` (not `/content`).
    Wrangler bundles the code, so compare distinctive identifiers, not bytes.

## Backlog

Open work lives in GitHub issues: app tests (#15), resolved-IP checks in the Worker (#16), an end-to-end check of the
live AI features (#17), and importing exports into each browser (#18).
