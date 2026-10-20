// Real pictures for edits, fetched by the app (the AI itself has no web access):
//   logo:<name>    the logo from the name's Wikipedia article, as a PNG
//   photo:<name>   the main picture of a Wikipedia article (a person, place, product, building)
//   og:<site>      the share image the website itself publishes (its og:image)
//   site:<site>    a screenshot of the website at desktop size, taken with the user's own Chrome
//   phone:<site>   the same at phone size
// Files land in assets/web/, with a note in assets/web/index.json of where each one came from.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import dns from 'node:dns/promises';
import net from 'node:net';
import { spawn } from 'node:child_process';

const UA = 'ReelRoom/0.3 (https://github.com/eliColussi/reel-room; video editor fetching a logo)';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const KINDS = ['logo', 'photo', 'og', 'site', 'phone'];
const NOT_A_LOGO = /commons-logo|wiki|wikt|symbol_support|question_book|edit-clear|padlock|ambox|crystal|portal|folder|lock-|increase|decrease|flag_of|disambig|nuvola|red_pog|blue_pog|text-x|office-|loudspeaker|sound-icon|semi-protection|star_full|pictogram|icon_tools/i;

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s.-]/g, '').trim().replace(/[\s_.]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'image';

export function parseWebQuery(q) {
  const m = /^\s*([a-z]+)\s*:\s*(.+?)\s*$/i.exec(String(q || ''));
  if (m && KINDS.includes(m[1].toLowerCase())) return { kind: m[1].toLowerCase(), term: m[2].slice(0, 120) };
  const term = String(q || '').trim().slice(0, 120);
  return { kind: /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(term) ? 'og' : 'logo', term };
}

// ---------- safety: only public websites, never this computer or the home network ----------
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && privateIp(v.slice(7));
}

async function publicUrl(raw) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new Error('not a web address'); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || (u.port && !['80', '443'].includes(u.port))) throw new Error('only normal web addresses are allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host) || net.isIP(host)) throw new Error('only public websites are allowed');
  const addrs = await dns.lookup(host, { all: true }).catch(() => { throw new Error(`couldn't find ${host}`); });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('only public websites are allowed');
  return u;
}

// fetch() that re-checks every redirect, with a size cap.
// Wikimedia asks apps to say who they are; most other sites only answer browsers.
const uaFor = (u) => (/(^|\.)(wikipedia|wikimedia)\.org$/.test(u.hostname) ? UA : BROWSER_UA);

async function get(url, { maxBytes = 15e6, accept, timeout = 20000 } = {}) {
  let u = await publicUrl(url);
  for (let hop = 0; hop < 6; hop++) {
    const r = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': uaFor(u), ...(accept ? { Accept: accept } : {}) }, signal: AbortSignal.timeout(timeout) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = await publicUrl(new URL(r.headers.get('location'), u).href); continue; }
    if (!r.ok) throw new Error(`${u.hostname} answered ${r.status}`);
    const len = +r.headers.get('content-length') || 0;
    if (len > maxBytes) throw new Error('file too large');
    const chunks = []; let size = 0;
    for await (const c of r.body) { size += c.length; if (size > maxBytes) throw new Error('file too large'); chunks.push(c); }
    return { buf: Buffer.concat(chunks), type: (r.headers.get('content-type') || '').split(';')[0].trim(), url: u.href };
  }
  throw new Error('too many redirects');
}

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/avif': '.avif' };

async function saveImage(dir, base, url) {
  const { buf, type } = await get(url, { accept: 'image/*' });
  if (!EXT[type]) throw new Error(`not an image (${type || 'unknown type'})`);
  const rel = `assets/web/${base}${EXT[type]}`;
  await fsp.mkdir(path.join(dir, 'assets', 'web'), { recursive: true });
  await fsp.writeFile(path.join(dir, rel), buf);
  return rel;
}

// ---------- Wikipedia / Wikimedia ----------
async function wiki(params) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const { buf } = await get(`https://en.wikipedia.org/w/api.php?${qs}`, { maxBytes: 4e6 });
  return JSON.parse(buf.toString('utf8'));
}

async function wikiPages(term, n = 3) {
  const d = await wiki({ action: 'query', list: 'search', srsearch: term, srlimit: String(n) });
  return (d.query?.search || []).map((p) => p.title);
}

async function fileThumb(title, width = 1200) {
  const d = await wiki({ action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: String(width) });
  const ii = d.query?.pages?.[0]?.imageinfo?.[0];
  if (!ii) return null;
  const meta = ii.extmetadata || {};
  const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();
  return { url: ii.thumburl || ii.url, page: ii.descriptionurl, license: strip(meta.LicenseShortName?.value), artist: strip(meta.Artist?.value).slice(0, 80) };
}

