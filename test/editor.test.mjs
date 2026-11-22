// The details panel: editing a bookmark (name, tags, keyword, an Assist-written note, moving), the export keeping all
// of it, following the selection, Esc, the New bookmark form with page reading and Suggest a folder, and folders.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { useApp, openFile, fixture, linkTitles, text, exportForFirefox, turnOnAssist, assertNoErrors, ROOT } from './harness.mjs'

const app = useApp({
  viewport: { width: 1360, height: 860 },
  delay: { describe: 1200 },
  site: {
    'https://kyoto.travel/en/': '<title>Kyoto Travel | Official</title><meta property="og:title" content="Kyoto City Official Travel Guide"><meta name="description" content="The official guide to Kyoto."><main><p>Temples, gardens and food in Kyoto.</p></main>',
    'https://kyoto.travel/favicon.ico': await readFile(join(ROOT, 'favicon.ico')),
    'https://en.wikivoyage.org/wiki/Kyoto': '<meta name="description" content="Kyoto travel guide."><main><p>Kyoto was the capital of Japan for over a thousand years.</p></main>',
  },
  assist: ({ prompt }) => {
    if (prompt.includes('Describe this web page')) {
      return { description: prompt.includes('wikivoyage') ? 'A travel guide to Kyoto, Japan’s former capital.' : 'The city’s official guide to temples, gardens and food.' }
    }
    const lines = prompt.split('\n').filter(l => /^\d+\. /.test(l))
    return { folders: [lines.findIndex(l => l.endsWith('/ Japan 2026'))] }
  },
})
const field = f => app.page.inputValue(`#insp [data-f="${f}"]`)
const tags = () => app.page.$$eval('#insp .tg', a => a.map(x => x.textContent))

test('the header has + Add and Sort, and + Add offers three things', async () => {
  const { page } = app
  await openFile(page, 'bookmarks.html', await fixture('demo'))
  await page.click('[data-layout="folder"]')
  await turnOnAssist(page)
  assert.deepEqual(await page.$$eval('.pacts .btn', a => a.map(b => b.textContent.trim())), ['Add', 'Sort'])
  await page.click('[data-h="add"]')
  assert.deepEqual(await page.$$eval('#menu .mi', a => a.map(b => b.textContent.trim())), ['New bookmarkB', 'New folderN', 'Separator'])
  await page.keyboard.press('Escape')
})

test('E opens the panel on the selected bookmark with the name focused', async () => {
  const { page } = app
  await page.locator('#tree .trow', { hasText: 'Travel' }).click()
  await page.locator('#rows .row', { hasText: 'Japan 2026' }).dblclick()
  await page.locator('#rows .row', { hasText: 'Kyoto' }).click()
  await page.keyboard.press('e')
  assert.ok(await page.isVisible('#insp'))
  assert.equal(await text(page, '#insp .insp-t b'), 'Bookmark')
  assert.equal(await field('name'), 'Kyoto — Wikivoyage')
  assert.equal(await field('url'), 'https://en.wikivoyage.org/wiki/Kyoto')
  assert.equal(await page.evaluate(() => document.activeElement.dataset.f), 'name')
  assert.deepEqual(await page.$$eval('#insp [data-more]', a => a.map(x => x.textContent)), ['Tags', 'Keyword', 'Note'])
  assert.match(await page.textContent('#insp [data-v="meta"]'), /Also saved in “Other bookmarks”\. Show it$/)
})

test('rename, tags and undo from the panel', async () => {
  const { page } = app
  await page.fill('#insp [data-f="name"]', 'Kyoto guide'); await page.keyboard.press('Enter')
  assert.ok((await linkTitles(page)).includes('Kyoto guide'))
  await page.click('#insp [data-more="tags"]')
  await page.keyboard.type('travel, japan'); await page.keyboard.press('Enter')
  assert.deepEqual(await tags(), ['travel', 'japan'])
  await page.locator('#insp [data-rmtag="travel"]').dispatchEvent('pointerdown')
  assert.deepEqual(await tags(), ['japan'])
  await page.locator('#list').focus(); await page.keyboard.press('ControlOrMeta+z')
  assert.deepEqual(await tags(), ['travel', 'japan'])
})

