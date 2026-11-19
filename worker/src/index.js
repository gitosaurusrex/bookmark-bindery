/* Bindery Assist: the small helper behind Bookmark Bindery's optional AI features.
   It takes the titles and addresses of the bookmarks that one action is for, asks a Workers AI model, checks the
   answer, and sends it back. It stores nothing and logs no bookmark content. */

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_BODY = 96 * 1024; // characters
const MAX_ITEMS = { tidy: 150, name: 60, titles: 100 };

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
  const items = cleanItems(body?.items, MAX_ITEMS[task]);
  if (!items) return reply({ error: 'bad_request' }, 400);

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