async function findLogo(term) {
  const words = term.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  for (const [rank, title] of (await wikiPages(term, 3)).entries()) {
    const d = await wiki({ action: 'query', titles: title, prop: 'images', imlimit: '80' });
    const files = (d.query?.pages?.[0]?.images || []).map((i) => i.title).filter((t) => /logo|wordmark/i.test(t) && !NOT_A_LOGO.test(t));
    if (!files.length) continue;
    const named = (t) => words.some((w) => t.toLowerCase().replace(/[\s_-]+/g, '').includes(w.replace(/[\s_-]+/g, '')));
    const titleMatches = title.toLowerCase().replace(/\W+/g, '') === term.toLowerCase().replace(/\W+/g, '');
    const pick = files.find(named) || (rank === 0 && titleMatches ? files[0] : null);
    if (!pick) continue;
    const th = await fileThumb(pick, 1000);
    if (th) return { ...th, from: `Wikipedia article "${title}", ${pick}` };
  }
  return null;
}

async function findPhoto(term) {
  for (const title of await wikiPages(term, 2)) {
    const d = await wiki({ action: 'query', titles: title, prop: 'pageimages', piprop: 'name', pilicense: 'any' });
    const name = d.query?.pages?.[0]?.pageimage;
    if (!name) continue;
    const th = await fileThumb(`File:${name}`, 1600);
    if (th) return { ...th, from: `Wikipedia article "${title}", File:${name}` };
  }
  // Wikimedia Commons file search as a fallback.
  const qs = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrsearch: term, gsrnamespace: '6', gsrlimit: '5', prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '1600' });
  const { buf } = await get(`https://commons.wikimedia.org/w/api.php?${qs}`, { maxBytes: 4e6 });
  const pages = (JSON.parse(buf.toString('utf8')).query?.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0));
  const hit = pages.find((p) => /image\/(jpeg|png|webp)/.test(p.imageinfo?.[0]?.mime || ''));
  return hit ? { url: hit.imageinfo[0].thumburl || hit.imageinfo[0].url, page: hit.imageinfo[0].descriptionurl, from: `Wikimedia Commons, ${hit.title}` } : null;
}

async function findOgImage(site) {
  const { buf, url } = await get(site, { maxBytes: 4e6, accept: 'text/html' });
  const html = buf.toString('utf8');
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const key of ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) {
    for (const m of metas) {
      if (!new RegExp(`(property|name)\\s*=\\s*["']${key}["']`, 'i').test(m)) continue;
      const c = /content\s*=\s*["']([^"']+)["']/i.exec(m);
      if (c) return { url: new URL(c[1].replace(/&amp;/g, '&'), url).href, from: `the share image of ${new URL(url).hostname}` };
    }
  }
  return null;
}

