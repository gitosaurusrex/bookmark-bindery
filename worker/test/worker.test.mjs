// Run with: node --test worker/test/*.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, readJSON } from '../src/index.js'

const ORIGIN = 'https://bookmark-bindery.onrender.com'
const fakeEnv = (reply, extra = {}) => {
  const calls = []
  return { calls, ALLOWED_ORIGINS: ORIGIN, AI: { run: async (model, opts) => { calls.push({ model, opts }); return typeof reply === 'function' ? reply(opts) : { response: reply } } }, ...extra }
}
const post = (task, body, origin = ORIGIN) => new Request(`https://assist.example/v1/${task}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const items = n => Array.from({ length: n }, (_, i) => ({ title: `Bookmark ${i}`, url: `example.com/${i}` }))

test('refuses other origins, and answers preflight only for allowed ones', async () => {
  assert.equal((await handle(post('name', { items: items(2) }, 'https://evil.example'), fakeEnv({}))).status, 403)
  const pre = await handle(new Request('https://assist.example/v1/name', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), fakeEnv({}))
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN)
  assert.equal((await handle(new Request('https://assist.example/v1/name', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), fakeEnv({}))).status, 403)
})

test('rejects unknown tasks, bad bodies and too many items', async () => {
  assert.equal((await handle(post('nope', { items: items(2) }), fakeEnv({}))).status, 404)
  assert.equal((await handle(post('constructor', { items: items(2) }), fakeEnv({}))).status, 404)
  assert.equal((await handle(post('name', { items: [] }), fakeEnv({}))).status, 400)
  assert.equal((await handle(post('name', { items: items(61) }), fakeEnv({}))).status, 400)
  assert.equal((await handle(post('tidy', { items: 'x' }), fakeEnv({}))).status, 400)
})

test('rate limit returns 429', async () => {
  const env = fakeEnv({}, { LIMITER: { limit: async () => ({ success: false }) } })
  assert.equal((await handle(post('name', { items: items(2) }), env)).status, 429)
})

test('tidy keeps only valid, unique bookmark numbers and merges same-named folders', async () => {
  const env = fakeEnv({ folders: [
    { name: 'Recipes', items: [0, 1, 1, 99, -1, 'x'] },
    { name: 'recipes', items: [2] },
    { name: '  ', items: [3] },
    { name: 'Travel', items: [0, 3] },
    { name: 'Empty', items: [] },
  ] })
  const res = await handle(post('tidy', { items: items(5), folder: 'Other', existing: ['Recipes'] }), env)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { folders: [{ name: 'Recipes', items: [0, 1, 2] }, { name: 'Travel', items: [3] }] })
  assert.match(env.calls[0].opts.messages[1].content, /"Recipes"/)
  assert.equal(env.calls[0].opts.response_format.type, 'json_schema')
})

test('name drops duplicates and the current name, and keeps three', async () => {
  const env = fakeEnv({ names: ['Travel', 'travel', 'Trips', 'Japan', 'Holidays', ''] })
  const res = await handle(post('name', { items: items(3), current: 'Trips' }), env)
  assert.deepEqual(await res.json(), { names: ['Travel', 'Japan', 'Holidays'] })
})

test('titles returns only changed titles for real bookmarks', async () => {
  const env = fakeEnv({ titles: [{ item: 0, title: 'Clean' }, { item: 1, title: 'Bookmark 1' }, { item: 0, title: 'Again' }, { item: 7, title: 'Out of range' }] })
  const res = await handle(post('titles', { items: items(3) }), env)
  assert.deepEqual(await res.json(), { titles: [{ item: 0, title: 'Clean' }] })
})

test('falls back to plain text when JSON mode fails, and reads JSON out of prose', async () => {
  const env = fakeEnv(opts => { if (opts.response_format) throw new Error('JSON Mode couldn\'t be met'); return { response: 'Sure! {"names":["Work"]} Hope that helps.' } })
  const res = await handle(post('name', { items: items(2) }), env)
  assert.deepEqual(await res.json(), { names: ['Work'] })
  assert.equal(env.calls.length, 2)
})

test('a model that never answers in JSON gives a 502', async () => {
  const res = await handle(post('name', { items: items(2) }), fakeEnv('no json here'))
  assert.equal(res.status, 502)
})

test('readJSON accepts objects and strings', () => {
  assert.deepEqual(readJSON({ a: 1 }), { a: 1 })
  assert.deepEqual(readJSON('```json\n{"a":2}\n```'), { a: 2 })
  assert.throws(() => readJSON(''))
})
