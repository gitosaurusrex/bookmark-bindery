// The Tidy review on a 400-bookmark folder: batching, renaming and merging suggested folders, Move/Stay, Send to,
// dragging between folders, leaving and coming back, Apply as one undo step, and folder name chips.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useApp, openFile, bigLibrary, linkTitles, lastToast, text, turnOnAssist, assertNoErrors } from './harness.mjs'

const GROUP = { github: 'Code', youtube: 'videos', nytimes: 'News', wikipedia: 'Reference', allrecipes: 'Recipes' }
const app = useApp({
  assist: ({ body, prompt }) => {
    if (prompt.includes('Group them')) {
      const by = {}
      body.items.forEach((x, i) => { const k = Object.keys(GROUP).find(k => x.url.includes(k)); if (k) (by[GROUP[k]] ||= []).push(i) })
      return { folders: Object.entries(by).map(([name, items]) => ({ name, items })) }
    }
    if (prompt.includes('Suggest 3')) return { names: ['Trip ideas', 'Japan', 'Travel plans'] }
    return { titles: [] }
  },
})

const heads = () => app.page.$$eval('#rows .grp.tgrp', a => a.map(g => (g.querySelector('.tg-name')?.textContent || '') + ' [' + (g.querySelector('.tbadge')?.textContent || '') + '] ' + g.querySelector('.n').textContent))
const scrollTo = top => app.page.evaluate(t => { document.getElementById('list').scrollTop = t }, top)

/** Every group header in the (virtualized) review, scrolling through it. */
async function allHeads() {
  const { page } = app, seen = new Map()
  await scrollTo(0); await page.waitForTimeout(60)
  for (let k = 0; k < 60; k++) {
    for (const h of await heads()) seen.set(h.split(' [')[0], h)
    const done = await page.evaluate(() => { const l = document.getElementById('list'), end = l.scrollTop + l.clientHeight >= l.scrollHeight - 2; l.scrollTop += 600; return end })
    await page.waitForTimeout(30)
    if (done) break
  }
  await scrollTo(0); await page.waitForTimeout(30)
  return [...seen.values()]
}
async function showHead(name) {
  const { page } = app
  await scrollTo(0); await page.waitForTimeout(60)
  for (let k = 0; k < 60; k++) {
    const loc = page.locator('.grp.tgrp .tg-name', { hasText: name })
    if (await loc.count()) { await loc.first().scrollIntoViewIfNeeded(); return loc.first() }
    await page.evaluate(() => { document.getElementById('list').scrollTop += 600 }); await page.waitForTimeout(30)
  }
  throw new Error('no group named ' + name)
}

let stayedTitle

test('Tidy sends 400 bookmarks in batches, telling later batches about earlier folders', async () => {
  const { page } = app
  await openFile(page, 'big.html', bigLibrary())
  await page.click('[data-layout="folder"]')
  await turnOnAssist(page)
  await page.locator('#tree .trow', { hasText: 'Unsorted' }).click()
  await page.click('#aiBtn'); await page.locator('#menu .mi', { hasText: 'Tidy' }).click()
  await page.waitForSelector('.grp.tgrp')
  assert.deepEqual(app.calls.map(c => `${c.task}:${c.body.items.length} existing=${(c.body.existing || []).join('/')}`), [
    'tidy:150 existing=News/Videos',
    'tidy:150 existing=News/Videos/Code/Reference/Recipes',
    'tidy:100 existing=News/Videos/Code/Reference/Recipes',
  ])
  assert.deepEqual(await allHeads(), [
    'Code [New folder] 67 bookmarks',
    'Videos [Existing folder] 67 bookmarks',
    'News [Existing folder] 67 bookmarks',
    'Reference [New folder] 67 bookmarks',
    'Recipes [New folder] 66 bookmarks',
    'Staying in “Unsorted” [] 66 bookmarks',
  ])
  assert.match(await page.textContent('.pmeta'), /^3 new folders · 2 existing · 334 of 400 bookmarks move · 66 stay/)
  assert.equal(await text(page, '[data-view="tidy"]'), 'Tidy plan334')
})

test('renaming a suggested folder, and merging it by giving it an existing name', async () => {
  const { page } = app
  await (await showHead('Code')).click()
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('Programming'); await page.keyboard.press('Enter')
  await (await showHead('Reference')).click()
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('Videos'); await page.keyboard.press('Enter')
  assert.deepEqual(await allHeads(), [
    'Programming [New folder] 67 bookmarks',
    'Videos [Existing folder] 134 bookmarks',
    'News [Existing folder] 67 bookmarks',
    'Recipes [New folder] 66 bookmarks',
    'Staying in “Unsorted” [] 66 bookmarks',
  ])
  assert.equal(await lastToast(page), 'Merged into “Videos”')
})

test('Stay, Send to → Leave, and the group checkbox', async () => {
  const { page } = app
  const first = page.locator('#rows .tidy-row').first()
  stayedTitle = await first.locator('.t').textContent()
  await first.locator('[data-a="tstay"]').click()
  assert.equal((await heads())[0], 'Programming [New folder] 66 of 67 move')
  await page.locator('#rows .tidy-row').nth(1).click()
  await page.locator('#rows .tidy-row').nth(3).click({ modifiers: ['Shift'] })
  assert.deepEqual(await page.$$eval('#selbar button span', a => a.map(x => x.textContent)), ['Move', 'Stay', 'Send to…'])
  await page.keyboard.press('m')
  assert.deepEqual(await page.$$eval('#menu .mi span, #menu .mlabel', a => a.map(x => x.textContent)),
    ['Send 3 bookmarks to', 'Videos', 'News', 'Recipes', 'New folder…', 'Leave in “Unsorted”'])
  await page.locator('#menu .mi', { hasText: 'Leave in' }).click()
  assert.equal((await heads())[0], 'Programming [New folder] 63 of 64 move')
  await page.locator('.grp.tgrp [data-a="tall"]').first().click()
  assert.equal((await heads())[0], 'Programming [New folder] 64 bookmarks')
  await page.locator('.grp.tgrp [data-a="tall"]').first().click()
  assert.equal((await heads())[0], 'Programming [New folder] 0 of 64 move')
})

