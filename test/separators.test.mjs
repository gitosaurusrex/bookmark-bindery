// Firefox separators: parsing (including the one the HTML parser nests in the previous <DT>), sorting by sections,
// adding, deleting, dragging, and a stable export → import → export round trip.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useApp, openFile, fixture, rows, lastToast, text, exportForFirefox, outline, assertNoErrors } from './harness.mjs'

const app = useApp()

test('opens the file with every separator in place', async () => {
  const { page } = app
  await openFile(page, 'seps.html', await fixture('separators.html'))
  assert.equal(await page.$$eval('.toast span', a => a.find(x => x.textContent.startsWith('Opened'))?.textContent), 'Opened seps.html: 7 bookmarks in 2 folders')
  assert.deepEqual(await rows(page), ['Bookmarks Toolbar', 'Zeta', 'Alpha', '——', 'Delta', 'Beta', 'Work', '——', 'Menu item'])
  assert.match(await text(page, '[data-view="all"]'), /7$/)
})

test('the export keeps every separator where it was', async () => {
  assert.deepEqual(outline(await exportForFirefox(app.page)),
    ['Bookmarks Toolbar', 'Zeta', 'Alpha', '——', 'Delta', 'Beta', 'Work', 'W2', '——', '——', 'W1', '——', 'Menu item'])
})

test('sorting by name sorts each section between separators', async () => {
  const { page } = app
  await page.click('[data-layout="folder"]'); await page.locator('#tree .trow', { hasText: 'Bookmarks Toolbar' }).click()
  assert.deepEqual(await rows(page), ['Zeta', 'Alpha', '——', 'Delta', 'Beta', 'Work'])
  await page.click('[data-h="sort"]'); await page.locator('#menu .mi', { hasText: 'By name' }).click()
  assert.deepEqual(await rows(page), ['Alpha', 'Zeta', '——', 'Work', 'Beta', 'Delta'])
  await page.click('[data-h="sort"]'); await page.click('.menu [role="menuitemcheckbox"]')
  await page.locator('#tree .trow', { hasText: 'Work' }).click()
  assert.deepEqual(await rows(page), ['W2', '——', '——', 'W1'])
  await page.locator('#list').focus(); await page.keyboard.press('ControlOrMeta+z'); await page.keyboard.press('ControlOrMeta+z')
})

test('+ Add → Separator adds one after the selection', async () => {
  const { page } = app
  await page.locator('#tree .trow', { hasText: 'Bookmarks Toolbar' }).click()
  await page.locator('#rows .row', { hasText: 'Alpha' }).click()
  await page.click('[data-h="add"]')
  assert.deepEqual(await page.$$eval('#menu .mi', a => a.map(x => x.textContent.trim())), ['New bookmarkB', 'New folderN', 'Separator'])
  await page.locator('#menu .mi', { hasText: 'Separator' }).click()
  assert.deepEqual(await rows(page), ['Zeta', 'Alpha', '——', '——', 'Delta', 'Beta', 'Work'])
  assert.match(await lastToast(page), /^Added a separator to “Bookmarks Toolbar”/)
})

test('a separator has its own menu and panel, and F2 does nothing', async () => {
  const { page } = app
  await page.locator('#rows .row.is-sep').first().click({ button: 'right' })
  assert.deepEqual(await page.$$eval('#menu .mi span', a => a.map(x => x.textContent)), ['Move to…', 'Cut', 'Delete separator'])
  await page.keyboard.press('Escape')
  await page.locator('#rows .row.is-sep').first().click(); await page.keyboard.press('F2')
  assert.equal(await page.$('.row[data-editing]'), null)
  await page.keyboard.press('e')
  assert.match(await page.textContent('#insp .insp-t'), /^Separator/)
  await page.locator('#list').focus(); await page.keyboard.press('Delete')
  assert.deepEqual(await rows(page), ['Zeta', 'Alpha', '——', 'Delta', 'Beta', 'Work'])
  assert.equal(await lastToast(page), 'Deleted a separator')
  await page.keyboard.press('ControlOrMeta+z')
})

test('deleting a mix names both kinds', async () => {
  const { page } = app
  await page.locator('#rows .row', { hasText: 'Delta' }).click()
  await page.locator('#rows .row.is-sep').first().click({ modifiers: ['ControlOrMeta'] })
  await page.keyboard.press('Delete')
  assert.equal(await text(page, '.dialog h2'), 'Delete 1 bookmark and 1 separator?')
  await page.keyboard.press('Escape')
})

test('a separator can be dragged, and a folder with only separators counts as empty', async () => {
  const { page } = app
  await page.locator('#rows .row.is-sep').first().dragTo(page.locator('#rows .row').last(), { targetPosition: { x: 200, y: 40 } })
  assert.deepEqual(await rows(page), ['Zeta', 'Alpha', '——', 'Beta', 'Work', '——', 'Delta'])
  assert.equal(await text(page, '[data-view="empty"]'), 'Empty folders')
})

test('export → import → export is stable', async () => {
  const { page } = app
  const first = await exportForFirefox(page)
  await openFile(page, 'again.html', Buffer.from(first))
  const again = await exportForFirefox(page)
  assert.deepEqual(outline(again), outline(first))
  assert.deepEqual(outline(again),
    ['Bookmarks Toolbar', 'Zeta', 'Alpha', '——', 'Beta', 'Work', 'W2', '——', '——', 'W1', '——', 'Delta', '——', 'Menu item'])
  assertNoErrors(app)
})
