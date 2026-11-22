// The folder tree: expand and collapse all, the folder filter, and "Keep everything A to Z" in the export.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useApp, openFile, fixture, treeNames, linkTitles, text, download, assertNoErrors } from './harness.mjs'

const app = useApp()

test('opens the demo library with its top folders showing', async () => {
  await openFile(app.page, 'bookmarks.html', await fixture('demo'))
  assert.deepEqual(await treeNames(app.page), ['Bookmarks', 'Bookmarks bar', 'Recipes', 'Travel', 'Work', 'Other bookmarks', 'Reading list', 'Garden', 'Old stuff'])
})

test('expand all and collapse all', async () => {
  const { page } = app
  await page.hover('#side'); await page.click('[data-tt="expand"]')
  assert.equal((await treeNames(page)).length, 13)
  await page.click('[data-tt="collapse"]')
  assert.deepEqual(await treeNames(page), ['Bookmarks', 'Bookmarks bar', 'Other bookmarks'])
})

test('F filters folder names, keeping their parents, and Esc twice closes the filter', async () => {
  const { page } = app
  await page.keyboard.press('Escape'); await page.locator('#list').focus()
  await page.keyboard.press('f'); await page.waitForTimeout(250)
  await page.keyboard.type('re')
  assert.deepEqual(await treeNames(page), ['Bookmarks', 'Bookmarks bar', 'Recipes', 'Other bookmarks', 'Reading list'])
  assert.equal(await text(page, '#tfn'), '2')
  await page.keyboard.press('Enter')
  assert.equal(await text(page, '.ptitle'), 'Bookmarks')
  await page.locator('#tq').focus(); await page.keyboard.type('zzzz')
  assert.match(await page.textContent('#tree'), /No folder names contain “rezzzz”\./)
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  assert.equal(await page.$eval('#tfilter', e => e.classList.contains('open')), false)
})

test('A to Z sorts every folder, folders first, and the export follows it', async () => {
  const { page } = app
  await page.click('[data-layout="folder"]')
  await page.locator('#tree .trow').first().click()
  await page.click('[data-h="sort"]'); await page.click('.menu [role="menuitemcheckbox"]')
  assert.deepEqual(await linkTitles(page), ['Bookmarks bar', 'Other bookmarks'])
  const txt = await download(page, () => page.click('#exportBtn'))
  const bad = await page.evaluate(t => {
    const doc = new DOMParser().parseFromString(t, 'text/html'), bad = []
    const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
    for (const dl of doc.querySelectorAll('dl')) {
      const items = [...dl.querySelectorAll(':scope > dt')].map(dt => {
        const h = dt.querySelector(':scope > h3'), a = dt.querySelector(':scope > a')
        return h ? { f: 1, t: h.textContent, bar: h.getAttribute('personal_toolbar_folder') === 'true' } : { f: 0, t: a.textContent }
      })
      for (let i = 1; i < items.length; i++) {
        const a = items[i - 1], b = items[i]
        if (b.bar || a.f < b.f || (a.f === b.f && !a.bar && coll.compare(a.t, b.t) > 0)) bad.push(a.t + ' > ' + b.t)
      }
    }
    return bad
  }, txt)
  assert.deepEqual(bad, [], 'items out of order in the export')
  const top = txt.split('\n').filter(l => /^\s{4}<DT>/.test(l)).map(l => l.replace(/<[^>]+>/g, '').trim())
  assert.deepEqual(top, ['Bookmarks bar', 'Other bookmarks'])
})

test('undo turns A to Z off again', async () => {
  await app.page.keyboard.press('ControlOrMeta+z')
  assert.equal(await text(app.page, '[data-h="sort"]'), 'Sort')
  assertNoErrors(app)
})
