// First-run analysis of an uploaded video, all in the browser:
// probe → audio loudness → transcript with word timings → face track → stills for the AI.
// Each step saves its result, so a closed tab resumes where it left off.
import { loadMediabunny, CDN } from './cdn.js';
import { api, canvasBlob } from './lib.js';

export async function openInput(url) {
  const MB = await loadMediabunny();
  return { MB, input: new MB.Input({ source: new MB.UrlSource(url), formats: MB.ALL_FORMATS }) };
}

export async function probe(url) {
  const { input } = await openInput(url);
  const video = await input.getPrimaryVideoTrack();
  if (!video) throw new Error('This file has no video track.');
  const audio = await input.getPrimaryAudioTrack();
  const duration = await input.computeDuration();
  let fps = 30;
  try { fps = (await video.computePacketStats(90)).averagePacketRate || 30; } catch {}
  return {
    width: video.displayWidth, height: video.displayHeight, duration, fps: Math.round(fps * 100) / 100,
    codec: await video.getCodec().catch(() => null),
    canDecode: await video.canDecode().catch(() => false),
    hasAudio: !!audio, audioDecodable: audio ? await audio.canDecode().catch(() => false) : false,
  };
}

// Full-resolution audio of the source: { rate, channels: [Float32Array, ...] }.
export async function decodeSourceAudio(url, onProgress) {
  const { MB, input } = await openInput(url);
  const track = await input.getPrimaryAudioTrack();
  if (!track || !(await track.canDecode())) return null;
  const duration = await input.computeDuration();
  const rate = track.sampleRate;
  const nch = Math.min(2, track.numberOfChannels || 1);
  const total = Math.ceil((duration + 1) * rate);
  const chans = Array.from({ length: nch }, () => new Float32Array(total));
  let end = 0;
  const sink = new MB.AudioBufferSink(track);
  for await (const { buffer, timestamp } of sink.buffers()) {
    const off = Math.round(timestamp * rate);
    if (off >= total) break;
    const start = Math.max(0, -off);
    const n = Math.min(buffer.length - start, total - Math.max(0, off));
    if (n <= 0) continue;
    for (let c = 0; c < nch; c++) chans[c].set(buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)).subarray(start, start + n), Math.max(0, off));
    end = Math.max(end, Math.max(0, off) + n);
    onProgress?.(Math.min(1, timestamp / duration));
  }
  return { rate, channels: chans.map((c) => c.subarray(0, end)) };
}

export async function resampleMono(src, targetRate) {
  const len = src.channels[0].length;
  if (!len) return new Float32Array(0);
  const mono = new Float32Array(len);
  for (const ch of src.channels) for (let i = 0; i < len; i++) mono[i] += ch[i] / src.channels.length;
  const ctx = new OfflineAudioContext(1, Math.ceil((len * targetRate) / src.rate), targetRate);
  const buf = ctx.createBuffer(1, len, src.rate);
  buf.copyToChannel(mono, 0);
  const node = ctx.createBufferSource();
  node.buffer = buf;
  node.connect(ctx.destination);
  node.start();
  return (await ctx.startRendering()).getChannelData(0);
}

// Loudness in dBFS every 20ms (50 per second).
export function envelope(pcm16k) {
  const win = 320, n = Math.floor(pcm16k.length / win);
  const db = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * win, e = j + win; j < e; j++) s += pcm16k[j] * pcm16k[j];
    db[i] = Math.max(-90, Math.round(20 * Math.log10(Math.sqrt(s / win) + 1e-9)));
  }
  return { rate: 50, db };
}

// ---- transcription ----
let worker = null;
const pending = new Map();
let listeners = new Set();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'result' || m.type === 'error') {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) m.type === 'result' ? p.resolve(m) : p.reject(new Error(m.message));
    } else for (const l of listeners) l(m);
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'Speech model crashed')); pending.clear(); worker = null; };
  return worker;
}

let reqId = 0;
function runWhisper(audio, model, language) {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: 'run', id, audio, model, language }, [audio.buffer]);
  });
}

