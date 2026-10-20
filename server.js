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
import { resolveWebImage, webQueries } from './lib/web-images.js';

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
  effects: path.join(DATA, 'effects'),
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

// What the page may load and talk to. Effect code from a shared style runs inside this page, so this
// keeps it from sending anything off the computer: the only outside hosts are the pinned code, model
// and font CDNs. Everything else (GIFs, emoji, web images) is fetched by this server.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com https://huggingface.co https://*.huggingface.co https://*.hf.co blob: data:",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

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
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-cache', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' };
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
const DEFAULT_SETTINGS = { provider: 'auto', model: '', giphyKey: '', whisper: 'base', language: 'english', autoClean: 'on' };
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

// Versions of one video: Main plus any trial reels. The open version lives in edit.json and the
// others wait in variants/<id>.json, so the editor and the AI only ever deal with edit.json.
const VARIANT_ID = /^[a-z0-9-]{1,40}$/;
async function activeVariant(dir) { return (await readJson(path.join(dir, 'project.json')))?.activeVariant || 'main'; }
const titleCase = (id) => id.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

async function listVariants(dir) {
  const active = await activeVariant(dir);
  const ids = new Set(['main', active]);
  for (const f of await fsp.readdir(path.join(dir, 'variants')).catch(() => [])) {
    const m = /^([a-z0-9-]{1,40})\.json$/.exec(f);
    if (m && m[1] !== 'index') ids.add(m[1]);
  }
  const meta = (await readJson(path.join(dir, 'variants', 'index.json'), {})) || {};
  const num = (id) => (id === 'main' ? -1 : parseInt(id.replace(/\D+/g, ''), 10) || 999);
  return [...ids].sort((a, b) => num(a) - num(b) || a.localeCompare(b)).map((id) => ({
    id, active: id === active,
    name: String(meta[id]?.name || (id === 'main' ? 'Main' : titleCase(id))).slice(0, 60),
    test: String(meta[id]?.test || '').slice(0, 300),
    caption: String(meta[id]?.caption || '').slice(0, 2200),
  }));
}

// Linear undo history of edit.json, one per version. Every save appends; undo/redo move a pointer.
async function historyDir(dir) { const v = await activeVariant(dir); return v === 'main' ? path.join(dir, 'history') : path.join(dir, 'history', v); }
async function historyState(dir) { return readJson(path.join(await historyDir(dir), 'index.json'), { versions: [], current: -1 }); }
async function recordVersion(dir, reason = 'edit') {
  const edit = await fsp.readFile(path.join(dir, 'edit.json'), 'utf8').catch(() => null);
  if (edit == null) return;
  const hd = await historyDir(dir);
  const h = await historyState(dir);
  const cur = h.versions[h.current];
  if (cur) {
    const prev = await fsp.readFile(path.join(hd, cur.file), 'utf8').catch(() => null);
    if (prev === edit) return;
  }
  for (const v of h.versions.slice(h.current + 1)) await fsp.rm(path.join(hd, v.file), { force: true });
  h.versions = h.versions.slice(0, h.current + 1);
  const file = `${Date.now()}.json`;
  await fsp.mkdir(hd, { recursive: true });
  await fsp.writeFile(path.join(hd, file), edit);
  h.versions.push({ file, reason, at: Date.now() });
  while (h.versions.length > 200) { const old = h.versions.shift(); await fsp.rm(path.join(hd, old.file), { force: true }); }
  h.current = h.versions.length - 1;
  await writeJson(path.join(hd, 'index.json'), h);
}
async function moveHistory(dir, delta) {
  const hd = await historyDir(dir);
  const h = await historyState(dir);
  const next = h.current + delta;
  if (next < 0 || next >= h.versions.length) return null;
  const text = await fsp.readFile(path.join(hd, h.versions[next].file), 'utf8');
  await fsp.writeFile(path.join(dir, 'edit.json'), text);
  h.current = next;
  await writeJson(path.join(hd, 'index.json'), h);
  return { edit: JSON.parse(text), canUndo: next > 0, canRedo: next < h.versions.length - 1, reason: h.versions[delta < 0 ? next + 1 : next].reason };
}

