/* Bindery Assist: the small helper behind Bookmark Bindery's optional AI features.
   It takes the titles and addresses of the bookmarks that one action is for, asks a Workers AI model, checks the
   answer, and sends it back. It stores nothing and logs no bookmark content. */

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_BODY = 96 * 1024; // characters
const MAX_ITEMS = { tidy: 150, name: 60, titles: 100, place: 1 };
const MAX_FOLDERS = 400;
const UA = 'Mozilla/5.0 (compatible; BookmarkBindery/1.0; +https://bookmark-bindery.onrender.com)';

export default { fetch: handle };

export async function handle(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const cors = allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : null;
  if (req.method === 'OPTIONS') {
    return new Response(null, cors
      ? { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } }
      : { status: 403 });
  }
  if (!cors) return json({ error: 'origin' }, 403);
  const reply = (body, status = 200) => json(body, status, cors);

  const task = new URL(req.url).pathname.replace(/^\/v1\//, '');
  if (req.method !== 'POST' || !Object.hasOwn(TASKS, task)) return reply({ error: 'not_found' }, 404);

  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: req.headers.get('CF-Connecting-IP') || 'unknown' });
    if (!success) return reply({ error: 'busy' }, 429);
  }

  const text = await req.text();
  if (text.length > MAX_BODY) return reply({ error: 'too_big' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return reply({ error: 'bad_request' }, 400); }
  // "page" takes one address; every other task takes a list of bookmarks.
  const byUrl = task === 'page' || task === 'describe', byTags = task === 'tagsim';
  const items = byUrl || byTags ? [] : cleanItems(body?.items, MAX_ITEMS[task]);
  if (!items) return reply({ error: 'bad_request' }, 400);
  if (byUrl && !pageUrl(body?.url)) return reply({ error: 'bad_request' }, 400);
  if (byTags && !cleanTags(body?.tags)) return reply({ error: 'bad_request' }, 400);

  try {
    return reply(await TASKS[task](env, items, body));
  } catch {
    return reply({ error: 'model' }, 502);
  }
}

