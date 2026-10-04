// Device sync through one private GitHub Gist, using a token that can only touch gists.
// The document holds courses, progress, settings and the repertoire; secrets never go in it.
// Merging is per item so two devices editing different things don't overwrite each other.

const FILE = 'opening-trainer-sync.json';
const API = 'https://api.github.com';

export class SyncError extends Error { constructor(msg, kind) { super(msg); this.kind = kind; } }

async function gh(token, path, opts = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      ...opts,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch { throw new SyncError('Can’t reach GitHub (offline?)', 'network'); }
  if (res.status === 401) throw new SyncError('GitHub rejected the sync token. Check it in Settings.', 'auth');
  if (res.status === 403 || res.status === 404) throw new SyncError('The sync token can’t access gists. It needs the Gists permission (read and write).', 'auth');
  if (!res.ok) throw new SyncError('GitHub error ' + res.status, 'http');
  return res.json();
}

// Finds this app's gist among the user's gists, or creates a private one.
export async function findOrCreateGist(token, initialDoc) {
  for (let page = 1; page <= 5; page++) {
    const list = await gh(token, `/gists?per_page=100&page=${page}`);
    const hit = list.find((g) => g.files && g.files[FILE]);
    if (hit) return hit.id;
    if (list.length < 100) break;
  }
  const g = await gh(token, '/gists', { method: 'POST', body: JSON.stringify({ description: 'Opening Trainer sync (private)', public: false, files: { [FILE]: { content: JSON.stringify(initialDoc) } } }) });
  return g.id;
}

export async function readGist(token, id) {
  const g = await gh(token, `/gists/${id}`);
  const f = g.files?.[FILE];
  if (!f) return null;
  let text = f.content;
  if (f.truncated) { // large files are cut off in the API response; fetch the raw file instead
    const r = await fetch(f.raw_url).catch(() => null);
    if (!r?.ok) throw new SyncError('Couldn’t download the sync file', 'http');
    text = await r.text();
  }
  try { return JSON.parse(text); } catch { return null; }
}

export async function writeGist(token, id, doc) {
  await gh(token, `/gists/${id}`, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(doc) } } }) });
}

// doc = { v: 1, courses: [{ ...course, updated }], deleted: { [courseId]: ts }, progress: { [courseId]: { [lineIdx]: { last, tries, ... } } },
//         settings: {...}, settingsT, rep: { tree, info }, repT }
export function emptyDoc() { return { v: 1, courses: [], deleted: {}, progress: {}, settings: null, settingsT: 0, rep: null, repT: 0 }; }

export function mergeDocs(a, b) {
  const out = emptyDoc();
  // deletions: keep the latest time per course
  for (const d of [a.deleted || {}, b.deleted || {}]) for (const [id, t] of Object.entries(d)) out.deleted[id] = Math.max(out.deleted[id] || 0, t);
  // courses: newest edit wins; a later deletion removes it
  const byId = new Map();
  for (const c of [...(a.courses || []), ...(b.courses || [])]) { const cur = byId.get(c.id); if (!cur || (c.updated || 0) > (cur.updated || 0)) byId.set(c.id, c); }
  out.courses = [...byId.values()].filter((c) => !(out.deleted[c.id] >= (c.updated || 0)));
  // progress: per line, the most recently practised record wins
  for (const p of [a.progress || {}, b.progress || {}]) for (const [cid, lines] of Object.entries(p)) {
    if (out.deleted[cid] && !out.courses.some((c) => c.id === cid)) continue;
    const dst = (out.progress[cid] ||= {});
    for (const [i, rec] of Object.entries(lines || {})) {
      const cur = dst[i];
      if (!cur || (rec.last || 0) > (cur.last || 0) || ((rec.last || 0) === (cur.last || 0) && (rec.tries || 0) > (cur.tries || 0))) dst[i] = rec;
    }
  }
  // settings and repertoire: last writer wins; on a tie the first argument wins (callers pass the gist first)
  const s = !a.settings ? b : !b.settings ? a : (a.settingsT || 0) >= (b.settingsT || 0) ? a : b;
  out.settings = s.settings; out.settingsT = s.settingsT || 0;
  const r = (a.repT || 0) >= (b.repT || 0) ? a : b;
  out.rep = r.rep; out.repT = r.repT || 0;
  return out;
}
