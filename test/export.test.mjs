// Browsers: no questions for a Chrome file; for a Firefox file, the import notice and the export choice (Firefox,
// or Chrome/Edge/Safari with tags as titles or a Tags folder), the library staying unchanged, and "Don't ask again".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useApp, openFile, fixture, rows, lastToast, text, download, assertNoErrors } from './harness.mjs'

const app = useApp()
/** The exported outline, marking bookmarks that carry TAGS or a keyword. */
const shape = t => t.split('\n').filter(l => /<HR>|<A |<H3/.test(l))
  .map(l => l.includes('<HR>') ? '——' : l.replace(/<[^>]+>/g, '').trim() + (/TAGS=/.test(l) ? '[tags]' : '') + (/SHORTCUTURL/.test(l) ? '[kw]' : ''))
let firefoxExport

test('a Chrome file: no notice, and export asks nothing', async () => {
  const { page } = app
  await openFile(page, 'chrome.html', await fixture('demo'), { dismiss: false })
  await page.waitForTimeout(200)
  assert.equal(await page.isVisible('#modal'), false)
  await download(page, () => page.click('#exportBtn'))
  assert.equal(await page.isVisible('#modal'), false)
  assert.match(await lastToast(page), /^Exported bookmarks_\d\d_\d\d_\d\d\.html\. To bring it into Chrome/)
})

test('a Firefox file: the notice counts what only Firefox understands', async () => {
  const { page } = app
  await page.setInputFiles('#fileIn', { name: 'ff.html', mimeType: 'text/html', buffer: await fixture('firefox.html') })
  await page.waitForTimeout(300)
  if (await page.isVisible('.dialog h2') && (await page.textContent('.dialog h2')).includes('different file')) await page.click('.dialog [data-m="ok"]')
  await page.waitForSelector('.dialog h2'); await page.waitForTimeout(250)
  assert.equal(await text(page, '.dialog h2'), 'This file is from Firefox')
  assert.equal(await text(page, '.dialog p'), 'It has 3 tags on 2 bookmarks, 1 keyword, 2 separators and 1 Firefox-only item (like “Most Visited”). Bindery keeps all of it, shows it, and lets you edit it.')
  await page.click('[data-ffn="tags"]')
  assert.equal(await text(page, '.ptitle'), 'Tags')
  await page.click('[data-layout="folder"]').catch(() => {})
  await page.locator('#tree .trow').first().click()
  assert.deepEqual(await rows(page), ['Most Visited', '——', 'Bookmarks Toolbar', 'Kyoto guide', '——', 'MDN', 'Other Bookmarks'])
})

test('export defaults to Firefox and keeps everything', async () => {
  const { page } = app
  await page.click('#exportBtn'); await page.waitForSelector('.targets')
  assert.equal(await page.$eval('.targets .on', b => b.textContent), 'FirefoxKeeps tags, keywords and separators')
  firefoxExport = await download(page, () => page.click('[data-ex="go"]'))
  assert.deepEqual(shape(firefoxExport), ['Most Visited', '——', 'Bookmarks Toolbar', 'Kyoto guide[tags][kw]', '——', 'MDN[tags]', 'Other Bookmarks', 'Example'])
  assert.match(await lastToast(page), /for Firefox\. To bring it into Firefox/)
})

test('for Chrome, tags can go into titles, and separators and Firefox-only items are left out', async () => {
  const { page } = app
  await page.click('#exportBtn'); await page.waitForSelector('.targets')
  await page.click('[data-target="other"]'); await page.click('[data-tagsas="titles"]')
  const detail = await page.textContent('.ffd')
  assert.match(detail, /1 keyword won’t work there\./)
  assert.match(detail, /2 separators are left out of the file\./)
  const txt = await download(page, () => page.click('[data-ex="go"]'))
  assert.deepEqual(shape(txt), ['Bookmarks Toolbar', 'Kyoto guide #travel #japan[tags][kw]', 'MDN #docs[tags]', 'Other Bookmarks', 'Example'])
})

test('the choice is remembered; a Tags folder, keeping Firefox-only items', async () => {
  const { page } = app
  await page.click('#exportBtn'); await page.waitForSelector('.targets')
  assert.match(await page.$eval('.targets .on', b => b.textContent), /^Chrome, Edge or Safari/)
  assert.equal(await page.$eval('.tagsas .on', b => b.textContent), '#tags in titles')
  await page.click('[data-tagsas="folders"]'); await page.uncheck('[data-dropplace]')
  const txt = await download(page, () => page.click('[data-ex="go"]'))
  assert.deepEqual(shape(txt), ['Most Visited', 'Bookmarks Toolbar', 'Kyoto guide[tags][kw]', 'MDN[tags]', 'Other Bookmarks', 'Example',
    'Tags', 'docs', 'MDN[tags]', 'japan', 'Kyoto guide[tags][kw]', 'travel', 'Kyoto guide[tags][kw]'])
})

test('exporting for another browser leaves the library itself unchanged', async () => {
  assert.equal(await text(app.page, '[data-view="tags"]'), 'Tags3')
  assert.equal((await app.page.$$('#rows .row.is-sep')).length, 2)
})

test('"Don\'t ask again" sticks across a reload, and the toast can bring the question back', async () => {
  const { page } = app
  await page.click('#exportBtn'); await page.waitForSelector('.targets'); await page.click('[data-target="firefox"]'); await page.check('[data-noask]')
  await download(page, () => page.click('[data-ex="go"]'))
  await download(page, () => page.click('#exportBtn'))
  assert.equal(await page.isVisible('#modal'), false)
  await page.waitForTimeout(800); await page.reload(); await page.waitForSelector('#rows .row')
  const again = await download(page, () => page.click('#exportBtn'))
  assert.equal(await page.isVisible('#modal'), false)
  assert.deepEqual(shape(again), shape(firefoxExport))
  await page.locator('.toast button', { hasText: 'Choose another browser' }).click(); await page.waitForTimeout(200)
  assert.ok(await page.isVisible('.targets'))
  await page.keyboard.press('Escape')
  assertNoErrors(app)
})