test('a keyword, and a note written by Assist from the page', async () => {
  const { page } = app
  await page.click('#insp [data-more="keyword"]'); await page.keyboard.type('kyo'); await page.keyboard.press('Enter')
  await page.click('#insp [data-more="note"]')
  await page.click('#insp [data-x="describe"]'); await page.waitForTimeout(400)
  assert.equal(await text(page, '#insp [data-v="describe"]'), 'Thinking…')
  await page.waitForFunction(() => document.querySelector('#insp [data-f="note"]').value)
  assert.equal(await field('note'), 'A travel guide to Kyoto, Japan’s former capital.')
  assert.deepEqual(app.calls.find(c => c.task === 'describe').body, { url: 'https://en.wikivoyage.org/wiki/Kyoto', title: 'Kyoto guide' })
})

test('the folder picker moves the bookmark and the panel stays on it', async () => {
  const { page } = app
  await page.click('#insp [data-x="pick"]'); await page.keyboard.type('lisbon'); await page.keyboard.press('Enter'); await page.waitForTimeout(150)
  assert.equal(await text(page, '#insp [data-v="where"]'), 'Bookmarks bar / Travel / Lisbon weekend')
  assert.equal(await field('name'), 'Kyoto guide')
})

test('the export keeps the name, tags, keyword and note', async () => {
  const lines = (await exportForFirefox(app.page)).split('\n'), i = lines.findIndex(l => l.includes('>Kyoto guide</A>'))
  assert.match(lines[i], /<DT><A HREF="https:\/\/en\.wikivoyage\.org\/wiki\/Kyoto" ADD_DATE="\d+" TAGS="travel,japan" SHORTCUTURL="kyo">Kyoto guide<\/A>/)
  assert.equal(lines[i + 1].trim(), '<DD>A travel guide to Kyoto, Japan’s former capital.')
})

test('the panel follows the selection, and Esc clears the selection, then closes', async () => {
  const { page } = app
  await page.locator('#rows .row').first().click()
  assert.equal(await field('name'), 'Japan Rail Pass')
  await page.locator('#rows .row').nth(1).click({ modifiers: ['ControlOrMeta'] })
  assert.equal(await text(page, '#insp .insp-t b'), '2 items selected')
  await page.keyboard.press('Escape'); assert.ok(await page.isVisible('#insp'))
  await page.keyboard.press('Escape'); assert.equal(await page.isVisible('#insp'), false)
})

test('B: a new bookmark from an address, with its page name, a suggested folder, tags and a note', async () => {
  const { page } = app
  await page.keyboard.press('b')
  assert.equal(await text(page, '#insp .insp-t b'), 'New bookmark')
  assert.equal(await page.evaluate(() => document.activeElement.dataset.f), 'url')
  await page.keyboard.type('kyoto.travel/en/')
  await page.waitForFunction(() => document.querySelector('#insp [data-f="name"]')?.value)
  await page.click('#insp [data-x="place"]'); await page.waitForSelector('#insp [data-pf]')
  await page.click('#insp [data-more="tags"]'); await page.keyboard.type('trip'); await page.keyboard.press('Enter')
  await page.click('#insp [data-more="note"]'); await page.click('#insp [data-x="describe"]')
  await page.waitForFunction(() => document.querySelector('#insp [data-f="note"]')?.value)
  assert.equal(await field('name'), 'Kyoto City Official Travel Guide')
  assert.equal(await text(page, '#insp [data-x="pick"]'), 'Japan 2026Bookmarks bar / Travel')
  assert.deepEqual(await tags(), ['trip'])
  assert.equal(await field('note'), 'The city’s official guide to temples, gardens and food.')
  await page.click('#insp [data-x="add"]'); await page.waitForTimeout(200)
  assert.equal(await text(page, '#insp .insp-t b'), 'Bookmark')
  assert.equal(await field('name'), 'Kyoto City Official Travel Guide')
  assert.deepEqual(await tags(), ['trip'])
  assert.equal(await text(page, '.ptitle'), 'Japan 2026')
})

test('a folder in the panel has a name, a place and a note, and can\'t move into itself', async () => {
  const { page } = app
  await page.locator('#tree .trow', { hasText: 'Travel' }).click()
  await page.locator('#rows .row.is-folder', { hasText: 'Japan 2026' }).click(); await page.keyboard.press('e')
  assert.equal(await text(page, '#insp .insp-t b'), 'Folder')
  assert.deepEqual(await page.$$eval('#insp [data-f]', a => a.map(x => x.dataset.f)), ['name', 'fq'])
  assert.deepEqual(await page.$$eval('#insp [data-more]', a => a.map(x => x.textContent)), ['Note'])
  await page.click('#insp [data-x="pick"]')
  assert.deepEqual(await page.$$eval('#insp .mp-row.dis b', a => a.map(x => x.textContent)), ['Japan 2026'])
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  assertNoErrors(app)
})
