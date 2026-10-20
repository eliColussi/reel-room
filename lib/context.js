// Writes the files the AI reads before each turn: the editing guide (as CLAUDE.md for
// Claude Code and AGENTS.md for Codex), context.md with live facts, and transcript.txt.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Reads `export const meta` from every built-in effect (they are plain ES modules).
export async function effectCatalog(appDir) {
  const dir = path.join(appDir, 'public', 'effects');
  const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.js')).sort();
  const out = [];
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const st = await fsp.stat(full);
      const m = await import(`${pathToFileURL(full).href}?v=${Math.floor(st.mtimeMs)}`);
      if (m.meta && typeof m.default === 'function') out.push({ file: `builtin/${f}`, ...m.meta });
    } catch (e) { out.push({ file: `builtin/${f}`, name: f, error: e.message }); }
  }
  return out;
}

const fmtVal = (v) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));

function catalogMarkdown(list) {
  const L = ['# Built-in effects', '',
    'Use one with a custom layer: `{ "type": "custom", "file": "builtin/<file>.js", "start": 3.2, "end": 6, "props": { ... } }`.',
    'Props you leave out use the defaults listed. To change an effect beyond its props, copy its file into effects/ and edit it.', ''];
  const groups = new Map();
  for (const e of list.filter((x) => !x.error)) {
    if (!groups.has(e.category || 'Other')) groups.set(e.category || 'Other', []);
    groups.get(e.category || 'Other').push(e);
  }
  for (const [cat, items] of groups) {
    L.push(`## ${cat}`, '');
    for (const e of items) {
      L.push(`### ${e.name}: \`${e.file}\`${(e.needs || []).includes('person') ? ' (uses the person cut-out)' : ''}`);
      if (e.description) L.push(e.description);
      const props = Object.entries(e.props || {}).map(([k, v]) => `${k}=${fmtVal(v)}`).join(', ');
      if (props) L.push(`Props: ${props}`);
      if (e.presets && Object.keys(e.presets).length) L.push(`Presets (props to copy): ${Object.entries(e.presets).map(([n, p]) => `${n} ${JSON.stringify(p)}`).join('; ')}`);
      if (e.duration) L.push(`Typical length: ${e.duration}s`);
      L.push('');
    }
  }
  return L.join('\n');
}

async function syncBuiltins(appDir, dir) {
  const src = path.join(appDir, 'public', 'effects');
  const dst = path.join(dir, 'builtin');
  await fsp.mkdir(dst, { recursive: true });
  for (const f of (await fsp.readdir(src).catch(() => [])).filter((f) => f.endsWith('.js'))) {
    await fsp.copyFile(path.join(src, f), path.join(dst, f));
  }
  await fsp.writeFile(path.join(dst, 'CATALOG.md'), catalogMarkdown(await effectCatalog(appDir)));
}

const readJson = async (p) => { try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return null; } };

async function listFiles(dir, prefix, out = []) {
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await listFiles(p, `${prefix}${e.name}/`, out);
    else { const st = await fsp.stat(p); out.push({ path: `${prefix}${e.name}`, size: st.size }); }
  }
  return out;
}

const KIND = [[/\.(png|jpe?g|webp|avif|svg)$/i, 'image'], [/\.gif$/i, 'gif'], [/\.(mp4|mov|webm|m4v|mkv)$/i, 'video'], [/\.(mp3|wav|m4a|aac|ogg|flac)$/i, 'audio'], [/\.(ttf|otf|woff2?)$/i, 'font']];
const kindOf = (p) => (KIND.find(([re]) => re.test(p)) || [null, 'file'])[1];
const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const fmt = (n) => (Math.round(n * 100) / 100).toFixed(2);

export function transcriptText(transcript) {
  const words = transcript?.words || [];
  if (!words.length) return '# Transcript\n\n(No speech was detected in this video.)\n';
  const lines = ['# Transcript. Times are source seconds. Each line: [start-end] then the words.', '# The indented row lists "index:word@start" for every word; use the index for captions.emphasis and the times for cuts, zooms and layers.', ''];
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const first = group[0], last = group[group.length - 1];
    lines.push(`[${fmt(first.w.s)}-${fmt(last.w.e)}] ${group.map((g) => g.w.w).join(' ')}`);
    lines.push('    ' + group.map((g) => `${g.i}:${g.w.w}@${fmt(g.w.s)}`).join('  '));
    group = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (group.length && (group.length >= 14 || w.s - prev.e > 0.6 || /[.?!]$/.test(prev.w))) flush();
    group.push({ w, i });
  });
  flush();
  return lines.join('\n') + '\n';
}