async function loadProject(id) {
  const dir = projectDir(id);
  const project = await readJson(path.join(dir, 'project.json'));
  if (!project) return null;
  const [edit, style, transcript, analysis, chat, h, files, variants] = await Promise.all([
    readJson(path.join(dir, 'edit.json')), readJson(path.join(dir, 'style.json')), readJson(path.join(dir, 'transcript.json')),
    readJson(path.join(dir, 'analysis.json')), readJson(path.join(dir, 'chat.json'), { messages: [], sessions: {} }), historyState(dir), listDir(dir),
    listVariants(dir),
  ]);
  return {
    project: { ...project, id }, edit, style, transcript, analysis,
    chat: chat.messages || [], aiBusy: running.has(id),
    canUndo: h.current > 0, canRedo: h.current < h.versions.length - 1,
    files: files.filter((f) => /^(assets|effects|exports|frames)\//.test(f.path)),
    variants,
  };
}

// Files the browser is allowed to write inside a project.
const WRITABLE = /^(edit\.json|style\.json|transcript\.json|analysis\.json|render-report\.json|thumb\.jpg|preview\.jpg|frames\/[\w.-]+\.jpg|assets\/[^/].*|effects\/[\w.-]+\.js|exports\/[^/]+\.(mp4|md)|references\/ref-[\w-]+\/[\w.-]+\.(mp4|mov|m4v|webm|jpg|json|md|txt))$/;

// ---------- my effects ----------
// Effects the user chose to keep. Saved as <name>.js plus <name>.json (its meta, read in the
// browser when saved) so the server never has to run effect code to list them.
const EFFECT_NAME = /^[\w-]{1,60}$/;
async function listMyEffects() {
  const out = [];
  for (const f of (await fsp.readdir(DIRS.effects).catch(() => [])).filter((f) => f.endsWith('.js')).sort()) {
    const meta = (await readJson(path.join(DIRS.effects, f.replace(/\.js$/, '.json')), {})) || {};
    out.push({ category: 'Mine', description: '', props: {}, ...meta, name: meta.name || f.replace(/\.js$/, ''), file: `mine/${f}`, mine: true });
  }
  return out;
}

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
  const userMsg = { role: 'user', text: body.display || message, at: Date.now() };
  if (body.ref && /^ref-[\w-]+$/.test(body.ref)) userMsg.ref = body.ref;
  if (body.kind) userMsg.kind = String(body.kind).slice(0, 20);
  chat.messages.push(userMsg);
  await writeJson(chatFile(dir), chat);

  await recordVersion(dir, 'before AI');
  const editBefore = await fsp.readFile(path.join(dir, 'edit.json'), 'utf8').catch(() => '');
  const styleBefore = await fsp.readFile(path.join(dir, 'style.json'), 'utf8').catch(() => '');
  const effectsBefore = await effectStamps(dir);
  const variantsBefore = await variantStamps(dir);
  await writeAgentContext({ dir, appDir: APP_DIR, libraryDir: DIRS.library, effectsDir: DIRS.effects, settings, provider, variants: await listVariants(dir) });

  const style = await readJson(path.join(dir, 'style.json'), {});
  const brief = String(style?.vibe || '').trim();
  const prompt = `${message}

---
${brief ? `(Reel Room) The user's style guide for this video. These are rules, not suggestions; follow every line exactly unless the message above says otherwise:\n<style-guide>\n${brief.slice(0, 4000)}\n</style-guide>\n\n` : ''}(Reel Room) You are editing the short video project in this folder. Follow ${provider === 'codex' ? 'AGENTS.md' : 'CLAUDE.md'}. context.md, transcript.txt and preview.jpg are refreshed every turn, so re-read them when you need current facts. Make changes by editing edit.json (plus effects/*.js, style.json, variants/ or references/ only when the request needs them) and keep every JSON file valid. When you finish editing, reply with one or two short plain sentences saying what you changed. If the user asked for ideas, options or an interview, or you need an answer first, reply with a short numbered list instead and don't edit yet. No headings.`;

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

  // Real images the AI asked for ("web" on layers): fetch them, then let it look at them and adjust.
  if (result.ok) {
    for (let round = 0; round < 2; round++) {
      const wanted = await webWanted(dir);
      if (!wanted.length) break;
      send({ type: 'status', text: `Finding real images: ${wanted.slice(0, 3).join(', ')}${wanted.length > 3 ? '…' : ''}` });
      const got = await Promise.all(wanted.map((q) => resolveWebImage(dir, q).catch((e) => ({ query: q, error: e.message }))));
      if (round === 1) break;
      const lines = got.map((g) => g.error ? `- ${g.query}: couldn't get it (${g.error})` : `- ${g.query} → ${g.src} (${g.from})${g.warning ? ` WARNING: ${g.warning}` : ''}`).join('\n');
      send({ type: 'status', text: 'Looking at the images and placing them' });
      const look = await attempt(result.sessionId, `The app fetched the real images your edit asked for:\n${lines}\n\nRead each image file to see what you actually got. Then make them look designed, the way an editor would by hand: crop to the part that matters (crop), size and place them, put them behind the speaker or in a card, and give them motion that fits the style. Fix anything that looks off (a dark logo on dark footage needs a light card, a busy screenshot needs a crop). Replace any wrong or failed image with a better query, or drop it. Keep the "web" keys as they are. Reply with one short sentence about what you adjusted.`);
      if (look.ok) { result.sessionId = look.sessionId; if (look.text && !/^done\.?$/i.test(look.text)) result.text = `${result.text}\n\n${look.text}`; }
      else break;
    }
  }

  // Never leave the project with broken JSON: ask the AI to repair once, else roll back.
  const validate = async () => {
    const files = ['edit.json', ...(await fsp.readdir(path.join(dir, 'variants')).catch(() => [])).filter((f) => f.endsWith('.json')).map((f) => `variants/${f}`)];
    for (const f of files) {
      try { JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8')); } catch (e) { return { file: f, message: `${f}: ${e.message}` }; }
    }
    return null;
  };
  let bad = await validate();
  if (bad && result.ok) {
    send({ type: 'status', text: 'Fixing a JSON mistake' });
    const fix = await attempt(result.sessionId, `${bad.file} is not valid JSON (${bad.message}). Fix the syntax so it parses, keeping your intended changes. Reply with one short sentence.`);
    if (fix.ok) result.sessionId = fix.sessionId;
    bad = await validate();
  }
  for (let guard = 0; bad && guard < 20; guard++) {
    if (bad.file === 'edit.json') await fsp.writeFile(path.join(dir, 'edit.json'), editBefore);
    else await fsp.rm(path.join(dir, bad.file), { force: true });
    if (result.ok) result = { ok: false, error: `The AI left ${bad.file} broken (${bad.message}), so I ${bad.file === 'edit.json' ? 'rolled it back' : 'removed it'}.`, sessionId: result.sessionId };
    bad = await validate();
  }

  if (result.sessionId) chat.sessions[provider] = result.sessionId;
  const editAfter = await fsp.readFile(path.join(dir, 'edit.json'), 'utf8').catch(() => '');
  const styleAfter = await fsp.readFile(path.join(dir, 'style.json'), 'utf8').catch(() => '');
  // Effects the AI wrote or changed this turn, so the chat can offer "Save to my effects".
  const effectsAfter = await effectStamps(dir);
  const newEffects = Object.keys(effectsAfter).filter((f) => effectsAfter[f] !== effectsBefore[f]);
  const variantsAfter = await variantStamps(dir);
  const variantsChanged = JSON.stringify(variantsAfter) !== JSON.stringify(variantsBefore);
  const changed = editAfter !== editBefore || styleAfter !== styleBefore || newEffects.length > 0 || variantsChanged;
  if (editAfter !== editBefore) await recordVersion(dir, 'AI edit');
  const reply = result.ok
    ? { role: 'assistant', text: result.text, at: Date.now(), provider }
    : { role: 'error', text: result.error, at: Date.now(), provider };
  if (result.ok && newEffects.length) reply.effects = newEffects;
  if (result.ok && variantsChanged) reply.variants = true;
  chat.messages.push(reply);
  await writeJson(chatFile(dir), chat);
  await touchProject(id);
  const h = await historyState(dir);
  send({ type: 'done', ok: result.ok, text: result.ok ? result.text : result.error, changed, effects: reply.effects || [], variantsChanged, variants: await listVariants(dir), canUndo: h.current > 0, canRedo: h.current < h.versions.length - 1 });
  if (open) res.end();
}

