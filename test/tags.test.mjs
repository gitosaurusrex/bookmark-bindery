// Tags: #search, the Tags view with look-alike groups, Assist's Find similar, merging, renaming, removing, tags ↔
// folders ↔ titles, bulk tagging in the panel, and TAGS in the export.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useApp, openFile, fixture, linkTitles, lastToast, text, exportForFirefox, turnOnAssist, assertNoErrors } from './harness.mjs'

const app = useApp({
  viewport: { width: 1360, height: 860 },
  assist: ({ body }) => ({ groups: [[body.tags.findIndex(x => x.toLowerCase() === 'javascript'), body.tags.findIndex(x => x === 'js')]] }),
})
const tagRows = () => app.page.$$eval('#rows .row.tagrow', a => a.map(x => x.querySelector('.t').textContent + ' (' + x.querySelector('.u').textContent + ')'))
const sims = () => app.page.$$eval('#rows .simrow', a => a.map(x => x.querySelector('.t').textContent + ' → ' + x.querySelector('[data-a="simmerge"]').textContent))
const chips = () => app.page.$$eval('#insp .tg', a => a.map(x => x.textContent + (x.classList.contains('part') ? '(part)' : '')))
const undo = async () => { await app.page.locator('#list').focus(); await app.page.keyboard.press('ControlOrMeta+z') }
async function search(q) { await app.page.fill('#q', q); await app.page.waitForTimeout(200); return linkTitles(app.page) }

test('search: #tag matches tag prefixes, and plain words match tags too', async () => {
  const { page } = app
  await openFile(page, 'firefox.html', await fixture('tagged.html'))
  await turnOnAssist(page)
  assert.equal(await text(page, '[data-view="tags"]'), 'Tags18')
  assert.deepEqual(await search('#trav'), ['Kyoto — Wikivoyage', 'Japan Rail Pass', 'Tokyo — Wikivoyage', 'Lisbon — Wikivoyage'])
  assert.deepEqual(await search('#recipe kimchi'), ['Kimchi basics'])
  assert.deepEqual(await search('portugal'), ['Lisbon — Wikivoyage'])
  await page.fill('#q', ''); await page.keyboard.press('Escape')
})

test('the Tags view lists tags and look-alike groups', async () => {
  const { page } = app
  await page.click('[data-view="tags"]')
  assert.match(await page.textContent('.pmeta'), /^18 tags on 14 bookmarks · 6 groups look like the same tag/)
  assert.deepEqual(await sims(), [
    'travel3Travel1 → Use “travel”',
    'japan2Japan1 → Use “japan”',
    'recipes1Recipes1 → Use “recipes”',
    'recipe1recipes2 → Merge into “recipes”',
    'web dev2web-dev1 → Merge into “web dev”',
    'photography1photograpy1 → Merge into “photography”',
  ])
  assert.deepEqual((await tagRows()).slice(0, 3), ['travel (4 bookmarks · also spelled “Travel”)', 'japan (3 bookmarks · also spelled “Japan”)', 'news (2 bookmarks)'])
})

test('Find similar sends only tag names and adds what Assist finds', async () => {
  const { page } = app
  await page.click('[data-h="tagai"]'); await page.waitForTimeout(600)
  const sent = app.calls.at(-1).body
  assert.deepEqual(Object.keys(sent), ['tags'])
  assert.ok(sent.tags.includes('javascript') && sent.tags.includes('js'))
  assert.match(await lastToast(page), /^Bindery Assist found 1 more group of tags that mean the same/)
  assert.equal((await sims()).at(-1), 'javascript1js1 → Merge into “javascript”')
})

test('merging every group, then undo and "They\'re different"', async () => {
  const { page } = app
  for (let n = 0; (await page.$$('#rows .simrow')).length && n < 10; n++) await page.locator('#rows .simrow [data-a="simmerge"]').first().click()
  assert.equal((await tagRows()).length, 14)
  assert.deepEqual((await tagRows()).slice(0, 5), ['travel (4 bookmarks)', 'japan (3 bookmarks)', 'recipes (3 bookmarks)', 'web dev (3 bookmarks)', 'javascript (2 bookmarks)'])
  assert.match(await page.textContent('.pmeta'), /^14 tags on 14 bookmarks/)
  await undo()
  assert.deepEqual(await sims(), ['javascript1js1 → Merge into “javascript”'])
  await page.locator('#rows .simrow [data-a="simmore"]').first().click()
  assert.deepEqual(await page.$$eval('#menu .mi span, #menu .mlabel', a => a.map(x => x.textContent)), ['Merge into', '“javascript”', '“js”', 'They’re different tags'])
  await page.locator('#menu .mi', { hasText: 'different' }).click()
  assert.deepEqual(await sims(), [])
})