// Split long audio into ≤26s pieces in the middle of the quietest ~0.4s stretch, so no word is cut.
function chunkPlan(env, totalSec) {
  const out = [];
  let start = 0;
  const win = Math.round(0.4 * env.rate);
  while (start < totalSec - 0.05) {
    if (totalSec - start <= 26) { out.push([start, totalSec]); break; }
    const a = Math.floor((start + 14) * env.rate), b = Math.floor((start + 26) * env.rate);
    let best = b, bestSum = Infinity;
    for (let i = a; i + win < b && i + win < env.db.length; i++) {
      let s = 0;
      for (let k = 0; k < win; k++) s += env.db[i + k];
      if (s < bestSum) { bestSum = s; best = i + win / 2; }
    }
    const end = best / env.rate;
    out.push([start, end]);
    start = end;
  }
  return out;
}

// Whisper drops a final sentence when the audio stops right after it, so every piece gets
// two seconds of silence appended before it is transcribed.
function padded(pcm, a, b) {
  const s = Math.floor(a * 16000), e = Math.min(pcm.length, Math.ceil(b * 16000));
  const out = new Float32Array(e - s + 32000);
  out.set(pcm.subarray(s, e), 0);
  return out;
}

export function chunksToWords(chunks, offset) {
  const words = [];
  for (const c of chunks) {
    const raw = c.text || '';
    const text = raw.trim();
    if (!text) continue;
    let [s, e] = c.timestamp || [];
    if (s == null) continue;
    if (e == null || e < s) e = s + 0.3;
    s += offset; e += offset;
    // Tokens without a leading space continue the previous word ("$1" + ",000").
    if (words.length && !/^\s/.test(raw)) {
      const w = words[words.length - 1];
      w.w += text; w.e = Math.max(w.e, e);
      continue;
    }
    words.push({ w: text, s, e });
  }
  return words;
}

export async function transcribe(pcm16k, env, { model = 'base', language = 'english', onProgress, onDownload } = {}) {
  const listener = (m) => { if (m.type === 'download') onDownload?.(m.progress, m.mb); };
  listeners.add(listener);
  try {
    const total = pcm16k.length / 16000;
    const plan = chunkPlan(env, total);
    const sorted = [...env.db].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.1)] ?? -90;
    const speech = sorted[Math.floor(sorted.length * 0.9)] ?? -20;
    const silentBelow = floor + Math.max(6, (speech - floor) * 0.3);
    const words = [];
    let done = 0;
    onProgress?.(0);
    // Last moment of real speech inside [a, b], from the loudness envelope.
    // (Needs at least 0.3s of loud frames, so a breath or a click doesn't count as speech.)
    const lastLoud = (a, b) => {
      let last = -1, count = 0;
      for (let i = Math.floor(a * 50); i < Math.min(env.db.length, Math.ceil(b * 50)); i++) if (env.db[i] > silentBelow) { last = i / 50; count++; }
      return count >= 15 ? last : -1;
    };
    for (const [a, b] of plan) {
      let from = a;
      // Up to two retries if speech near the end of the piece came back without words.
      for (let attempt = 0; attempt < 3 && lastLoud(from, b) >= 0; attempt++) {
        const res = await runWhisper(padded(pcm16k, from, b), model, language);
        const got = chunksToWords(res.chunks, from).filter((w) => w.s < b + 0.5);
        for (const w of got) words.push(w);
        const end = got.length ? Math.max(...got.map((w) => w.e)) : from;
        const missed = lastLoud(end + 0.4, b);
        if (missed < 0 || missed - end < 0.6) break;
        from = Math.max(end, from + 0.5);
      }
      done += b - a;
      onProgress?.(done / total);
    }
    // Whisper often stretches a word's end across the pause after it. End the word where the
    // audio actually goes quiet (at least 0.14s below the speech threshold).
    const quietAfter = (s, e) => {
      let run = 0;
      for (let i = Math.floor((s + 0.12) * 50); i < Math.min(env.db.length, Math.ceil(e * 50)); i++) {
        if (env.db[i] <= silentBelow) { if (++run >= 7) return (i - run + 1) / 50 + 0.04; } else run = 0;
      }
      return e;
    };
    // Tidy timings: monotonic, minimum length, no overlaps.
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (i > 0 && w.s < words[i - 1].s) w.s = words[i - 1].s;
      if (w.e - w.s > 0.35) w.e = Math.max(w.s + 0.15, quietAfter(w.s, w.e));
      if (w.e - w.s < 0.06) w.e = w.s + 0.06;
      if (i > 0 && words[i - 1].e > w.s) words[i - 1].e = Math.max(words[i - 1].s + 0.04, w.s);
      w.s = Math.round(w.s * 1000) / 1000;
      w.e = Math.round(w.e * 1000) / 1000;
    }
    return { language, model, words };
  } finally { listeners.delete(listener); }
}