// Web image queries in edit.json (and the versions) that haven't been fetched yet.
async function webWanted(dir) {
  const files = ['edit.json', ...(await fsp.readdir(path.join(dir, 'variants')).catch(() => [])).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => `variants/${f}`)];
  const qs = new Set();
  for (const f of files) for (const q of webQueries(await readJson(path.join(dir, f)))) qs.add(q);
  let index = {};
  try { index = JSON.parse(await fsp.readFile(path.join(dir, 'assets', 'web', 'index.json'), 'utf8')); } catch {}
  return [...qs].filter((q) => !index[q]).slice(0, 12);
}

async function effectStamps(dir) {
  const out = {};
  for (const f of (await fsp.readdir(path.join(dir, 'effects')).catch(() => [])).filter((f) => f.endsWith('.js'))) {
    const st = await fsp.stat(path.join(dir, 'effects', f)).catch(() => null);
    if (st) out[`effects/${f}`] = `${st.size}-${Math.floor(st.mtimeMs)}`;
  }
  return out;
}
async function variantStamps(dir) {
  const out = {};
  for (const f of (await fsp.readdir(path.join(dir, 'variants')).catch(() => [])).filter((f) => f.endsWith('.json')).sort()) {
    const st = await fsp.stat(path.join(dir, 'variants', f)).catch(() => null);
    if (st) out[f] = `${st.size}-${Math.floor(st.mtimeMs)}`;
  }
  return out;
}

