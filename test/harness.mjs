/**
 * Shared setup for the app tests: serves the repo the way the static host does, opens index.html in Chromium, and
 * (for Bindery Assist tests) answers the page's Assist requests with the real Worker code and a fake model, so
 * nothing leaves the machine. Needs Playwright with Chromium, like scripts/screenshots.mjs.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before } from 'node:test'
import assert from 'node:assert/strict'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
const { chromium } = createRequire(import.meta.url)('playwright')
const { handle } = await import(join(ROOT, 'worker', 'src', 'index.js'))

export const ASSIST = 'https://assist.test'
const TYPES = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }

/** A fixture's bytes: the demo library from scripts/, or a file from test/fixtures/. */
export const fixture = name => readFile(name === 'demo' ? join(ROOT, 'scripts', 'demo-bookmarks.html') : join(ROOT, 'test', 'fixtures', name))

/** 400 bookmarks from six sites in "Bookmarks bar / Unsorted", next to an existing "News" and an empty "Videos". */
export function bigLibrary() {
  const sites = [['github.com', 'Repo'], ['youtube.com', 'Video'], ['nytimes.com', 'Article'], ['en.wikipedia.org/wiki', 'Wiki'], ['allrecipes.com', 'Recipe'], ['example.org', 'Misc']]
  const out = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>',
    '<DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>', '<DL><p>', '<DT><H3>Unsorted</H3>', '<DL><p>',
    '<DT><H3>News</H3>', '<DL><p>', '<DT><A HREF="https://bbc.co.uk/news">BBC News</A>', '</DL><p>',
    '<DT><H3>Videos</H3>', '<DL><p>', '</DL><p>']
  for (let i = 0; i < 400; i++) {
    const [h, t] = sites[i % sites.length]
    out.push(`<DT><A HREF="https://${h}/item-${i}?utm_source=x" ADD_DATE="${1700000000 + i}">${t} ${i} | Site name</A>`)
  }
  out.push('</DL><p>', '</DL><p>', '</DL><p>')
  return Buffer.from(out.join('\n'))
}

function serve(assist) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
    try {
      let body = await readFile(join(ROOT, path === '/' ? 'index.html' : path))
      if (path === '/' && assist) {
        body = body.toString('utf8')
          .replace(/<meta name="bindery-ai" content="[^"]*">/, `<meta name="bindery-ai" content="${ASSIST}">`)
          .replace(/connect-src [^;"]+/, `connect-src ${ASSIST}`)
      }
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' }).end(body)
    } catch { res.writeHead(404).end() }
  })
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)))
}

/**
 * Opens the app once for a test file (`before`) and closes it afterwards (`after`). Returns a handle whose fields
 * are filled in before the first test runs.
 *
 * - `viewport`: the window size.
 * - `assist`: a function `({ task, body, prompt }) => modelResponse` that plays the AI model. When given, the page is
 *   pointed at the fake Assist origin, every request goes through the real Worker code, and `app.calls` records
 *   `{ task, body }` for each one.
 * - `site`: addresses → page bodies the Worker sees when it reads a page (anything else is a 404).
 * - `delay`: `{ task: ms }` to keep a request in flight, e.g. to see a "Thinking…" state.
 */
export function useApp({ viewport = { width: 1280, height: 860 }, assist, site = {}, delay = {} } = {}) {
  const app = { calls: [], errors: [] }
  before(async () => {
    app.server = await serve(!!assist)
    app.origin = `http://127.0.0.1:${app.server.address().port}`
    app.browser = await chromium.launch()
    app.context = await app.browser.newContext({ viewport })
    const page = app.page = await app.context.newPage()
    page.on('pageerror', e => app.errors.push(e.message))
    page.on('console', m => m.type() === 'error' && app.errors.push(m.text()))
    if (assist) await routeAssist(app, assist, site, delay)
    await page.goto(app.origin)
  })
  after(async () => {
    await app.browser?.close()
    app.server?.close()
  })
  return app
}