// ---- faces ----
async function makeFaceDetector(modelPath) {
  const { FilesetResolver, FaceDetector } = await import(CDN.mediapipe);
  const vision = await FilesetResolver.forVisionTasks(CDN.mediapipeWasm);
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: modelPath, delegate }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 });
  try { return await FaceDetector.createFromOptions(vision, opts('GPU')); } catch { return await FaceDetector.createFromOptions(vision, opts('CPU')); }
}

function biggestFace(det, w, h) {
  let best = null;
  for (const d of det?.detections || []) {
    const b = d.boundingBox;
    if (!b || (d.categories?.[0]?.score ?? 1) < 0.5) continue;
    if (!best || b.width * b.height > best.width * best.height) best = b;
  }
  return best ? { x: (best.originX + best.width / 2) / w, y: (best.originY + best.height / 2) / h, w: best.width / w, h: best.height / h } : null;
}

export async function detectFaces(url, duration, onProgress) {
  const { MB, input } = await openInput(url);
  const track = await input.getPrimaryVideoTrack();
  const landscape = track.displayWidth >= track.displayHeight;
  const sink = new MB.CanvasSink(track, landscape ? { width: 640 } : { height: 640 });
  const step = duration > 180 ? 0.5 : 0.25;
  const times = [];
  for (let t = 0; t < duration; t += step) times.push(+t.toFixed(3));

  // Pick whichever face model finds the speaker more often on a sample of frames.
  const sampleTimes = times.filter((_, i) => i % Math.max(1, Math.floor(times.length / 10)) === 0).slice(0, 10);
  const full = await makeFaceDetector(CDN.faceModelFull);
  const short = await makeFaceDetector(CDN.faceModelShort);
  let fullHits = 0, shortHits = 0;
  for await (const wc of sink.canvasesAtTimestamps(sampleTimes)) {
    if (!wc) continue;
    if (biggestFace(full.detect(wc.canvas), wc.canvas.width, wc.canvas.height)) fullHits++;
    if (biggestFace(short.detect(wc.canvas), wc.canvas.width, wc.canvas.height)) shortHits++;
  }
  const detector = shortHits > fullHits ? short : full;
  (detector === short ? full : short).close?.();

  const faces = [];
  let i = 0;
  for await (const wc of sink.canvasesAtTimestamps(times)) {
    const t = times[i++];
    if (wc) {
      const f = biggestFace(detector.detect(wc.canvas), wc.canvas.width, wc.canvas.height);
      if (f) faces.push({ t, x: +f.x.toFixed(4), y: +f.y.toFixed(4), w: +f.w.toFixed(4), h: +f.h.toFixed(4) });
    }
    if (i % 8 === 0) onProgress?.(i / times.length);
  }
  detector.close?.();
  return { faces, faceSamples: times.length };
}

