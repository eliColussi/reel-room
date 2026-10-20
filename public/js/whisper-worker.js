// Speech-to-text with word timings, fully in the browser (Whisper via transformers.js).
// The model downloads once (~80–250 MB) and is cached by the browser afterwards.
import { CDN } from './cdn.js';

let asr = null;
let loaded = '';

async function load(modelKey) {
  const model = CDN.whisper[modelKey] || CDN.whisper.base;
  if (asr && loaded === model) return;
  const { pipeline, env } = await import(CDN.transformers);
  env.allowLocalModels = false;
  const files = new Map();
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.total) {
      files.set(p.file, [p.loaded, p.total]);
      let a = 0, b = 0;
      for (const [l, t] of files.values()) { a += l; b += t; }
      postMessage({ type: 'download', progress: a / b, mb: Math.round(b / 1e6) });
    }
  };
  let device = 'wasm';
  try { if (navigator.gpu && (await navigator.gpu.requestAdapter())) device = 'webgpu'; } catch {}
  const make = (dev) => pipeline('automatic-speech-recognition', model, {
    device: dev,
    dtype: dev === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
    progress_callback,
  });
  try {
    asr = await make(device);
    if (device === 'webgpu') await asr(new Float32Array(16000), { return_timestamps: 'word' }); // warm-up / sanity check
  } catch (e) {
    if (device !== 'webgpu') throw e;
    device = 'wasm';
    asr = await make('wasm');
  }
  loaded = model;
  postMessage({ type: 'ready', device });
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') { await load(msg.model); return; }
    if (msg.type === 'run') {
      await load(msg.model);
      // Dictation only needs the text; captions need a time for every word.
      const opts = msg.plain ? { chunk_length_s: 30, task: 'transcribe' } : { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 0, task: 'transcribe' };
      if (msg.language && msg.language !== 'auto') opts.language = msg.language;
      const out = await asr(msg.audio, opts);
      postMessage({ type: 'result', id: msg.id, chunks: out.chunks || [], text: out.text || '' });
    }
  } catch (err) {
    postMessage({ type: 'error', id: msg.id, message: String(err?.message || err) });
  }
};