async function routeAssist(app, assist, site, delay) {
  await app.page.route(ASSIST + '/**', async route => {
    const r = route.request(), body = r.postData() ? JSON.parse(r.postData()) : null, task = r.url().split('/').pop()
    if (body) app.calls.push({ task, body })
    if (delay[task]) await new Promise(res => setTimeout(res, delay[task]))
    const ai = { run: async (model, opts) => ({ response: await assist({ task, body, prompt: opts.messages.at(-1).content }) }) }
    const realFetch = globalThis.fetch
    globalThis.fetch = async u => {
      const b = site[String(u)]
      const res = new Response(b ?? 'not found', { status: b ? 200 : 404, headers: { 'Content-Type': String(u).endsWith('.ico') ? 'image/x-icon' : 'text/html' } })
      Object.defineProperty(res, 'url', { value: String(u) })
      return res
    }
    try {
      const req = new Request(r.url(), { method: r.method(), headers: { ...r.headers(), origin: app.origin }, body: r.method() === 'POST' ? r.postData() : undefined })
      const res = await handle(req, { ALLOWED_ORIGINS: app.origin, AI: ai })
      await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() })
    } finally { globalThis.fetch = realFetch }
  })
}

/* ---------- page helpers ---------- */

/** Opens a bookmarks file through the hidden file input and waits for the list. Dismisses the Firefox notice. */
export async function openFile(page, name, buffer, { dismiss = true } = {}) {
  await page.setInputFiles('#fileIn', { name, mimeType: 'text/html', buffer })
  await page.waitForSelector('#rows .row')
  if (dismiss) {
    for (let k = 0; k < 2; k++) {
      const ok = await page.waitForSelector('.dialog [data-m="ok"]', { timeout: 800 }).catch(() => null)
      if (!ok) break
      await ok.click()
    }
  }
}

/** Titles of the rows on screen; separators show as "——". */
export const rows = page => page.$$eval('#rows .row', a => a.map(x => x.classList.contains('is-sep') ? '——' : x.querySelector('.t').textContent))
export const linkTitles = page => page.$$eval('#rows .row .t', a => a.map(x => x.textContent))
export const treeNames = page => page.$$eval('#tree .trow .tname', a => a.map(x => x.textContent))
export const lastToast = page => page.$$eval('.toast span', a => a.map(x => x.textContent).at(-1))
export const text = async (page, sel) => (await page.textContent(sel)).trim()
export const width = (page, sel) => page.$eval(sel, e => Math.round(e.getBoundingClientRect().width))
export const left = (page, sel) => page.$eval(sel, e => Math.round(e.getBoundingClientRect().left))

/** Waits for a download started by `click` and returns the file's text. */
export async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()])
  return readFile(await dl.path(), 'utf8')
}

/** Exports, answering the browser question with Firefox if it's asked. */
export const exportForFirefox = page => download(page, async () => {
  await page.click('#exportBtn')
  if (await page.waitForSelector('.targets', { timeout: 1500 }).catch(() => null)) {
    await page.click('[data-target="firefox"]')
    await page.click('[data-ex="go"]')
  }
})

/** The outline of an exported file: folders, bookmarks and "——" for separators, in file order. */
export const outline = txt => txt.split('\n').filter(l => /<HR>|<A |<H3/.test(l))
  .map(l => l.includes('<HR>') ? '——' : l.replace(/<[^>]+>/g, '').trim())

/** Drags with the mouse from the middle of `sel` by `dx` pixels. */
export async function dragBy(page, sel, dx) {
  const b = await page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 200 } })
  await page.mouse.move(b.x, b.y)
  await page.mouse.down()
  await page.mouse.move(b.x + dx / 2, b.y, { steps: 4 })
  await page.mouse.move(b.x + dx, b.y, { steps: 4 })
  await page.mouse.up()
}

/** Turns Bindery Assist on through the welcome sheet. */
export async function turnOnAssist(page) {
  await page.click('#aiBtn')
  await page.click('.ob-go')
  await page.keyboard.press('Escape')
}

/** Asserts no script errors or console errors happened, apart from ones matching `ignore`. */
export function assertNoErrors(app, ignore) {
  assert.deepEqual(app.errors.filter(e => !ignore || !ignore.test(e)), [])
}