// ---------- reference reels ----------
// Downloads a reel someone else posted (Instagram, TikTok, YouTube...) with yt-dlp, when it is
// installed, so the AI can study its editing. It stays in the project folder for analysis only.
async function handleReference(req, res, id) {
  const dir = projectDir(id);
  const body = await readJsonBody(req);
  const url = String(body.url || '').trim();
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(url)) return json(res, 400, { error: 'That doesn\'t look like a link.', code: 'bad-url' });
  const ytdlp = which('yt-dlp');
  if (!ytdlp) return json(res, 400, { error: 'Downloading links needs yt-dlp, a free downloader.', code: 'no-ytdlp' });
  const rid = `ref-${Date.now().toString(36)}`;
  const out = path.join(dir, 'references', rid);
  await fsp.mkdir(out, { recursive: true });
  const ff = which('ffmpeg');
  const args = ['--no-playlist', '--no-progress', '--max-filesize', '400M', '-S', 'res:1080,vcodec:h264,acodec:aac',
    '-f', ff ? 'bv*+ba/b' : 'b[ext=mp4]/b', '-o', path.join(out, 'video.%(ext)s')];
  if (ff) args.push('--merge-output-format', 'mp4', '--ffmpeg-location', ff);
  if (body.cookies === 'chrome') args.push('--cookies-from-browser', 'chrome');
  args.push('--', url);
  const result = await new Promise((resolve) => {
    let err = '';
    const c = spawn(ytdlp, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => { err += '\nTimed out'; c.kill(); }, 180000);
    c.stderr.on('data', (d) => { err += d; });
    c.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, err: String(e) }); });
    c.on('close', (code) => { clearTimeout(timer); resolve({ code, err }); });
  });
  const file = (await fsp.readdir(out).catch(() => [])).find((f) => /^video\.(mp4|mov|m4v|webm|mkv)$/.test(f));
  if (result.code !== 0 || !file) {
    await fsp.rm(out, { recursive: true, force: true });
    const e = result.err;
    const login = /login|log in|sign in|cookies|rate-limit|private|not available|unavailable|empty media response/i.test(e);
    console.error(`[reference] yt-dlp failed for ${url}:\n${e.trim().split('\n').slice(-4).join('\n')}`);
    return json(res, 502, {
      code: login ? 'login' : 'failed',
      error: login ? 'That site wants you signed in before it shares this video.' : 'Couldn\'t download that link.',
      detail: e.trim().split('\n').filter((l) => /ERROR/.test(l)).pop()?.slice(0, 300) || '',
    });
  }
  json(res, 200, { rid, path: `references/${rid}/${file}`, site: new URL(url).hostname.replace(/^www\./, '') });
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
    ytdlp: !!which('yt-dlp'),
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
  if (!/^(assets|exports|effects|references)\//.test(rel)) return fail(res, 403, 'Not allowed');
  await fsp.rm(safeJoin(projectDir(m[1]), rel), { force: true });
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/projects\/([\w-]+)\/(undo|redo)$/, async (req, res, m) => {
  const r = await moveHistory(projectDir(m[1]), m[2] === 'undo' ? -1 : 1);
  r ? json(res, 200, r) : fail(res, 400, `Nothing to ${m[2]}`);
});

