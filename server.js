#!/usr/bin/env node
// Reel Room: a free, local AI video editor.
// Start it with `node server.js` (no npm install needed), then use it in Chrome.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { detectAgents, pickProvider, runTurn, testProvider, which } from './lib/ai.js';
import { writeAgentContext, effectCatalog } from './lib/context.js';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const BUILTIN_STYLES = path.join(APP_DIR, 'styles');
const VERSION = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version;

function defaultDataDir() {
  if (process.env.REELROOM_DATA) return path.resolve(process.env.REELROOM_DATA);
  const home = os.homedir();
  const base = path.join(home, process.platform === 'darwin' ? 'Movies' : 'Videos');
  return path.join(fs.existsSync(base) ? base : home, 'Reel Room');
}
const DATA = defaultDataDir();
const DIRS = {
  projects: path.join(DATA, 'projects'),
  styles: path.join(DATA, 'styles'),
  library: path.join(DATA, 'library'),
  cache: path.join(DATA, 'cache'),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

const TOKEN = crypto.randomBytes(16).toString('hex');
const START_PORT = Number(process.env.PORT) || 3737;
let PORT = START_PORT;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
const VIDEO_EXT = ['.mp4', '.mov', '.m4v', '.webm', '.mkv'];

// ---------- helpers ----------
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const fail = (res, code, message) => json(res, code, { error: message });
const exists = (p) => fsp.access(p).then(() => true, () => false);
const readJson = async (p, fallback = null) => { try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return fallback; } };
const writeJson = async (p, v) => { await fsp.mkdir(path.dirname(p), { recursive: true }); const tmp = p + '.tmp'; await fsp.writeFile(tmp, JSON.stringify(v, null, 2)); await fsp.rename(tmp, p); };
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'video';

function safeJoin(root, rel) {
  const base = path.resolve(root);
  const p = path.resolve(base, String(rel || '').replace(/^[/\\]+/, ''));
  if (p !== base && !p.startsWith(base + path.sep)) throw Object.assign(new Error('Bad path'), { status: 400 });
  return p;
}

async function readBody(req, limit = 20 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks);
}
const readJsonBody = async (req) => { const b = await readBody(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; };

async function streamToFile(req, file) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.part';
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    req.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Upload cancelled')));
  });
  await fsp.rename(tmp, file);
}

async function sendFile(req, res, file, { maxAge = 0 } = {}) {
  let st;
  try { st = await fsp.stat(file); } catch { return fail(res, 404, 'Not found'); }
  if (!st.isFile()) return fail(res, 404, 'Not found');
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-cache' };
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start, end;
    if (!m || (m[1] === '' && m[2] === '')) { start = 0; end = st.size - 1; }
    else if (m[1] === '') { start = Math.max(0, st.size - Number(m[2])); end = st.size - 1; }
    else { start = Number(m[1]); end = m[2] === '' ? st.size - 1 : Math.min(Number(m[2]), st.size - 1); }
    if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function openPath(target) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [target]] : process.platform === 'win32' ? ['explorer', [target]] : ['xdg-open', [target]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

function openBrowser(url) {
  if (process.env.REELROOM_NO_OPEN) return;
  const tryRun = (cmd, args) => new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
    c.on('error', () => resolve(false));
    c.on('exit', (code) => resolve(code === 0));
    c.unref();
  });
  (async () => {
    // Chrome gives the most reliable video encoding, so prefer it when it is installed.
    if (process.platform === 'darwin') { if (!(await tryRun('open', ['-a', 'Google Chrome', url]))) await tryRun('open', [url]); }
    else if (process.platform === 'win32') { if (!(await tryRun('start', ['chrome', url]))) await tryRun('start', ['""', url]); }
    else if (!(await tryRun('google-chrome', [url]))) await tryRun('xdg-open', [url]);
  })();
}

// ---------- settings ----------
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const DEFAULT_SETTINGS = { provider: 'auto', model: '', giphyKey: '', whisper: 'base', language: 'english' };
async function getSettings() { return { ...DEFAULT_SETTINGS, ...(await readJson(SETTINGS_FILE, {})) }; }

