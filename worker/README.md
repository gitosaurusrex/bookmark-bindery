# Bindery Assist Worker

The Cloudflare Worker behind Bookmark Bindery's optional AI features: **Tidy into folders**, **Suggest a name**, **Clean
up titles**, reading a page's name and icon and suggesting a folder for **New bookmark**, writing a bookmark's note, and
finding tags that mean the same thing. Bindery works fully without it. Until a site is pointed at a Worker, the AI
features don't appear.

## What it does with bookmarks

For each action, the page sends only the bookmarks that action is for: their titles, and their addresses cut down to
site and path (no query string or fragment, nothing for bookmarklets or local files). Reading a page (`page`,
`describe`) sends that one bookmark's full address, `place` also sends folder names, and `tagsim` sends tag names and
nothing else. The Worker builds a prompt, asks a [Workers AI](https://developers.cloudflare.com/workers-ai/) model for
JSON, checks the reply against what was sent (real bookmark numbers, each used once, short names), and returns it. It
doesn't store requests and doesn't log bookmark content.

It only answers pages listed in `ALLOWED_ORIGINS`, accepts at most 150 items and 96 KB per request, and, with the rate
limit binding in `wrangler.toml`, allows 20 requests a minute per visitor.

| Endpoint | Sends | Returns |
| --- | --- | --- |
| `POST /v1/tidy` | `{ folder, existing: [subfolder names], items: [{ title, url }] }` (up to 150) | `{ folders: [{ name, items: [index] }] }` |
| `POST /v1/name` | `{ current, items }` (up to 60) | `{ names: [up to 3] }` |
| `POST /v1/titles` | `{ items }` (up to 100) | `{ titles: [{ item: index, title }] }`, changed titles only |
| `POST /v1/place` | `{ items: [one bookmark], folders: [folder paths] }` (up to 400) | `{ folders: [up to 3 indexes] }` |
| `POST /v1/page` | `{ url }` | `{ title, icon }`. Not AI: see below |
| `POST /v1/describe` | `{ url, title }` | `{ description }`, one or two sentences, up to 300 characters |
| `POST /v1/tagsim` | `{ tags: [names] }` (2 to 600) | `{ groups: [[index, …]] }`, tags that mean the same, each in at most one group |

`page` fetches the address server-side (8-second limit, the first 400 KB of HTML) and returns its `og:title`,
`twitter:title` or `<title>`, and its best small icon as a `data:` URL (at most 48 KB, falling back to `/favicon.ico`).
It only fetches public `http`/`https` addresses: no local names, private networks, raw IP addresses, unusual ports or
addresses with a username. It follows redirects itself, at most 5, and checks every one the same way, as it does each
icon address the page links to, so a public page can't send it on to a private one. A site that's down or refuses, or a
redirect it won't follow, gets an empty answer, not an error. `describe` reads a page
the same way, then gives the model the page's own description (`og:description`, `description` or
`twitter:description`) and the first 2,500 characters of its text (from `<main>`, `<article>` or `<body>`, without
scripts, styles, navigation, headers, footers or forms). If the model fails, it returns the page's own description;
if the page can't be read, it returns an empty note.

## Deploy

You need a Cloudflare account with Workers AI. From this folder:

```bash
npx wrangler@4 login
```

```bash
npx wrangler@4 deploy
```

Where `wrangler login` can't open a browser (CI, or a cloud sandbox), skip it and give Wrangler an API token instead:
create one in the Cloudflare dashboard from the "Edit Cloudflare Workers" template, then set `CLOUDFLARE_API_TOKEN` to
it and `CLOUDFLARE_ACCOUNT_ID` to your account ID for the `deploy` command.

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

The tests run the Worker in Node with a fake model and fake websites: origin checks, limits, rate limiting, reply
validation for every endpoint, the fallback when JSON mode fails, and reading pages (titles, entities, icon choice,
size and type limits, blocked addresses and redirects, page text and descriptions).
