// Bindery Assist through the real Worker code with a fake model: the consent sheet, Tidy, Clean up titles, Suggest a
// name, what's sent, turning it off, and the error when the Worker can't be reached.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useApp, openFile, fixture, linkTitles, text, assertNoErrors, ASSIST } from './harness.mjs'

const app = useApp({
  assist: ({ body, prompt }) => {
    if (prompt.includes('Group them')) {
      return { folders: [
        { name: 'Wiki pages', items: body.items.map((x, i) => /wiki/i.test(x.title + x.url) ? i : -1).filter(i => i >= 0) },
        { name: 'Reading list', items: [0] },
        { name: 'Everything else', items: body.items.map((_, i) => i) },
      ] }
    }
    if (prompt.includes('Suggest 3')) return { names: ['Kitchen', 'Recipes', 'Cooking'] }
    return { titles: body.items.map((x, i) => ({ item: i, title: x.title.split(/ [—|-] /)[0] })) }
  },
})

test('"Not now" on the welcome sheet sends nothing', async () => {
  const { page } = app
  await openFile(page, 'bookmarks.html', await fixture('demo'))
  await page.click('[data-layout="folder"]')
  assert.ok(await page.isVisible('#aiBtn'))
  await page.click('#aiBtn')
  await page.waitForSelector('.dialog.onboard')
  await page.click('.ob-alt')
  assert.equal(app.calls.length, 0)
  assert.equal(await page.isVisible('#menu'), false)
})

test('an AI item in a row menu asks first, then runs Tidy into a review', async () => {
  const { page } = app
  await page.locator('#tree .trow', { hasText: 'Other bookmarks' }).click()
  await page.locator('#rows .row', { hasText: 'Reading list' }).click({ button: 'right' })
  const menu = await page.$$eval('#menu .mi span', a => a.map(x => x.textContent))
  assert.ok(menu.includes('Tidy into folders…') && menu.includes('Suggest a name…'))
  await page.locator('#menu .mi', { hasText: 'Tidy into folders' }).click()
  await page.waitForSelector('.dialog.onboard')
  await page.click('.ob-go')
  await page.waitForSelector('.grp.tgrp')
  // "Reading list" (the folder being tidied) doesn't come back as a suggestion.
  assert.deepEqual(await page.$$eval('.grp.tgrp .tg-name', a => a.map(x => x.textContent)), ['Wiki pages', 'Everything else'])
  await page.click('[data-h="tdiscard"]')
  assert.equal(await text(page, '.ptitle'), 'Reading list')
})

test('Clean up titles shows a checklist and renames only what stays ticked', async () => {
  const { page } = app
  await page.locator('#tree .trow', { hasText: 'Travel' }).click()
  await page.locator('#rows .row', { hasText: 'Japan 2026' }).dblclick()
  await page.click('#aiBtn'); await page.locator('#menu .mi', { hasText: 'Clean up titles' }).click()
  await page.waitForSelector('.dialog.wide')
  await page.locator('.ai-row input').first().uncheck()
  assert.equal(await text(page, '.dialog [data-m="ok"]'), 'Rename 1 bookmark')
  await page.click('.dialog [data-m="ok"]')
  assert.deepEqual(await linkTitles(page), ['Japan Rail Pass', 'Kyoto — Wikivoyage', 'JR Pass', 'Tokyo', 'Hakone day trip'])
})

test('Suggest a name offers chips, and a chip renames the folder', async () => {
  const { page } = app
  await page.locator('#tree .trow', { hasText: 'Recipes' }).click()
  await page.click('#aiBtn'); await page.locator('#menu .mi', { hasText: 'Suggest a name' }).click()
  await page.waitForSelector('.ttl .chip[data-chip="0"]')
  await page.click('.ttl .chip[data-chip="1"]')
  await page.waitForTimeout(100)
  assert.equal(await text(page, '.ptitle'), 'Cooking')
})

test('addresses are sent without query strings or fragments', () => {
  const urls = app.calls.flatMap(c => c.body.items.map(i => i.url))
  assert.ok(urls.length > 0)
  assert.deepEqual(urls.filter(u => u.includes('?') || u.includes('#') || /^https?:/.test(u)), [])
})

test('About → Turn off turns Assist off', async () => {
  const { page } = app
  await page.click('#aiBtn'); await page.locator('#menu .mi', { hasText: 'About' }).click()
  await page.waitForSelector('.dialog.onboard')
  await page.click('.ob-alt.danger')
  assert.equal(await page.$eval('#aiBtn', b => b.className), 'icon-btn ai-btn')
})

test('when the Worker can\'t be reached, a toast says so and nothing is left open', async () => {
  const { page } = app
  await page.unroute(ASSIST + '/**'); await page.route(ASSIST + '/**', r => r.abort())
  await page.click('#aiBtn'); await page.click('.ob-go'); await page.waitForTimeout(200)
  await page.click('#aiBtn'); await page.locator('#menu .mi', { hasText: 'Suggest a name' }).click()
  await page.waitForTimeout(500)
  assert.deepEqual(await page.$$eval('.toast.err span', a => a.map(x => x.textContent)), ['Couldn’t reach Bindery Assist. Check your connection and try again.'])
  assert.equal(await page.$eval('#modal', m => m.hidden), true)
  assertNoErrors(app, /net::ERR_FAILED|Failed to fetch/)
})
