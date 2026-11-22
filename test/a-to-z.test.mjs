// "Keep everything A to Z": edits land in order, hand reordering is refused, the setting persists, and undo/redo never
// shows an unsorted tree (the bug fixed in #9).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useApp, openFile, fixture, rows, linkTitles, lastToast, text, assertNoErrors } from './harness.mjs'

const app = useApp()
const RECIPES = ['Kimchi basics', 'Lentil soup', 'Miso glazed aubergine', 'Sourdough starter, day by day', 'Weeknight Lentil Soup']

test('turning A to Z on sorts the open folder', async () => {
  const { page } = app
  await openFile(page, 'bookmarks.html', await fixture('demo'))
  await page.click('[data-layout="folder"]')
  await page.locator('#tree .trow', { hasText: 'Recipes' }).click()
  await page.click('[data-h="sort"]'); await page.click('.menu [role="menuitemcheckbox"]')
  assert.deepEqual(await linkTitles(page), RECIPES)
})

test('a renamed bookmark moves to its place', async () => {
  const { page } = app
  await page.locator('#rows .row', { hasText: 'Kimchi basics' }).click()
  await page.keyboard.press('F2'); await page.keyboard.type('Zucchini bread'); await page.keyboard.press('Enter')
  assert.deepEqual(await linkTitles(page), [...RECIPES.slice(1), 'Zucchini bread'])
})

test('dragging to reorder is refused with an explanation', async () => {
  const { page } = app
  await page.locator('#rows .row', { hasText: 'Zucchini bread' }).dragTo(page.locator('#rows .row').first(), { targetPosition: { x: 200, y: 4 } })
  await page.waitForTimeout(100)
  assert.deepEqual(await linkTitles(page), [...RECIPES.slice(1), 'Zucchini bread'])
  assert.match(await lastToast(page), /A to Z order is on, so items can’t be rearranged by hand/)
})

test('a new folder lands before the bookmarks', async () => {
  const { page } = app
  await page.click('[data-h="add"]'); await page.locator('#menu .mi', { hasText: 'New folder' }).click()
  await page.keyboard.type('Breads'); await page.keyboard.press('Enter')
  assert.deepEqual(await linkTitles(page), ['Breads', ...RECIPES.slice(1), 'Zucchini bread'])
})

test('the setting survives a reload and applies to a newly opened file', async () => {
  const { page } = app
  await page.reload(); await page.waitForSelector('#rows .row')
  assert.equal(await text(page, '[data-h="sort"]'), 'A to Z')
  await openFile(page, 'b2.html', await fixture('demo'))
  assert.match(await lastToast(page), /^Opened b2\.html: 33 bookmarks in 12 folders, sorted A to Z$/)
  await page.locator('#tree .trow', { hasText: 'Work' }).click()
  assert.deepEqual(await linkTitles(page), ['Design', 'Dev', 'Team calendar'])
  await page.keyboard.press('ControlOrMeta+z')
  assert.equal(await text(page, '[data-h="sort"]'), 'Sort')
})

test('undo and redo around A to Z with separators never show an unsorted tree', async () => {
  const { page } = app
  await openFile(page, 'separators.html', await fixture('separators.html'))
  await page.click('[data-layout="folder"]').catch(() => {})
  await page.locator('#tree .trow', { hasText: 'Bookmarks Toolbar' }).click()
  await page.click('[data-h="sort"]'); await page.locator('#menu .mi', { hasText: 'By name' }).click()
  const sorted = ['Alpha', 'Zeta', '——', 'Work', 'Beta', 'Delta']
  assert.deepEqual(await rows(page), sorted)
  await page.click('[data-h="sort"]'); await page.click('.menu [role="menuitemcheckbox"]')
  assert.equal(await text(page, '[data-h="sort"]'), 'A to Z')
  assert.match(await lastToast(page), /Everything is already A to Z/)
  await page.locator('#list').focus()
  await page.keyboard.press('ControlOrMeta+z')
  assert.deepEqual(await rows(page), sorted); assert.equal(await text(page, '[data-h="sort"]'), 'Sort')
  await page.keyboard.press('ControlOrMeta+z')
  assert.deepEqual(await rows(page), ['Zeta', 'Alpha', '——', 'Delta', 'Beta', 'Work']); assert.equal(await text(page, '[data-h="sort"]'), 'Sort')
  await page.keyboard.press('ControlOrMeta+Shift+z'); await page.keyboard.press('ControlOrMeta+Shift+z')
  assert.deepEqual(await rows(page), sorted); assert.equal(await text(page, '[data-h="sort"]'), 'A to Z')
  assertNoErrors(app)
})