const TASKS = {
  /* Groups a folder's bookmarks into a few new or existing folders. */
  async tidy(env, items, body) {
    const folder = clip(body.folder, 120) || 'Bookmarks';
    const existing = Array.isArray(body.existing) ? body.existing.map(x => clip(x, 120)).filter(Boolean).slice(0, 40) : [];
    const system = 'You organize browser bookmarks into folders. Reply with JSON only.';
    const user = [
      `These bookmarks are all in the folder "${folder}". Group them into 2 to 8 folders with short, clear names (1 to 3 words), written in the same language as the bookmarks.`,
      existing.length ? `The folder already has these subfolders. Reuse one of these names exactly when it fits: ${existing.map(x => `"${x}"`).join(', ')}.` : '',
      'Put each bookmark in at most one folder. Leave a bookmark out if it fits nowhere. Every folder needs at least 2 bookmarks unless it is an existing subfolder.',
      'Reply as {"folders":[{"name":"Folder name","items":[0,3,5]}]}, where items are the bookmark numbers.',
      '',
      listing(items),
    ].filter(x => x !== '').join('\n');
    const out = await ask(env, system, user, {
      type: 'object',
      properties: { folders: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, items: { type: 'array', items: { type: 'integer' } } }, required: ['name', 'items'] } } },
      required: ['folders'],
    }, 2048);
    const used = new Set(), byName = new Map();
    for (const f of Array.isArray(out?.folders) ? out.folders : []) {
      const name = clip(f?.name, 60);
      if (!name || !Array.isArray(f.items)) continue;
      const key = name.toLowerCase();
      const entry = byName.get(key) || { name, items: [] };
      for (const i of f.items) if (Number.isInteger(i) && i >= 0 && i < items.length && !used.has(i)) { used.add(i); entry.items.push(i); }
      if (entry.items.length) byName.set(key, entry);
    }
    // A new folder for a single bookmark isn't tidying. Those bookmarks stay where they are.
    const keep = new Set(existing.map(x => x.toLowerCase()));
    return { folders: [...byName.values()].filter(f => f.items.length > 1 || keep.has(f.name.toLowerCase())).slice(0, 12) };
  },

  /* Picks up to three existing folders for a new bookmark, best first. */
  async place(env, items, body) {
    const folders = Array.isArray(body.folders) ? body.folders.slice(0, MAX_FOLDERS).map(x => clip(x, 160)) : [];
    if (folders.length < 2 || folders.some(f => !f)) return { folders: [] };
    const b = items[0];
    const system = 'You file browser bookmarks into folders. Reply with JSON only.';
    const user = [
      `Which of these folders fits this bookmark best? Bookmark: ${b.title || '(no title)'}${b.url ? ` — ${b.url}` : ''}`,
      'Pick up to 3 folders, best first. Prefer a specific folder over a general one. Folder paths use " / " between levels.',
      'Reply as {"folders":[4,12]}, where the numbers are folder numbers from the list.',
      '',
      folders.map((f, i) => `${i}. ${f}`).join('\n'),
    ].join('\n');
    const out = await ask(env, system, user, {
      type: 'object', properties: { folders: { type: 'array', items: { type: 'integer' } } }, required: ['folders'],
    }, 128);
    const picks = [];
    for (const i of Array.isArray(out?.folders) ? out.folders : []) if (Number.isInteger(i) && i >= 0 && i < folders.length && !picks.includes(i)) picks.push(i);
    return { folders: picks.slice(0, 3) };
  },

  /* Reads a page's name and icon for a new bookmark. Not AI: the Worker fetches the page because the Bindery page
     can't (its CSP allows no other connections, and most sites don't allow cross-site reads). */
  async page(env, items, body) {
    const u = pageUrl(body.url), { html, final } = await fetchPage(u);
    return { title: pageTitle(html), icon: await findIcon(iconLinks(html, final), final) };
  },

  /* Writes a short note about a page for its bookmark: the model reads the page's own description and the start of its
     text. If the model can't answer, the page's own description is used as it is. */
  async describe(env, items, body) {
    const u = pageUrl(body.url), { html } = await fetchPage(u);
    if (!html) return { description: '' };
    const own = pageDescription(html), text = pageText(html, 2500), title = clip(body.title, 200) || pageTitle(html);
    if (!own && text.length < 80) return { description: '' };
    const system = 'You write short notes for browser bookmarks. Reply with JSON only.';
    const user = [
      'Describe this web page in one or two plain sentences (under 240 characters) so its owner remembers what it is. Write in the language of the page.',
      'Say what the page is or offers. No marketing words, no "This page", no title repeated word for word.',
      'Reply as {"description":"..."}.',
      '',
      `Address: ${u.href.slice(0, 300)}`,
      title ? `Title: ${title}` : '',
      own ? `The page describes itself as: ${own}` : '',
      text ? `Start of the page text: ${text}` : '',
    ].filter(Boolean).join('\n');
    try {
      const out = await ask(env, system, user, { type: 'object', properties: { description: { type: 'string' } }, required: ['description'] }, 200);
      const d = clip(out?.description, 300);
      if (d) return { description: d };
    } catch { /* fall back below */ }
    return { description: clip(own, 300) };
  },

  /* Groups tags that mean the same thing (synonyms, abbreviations, spellings, singular and plural). */
  async tagsim(env, items, body) {
    const tags = cleanTags(body.tags);
    const system = 'You tidy the tags people use for browser bookmarks. Reply with JSON only.';
    const user = [
      'Group the tags below that mean the same thing: synonyms, abbreviations (js and javascript), spelling variants, singular and plural, or the same word in another language.',
      'Don\'t group tags that are only related (python and django, recipes and baking). Leave out tags that have no match. A tag can be in at most one group.',
      'Reply as {"groups":[[0,5],[3,8,9]]}, where the numbers are tag numbers from the list.',
      '',
      tags.map((t, i) => `${i}. ${t}`).join('\n'),
    ].join('\n');
    const out = await ask(env, system, user, {
      type: 'object', properties: { groups: { type: 'array', items: { type: 'array', items: { type: 'integer' } } } }, required: ['groups'],
    }, 1024);
    const used = new Set(), groups = [];
    for (const g of Array.isArray(out?.groups) ? out.groups : []) {
      const ok = (Array.isArray(g) ? g : []).filter(i => Number.isInteger(i) && i >= 0 && i < tags.length && !used.has(i));
      const uniq = [...new Set(ok)];
      if (uniq.length < 2) continue;
      uniq.forEach(i => used.add(i)); groups.push(uniq);
    }
    return { groups: groups.slice(0, 60) };
  },

  /* Suggests up to three names for a folder from what's inside it. */
  async name(env, items, body) {
    const current = clip(body.current, 120);
    const system = 'You name folders of browser bookmarks. Reply with JSON only.';
    const user = [
      'Suggest 3 different short, clear names (1 to 3 words) for a folder holding these bookmarks, written in the same language as the bookmarks.',
      current ? `Its current name is "${current}". Don't suggest that name.` : '',
      'Reply as {"names":["First","Second","Third"]}.',
      '',
      listing(items),
    ].filter(x => x !== '').join('\n');
    const out = await ask(env, system, user, {
      type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'],
    }, 256);
    const seen = new Set([current.toLowerCase()]), names = [];
    for (const n of Array.isArray(out?.names) ? out.names : []) {
      const name = clip(n, 60), key = name.toLowerCase();
      if (name && !seen.has(key)) { seen.add(key); names.push(name); }
    }
    return { names: names.slice(0, 3) };
  },

  /* Rewrites cluttered bookmark titles. Only changed titles come back. */
  async titles(env, items) {
    const system = 'You tidy the titles of browser bookmarks. Reply with JSON only.';
    const user = [
      'Make each title short and clear: remove site names and taglines that repeat the address, separators like " | " or " - " left over from them, unread counts like "(3)", SEO filler and stray punctuation.',
      'Keep the meaning and the language. Don\'t invent details, and don\'t translate. Leave titles that are already clear unchanged, and leave them out of the reply.',
      'Reply as {"titles":[{"item":0,"title":"New title"}]}, where item is the bookmark number.',
      '',
      listing(items),
    ].join('\n');
    const out = await ask(env, system, user, {
      type: 'object',
      properties: { titles: { type: 'array', items: { type: 'object', properties: { item: { type: 'integer' }, title: { type: 'string' } }, required: ['item', 'title'] } } },
      required: ['titles'],
    }, 4096);
    const seen = new Set(), titles = [];
    for (const t of Array.isArray(out?.titles) ? out.titles : []) {
      const i = t?.item, title = clip(t?.title, 200);
      if (!Number.isInteger(i) || i < 0 || i >= items.length || seen.has(i) || !title || title === items[i].title) continue;
      seen.add(i); titles.push({ item: i, title });
    }
    return { titles };
  },
};