function faceSummary(analysis) {
  const faces = (analysis?.faces || []).filter(Boolean);
  if (!faces.length) return 'No face detected (treat the frame as having no fixed subject).';
  const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const x = med(faces.map((f) => f.x)), y = med(faces.map((f) => f.y)), h = med(faces.map((f) => f.h));
  const coverage = Math.round((faces.length / Math.max(1, analysis.faceSamples || faces.length)) * 100);
  return `Face center in the SOURCE frame is usually x≈${x.toFixed(2)}, y≈${y.toFixed(2)} (face height ≈ ${Math.round(h * 100)}% of the frame), visible in ~${coverage}% of sampled frames. With fit "fill" + track "face" the face stays near the horizontal center of the output.`;
}

export async function writeAgentContext({ dir, appDir, libraryDir, settings, provider }) {
  const guide = await fsp.readFile(path.join(appDir, 'lib', 'agent-guide.md'), 'utf8');
  await fsp.writeFile(path.join(dir, 'CLAUDE.md'), guide);
  await fsp.writeFile(path.join(dir, 'AGENTS.md'), guide);
  await syncBuiltins(appDir, dir);

  const [project, transcript, analysis, report, style] = await Promise.all([
    readJson(path.join(dir, 'project.json')), readJson(path.join(dir, 'transcript.json')),
    readJson(path.join(dir, 'analysis.json')), readJson(path.join(dir, 'render-report.json')), readJson(path.join(dir, 'style.json')),
  ]);
  await fsp.writeFile(path.join(dir, 'transcript.txt'), transcriptText(transcript));

  const meta = project?.meta || {};
  const assets = await listFiles(path.join(dir, 'assets'), 'assets/');
  const library = await listFiles(libraryDir, 'library/');
  const effects = await listFiles(path.join(dir, 'effects'), 'effects/');
  const frames = (await listFiles(path.join(dir, 'frames'), 'frames/')).map((f) => f.path);
  const hasPreview = await fsp.access(path.join(dir, 'preview.jpg')).then(() => true, () => false);

  const L = [];
  L.push('# Context (refreshed every turn)', '');
  L.push(`- Video: "${project?.name || 'Untitled'}". Source ${meta.width || '?'}×${meta.height || '?'} (${meta.width > meta.height ? 'landscape' : 'portrait'}), ${fmt(meta.duration || 0)}s, ${meta.fps ? Math.round(meta.fps) : '?'} fps.`);
  if (report) {
    L.push(`- Output: ${report.aspect} ${report.width}×${report.height}, **${fmt(report.outDuration)}s after cuts** (${report.segments} kept segment${report.segments === 1 ? '' : 's'}, ${fmt(report.removed)}s removed).`);
    L.push(`- On screen now: ${report.captionPages} caption groups, ${report.layers} layers, ${report.zooms} zooms.`);
  }
  L.push(`- Transcript: ${(transcript?.words || []).length} words in transcript.txt${transcript?.language ? ` (language: ${transcript.language})` : ''}.`);
  L.push(`- ${faceSummary(analysis)}`);
  L.push(`- Raw frames: ${frames.length ? frames.join(', ') : 'none yet'}.`);
  L.push(`- Current render: ${hasPreview ? 'preview.jpg (contact sheet of the edit as it looks right now)' : 'no preview yet'}.`);
  L.push(`- GIF search: ${settings.giphyKey ? 'ON. gif layers with a "query" get a real GIF.' : 'OFF (no GIPHY key). gif layers will show their fallbackEmoji, so prefer emoji layers.'}`);
  L.push('');
  L.push(`## Active style: ${style?.name || 'none'}`);
  if (style?.description) L.push(style.description);
  if (style?.vibe) L.push('', '> ' + String(style.vibe).split('\n').join('\n> '));
  L.push('');
  if (report?.errors?.length || report?.warnings?.length) {
    L.push('## Problems the renderer reported (fix these if they relate to your work)');
    for (const e of report.errors || []) L.push(`- ERROR: ${e}`);
    for (const w of report.warnings || []) L.push(`- ${w}`);
    L.push('');
  }
  L.push('## Assets you can use');
  if (!assets.length && !library.length) L.push('None. The user has not added any images, clips, logos or music. Use emoji, gif queries, text, shapes and custom effects.');
  for (const a of [...assets, ...library]) {
    if (a.path.startsWith('assets/gifs/')) continue;
    L.push(`- \`${a.path}\` (${kindOf(a.path)}, ${kb(a.size)})`);
  }
  const gifs = assets.filter((a) => a.path.startsWith('assets/gifs/'));
  if (gifs.length) L.push(`- ${gifs.length} GIF(s) already downloaded in assets/gifs/ (from earlier gif queries)`);
  L.push('', 'Built-in effects: see builtin/CATALOG.md (use with `"file": "builtin/<name>.js"`).');
  if (effects.length) { L.push('', '## Custom effects already written for this video'); for (const e of effects) L.push(`- \`${e.path}\``); }
  L.push('');
  await fsp.writeFile(path.join(dir, 'context.md'), L.join('\n'));
}
