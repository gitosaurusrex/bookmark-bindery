// Pane sizes and the rail: resizing the folders pane and details panel (drag, keys, double-click, limits), folding
// into the rail (button, Ctrl/⌘+B, dragging narrow), what's remembered, and the medium and phone layouts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useApp, openFile, fixture, text, width, left, dragBy, assertNoErrors } from './harness.mjs'

const app = useApp({ viewport: { width: 1440, height: 860 } })
const isRail = () => app.page.$eval('#app', a => a.classList.contains('side-rail'))
let saved

test('dragging the folders pane edge resizes it, up to 520 px, and the file name follows', async () => {
  const { page } = app
  await openFile(page, 'b.html', await fixture('demo'))
  assert.equal(await width(page, '#side'), 276)
  assert.equal(await left(page, '#pane'), 276)
  assert.equal(await left(page, '#fileChip'), 276)
  assert.match(await page.getAttribute('#navBtn', 'title'), /^Collapse the folders pane \((Ctrl|⌘)\+B\)$/)
  await dragBy(page, '#sideRes', 120)
  assert.equal(await width(page, '#side'), 396)
  assert.equal(await left(page, '#fileChip'), 396)
  await dragBy(page, '#sideRes', 400)
  assert.equal(await width(page, '#side'), 520)
})

test('double-click resets it, and arrow keys nudge it', async () => {
  const { page } = app
  await page.dblclick('#sideRes')
  assert.equal(await width(page, '#side'), 276)
  await page.focus('#sideRes'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowRight')
  assert.equal(await width(page, '#side'), 340)
  assert.equal(await page.getAttribute('#sideRes', 'aria-valuenow'), '340')
  await page.dblclick('#sideRes')
})

test('the top-bar button folds the pane into a rail of icons', async () => {
  const { page } = app
  await page.click('#navBtn'); await page.waitForTimeout(100)
  assert.equal(await width(page, '#side'), 58)
  assert.deepEqual(await page.$$eval('#rail .rbtn', a => a.map(b => b.getAttribute('aria-label'))), [
    'Folders: open the pane', 'Filter folders (F)', 'All bookmarks · 33', 'Duplicates · 7 extra copies', 'Empty folders · 1',
    'Tags', 'This device: saved in this browser', 'Keyboard shortcuts (?)',
  ])
  assert.match(await page.getAttribute('#navBtn', 'title'), /^Expand the folders pane/)
})

test('rail buttons open views, the shortcuts and the pane', async () => {
  const { page } = app
  await page.click('[data-rail="dupes"]')
  assert.equal(await text(page, '.ptitle'), 'Duplicates')
  assert.equal(await width(page, '#side'), 58)
  assert.equal(await page.$eval('#rail .rbtn.on', b => b.dataset.rail), 'dupes')
  assert.equal(await text(page, '[data-rail="dupes"] .rbadge'), '7')
  await page.click('[data-rail="tags"]')
  assert.equal(await text(page, '.ptitle'), 'Tags')
  await page.click('[data-rail="keys"]')
  assert.equal(await text(page, '.dialog h2'), 'Shortcuts')
  await page.keyboard.press('Escape')
  await page.click('[data-rail="folders"]')
  assert.equal(await width(page, '#side'), 276)
})

test('Ctrl/⌘+B folds it, and F opens it with the filter focused', async () => {
  const { page } = app
  await page.locator('#list').focus(); await page.keyboard.press('ControlOrMeta+b')
  assert.equal(await width(page, '#side'), 58)
  await page.keyboard.press('f'); await page.waitForTimeout(100)
  assert.equal(await width(page, '#side'), 276)
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tq')
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
})

test('dragging the pane very narrow folds it, and dragging out opens it', async () => {
  const { page } = app
  await dragBy(page, '#sideRes', -200)
  assert.equal(await width(page, '#side'), 58); assert.equal(await isRail(), true)
  await dragBy(page, '#sideRes', 260)
  assert.equal(await width(page, '#side'), 318); assert.equal(await isRail(), false)
})

test('the details panel resizes, keeping the list at least 380 px wide', async () => {
  const { page } = app
  await page.click('[data-view="all"]'); await page.locator('#rows .row.is-link').first().click(); await page.keyboard.press('e')
  assert.equal(await width(page, '#insp'), 372)
  await dragBy(page, '#insp .resizer', -150)
  assert.equal(await width(page, '#insp'), 522)
  await dragBy(page, '#insp .resizer', -800)
  assert.equal(await width(page, '#insp'), 742)
  assert.equal(await width(page, '#pane'), 380)
  await page.locator('#rows .row.is-link').nth(1).click()
  assert.ok(await page.$('#insp .resizer'), 'the handle survives switching bookmarks')
  assert.equal(await width(page, '#insp'), 742)
  await page.dblclick('#insp .resizer')
  assert.equal(await width(page, '#insp'), 372)
  await dragBy(page, '#insp .resizer', -100)
  saved = await width(page, '#insp')
})

test('the rail and both widths are remembered after a reload', async () => {
  const { page } = app
  await page.click('#navBtn'); await page.waitForTimeout(700)
  await page.reload(); await page.waitForSelector('#rows .row')
  assert.equal(await isRail(), true); assert.equal(await width(page, '#side'), 58)
  await page.click('#navBtn')
  assert.equal(await width(page, '#side'), 318)
  await page.click('[data-view="all"]'); await page.locator('#rows .row.is-link').first().click(); await page.keyboard.press('e')
  assert.equal(await width(page, '#insp'), saved)
})

test('at 1100 px the details drawer still resizes', async () => {
  const { page } = app
  await page.setViewportSize({ width: 1100, height: 800 }); await page.waitForTimeout(200)
  assert.equal(await width(page, '#insp'), saved)
  await dragBy(page, '#insp .resizer', -80)
  assert.equal(await width(page, '#insp'), saved + 80)
})

test('on a phone the folders pane is a drawer with no handle', async () => {
  const { page } = app
  await page.keyboard.press('Escape'); await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200)
  assert.equal(await page.getAttribute('#navBtn', 'title'), 'Show folders')
  assert.equal(await page.isVisible('#sideRes'), false)
  await page.click('#navBtn'); await page.waitForTimeout(300)
  assert.equal(await page.$eval('#app', a => a.classList.contains('nav-open')), true)
  assert.equal(await left(page, '#side'), 0)
  assert.equal(await page.getAttribute('#navBtn', 'title'), 'Hide folders')
  assertNoErrors(app)
})
