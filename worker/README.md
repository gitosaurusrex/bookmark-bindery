# Bindery Assist Worker

The Cloudflare Worker behind Bookmark Bindery's optional AI features: **Tidy into folders**, **Suggest a name** and
**Clean up titles**. Bindery works fully without it. Until a site is pointed at a Worker, the AI features don't appear.

## What it does with bookmarks

For each action, the page sends only the bookmarks that action is for: their titles, and their addresses cut down to
site and path (no query string or fragment, nothing for bookmarklets or local files). The Worker builds a prompt, asks
a [Workers AI](https://developers.cloudflare.com/workers-ai/) model for JSON, checks the reply against what was sent
(real bookmark numbers, each used once, short names), and returns it. It doesn't store requests and doesn't log
bookmark content.

It only answers pages listed in `ALLOWED_ORIGINS`, accepts at most 150 items and 96 KB per request, and, with the rate
limit binding in `wrangler.toml`, allows 20 requests a minute per visitor.

| Endpoint | Sends | Returns |
| --- | --- | --- |
| `POST /v1/tidy` | `{ folder, existing: [subfolder names], items: [{ title, url }] }` (up to 150) | `{ folders: [{ name, items: [index] }] }` |
| `POST /v1/name` | `{ current, items }` (up to 60) | `{ names: [up to 3] }` |
| `POST /v1/titles` | `{ items }` (up to 100) | `{ titles: [{ item: index, title }] }`, changed titles only |

## Deploy

You need a Cloudflare account with Workers AI. From this folder:

```bash
npx wrangler@4 login
```

```bash
npx wrangler@4 deploy
```

Wrangler prints the Worker's address, like `https://bookmark-bindery-ai.<your-subdomain>.workers.dev`. Then, from the
repo root, point the page at it and publish the change:

```bash
node scripts/set-ai-endpoint.mjs https://bookmark-bindery-ai.<your-subdomain>.workers.dev
```

That sets the address in `index.html` in both places that must agree: the `bindery-ai` meta tag the page reads, and
the Content Security Policy's `connect-src`, which stays the only address the page can connect to.
`node scripts/set-ai-endpoint.mjs off` turns Assist off again.

If you host Bindery somewhere other than `https://bookmark-bindery.onrender.com`, change `ALLOWED_ORIGINS` in
`wrangler.toml` before deploying. `namespace_id` for the rate limit must be unique in your Cloudflare account. The
`[[ratelimits]]` block needs Wrangler 4.36 or later. Set `MODEL` to try a different Workers AI text model.

## Test

```bash
node --test worker/test/*.mjs
```

The tests run the Worker in Node with a fake model: origin checks, limits, rate limiting, reply validation, and the
fallback when JSON mode fails.