// ---- stills for the AI and the project card ----
export async function grabStills(id, url, duration) {
  const { MB, input } = await openInput(url);
  const track = await input.getPrimaryVideoTrack();
  const sink = new MB.CanvasSink(track, track.displayWidth >= track.displayHeight ? { width: 640 } : { height: 640 });
  const n = 6;
  const times = Array.from({ length: n }, (_, i) => +(((i + 0.5) / n) * duration).toFixed(3));
  times.push(+(Math.min(duration * 0.3, 3)).toFixed(3));
  const out = document.createElement('canvas');
  let i = 0;
  for await (const wc of sink.canvasesAtTimestamps(times)) {
    const idx = i++;
    if (!wc) continue;
    const c = wc.canvas;
    const k = idx === n ? 360 / Math.max(c.width, c.height) : 640 / Math.max(c.width, c.height);
    out.width = Math.round(c.width * k); out.height = Math.round(c.height * k);
    out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
    const blob = await canvasBlob(out, 'image/jpeg', 0.8);
    const name = idx === n ? 'thumb.jpg' : `frames/f-${String(idx + 1).padStart(2, '0')}-${times[idx].toFixed(1)}s.jpg`;
    await api.put(`/api/projects/${id}/files/${name}`, blob, 'image/jpeg');
  }
}

// Runs whatever analysis steps are still missing. onStep(key, label, progress 0..1 | null, done?)
export async function analyze({ id, project, settings, onStep }) {
  const url = `/files/projects/${id}/${encodeURIComponent(project.source)}`;
  const status = { ...(project.analysis || {}) };
  const save = async () => api.patch(`/api/projects/${id}`, { analysis: status });
  let meta = project.meta;

  if (!status.meta || !meta) {
    onStep('meta', 'Reading the video', null);
    meta = await probe(url);
    if (!meta.canDecode) {
      const err = new Error(`This browser can't decode this video (${meta.codec || 'unknown codec'}).`);
      err.code = 'decode';
      throw err;
    }
    status.meta = true;
    await api.patch(`/api/projects/${id}`, { meta, analysis: status });
  }
  onStep('meta', 'Reading the video', 1, true);

  let analysis = (await api.get(`/api/projects/${id}`)).analysis || {};
  let pcm = null, env = analysis.audio || null;
  const needAudio = !status.audio || !status.transcript;
  if (needAudio && meta.hasAudio && meta.audioDecodable) {
    onStep('audio', 'Listening to the audio', 0);
    const src = await decodeSourceAudio(url, (p) => onStep('audio', 'Listening to the audio', p));
    if (src) {
      pcm = await resampleMono(src, 16000);
      env = envelope(pcm);
      analysis = { ...analysis, audio: env };
      await api.put(`/api/projects/${id}/files/analysis.json`, analysis);
    }
    status.audio = true; await save();
  } else if (!status.audio) { status.audio = true; await save(); }
  onStep('audio', 'Listening to the audio', 1, true);

  if (!status.transcript) {
    let transcript = { language: settings.language, model: settings.whisper, words: [] };
    if (pcm && env) {
      onStep('transcript', 'Writing the transcript', 0);
      transcript = await transcribe(pcm, env, {
        model: settings.whisper || 'base', language: settings.language || 'english',
        onProgress: (p) => onStep('transcript', 'Writing the transcript', p),
        onDownload: (p, mb) => onStep('transcript', `Downloading the speech model (${mb} MB, first time only)`, p),
      });
    }
    await api.put(`/api/projects/${id}/files/transcript.json`, transcript);
    status.transcript = true; await save();
  }
  onStep('transcript', 'Writing the transcript', 1, true);

  if (!status.faces) {
    onStep('faces', 'Finding your face', 0);
    try {
      const { faces, faceSamples } = await detectFaces(url, meta.duration, (p) => onStep('faces', 'Finding your face', p));
      analysis = { ...analysis, faces, faceSamples };
      await api.put(`/api/projects/${id}/files/analysis.json`, analysis);
    } catch (e) { console.warn('Face detection failed', e); }
    status.faces = true; await save();
  }
  onStep('faces', 'Finding your face', 1, true);

  if (!status.frames) {
    onStep('frames', 'Grabbing stills for the AI', null);
    await grabStills(id, url, meta.duration).catch((e) => console.warn('Stills failed', e));
    status.frames = true; await save();
  }
  onStep('frames', 'Grabbing stills for the AI', 1, true);
  await api.patch(`/api/projects/${id}`, { status: 'ready', analysis: status });
  return meta;
}