route('POST', /^\/api\/projects\/([\w-]+)\/chat$/, (req, res, m) => handleChat(req, res, m[1]));
route('POST', /^\/api\/projects\/([\w-]+)\/reference$/, (req, res, m) => handleReference(req, res, m[1]));

// Open another version: park the current edit.json, bring the chosen one in.
route('POST', /^\/api\/projects\/([\w-]+)\/variants\/switch$/, async (req, res, m) => {
  if (running.has(m[1])) return fail(res, 409, 'Wait for the AI to finish first.');
  const dir = projectDir(m[1]);
  const to = String((await readJsonBody(req)).to || '');
  if (!VARIANT_ID.test(to) || to === 'index') return fail(res, 400, 'Bad version');
  const from = await activeVariant(dir);
  if (to !== from) {
    const target = path.join(dir, 'variants', `${to}.json`);
    if (!(await exists(target))) return fail(res, 404, 'That version doesn\'t exist any more.');
    JSON.parse(await fsp.readFile(target, 'utf8'));
    await fsp.mkdir(path.join(dir, 'variants'), { recursive: true });
    await fsp.copyFile(path.join(dir, 'edit.json'), path.join(dir, 'variants', `${from}.json`));
    await fsp.copyFile(target, path.join(dir, 'edit.json'));
    await fsp.rm(target, { force: true });
    await touchProject(m[1], { activeVariant: to });
    await recordVersion(dir, 'opened');
  }
  json(res, 200, await loadProject(m[1]));
});

// Copy the open version into a new one ("try something else without losing this").
route('POST', /^\/api\/projects\/([\w-]+)\/variants\/duplicate$/, async (req, res, m) => {
  const dir = projectDir(m[1]);
  const list = await listVariants(dir);
  const n = Math.max(0, ...list.map((v) => parseInt((/^copy-(\d+)$/.exec(v.id) || [])[1] || '0', 10))) + 1;
  const id = `copy-${n}`;
  await fsp.mkdir(path.join(dir, 'variants'), { recursive: true });
  await fsp.copyFile(path.join(dir, 'edit.json'), path.join(dir, 'variants', `${id}.json`));
  const indexFile = path.join(dir, 'variants', 'index.json');
  const index = (await readJson(indexFile, {})) || {};
  const cur = list.find((v) => v.active);
  index[id] = { name: `Copy of ${cur?.name || 'Main'}`, test: '' };
  await writeJson(indexFile, index);
  json(res, 200, { id, variants: await listVariants(dir) });
});

