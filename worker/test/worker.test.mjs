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
  assert.deepEqual(await res.json(), { folders: [{ name: 'Recipes', items: [0, 1, 2] }] })
  assert.match(env.calls[0].opts.messages[1].content, /"Recipes"/)
  assert.equal(env.calls[0].opts.response_format.type, 'json_schema')
})

test('tidy drops new folders with a single bookmark, but keeps existing ones', async () => {
  const env = fakeEnv({ folders: [{ name: 'Solo', items: [0] }, { name: 'Pair', items: [1, 2] }, { name: 'news', items: [3] }] })
  const res = await handle(post('tidy', { items: items(5), existing: ['News'] }), env)
  assert.deepEqual(await res.json(), { folders: [{ name: 'Pair', items: [1, 2] }, { name: 'news', items: [3] }] })
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

/* ---------- page: name and icon for a new bookmark ---------- */
import { pageUrl, pageTitle, iconLinks, decodeEntities } from '../src/index.js'

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
function fakeWeb(routes) {
  const seen = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, opts) => {
    seen.push(String(url))
    const r = routes[String(url)]
    if (!r) return new Response('nope', { status: 404 })
    if (r instanceof Error) throw r
    const res = new Response(r.body, { status: r.status || 200, headers: { 'Content-Type': r.type || 'text/html' } })
    Object.defineProperty(res, 'url', { value: r.finalUrl || String(url) })
    return res
  }
  return { seen, restore: () => { globalThis.fetch = real } }
}
const postPage = url => post('page', { url })

test('page reads og:title and the best icon link, resolved against the final address', async () => {
  const web = fakeWeb({
    'https://example.com/a?x=1': { finalUrl: 'https://www.example.com/a/', body: `<html><head><title>Fallback | Site</title>
      <meta property="og:title" content="Tom &amp; Jerry&#8217;s page">
      <link rel="apple-touch-icon" href="/apple.png"><link rel="icon" type="image/png" sizes="32x32" href="icons/fav-32.png"></head></html>` },
    'https://www.example.com/a/icons/fav-32.png': { body: PNG, type: 'image/png' },
  })
  try {
    const res = await handle(postPage('https://example.com/a?x=1'), fakeEnv({}))
    assert.equal(res.status, 200)
    const out = await res.json()
    assert.equal(out.title, 'Tom & Jerry’s page')
    assert.equal(out.icon, 'data:image/png;base64,' + Buffer.from(PNG).toString('base64'))
    assert.deepEqual(web.seen, ['https://example.com/a?x=1', 'https://www.example.com/a/icons/fav-32.png'])
  } finally { web.restore() }
})

test('page falls back to <title> and /favicon.ico, and skips icons that are too big or not images', async () => {
  const web = fakeWeb({
    'https://site.test/': { body: '<title>\n  Plain   title </title><link rel="icon" href="/big.png"><link rel="shortcut icon" href="/page.html">' },
    'https://site.test/big.png': { body: new Uint8Array(60 * 1024), type: 'image/png' },
    'https://site.test/page.html': { body: '<html>', type: 'text/html' },
    'https://site.test/favicon.ico': { body: PNG, type: 'application/octet-stream' },
  })
  try {
    const out = await (await handle(postPage('https://site.test/'), fakeEnv({}))).json()
    assert.equal(out.title, 'Plain title')
    assert.match(out.icon, /^data:image\/x-icon;base64,/)
  } finally { web.restore() }
})

test('page answers with nothing, not an error, when the site is down or not HTML', async () => {
  const web = fakeWeb({ 'https://down.test/': new Error('connect failed'), 'https://pdf.test/x.pdf': { body: '%PDF', type: 'application/pdf' } })
  try {
    assert.deepEqual(await (await handle(postPage('https://down.test/'), fakeEnv({}))).json(), { title: '', icon: '' })
    assert.deepEqual(await (await handle(postPage('https://pdf.test/x.pdf'), fakeEnv({}))).json(), { title: '', icon: '' })
  } finally { web.restore() }
})

test('page refuses local, private and odd addresses', async () => {
  for (const u of ['http://localhost/', 'http://192.168.1.1/', 'http://[::1]/', 'http://printer.local/', 'ftp://example.com/', 'https://user:pw@example.com/', 'https://example.com:22/', 'nonsense', 42])
    assert.equal((await handle(post('page', { url: u }), fakeEnv({}))).status, 400, String(u))
  assert.ok(pageUrl('https://example.com:8443/x'))
})

test('helpers: entities, titles, icon ranking', () => {
  assert.equal(decodeEntities('a &lt;b&gt; &#x1F600; &unknown;'), 'a <b> 😀 &unknown;')
  assert.equal(pageTitle('<meta name="twitter:title" content="Tw"><title>T</title>'), 'Tw')
  assert.deepEqual(iconLinks('<link rel="icon" href="a.svg"><link rel="icon" sizes="16x16" href="b.png"><link rel="mask-icon" href="m.svg"><link rel="icon" href="javascript:x">', 'https://e.com/'), ['https://e.com/b.png', 'https://e.com/a.svg'])
})

/* ---------- place: suggest a folder ---------- */
test('place returns up to three valid, unique folder numbers', async () => {
  const env = fakeEnv({ folders: [3, 3, 9, -1, 0, 1, 2] })
  const res = await handle(post('place', { items: [{ title: 'Kyoto guide', url: 'wikivoyage.org/wiki/Kyoto' }], folders: ['Bar', 'Bar / Travel', 'Bar / Travel / Japan', 'Other / Recipes'] }), env)
  assert.deepEqual(await res.json(), { folders: [3, 0, 1] })
  assert.match(env.calls[0].opts.messages[1].content, /2\. Bar \/ Travel \/ Japan/)
})

test('place needs exactly one bookmark and at least two folders', async () => {
  assert.equal((await handle(post('place', { items: items(2), folders: ['a', 'b'] }), fakeEnv({}))).status, 400)
  assert.deepEqual(await (await handle(post('place', { items: items(1), folders: ['only'] }), fakeEnv({ folders: [0] }))).json(), { folders: [] })
})

/* ---------- describe: a short note for a bookmark ---------- */
import { pageDescription, pageText } from '../src/index.js'

test('describe gives the model the page description and text, and returns its note', async () => {
  const web = fakeWeb({ 'https://soup.test/lentil': { body: `<html><head><title>Lentil soup | Soups</title><meta name="description" content="A hearty red lentil soup."><script>var x = "<p>nope</p>"</script></head>
    <body><nav>Home Menu</nav><main><h1>Lentil soup</h1><p>Simmer red lentils with cumin &amp; lemon for 25 minutes.</p></main><footer>© Soups</footer></body></html>` } })
  try {
    const env = fakeEnv({ description: 'A 25-minute red lentil soup with cumin and lemon.' })
    const out = await (await handle(post('describe', { url: 'https://soup.test/lentil', title: 'Lentil soup' }), env)).json()
    assert.deepEqual(out, { description: 'A 25-minute red lentil soup with cumin and lemon.' })
    const prompt = env.calls[0].opts.messages[1].content
    assert.match(prompt, /describes itself as: A hearty red lentil soup\./)
    assert.match(prompt, /Start of the page text: Lentil soup Simmer red lentils with cumin & lemon for 25 minutes\./)
    assert.doesNotMatch(prompt, /nope|Home Menu|© Soups/)
  } finally { web.restore() }
})

test('describe falls back to the page description when the model fails, and is empty for unreadable pages', async () => {
  const web = fakeWeb({ 'https://a.test/': { body: '<meta property="og:description" content="Own words.">' }, 'https://b.test/': { body: 'x', type: 'image/png' } })
  try {
    assert.deepEqual(await (await handle(post('describe', { url: 'https://a.test/' }), fakeEnv('no json'))).json(), { description: 'Own words.' })
    assert.deepEqual(await (await handle(post('describe', { url: 'https://b.test/' }), fakeEnv({ description: 'x' }))).json(), { description: '' })
    assert.equal((await handle(post('describe', { url: 'http://10.0.0.1/' }), fakeEnv({}))).status, 400)
  } finally { web.restore() }
})

test('pageText prefers <main>, then <article>, then <body>', () => {
  assert.equal(pageText('<body><p>Body</p><article>Art</article></body>', 100), 'Art')
  assert.equal(pageText('<body><p>Only &lt;body&gt;</p></body>', 100), 'Only <body>')
  assert.equal(pageDescription('<meta name="twitter:description" content="T"><meta name="description" content="D">'), 'D')
})