// ---------- projects ----------
const projectDir = (id) => {
  if (!/^[a-z0-9-]{1,80}$/.test(id || '')) throw Object.assign(new Error('Bad project id'), { status: 400 });
  return path.join(DIRS.projects, id);
};

async function listDir(dir, base = dir, out = []) {
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.endsWith('.part') || e.name.endsWith('.tmp')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await listDir(p, base, out);
    else { const st = await fsp.stat(p); out.push({ path: path.relative(base, p).split(path.sep).join('/'), size: st.size, mtime: Math.floor(st.mtimeMs) }); }
  }
  return out;
}

async function listProjects() {
  const out = [];
  for (const id of await fsp.readdir(DIRS.projects).catch(() => [])) {
    const p = await readJson(path.join(DIRS.projects, id, 'project.json'));
    if (p) out.push({ ...p, id, hasThumb: await exists(path.join(DIRS.projects, id, 'thumb.jpg')) });
  }
  return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

async function touchProject(id, patch = {}) {
  const file = path.join(projectDir(id), 'project.json');
  const p = (await readJson(file)) || {};
  Object.assign(p, patch, { updated: Date.now() });
  await writeJson(file, p);
  return p;
}

// Linear undo history of edit.json. Every save appends a version; undo/redo move a pointer.
async function historyState(dir) { return readJson(path.join(dir, 'history', 'index.json'), { versions: [], current: -1 }); }
async function recordVersion(dir, reason = 'edit') {
  const edit = await fsp.readFile(path.join(dir, 'edit.json'), 'utf8').catch(() => null);
  if (edit == null) return;
  const h = await historyState(dir);
  const cur = h.versions[h.current];
  if (cur) {
    const prev = await fsp.readFile(path.join(dir, 'history', cur.file), 'utf8').catch(() => null);
    if (prev === edit) return;
  }
  for (const v of h.versions.slice(h.current + 1)) await fsp.rm(path.join(dir, 'history', v.file), { force: true });
  h.versions = h.versions.slice(0, h.current + 1);
  const file = `${Date.now()}.json`;
  await fsp.mkdir(path.join(dir, 'history'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'history', file), edit);
  h.versions.push({ file, reason, at: Date.now() });
  while (h.versions.length > 200) { const old = h.versions.shift(); await fsp.rm(path.join(dir, 'history', old.file), { force: true }); }
  h.current = h.versions.length - 1;
  await writeJson(path.join(dir, 'history', 'index.json'), h);
}
async function moveHistory(dir, delta) {
  const h = await historyState(dir);
  const next = h.current + delta;
  if (next < 0 || next >= h.versions.length) return null;
  const text = await fsp.readFile(path.join(dir, 'history', h.versions[next].file), 'utf8');
  await fsp.writeFile(path.join(dir, 'edit.json'), text);
  h.current = next;
  await writeJson(path.join(dir, 'history', 'index.json'), h);
  return { edit: JSON.parse(text), canUndo: next > 0, canRedo: next < h.versions.length - 1, reason: h.versions[delta < 0 ? next + 1 : next].reason };
}

async function loadProject(id) {
  const dir = projectDir(id);
  const project = await readJson(path.join(dir, 'project.json'));
  if (!project) return null;
  const [edit, style, transcript, analysis, chat, h, files] = await Promise.all([
    readJson(path.join(dir, 'edit.json')), readJson(path.join(dir, 'style.json')), readJson(path.join(dir, 'transcript.json')),
    readJson(path.join(dir, 'analysis.json')), readJson(path.join(dir, 'chat.json'), { messages: [], sessions: {} }), historyState(dir), listDir(dir),
  ]);
  return {
    project: { ...project, id }, edit, style, transcript, analysis,
    chat: chat.messages || [], aiBusy: running.has(id),
    canUndo: h.current > 0, canRedo: h.current < h.versions.length - 1,
    files: files.filter((f) => /^(assets|effects|exports|frames)\//.test(f.path)),
  };
}

// Files the browser is allowed to write inside a project.
const WRITABLE = /^(edit\.json|style\.json|transcript\.json|analysis\.json|render-report\.json|thumb\.jpg|preview\.jpg|frames\/[\w.-]+\.jpg|assets\/[^/].*|effects\/[\w.-]+\.js|exports\/[^/]+\.mp4)$/;

// ---------- styles ----------
async function listStyles() {
  const read = async (dir, builtin) => {
    const out = [];
    for (const f of (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json')).sort()) {
      const s = await readJson(path.join(dir, f));
      if (s) out.push({ ...s, id: f.replace(/\.json$/, ''), builtin });
    }
    return out;
  };
  const builtins = await read(BUILTIN_STYLES, true);
  const mine = await read(DIRS.styles, false);
  const ids = new Set(mine.map((s) => s.id));
  return [...mine, ...builtins.filter((s) => !ids.has(s.id))];
}

// ---------- AI chat ----------
const running = new Map(); // projectId -> { cancel }
const chatFile = (dir) => path.join(dir, 'chat.json');

async function handleChat(req, res, id) {
  const dir = projectDir(id);
  if (running.has(id)) return fail(res, 409, 'The AI is already working on this video.');
  const body = await readJsonBody(req);
  const message = String(body.message || '').trim();
  if (!message) return fail(res, 400, 'Empty message');
  const settings = await getSettings();
  const agents = await detectAgents();
  const provider = pickProvider(agents, settings.provider);
  if (!provider) return fail(res, 400, 'No AI found. Install Claude Code or Codex and sign in (Settings → AI).');

  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  let open = true;
  res.on('close', () => { open = false; });
  const send = (e) => { if (open) res.write(JSON.stringify(e) + '\n'); };

  const chat = await readJson(chatFile(dir), { messages: [], sessions: {} });
  chat.sessions ||= {};
  chat.messages.push({ role: 'user', text: body.display || message, at: Date.now() });
  await writeJson(chatFile(dir), chat);

  await recordVersion(dir, 'before AI');
  const editBefore = await fsp.readFile(path.join(dir, 'edit.json'), 'utf8').catch(() => '');
  const styleBefore = await fsp.readFile(path.join(dir, 'style.json'), 'utf8').catch(() => '');
  await writeAgentContext({ dir, appDir: APP_DIR, libraryDir: DIRS.library, settings, provider });

  const prompt = `${message}

---
(Reel Room) You are editing the short video project in this folder. Follow ${provider === 'codex' ? 'AGENTS.md' : 'CLAUDE.md'}. context.md, transcript.txt and preview.jpg are refreshed every turn, so re-read them when you need current facts. Make changes by editing edit.json (plus effects/*.js or style.json only when needed) and keep edit.json valid JSON. When you finish editing, reply with one or two short plain sentences saying what you changed. If the user asked for ideas, options or an interview, or you need an answer first, reply with a short numbered list instead and don't edit yet. No headings.`;

  const images = (await fsp.readdir(path.join(dir, 'frames')).catch(() => [])).filter((f) => f.endsWith('.jpg')).sort().slice(0, 3).map((f) => path.join(dir, 'frames', f));
  let sessionId = chat.sessions[provider] || null;
  send({ type: 'status', text: provider === 'claude' ? 'Starting Claude Code' : 'Starting Codex' });

  const attempt = async (sid, text) => {
    const turn = runTurn({ provider, agents, cwd: dir, prompt: text, sessionId: sid, model: settings.model || '', images, onEvent: send });
    running.set(id, turn);
    try { return await turn.done; } finally { running.delete(id); }
  };

  let result = await attempt(sessionId, prompt);
  if (!result.ok && !result.cancelled && sessionId && /conversation|session|thread|rollout/i.test(result.raw || result.error || '')) {
    send({ type: 'status', text: 'Starting a fresh session' });
    result = await attempt(null, prompt);
  }

  // Never leave the project with a broken edit.json: ask the AI to repair once, else roll back.
  const validate = async () => { try { JSON.parse(await fsp.readFile(path.join(dir, 'edit.json'), 'utf8')); return null; } catch (e) { return e.message; } };
  let bad = await validate();
  if (bad && result.ok) {
    send({ type: 'status', text: 'Fixing a JSON mistake' });
    const fix = await attempt(result.sessionId, `edit.json is not valid JSON (${bad}). Fix the syntax so it parses, keeping your intended changes. Reply with one short sentence.`);
    if (fix.ok) result.sessionId = fix.sessionId;
    bad = await validate();
  }
  if (bad) {
    await fsp.writeFile(path.join(dir, 'edit.json'), editBefore);
    if (result.ok) result = { ok: false, error: `The AI left edit.json broken (${bad}), so I rolled it back.`, sessionId: result.sessionId };
  }

  if (result.sessionId) chat.sessions[provider] = result.sessionId;
  const editAfter = await fsp.readFile(path.join(dir, 'edit.json'), 'utf8').catch(() => '');
  const styleAfter = await fsp.readFile(path.join(dir, 'style.json'), 'utf8').catch(() => '');
  const changed = editAfter !== editBefore || styleAfter !== styleBefore;
  if (changed) await recordVersion(dir, 'AI edit');
  chat.messages.push(result.ok
    ? { role: 'assistant', text: result.text, at: Date.now(), provider }
    : { role: 'error', text: result.error, at: Date.now(), provider });
  await writeJson(chatFile(dir), chat);
  await touchProject(id);
  const h = await historyState(dir);
  send({ type: 'done', ok: result.ok, text: result.ok ? result.text : result.error, changed, canUndo: h.current > 0, canRedo: h.current < h.versions.length - 1 });
  if (open) res.end();
}

// ---------- GIFs and emoji ----------
function emojiCodepoints(str) {
  return [...String(str)].map((c) => c.codePointAt(0)).filter((cp) => cp !== 0xfe0f).map((cp) => cp.toString(16)).join('_');
}

async function fetchToFile(url, file) {
  const r = await fetch(url, { headers: { 'User-Agent': 'ReelRoom/1.0' } });
  if (!r.ok) throw Object.assign(new Error(`Download failed (${r.status})`), { status: r.status === 404 ? 404 : 502 });
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, Buffer.from(await r.arrayBuffer()));
}

async function handleGif(res, id, q) {
  const settings = await getSettings();
  if (!settings.giphyKey) return fail(res, 404, 'No GIPHY key set');
  const name = `${slug(q)}.webp`;
  const rel = `assets/gifs/${name}`;
  const file = path.join(projectDir(id), rel);
  if (await exists(file)) return json(res, 200, { src: rel });
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(settings.giphyKey)}&q=${encodeURIComponent(q)}&limit=1&rating=pg-13&lang=en`;
  const r = await fetch(url);
  if (!r.ok) return fail(res, 502, `GIPHY error ${r.status}`);
  const data = (await r.json()).data?.[0];
  const img = data?.images?.downsized_medium?.url ? data.images : null;
  const pick = img?.original?.webp || img?.downsized_medium?.url || img?.original?.url;
  if (!pick) return fail(res, 404, 'No GIF found');
  await fetchToFile(pick, file);
  json(res, 200, { src: rel, title: data.title || q });
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('GET', /^\/api\/state$/, async (req, res) => {
  const settings = await getSettings();
  const agents = await detectAgents();
  json(res, 200, {
    version: VERSION, dataDir: DATA, platform: process.platform,
    settings: { ...settings, giphyKey: settings.giphyKey ? '••••' + settings.giphyKey.slice(-4) : '' },
    agents: {
      claude: agents.claude ? { version: agents.claude.version, path: agents.claude.path } : null,
      codex: agents.codex ? { version: agents.codex.version, path: agents.codex.path, loggedIn: agents.codex.loggedIn } : null,
    },
    provider: pickProvider(agents, settings.provider),
    ffmpeg: !!which('ffmpeg'),
  });
});

route('POST', /^\/api\/settings$/, async (req, res) => {
  const body = await readJsonBody(req);
  const s = await getSettings();
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (!(k in body)) continue;
    if (k === 'giphyKey' && String(body[k]).startsWith('••••')) continue;
    s[k] = String(body[k] ?? '').trim();
  }
  await writeJson(SETTINGS_FILE, s);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/ai\/(recheck|test)$/, async (req, res, m) => {
  const agents = await detectAgents(true);
  if (m[1] === 'recheck') return json(res, 200, { claude: !!agents.claude, codex: !!agents.codex });
  const body = await readJsonBody(req);
  const settings = await getSettings();
  const provider = body.provider || pickProvider(agents, settings.provider);
  if (!provider) return json(res, 200, { ok: false, message: 'No AI CLI found.' });
  json(res, 200, await testProvider(provider, DATA));
});

route('GET', /^\/api\/projects$/, async (req, res) => json(res, 200, await listProjects()));

route('POST', /^\/api\/projects$/, async (req, res) => {
  const body = await readJsonBody(req);
  const ext = path.extname(String(body.filename || '')).toLowerCase();
  if (!VIDEO_EXT.includes(ext)) return fail(res, 400, `Unsupported file type ${ext || ''}. Use MP4, MOV, M4V, WebM or MKV.`);
  const name = String(body.name || path.basename(body.filename, ext)).slice(0, 80);
  const id = `${slug(name)}-${crypto.randomBytes(2).toString('hex')}`;
  const dir = path.join(DIRS.projects, id);
  await fsp.mkdir(path.join(dir, 'assets'), { recursive: true });
  await writeJson(path.join(dir, 'project.json'), { name, source: `source${ext}`, originalName: body.filename, created: Date.now(), updated: Date.now(), status: 'uploading' });
  json(res, 200, { id });
});

route('PUT', /^\/api\/projects\/([\w-]+)\/source$/, async (req, res, m) => {
  const dir = projectDir(m[1]);
  const p = await readJson(path.join(dir, 'project.json'));
  if (!p) return fail(res, 404, 'No such project');
  await streamToFile(req, path.join(dir, p.source));
  await touchProject(m[1], { status: 'analyzing' });
  json(res, 200, { ok: true });
});

route('GET', /^\/api\/projects\/([\w-]+)$/, async (req, res, m) => {
  const data = await loadProject(m[1]);
  data ? json(res, 200, data) : fail(res, 404, 'No such project');
});

route('PATCH', /^\/api\/projects\/([\w-]+)$/, async (req, res, m) => {
  const body = await readJsonBody(req);
  const allowed = {};
  for (const k of ['name', 'status', 'meta', 'analysis', 'styleId', 'styleName']) if (k in body) allowed[k] = body[k];
  json(res, 200, await touchProject(m[1], allowed));
});

route('DELETE', /^\/api\/projects\/([\w-]+)$/, async (req, res, m) => {
  running.get(m[1])?.cancel();
  await fsp.rm(projectDir(m[1]), { recursive: true, force: true });
  json(res, 200, { ok: true });
});

route('PUT', /^\/api\/projects\/([\w-]+)\/files\/(.+)$/, async (req, res, m) => {
  const dir = projectDir(m[1]);
  const rel = decodeURIComponent(m[2]);
  if (!WRITABLE.test(rel)) return fail(res, 403, `Can't write ${rel}`);
  const file = safeJoin(dir, rel);
  if (/\.json$/.test(rel)) {
    const body = await readBody(req);
    JSON.parse(body.toString('utf8'));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, body);
    if (rel === 'edit.json') await recordVersion(dir, new URL(req.url, 'http://x').searchParams.get('reason') || 'edit');
  } else {
    await streamToFile(req, file);
  }
  if (!/^(render-report|analysis)\.json$|^preview\.jpg$|^frames\//.test(rel)) await touchProject(m[1]);
  json(res, 200, { ok: true, path: rel });
});

