// Studies a reel someone else made so the AI can borrow its editing style: contact sheets with a
// time on every frame, a few full-size frames, where the cuts are, how fast they talk and what they
// say. Runs in the browser like the main analysis; the files land in references/<id>/.
import { api, canvasBlob } from './lib.js';
import { openInput, probe, decodeSourceAudio, resampleMono, envelope, transcribe } from './analyze.js';

const MAX_SECONDS = 180;
const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);

async function put(projectId, rid, name, body, type) {
  await api.put(`/api/projects/${projectId}/files/references/${rid}/${name}`, body, type);
}

// Big jumps in the picture between frames sampled 10 times a second = cuts (or hard punch-ins).
async function findCuts(MB, track, duration) {
  const sink = new MB.CanvasSink(track, track.displayWidth >= track.displayHeight ? { width: 64 } : { height: 64 });
  const times = [];
  for (let t = 0.05; t < duration; t += 0.1) times.push(+t.toFixed(3));
  const c = document.createElement('canvas');
  const x = c.getContext('2d', { willReadFrequently: true });
  let prev = null;
  const diffs = [];
  let i = 0;
  for await (const wc of sink.canvasesAtTimestamps(times)) {
    const t = times[i++];
    if (!wc) continue;
    if (c.width !== wc.canvas.width || c.height !== wc.canvas.height) { c.width = wc.canvas.width; c.height = wc.canvas.height; }
    x.drawImage(wc.canvas, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const luma = new Float32Array(d.length / 4);
    for (let k = 0; k < luma.length; k++) luma[k] = d[k * 4] * 0.299 + d[k * 4 + 1] * 0.587 + d[k * 4 + 2] * 0.114;
    if (prev && prev.length === luma.length) {
      let s = 0;
      for (let k = 0; k < luma.length; k++) s += Math.abs(luma[k] - prev[k]);
      diffs.push({ t, d: s / luma.length });
    }
    prev = luma;
  }
  const sorted = diffs.map((v) => v.d).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const threshold = Math.max(18, median * 4);
  const cuts = [];
  diffs.forEach((v, k) => {
    const before = diffs[k - 1]?.d ?? 0, after = diffs[k + 1]?.d ?? 0;
    if (v.d > threshold && v.d >= before && v.d >= after && (!cuts.length || v.t - cuts[cuts.length - 1] > 0.3)) cuts.push(+(v.t - 0.05).toFixed(2));
  });
  return cuts;
}

// Grids of 12 frames with the time stamped on each, so the AI can "watch" the reel in a few images.
async function contactSheets(MB, track, duration, projectId, rid) {
  const portrait = track.displayHeight > track.displayWidth;
  const tw = portrait ? 240 : 320, th = portrait ? Math.round((240 * track.displayHeight) / track.displayWidth) : Math.round((320 * track.displayHeight) / track.displayWidth);
  const cols = portrait ? 4 : 3, rows = portrait ? 3 : 4, per = cols * rows;
  const n = Math.max(12, Math.min(36, Math.round(duration / 0.9)));
  const times = Array.from({ length: n }, (_, i) => +(((i + 0.5) / n) * duration).toFixed(3));
  const sink = new MB.CanvasSink(track, portrait ? { height: th * 2 } : { width: tw * 2 });
  const sheets = [];
  let sheet = null, sx = null, idx = 0;
  const flush = async () => {
    if (!sheet) return;
    const name = `sheet-${sheets.length + 1}.jpg`;
    await put(projectId, rid, name, await canvasBlob(sheet, 'image/jpeg', 0.8), 'image/jpeg');
    sheets.push({ name, from: times[sheets.length * per], to: times[Math.min(times.length - 1, sheets.length * per + per - 1)] });
    sheet = null;
  };
  for await (const wc of sink.canvasesAtTimestamps(times)) {
    const k = idx % per;
    if (k === 0) {
      await flush();
      sheet = document.createElement('canvas');
      const count = Math.min(per, n - idx);
      sheet.width = cols * tw;
      sheet.height = Math.ceil(count / cols) * th;
      sx = sheet.getContext('2d');
      sx.fillStyle = '#000';
      sx.fillRect(0, 0, sheet.width, sheet.height);
    }
    const x = (k % cols) * tw, y = Math.floor(k / cols) * th;
    if (wc) sx.drawImage(wc.canvas, x, y, tw, th);
    sx.fillStyle = 'rgba(0,0,0,0.7)';
    sx.fillRect(x, y, 62, 24);
    sx.fillStyle = '#fff';
    sx.font = '600 15px Inter, sans-serif';
    sx.fillText(`${fmt(times[idx])}s`, x + 6, y + 17);
    sx.strokeStyle = 'rgba(255,255,255,0.25)';
    sx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);
    idx++;
  }
  await flush();
  return sheets;
}