test('a tag\'s view: rename, remove from all (and undo), make a folder', async () => {
  const { page } = app
  await page.locator('#rows .row.tagrow', { hasText: 'travel' }).first().click(); await page.keyboard.press('Enter')
  assert.equal(await text(page, '.ptitle'), 'travel')
  assert.equal(await text(page, '.pmeta'), '4 bookmarks in 2 folders')
  await page.click('[data-h="tagrename"]'); await page.fill('#pdIn', 'Trips'); await page.keyboard.press('Enter')
  assert.equal(await text(page, '.ptitle'), 'Trips')
  assert.equal(await lastToast(page), 'Renamed “travel” to “Trips”')
  await page.click('[data-h="tagmore"]')
  assert.deepEqual(await page.$$eval('#menu .mi span', a => a.map(x => x.textContent)), ['Rename…', 'Merge into another tag…', 'Make a folder from this tag…', 'Remove from 4 bookmarks'])
  await page.locator('#menu .mi', { hasText: 'Remove from' }).click()
  assert.equal(await text(page, '.pmeta'), 'No bookmarks have this tag now')
  assert.equal(await lastToast(page), 'Removed “Trips” from 4 bookmarks. The bookmarks stay.')
  await undo()
  assert.equal(await text(page, '.pmeta'), '4 bookmarks in 2 folders')
  await page.click('[data-h="tagmore"]'); await page.locator('#menu .mi', { hasText: 'Make a folder' }).click()
  await page.waitForSelector('.cf-list')
  await page.check('input[name="how"][value="move"]'); await page.check('input[name="untag"]')
  await page.locator('.cf-list .mp-row', { hasText: 'Bookmarks Toolbar' }).click(); await page.click('[data-cf="ok"]')
  assert.equal(await lastToast(page), 'Moved 4 bookmarks into “Trips”')
  await undo()
})

test('Convert: a folder for each tag, tags in titles, and folder names as tags', async () => {
  const { page } = app
  await page.click('[data-view="tags"]'); await page.click('[data-h="convert"]')
  assert.deepEqual(await page.$$eval('#menu .mi span, #menu .mlabel', a => a.map(x => x.textContent)),
    ['For Chrome (no tags)', 'Make a folder for each tag…', 'Add tags to titles…', 'For Firefox', 'Tag bookmarks with their folder names…'])
  await page.locator('#menu .mi', { hasText: 'folder for each tag' }).click(); await page.click('[data-cf="ok"]')
  assert.equal(await lastToast(page), 'Made 15 folders with 27 copies in “Tags”')
  await undo()
  await page.click('[data-view="tags"]'); await page.click('[data-h="convert"]'); await page.locator('#menu .mi', { hasText: 'titles' }).click(); await page.click('.dialog [data-m="ok"]')
  assert.deepEqual(await search('kyoto'), ['Kyoto — Wikivoyage #Trips #japan #kyoto'])
  await page.fill('#q', ''); await page.keyboard.press('Escape')
  await undo()
  await page.click('[data-view="tags"]'); await page.click('[data-h="convert"]'); await page.locator('#menu .mi', { hasText: 'folder names' }).click()
  await page.locator('.cf-list .mp-row', { hasText: 'Bookmarks Toolbar' }).click(); await page.click('[data-cf="ok"]')
  assert.equal(await lastToast(page), 'Tagged 11 bookmarks with their folder names')
  assert.deepEqual((await tagRows()).filter(t => /Cooking|Japan 2026|Dev/.test(t)), ['Dev (4 bookmarks)', 'Cooking (3 bookmarks)', 'Japan 2026 (3 bookmarks)'])
})

test('bulk tagging several bookmarks, and TAGS in the export', async () => {
  const { page } = app
  await page.click('[data-layout="folder"]').catch(() => {})
  await page.locator('#tree .trow', { hasText: 'Dev' }).click()
  await page.locator('#rows .row.is-link').nth(0).click(); await page.locator('#rows .row.is-link').nth(2).click({ modifiers: ['Shift'] })
  await page.keyboard.press('e')
  assert.equal(await text(page, '#insp .insp-t'), '3 items selected3 bookmarks')
  assert.deepEqual(await chips(), ['Dev', 'web dev2/3(part)', 'docs1/3(part)', 'javascript1/3(part)', 'js1/3(part)', 'tools1/3(part)'])
  await page.fill('#insp [data-f="tag"]', 'reference'); await page.keyboard.press('Enter')
  await page.locator('#insp .tg.part [data-addtag]').first().dispatchEvent('pointerdown')
  await page.locator('#insp .tg [data-rmtag="Dev"]').first().dispatchEvent('pointerdown')
  assert.deepEqual(await chips(), ['reference', 'web dev', 'docs1/3(part)', 'javascript1/3(part)', 'js1/3(part)', 'tools1/3(part)'])
  const line = (await exportForFirefox(page)).split('\n').find(l => l.includes('developer.mozilla.org')).trim()
  assert.equal(line, '<DT><A HREF="https://developer.mozilla.org/" ADD_DATE="1700000000" TAGS="javascript,web dev,docs,reference">MDN Web Docs</A>')
  assertNoErrors(app)
})