test('Send to → New folder makes a new suggested folder', async () => {
  const { page } = app
  await page.locator('#rows .tidy-row').nth(5).click()
  await page.keyboard.press('m'); await page.locator('#menu .mi', { hasText: 'New folder' }).click()
  await page.keyboard.type('Favourites'); await page.keyboard.press('Enter')
  assert.deepEqual((await allHeads()).filter(h => h.startsWith('Favourites')), ['Favourites [New folder] 1 bookmark'])
})

test('dropping a bookmark on a group header sends it there', async () => {
  const { page } = app
  await showHead('Videos')
  await page.evaluate(() => {
    const head = [...document.querySelectorAll('.grp.tgrp')].find(g => g.querySelector('.tg-name')?.textContent === 'Videos')
    const row = [...document.querySelectorAll('#rows .tidy-row')].filter(r => r.offsetTop < head.offsetTop).sort((a, b) => b.offsetTop - a.offsetTop)[0]
    const dt = new DataTransfer(), hb = head.getBoundingClientRect()
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    const at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: hb.left + 100, clientY: hb.top + hb.height / 2 }
    head.dispatchEvent(new DragEvent('dragover', at)); head.dispatchEvent(new DragEvent('drop', at))
    document.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
  })
  await page.waitForTimeout(100)
  assert.deepEqual((await allHeads()).filter(h => /Programming|Videos/.test(h)),
    ['Programming [New folder] 0 of 62 move', 'Videos [Existing folder] 135 bookmarks'])
})

test('the plan survives visiting another folder', async () => {
  const { page } = app
  await page.locator('#rows .tidy-row').nth(2).click(); await page.keyboard.press('d')
  assert.match(await page.textContent('.pmeta'), /^2 new folders · 2 existing · 269 of 400 bookmarks move · 131 stay/)
  await page.locator('#tree .trow', { hasText: 'Bookmarks bar' }).click()
  assert.equal(await text(page, '.ptitle'), 'Bookmarks bar')
  assert.ok(await page.isVisible('[data-view="tidy"]'))
  await page.click('[data-view="tidy"]')
  assert.equal(await text(page, '.ptitle'), 'Tidy “Unsorted”')
})

test('Apply moves everything in one step, and one undo puts it back', async () => {
  const { page } = app
  assert.equal(await text(page, '#markbar .count'), 'Move 269 bookmarks into 4 folders')
  await page.click('#markbar [data-mb="tapply"]')
  assert.equal(await lastToast(page), 'Moved 269 bookmarks into 4 folders')
  assert.equal(await text(page, '.ptitle'), 'Unsorted')
  assert.deepEqual((await linkTitles(page)).slice(0, 4), ['News', 'Videos', 'Recipes', 'Favourites'])
  assert.equal(await page.isVisible('[data-view="tidy"]'), false)
  assert.ok((await linkTitles(page)).includes(stayedTitle))
  await page.keyboard.press('ControlOrMeta+z')
  assert.deepEqual(await page.$$eval('#rows .row.is-folder .t', a => a.map(x => x.textContent)), ['News', 'Videos'])
})

test('Group offers name chips that keep the name field focused', async () => {
  const { page } = app
  await page.locator('#rows .row.is-link').nth(0).click()
  await page.locator('#rows .row.is-link').nth(1).click({ modifiers: ['ControlOrMeta'] })
  await page.keyboard.press('g'); await page.waitForTimeout(150)
  assert.deepEqual(await page.$$eval('.row[data-editing] .chip', a => a.map(x => x.textContent)), ['Suggest names'])
  await page.click('.row[data-editing] .chip.ask')
  await page.waitForSelector('.row[data-editing] .chip[data-chip="0"]')
  assert.deepEqual(await page.$$eval('.row[data-editing] .chip', a => a.map(x => x.textContent)), ['Trip ideas', 'Japan', 'Travel plans'])
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains('in-t')))
  await page.click('.row[data-editing] .chip[data-chip="1"]')
  assert.deepEqual(await page.$$eval('#rows .row.is-folder .t', a => a.map(x => x.textContent)), ['News', 'Videos', 'Japan'])
  assert.equal(await page.$('.row[data-editing]'), null)
})

test('renaming a folder\'s title offers chips, and the menu item asks straight away', async () => {
  const { page } = app
  await page.locator('#rows .row.is-folder', { hasText: 'Japan' }).dblclick()
  await page.dblclick('.ptitle')
  assert.deepEqual(await page.$$eval('.ttl .chip', a => a.map(x => x.textContent)), ['Suggest names'])
  await page.keyboard.press('Escape')
  await page.click('.crumb >> nth=-1')
  await page.locator('#rows .row.is-folder', { hasText: 'News' }).click({ button: 'right' })
  await page.locator('#menu .mi', { hasText: 'Suggest a name' }).click()
  await page.waitForSelector('.row[data-editing] .chip[data-chip="0"]')
  assert.deepEqual(await page.$$eval('.row[data-editing] .chip', a => a.map(x => x.textContent)), ['Trip ideas', 'Japan', 'Travel plans'])
  await page.keyboard.press('Escape')
  assert.equal(app.calls.length, 5)
  assertNoErrors(app)
})