route('DELETE', /^\/api\/projects\/([\w-]+)\/files\/(.+)$/, async (req, res, m) => {
  const rel = decodeURIComponent(m[2]);
  if (!/^(assets|exports|effects)\//.test(rel)) return fail(res, 403, 'Not allowed');
  await fsp.rm(safeJoin(projectDir(m[1]), rel), { force: true });
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/projects\/([\w-]+)\/(undo|redo)$/, async (req, res, m) => {
  const r = await moveHistory(projectDir(m[1]), m[2] === 'undo' ? -1 : 1);
  r ? json(res, 200, r) : fail(res, 400, `Nothing to ${m[2]}`);
});

route('POST', /^\/api\/projects\/([\w-]+)\/chat$/, (req, res, m) => handleChat(req, res, m[1]));
route('POST', /^\/api\/projects\/([\w-]+)\/chat\/cancel$/, async (req, res, m) => { running.get(m[1])?.cancel(); json(res, 200, { ok: true }); });
route('POST', /^\/api\/projects\/([\w-]+)\/chat\/reset$/, async (req, res, m) => {
  const file = chatFile(projectDir(m[1]));
  const chat = await readJson(file, { messages: [], sessions: {} });
  chat.sessions = {};
  chat.messages.push({ role: 'system', text: 'New conversation. The AI starts fresh but your edit stays as it is.', at: Date.now() });
  await writeJson(file, chat);
  json(res, 200, { ok: true });
});
route('POST', /^\/api\/projects\/([\w-]+)\/chat\/note$/, async (req, res, m) => {
  const body = await readJsonBody(req);
  const file = chatFile(projectDir(m[1]));
  const chat = await readJson(file, { messages: [], sessions: {} });
  chat.messages.push({ role: 'system', text: String(body.text || '').slice(0, 2000), at: Date.now() });
  await writeJson(file, chat);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/projects\/([\w-]+)\/reveal$/, async (req, res, m) => {
  const body = await readJsonBody(req).catch(() => ({}));
  const dir = projectDir(m[1]);
  openPath(body.sub === 'exports' ? path.join(dir, 'exports') : dir);
  json(res, 200, { ok: true });
});

// Optional: convert footage Chrome can't decode, when ffmpeg happens to be installed.
route('POST', /^\/api\/projects\/([\w-]+)\/convert$/, async (req, res, m) => {
  const ff = which('ffmpeg');
  if (!ff) return fail(res, 400, 'ffmpeg is not installed');
  const dir = projectDir(m[1]);
  const p = await readJson(path.join(dir, 'project.json'));
  const src = path.join(dir, p.source);
  const out = path.join(dir, 'source-h264.mp4');
  const code = await new Promise((resolve) => {
    const c = spawn(ff, ['-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { stdio: 'ignore' });
    c.on('close', resolve); c.on('error', () => resolve(-1));
  });
  if (code !== 0) return fail(res, 500, 'ffmpeg could not convert this file');
  await touchProject(m[1], { source: 'source-h264.mp4' });
  json(res, 200, { ok: true, source: 'source-h264.mp4' });
});

route('GET', /^\/api\/effects$/, async (req, res) => json(res, 200, await effectCatalog(APP_DIR)));
route('GET', /^\/api\/styles$/, async (req, res) => json(res, 200, await listStyles()));
route('PUT', /^\/api\/styles\/([\w-]+)$/, async (req, res, m) => {
  const style = await readJsonBody(req);
  delete style.builtin;
  style.id = m[1];
  style.updated = Date.now();
  await writeJson(path.join(DIRS.styles, `${m[1]}.json`), style);
  json(res, 200, { ok: true, id: m[1] });
});
route('DELETE', /^\/api\/styles\/([\w-]+)$/, async (req, res, m) => {
  await fsp.rm(path.join(DIRS.styles, `${m[1]}.json`), { force: true });
  json(res, 200, { ok: true });
});

route('GET', /^\/api\/library$/, async (req, res) => json(res, 200, await listDir(DIRS.library)));
route('PUT', /^\/api\/library\/(.+)$/, async (req, res, m) => {
  const rel = decodeURIComponent(m[1]);
  await streamToFile(req, safeJoin(DIRS.library, rel));
  json(res, 200, { ok: true, path: `library/${rel}` });
});
route('DELETE', /^\/api\/library\/(.+)$/, async (req, res, m) => {
  await fsp.rm(safeJoin(DIRS.library, decodeURIComponent(m[1])), { force: true });
  json(res, 200, { ok: true });
});
route('POST', /^\/api\/library\/reveal$/, async (req, res) => { openPath(DIRS.library); json(res, 200, { ok: true }); });

route('GET', /^\/api\/emoji\/([0-9a-f_]+)\.webp$/, async (req, res, m) => {
  const file = path.join(DIRS.cache, 'emoji', `${m[1]}.webp`);
  if (!(await exists(file))) await fetchToFile(`https://fonts.gstatic.com/s/e/notoemoji/latest/${m[1]}/512.webp`, file);
  sendFile(req, res, file, { maxAge: 31536000 });
});
route('GET', /^\/api\/emoji-code$/, async (req, res) => {
  json(res, 200, { code: emojiCodepoints(new URL(req.url, 'http://x').searchParams.get('e') || '') });
});

route('GET', /^\/api\/projects\/([\w-]+)\/gif$/, async (req, res, m) => {
  const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
  if (!q.trim()) return fail(res, 400, 'Missing query');
  await handleGif(res, m[1], q.trim());
});

// ---------- server ----------
async function serveIndex(res) {
  const html = (await fsp.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8')).replace('__RR_TOKEN__', TOKEN);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  try {
    // Only answer requests addressed to this machine (blocks DNS-rebinding tricks).
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return fail(res, 403, 'Forbidden host');
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = decodeURIComponent(url.pathname);

    if (p === '/api/ping') return json(res, 200, { app: 'reel-room', version: VERSION });
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveIndex(res);
    if (req.method === 'GET' && p.startsWith('/app/')) return sendFile(req, res, safeJoin(PUBLIC_DIR, p.slice(5)));
    if ((req.method === 'GET' || req.method === 'HEAD') && p.startsWith('/files/')) {
      const rest = p.slice(7);
      if (rest.startsWith('library/')) return sendFile(req, res, safeJoin(DIRS.library, rest.slice(8)));
      const mm = /^projects\/([\w-]+)\/(.+)$/.exec(rest);
      if (mm) return sendFile(req, res, safeJoin(projectDir(mm[1]), mm[2]));
      return fail(res, 404, 'Not found');
    }
    if (p.startsWith('/api/')) {
      // Every API call must carry the per-launch token, so other websites can't drive the app.
      if (req.headers['x-rr-token'] !== TOKEN) return fail(res, 401, 'Reload the page (the app was restarted).');
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.pattern.exec(p);
        if (m) return await r.handler(req, res, m);
      }
    }
    fail(res, 404, 'Not found');
  } catch (e) {
    if (!res.headersSent) fail(res, e.status || 500, e.message || 'Server error');
    else res.end();
    if (!e.status) console.error(e);
  }
});
server.requestTimeout = 0;
server.headersTimeout = 0;

async function alreadyRunning(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(800) });
    return (await r.json()).app === 'reel-room';
  } catch { return false; }
}

async function start() {
  for (let port = START_PORT; port < START_PORT + 20; port++) {
    if (await alreadyRunning(port)) {
      console.log(`Reel Room is already running at http://localhost:${port}`);
      openBrowser(`http://localhost:${port}`);
      return;
    }
    const ok = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (ok) { PORT = port; break; }
  }
  const url = `http://localhost:${PORT}`;
  const agents = await detectAgents();
  console.log(`\n  Reel Room ${VERSION} is running at ${url}`);
  console.log(`  Your videos live in ${DATA}`);
  console.log(`  AI: ${agents.claude ? `Claude Code ${agents.claude.version}` : 'Claude Code not found'} · ${agents.codex ? `Codex ${agents.codex.version}` : 'Codex not found'}`);
  console.log('  Keep this window open while you edit. Press Ctrl+C to quit.\n');
  openBrowser(url);
}
start();