/* Asks the model for JSON matching the schema. If JSON mode isn't available or fails, asks again in plain text and
   reads the JSON out of the reply. */
async function ask(env, system, user, schema, max_tokens) {
  const model = env.MODEL || DEFAULT_MODEL;
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  let out;
  try {
    out = await env.AI.run(model, { messages, max_tokens, temperature: 0.2, response_format: { type: 'json_schema', json_schema: schema } });
    return readJSON(out?.response);
  } catch {
    out = await env.AI.run(model, { messages, max_tokens, temperature: 0.2 });
    return readJSON(out?.response);
  }
}
export function readJSON(r) {
  if (r && typeof r === 'object') return r;
  const s = String(r ?? '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('No JSON in the reply');
  return JSON.parse(s.slice(a, b + 1));
}

/* ---------- reading pages ---------- */
function safeUrl(s) { try { return new URL(s); } catch { return null; } }
/* Only public web addresses: no local names, private networks or raw IP addresses. */
export function pageUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  const u = safeUrl(raw.trim());
  if (!u || !/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h.startsWith('[') || /^[\d.]+$/.test(h) || /(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(h)) return null;
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) return null;
  return u;
}
async function readBytes(res, max) {
  const reader = res.body?.getReader(); if (!reader) return null;
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return { chunks, size: size - value.byteLength, cut: true, last: value }; }
    chunks.push(value);
  }
  return { chunks, size, cut: false };
}
const join = (chunks, size) => { const out = new Uint8Array(size); let at = 0; for (const c of chunks) { out.set(c, at); at += c.byteLength; } return out; };
async function readText(res, max, type) {
  const r = await readBytes(res, max); if (!r) return '';
  const chunks = r.cut ? [...r.chunks, r.last.subarray(0, max - r.size)] : r.chunks;
  const bytes = join(chunks, Math.min(r.size + (r.cut ? max - r.size : 0), max));
  const charset = /charset=["']?([\w-]+)/i.exec(type)?.[1] || /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder('latin1').decode(bytes.subarray(0, 2048)))?.[1] || 'utf-8';
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', raquo: '»', laquo: '«' };
export function decodeEntities(s) {
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  return out;
}
/* Fetches a public page and returns up to 400 KB of its HTML ('' when it isn't HTML or can't be fetched). */
async function fetchPage(u) {
  let res;
  try { res = await fetch(u.href, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(8000) }); }
  catch { return { html: '', final: u }; }
  const final = safeUrl(res.url) || u, type = res.headers.get('Content-Type') || '';
  const html = res.ok && /html|xml/i.test(type) ? await readText(res, 400_000, type) : '';
  if (!html) res.body?.cancel?.();
  return { html, final };
}
function metaTags(html) {
  const meta = {};
  for (const m of html.slice(0, 200_000).matchAll(/<meta\b[^>]*>/gi)) { const a = attrs(m[0]), k = (a.property || a.name || '').toLowerCase(); if (k && a.content && !meta[k]) meta[k] = a.content; }
  return meta;
}
/* The page's own summary: og:description, then description, then twitter:description. */
export function pageDescription(html) {
  if (!html) return '';
  const m = metaTags(html);
  return clip(m['og:description'] || m['description'] || m['twitter:description'] || '', 400);
}
/* Readable text from <main>, <article> or <body>, without scripts, styles and markup. */
export function pageText(html, max) {
  if (!html) return '';
  let h = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|header|form)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  h = /<main\b[\s\S]*?<\/main>/i.exec(h)?.[0] || /<article\b[\s\S]*?<\/article>/i.exec(h)?.[0] || /<body\b[\s\S]*<\/body>/i.exec(h)?.[0] || h;
  return decodeEntities(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, max);
}
/* og:title, then twitter:title, then <title>. */
export function pageTitle(html) {
  if (!html) return '';
  const head = html.slice(0, 200_000), meta = metaTags(html);
  const t = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  return clip(meta['og:title'] || meta['twitter:title'] || (t ? decodeEntities(t) : ''), 200);
}
/* Icon links from the page, best first: small PNG/ICO icons, then SVG, then larger or Apple touch icons. */
export function iconLinks(html, base) {
  const found = [];
  for (const m of (html || '').slice(0, 200_000).matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]), rel = (a.rel || '').toLowerCase().split(/\s+/);
    if (!a.href || !(rel.includes('icon') || rel.includes('apple-touch-icon')) || rel.includes('mask-icon')) continue;
    let url; try { url = new URL(a.href, base); } catch { continue; }
    if (!/^https?:$/.test(url.protocol)) continue;
    const size = Math.max(0, ...String(a.sizes || '').split(/\s+/).map(x => parseInt(x, 10) || 0));
    const svg = /svg/i.test(a.type || '') || /\.svg($|\?)/i.test(url.pathname);
    let score = rel.includes('apple-touch-icon') ? 40 : svg ? 20 : 10;
    if (size) score += Math.abs(size - 32) / 8;
    found.push({ url: url.href, score });
  }
  return found.sort((a, b) => a.score - b.score).map(x => x.url);
}
const ICON_MAX = 48 * 1024;
async function findIcon(links, base) {
  const tries = [...new Set([...links, new URL('/favicon.ico', base).href])].slice(0, 4);
  for (const url of tries) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' }, redirect: 'follow', signal: AbortSignal.timeout(5000) });
      if (!res.ok) { res.body?.cancel?.(); continue; }
      let type = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
      if (!type.startsWith('image/')) { if (/\.ico($|\?)/i.test(url) && /octet-stream|^$/.test(type)) type = 'image/x-icon'; else { res.body?.cancel?.(); continue; } }
      const r = await readBytes(res, ICON_MAX);
      if (!r || r.cut || !r.size) continue;
      const bytes = join(r.chunks, r.size);
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `data:${type};base64,${btoa(bin)}`;
    } catch { /* try the next one */ }
  }
  return '';
}

const MAX_TAGS = 600;
function cleanTags(raw) {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_TAGS) return null;
  const tags = raw.map(t => clip(t, 60));
  return tags.every(Boolean) ? tags : null;
}
function cleanItems(raw, max) {
  if (!Array.isArray(raw) || !raw.length || raw.length > max) return null;
  const items = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') return null;
    items.push({ title: clip(x.title, 300), url: clip(x.url, 300) });
  }
  return items;
}
const clip = (s, n) => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '';
const listing = items => items.map((x, i) => `${i}. ${x.title || '(no title)'}${x.url ? ` — ${x.url}` : ''}`).join('\n');
const json = (body, status, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
