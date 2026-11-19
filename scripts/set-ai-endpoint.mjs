/**
 * Points Bindery at a Bindery Assist Worker, or turns Assist off.
 *
 *   node scripts/set-ai-endpoint.mjs https://bookmark-bindery-ai.<your-subdomain>.workers.dev
 *   node scripts/set-ai-endpoint.mjs off
 *
 * Updates both places in index.html that must agree: the bindery-ai meta tag the page reads, and the Content
 * Security Policy's connect-src, the only address the page is allowed to connect to.
 */
import { readFile, writeFile } from 'node:fs/promises'

const FILE = new URL('../index.html', import.meta.url)
const fail = msg => { console.error(msg); process.exit(1) }
const arg = process.argv[2]
if (!arg) fail('Usage: node scripts/set-ai-endpoint.mjs <https://worker-address> | off')

let origin = ''
if (arg !== 'off') {
  let u
  try { u = new URL(arg) } catch { fail(`Not an address: ${arg}`) }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) fail('The address must start with https://')
  if (u.pathname !== '/' || u.search || u.hash || u.username) fail(`Give just the Worker's address, like ${u.origin}`)
  origin = u.origin
}

const META = /<meta name="bindery-ai" content="[^"]*">/
const CSP = /connect-src [^;"]+/
let html = await readFile(FILE, 'utf8')
if (!META.test(html) || !CSP.test(html)) fail('index.html is missing the bindery-ai meta tag or the connect-src policy')
html = html.replace(META, `<meta name="bindery-ai" content="${origin}">`).replace(CSP, `connect-src ${origin || "'none'"}`)
await writeFile(FILE, html)
console.log(origin ? `Bindery Assist now uses ${origin}` : 'Bindery Assist is off')