route('DELETE', /^\/api\/projects\/([\w-]+)\/variants\/([a-z0-9-]{1,40})$/, async (req, res, m) => {
  const dir = projectDir(m[1]);
  const id = m[2];
  if (id === 'main' || id === 'index') return fail(res, 400, 'The main version can\'t be deleted.');
  if (id === (await activeVariant(dir))) return fail(res, 400, 'Open another version before deleting this one.');
  await fsp.rm(path.join(dir, 'variants', `${id}.json`), { force: true });
  await fsp.rm(path.join(dir, 'history', id), { recursive: true, force: true });
  const indexFile = path.join(dir, 'variants', 'index.json');
  const index = await readJson(indexFile, null);
  if (index && index[id]) { delete index[id]; await writeJson(indexFile, index); }
  json(res, 200, { variants: await listVariants(dir) });
});
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
  chat.messages.push({ role: 'system', text: String(body.text || '').slice(0, 2000), at: Date.now(), ...(body.kind ? { kind: String(body.kind).slice(0, 20) } : {}) });
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
route('GET', /^\/api\/my-effects$/, async (req, res) => json(res, 200, await listMyEffects()));
route('PUT', /^\/api\/my-effects\/([\w-]+)$/, async (req, res, m) => {
  if (!EFFECT_NAME.test(m[1])) return fail(res, 400, 'Bad name');
  const body = await readJsonBody(req);
  if (typeof body.code !== 'string' || !body.code.includes('export')) return fail(res, 400, 'That isn\'t an effect file.');
  const meta = {};
  const src = body.meta && typeof body.meta === 'object' ? body.meta : {};
  for (const k of ['name', 'category', 'description', 'props', 'presets', 'fonts', 'needs', 'duration']) if (src[k] !== undefined) meta[k] = src[k];
  meta.savedFrom = String(body.from || '').slice(0, 80);
  meta.saved = Date.now();
  await fsp.mkdir(DIRS.effects, { recursive: true });
  await fsp.writeFile(path.join(DIRS.effects, `${m[1]}.js`), body.code);
  await writeJson(path.join(DIRS.effects, `${m[1]}.json`), meta);
  json(res, 200, { ok: true, file: `mine/${m[1]}.js` });
});
route('DELETE', /^\/api\/my-effects\/([\w-]+)$/, async (req, res, m) => {
  if (!EFFECT_NAME.test(m[1])) return fail(res, 400, 'Bad name');
  await fsp.rm(path.join(DIRS.effects, `${m[1]}.js`), { force: true });
  await fsp.rm(path.join(DIRS.effects, `${m[1]}.json`), { force: true });
  json(res, 200, { ok: true });
});
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

route('GET', /^\/api\/projects\/([\w-]+)\/web-image$/, async (req, res, m) => {
  const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
  if (!q.trim()) return fail(res, 400, 'Missing query');
  const r = await resolveWebImage(projectDir(m[1]), q.trim());
  r.error ? fail(res, 404, r.error) : json(res, 200, r);
});

route('GET', /^\/api\/projects\/([\w-]+)\/gif$/, async (req, res, m) => {
  const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
  if (!q.trim()) return fail(res, 400, 'Missing query');
  await handleGif(res, m[1], q.trim());
});

// ---------- server ----------
async function serveIndex(res) {
  const html = (await fsp.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8')).replace('__RR_TOKEN__', TOKEN);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
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
      if (rest.startsWith('mine/')) return sendFile(req, res, safeJoin(DIRS.effects, rest.slice(5)));
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