// ---------- screenshots with the user's Chrome ----------
export function findChrome() {
  const c = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap((b) => [path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe')])
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return c.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

// Drives Chrome over its debugging pipe (no extra packages): open the page, wait for it to load
// (or 12 seconds, whichever comes first, since some sites never stop loading ads), then capture.
function cdpSession(chrome, args) {
  const c = spawn(chrome, [...args, '--remote-debugging-pipe'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  const waiting = new Map();
  const listeners = [];
  let id = 0, buf = '';
  c.stdio[4].on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? w.reject(new Error(msg.error.message)) : w.resolve(msg.result); }
      else for (const l of listeners) l(msg);
    }
  });
  c.stdio[3].on('error', () => {});
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, { resolve, reject });
    c.stdio[3].write(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  return { child: c, send, on: (fn) => listeners.push(fn) };
}

async function screenshot(dir, base, site, phone) {
  const chrome = findChrome();
  if (!chrome) throw new Error('needs Chrome, Edge or Brave installed for screenshots');
  const u = await publicUrl(site);
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelroom-shot-'));
  const rel = `assets/web/${base}.png`;
  const cdp = cdpSession(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', `--user-data-dir=${profile}`, 'about:blank']);
  const kill = setTimeout(() => cdp.child.kill(), 40000);
  try {
    const exited = new Promise((_, reject) => cdp.child.on('exit', () => reject(new Error('the browser closed before the page loaded'))));
    const work = (async () => {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const page = targetInfos.find((t) => t.type === 'page');
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
      const s = (m, p) => cdp.send(m, p, sessionId);
      const [w, h, scale] = phone ? [430, 932, 3] : [1440, 900, 1.5];
      await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: phone });
      await s('Network.setUserAgentOverride', { userAgent: phone ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' : BROWSER_UA });
      await s('Page.enable');
      const loaded = new Promise((resolve) => cdp.on((m) => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') resolve(); }));
      await s('Page.navigate', { url: u.href });
      await Promise.race([loaded, new Promise((r) => setTimeout(r, 12000))]);
      await new Promise((r) => setTimeout(r, 1500)); // let fonts, hero images and animations settle
      // Cookie and consent banners would sit across the bottom of every screenshot: take them out.
      await s('Runtime.evaluate', { expression: `(() => {
        const re = /cookie|consent|privacy|personali[sz]ed|advertising partners|we use|gdpr/i;
        for (const el of [...document.querySelectorAll('body *')]) {
          const cs = getComputedStyle(el);
          if ((cs.position === 'fixed' || cs.position === 'sticky') && re.test(el.innerText || '') && el.getBoundingClientRect().top > innerHeight * 0.25) el.remove();
        }
        for (const el of document.querySelectorAll('#onetrust-consent-sdk, #CybotCookiebotDialog, .fc-consent-root, #usercentrics-root, [aria-label*="cookie" i][role="dialog"]')) el.remove();
        document.documentElement.style.overflow = ''; document.body.style.overflow = '';
      })()` }).catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
      const { data } = await s('Page.captureScreenshot', { format: 'png' });
      await fsp.mkdir(path.join(dir, 'assets', 'web'), { recursive: true });
      await fsp.writeFile(path.join(dir, rel), Buffer.from(data, 'base64'));
      cdp.send('Browser.close').catch(() => {});
      return Buffer.byteLength(data, 'base64');
    })();
    const size = await Promise.race([work, exited]);
    // A nearly empty PNG means a loading screen or a bot check, not the real page.
    const warning = size < (phone ? 60000 : 40000) ? 'This screenshot looks almost blank: the site probably blocks automated browsers or shows a loading screen. Use a logo or og image instead.' : '';
    return { rel, from: `a screenshot of ${u.hostname}${phone ? ' at phone size' : ''}`, warning };
  } finally {
    clearTimeout(kill);
    setTimeout(() => { try { cdp.child.kill(); } catch {} fsp.rm(profile, { recursive: true, force: true }).catch(() => {}); }, 1500);
  }
}

// ---------- the resolver ----------
const inflight = new Map();

export async function webIndex(dir) {
  try { return JSON.parse(await fsp.readFile(path.join(dir, 'assets', 'web', 'index.json'), 'utf8')); } catch { return {}; }
}

export function resolveWebImage(dir, query) {
  const key = `${dir}|${query}`;
  if (!inflight.has(key)) inflight.set(key, run(dir, query).finally(() => inflight.delete(key)));
  return inflight.get(key);
}

async function run(dir, query) {
  const q = String(query || '').trim();
  const index = await webIndex(dir);
  const hit = index[q];
  if (hit?.file && fs.existsSync(path.join(dir, hit.file))) return { query: q, src: hit.file, from: hit.from, warning: hit.warning || '', cached: true };
  if (hit?.error && Date.now() - (hit.at || 0) < 10 * 60 * 1000) return { query: q, error: hit.error, cached: true };
  const { kind, term } = parseWebQuery(q);
  const base = `${kind}-${slug(term)}`;
  let entry;
  try {
    if (kind === 'site' || kind === 'phone') {
      const s = await screenshot(dir, base, term, kind === 'phone');
      entry = { file: s.rel, from: s.from, warning: s.warning };
    } else {
      const found = kind === 'logo' ? (await findLogo(term)) || (/\./.test(term) ? await findOgImage(term) : null)
        : kind === 'photo' ? await findPhoto(term)
          : await findOgImage(term);
      if (!found) throw new Error(kind === 'logo' ? `no logo found for "${term}" on Wikipedia` : `nothing found for "${term}"`);
      entry = { file: await saveImage(dir, base, found.url), from: found.from, page: found.page, license: found.license };
    }
  } catch (e) {
    entry = { error: String(e.message || e).slice(0, 200) };
  }
  entry.at = Date.now();
  const fresh = await webIndex(dir);
  fresh[q] = entry;
  await fsp.mkdir(path.join(dir, 'assets', 'web'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'assets', 'web', 'index.json'), JSON.stringify(fresh, null, 2));
  return entry.error ? { query: q, error: entry.error } : { query: q, src: entry.file, from: entry.from, warning: entry.warning || '' };
}

// Every web image an edit asks for: image layers, image backgrounds, and custom effects' images.
export function webQueries(spec) {
  const out = new Set();
  const add = (v) => { if (typeof v === 'string' && v.trim()) out.add(v.trim()); };
  if (!spec || typeof spec !== 'object') return [];
  if (spec.background?.web) add(spec.background.web);
  for (const l of Array.isArray(spec.layers) ? spec.layers : []) {
    if (l?.web) add(l.web);
    for (const im of Array.isArray(l?.images) ? l.images : []) if (typeof im === 'string' && im.startsWith('web:')) add(im.slice(4));
  }
  return [...out];
}