async function detailFrames(MB, track, duration, projectId, rid) {
  const portrait = track.displayHeight > track.displayWidth;
  const sink = new MB.CanvasSink(track, portrait ? { height: 1280 } : { width: 1280 });
  const times = [Math.min(0.6, duration * 0.1), duration * 0.42, duration * 0.78].map((t) => +t.toFixed(2));
  const out = [];
  let i = 0;
  for await (const wc of sink.canvasesAtTimestamps(times)) {
    const t = times[i++];
    if (!wc) continue;
    const c = document.createElement('canvas');
    c.width = wc.canvas.width; c.height = wc.canvas.height;
    c.getContext('2d').drawImage(wc.canvas, 0, 0);
    const name = `detail-${i}-${fmt(t)}s.jpg`;
    await put(projectId, rid, name, await canvasBlob(c, 'image/jpeg', 0.85), 'image/jpeg');
    out.push(name);
  }
  return out;
}

export async function studyReference({ projectId, rid, file, site, settings = {}, onStatus }) {
  const url = `/files/projects/${projectId}/references/${rid}/${encodeURIComponent(file)}`;
  onStatus?.('Watching the reference reel');
  const meta = await probe(url);
  if (!meta.canDecode) throw new Error(`Chrome can't play this reel's format (${meta.codec || 'unknown codec'}). Try a different link or file.`);
  const duration = Math.min(meta.duration, MAX_SECONDS);
  const { MB, input } = await openInput(url);
  const track = await input.getPrimaryVideoTrack();

  onStatus?.('Finding its cuts');
  const cuts = await findCuts(MB, track, duration);
  onStatus?.('Taking stills of every moment');
  const sheets = await contactSheets(MB, track, duration, projectId, rid);
  const details = await detailFrames(MB, track, duration, projectId, rid);

  let words = [], musicBed = null, env = null;
  if (meta.hasAudio && meta.audioDecodable) {
    onStatus?.('Listening to it');
    const src = await decodeSourceAudio(url).catch(() => null);
    if (src) {
      const pcm = await resampleMono(src, 16000);
      const clip = pcm.subarray(0, Math.min(pcm.length, Math.round(duration * 16000)));
      env = envelope(clip);
      const db = [...env.db].sort((a, b) => a - b);
      const floor = db[Math.floor(db.length * 0.1)] ?? -90, loud = db[Math.floor(db.length * 0.9)] ?? -90;
      musicBed = floor > -42 && loud - floor < 24;
      try {
        words = (await transcribe(new Float32Array(clip), env, { model: settings.whisper || 'base', language: settings.language || 'english' })).words;
      } catch (e) { console.warn('Reference transcription failed', e); }
    }
  }

  const shots = [0, ...cuts, duration];
  const lens = shots.slice(1).map((t, i) => t - shots[i]).filter((d) => d > 0.05);
  const avg = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
  const spoken = words.length ? words[words.length - 1].e - words[0].s : 0;
  const L = [];
  L.push(`# Reference reel ${rid}`, '');
  L.push(`- From: ${site || 'a video file the user dropped in'}. ${meta.width}×${meta.height} (${meta.height > meta.width ? 'vertical' : 'horizontal'}), ${fmt(meta.duration)}s${meta.duration > MAX_SECONDS ? ` (studied the first ${MAX_SECONDS}s)` : ''}, ${Math.round(meta.fps || 30)} fps.`);
  L.push(`- Visual cuts (or hard punch-ins): ${cuts.length}, so ${lens.length} shots averaging ${fmt(avg)}s (shortest ${fmt(Math.min(...lens))}s, longest ${fmt(Math.max(...lens))}s). That's ${fmt((cuts.length / Math.max(1, duration)) * 10)} cuts per 10 seconds.`);
  if (cuts.length) L.push(`- Cut times (s): ${cuts.map(fmt).join(', ')}`);
  if (words.length) L.push(`- Speech: ${words.length} words, ${fmt(words.length / Math.max(1, spoken))} words per second. First word at ${fmt(words[0].s)}s.`);
  else L.push('- Speech: none detected (music, text-only or voiceless reel).');
  if (musicBed != null) L.push(`- Audio under the voice: ${musicBed ? 'continuous (probably a music bed)' : 'quiet between words (probably no music, or very low)'}.`);
  L.push('', '## Frames', '');
  for (const s of sheets) L.push(`- \`${s.name}\`: ${fmt(s.from)}s to ${fmt(s.to)}s, 12 frames, each labelled with its time.`);
  for (const d of details) L.push(`- \`${d}\`: one frame at full size.`);
  if (words.length) {
    L.push('', '## What they say (for structure and pacing only, never reuse their words)', '');
    let line = [];
    const flush = () => { if (line.length) { L.push(`[${fmt(line[0].s)}-${fmt(line[line.length - 1].e)}] ${line.map((w) => w.w).join(' ')}`); line = []; } };
    words.forEach((w, i) => {
      if (line.length && (line.length >= 14 || w.s - words[i - 1].e > 0.6 || /[.?!]$/.test(words[i - 1].w))) flush();
      line.push(w);
    });
    flush();
  }
  L.push('');
  await put(projectId, rid, 'notes.md', L.join('\n'), 'text/markdown');
  return { sheets: sheets.map((s) => s.name), details, cuts, words: words.length, duration };
}
