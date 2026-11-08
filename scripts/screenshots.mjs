/**
 * Takes the README screenshots in docs/screenshots/, light and dark, as WebP.
 *
 * Opens index.html in Chromium, imports the made-up library in
 * scripts/demo-bookmarks.html and captures the main views. Needs Node and
 * Playwright with Chromium installed:
 *
 *   node scripts/screenshots.mjs
 */
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'docs', 'screenshots')
const DEMO = join(ROOT, 'scripts', 'demo-bookmarks.html')
const { chromium } = createRequire(import.meta.url)('playwright')

const TYPES = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }

/** Serves the repo the way the static host does. */
function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
    try {
      const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path))
      res.writeHead(200, { 'content-type': TYPES[extname(path) || '.html'] ?? 'application/octet-stream' }).end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

/** Opens the demo library with every folder in the bookmarks bar expanded. */
async function openLibrary(page) {
  // Named like a real browser export, since the file's name shows in the top bar.
  await page.setInputFiles('#fileIn', { name: 'bookmarks_11_8_26.html', mimeType: 'text/html', buffer: await readFile(DEMO) })
  await page.waitForSelector('#rows .row')
  // Alt-click expands a folder and every folder inside it.
  await page.click('#rows .row.is-folder .twist.open', { modifiers: ['Alt'] }).catch(() => {})
  await page.click('#rows .row.is-folder .twist', { modifiers: ['Alt'] })
  await page.waitForTimeout(200)
}

const SHOTS = [
  {
    name: 'library',
    width: 1280,
    height: 800,
    prepare: async (page) => {
      await openLibrary(page)
      // Select two bookmarks so the selection tray shows what can be done with them.
      const links = page.locator('#rows .row.is-link')
      await links.nth(1).click()
      await links.nth(4).click({ modifiers: ['Control'] })
    },
  },
  {
    name: 'duplicates',
    width: 1280,
    height: 1260,
    prepare: async (page) => {
      await openLibrary(page)
      await page.click('[data-view="dupes"]')
      await page.waitForSelector('#rows .grp')
      await page.locator('#rows .row [data-a="del"]').nth(1).click()
    },
  },
  {
    name: 'phone',
    width: 390,
    height: 844,
    prepare: async (page) => {
      await openLibrary(page)
    },
  },
]

/** WebP is a fraction of PNG's size. Chromium's canvas encodes it, so nothing else needs installing. */
async function toWebp(page, png) {
  const dataUrl = await page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    canvas.getContext('2d').drawImage(image, 0, 0)
    return canvas.toDataURL('image/webp', 0.9)
  }, png.toString('base64'))
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

const server = await serve()
const url = `http://127.0.0.1:${server.address().port}/`
await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
try {
  for (const scheme of ['light', 'dark']) {
    for (const shot of SHOTS) {
      const phone = shot.width < 600
      const context = await browser.newContext({
        viewport: { width: shot.width, height: shot.height },
        deviceScaleFactor: 2,
        colorScheme: scheme,
        reducedMotion: 'reduce',
        ...(phone ? { isMobile: true, hasTouch: true } : {}),
      })
      const page = await context.newPage()
      await page.goto(url)
      await page.evaluate(() => document.fonts.ready)
      await shot.prepare(page)
      // Let toasts from opening the file fade, so they don't cover the view.
      await page.evaluate(() => document.getElementById('toasts').replaceChildren())
      await page.waitForTimeout(300)
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      if (sideways) console.warn(`${shot.name} (${scheme}) scrolls sideways`)
      const file = join(OUT, `${shot.name}-${scheme}.webp`)
      await writeFile(file, await toWebp(page, await page.screenshot()))
      console.log(`Saved ${file}`)
      await context.close()
    }
  }
} finally {
  await browser.close()
  server.close()
}
