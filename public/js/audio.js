// Builds the final soundtrack: voice with the cuts applied (tiny fades so cuts never click),
// optional voice leveling, music that ducks under speech, sound effects and b-roll audio.
import { findSilences } from './render/timeline.js';

const OUT_RATE = 48000;

async function decodeUrl(ctx, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load audio ${url}`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

function stitchVoice(ctx, src, timeline) {
  const { rate, channels } = src;
  const len = channels[0].length;
  const pieces = timeline.segments.map((s) => [Math.min(len, Math.floor(s.s * rate)), Math.min(len, Math.floor(s.e * rate))]).filter(([a, b]) => b > a);
  const total = pieces.reduce((n, [a, b]) => n + (b - a), 0);
  const buf = ctx.createBuffer(channels.length, Math.max(1, total), rate);
  const fade = Math.floor(rate * 0.008);
  channels.forEach((data, c) => {
    const out = buf.getChannelData(c);
    let off = 0;
    pieces.forEach(([a, b], i) => {
      out.set(data.subarray(a, b), off);
      const n = b - a, f = Math.min(fade, Math.floor(n / 2));
      if (i > 0) for (let k = 0; k < f; k++) out[off + k] *= k / f;
      if (i < pieces.length - 1) for (let k = 0; k < f; k++) out[off + n - 1 - k] *= k / f;
      off += n;
    });
  });
  return buf;
}

// Gain that brings the voice to a steady speaking level (about -20 dBFS RMS while talking).
function voiceGain(buf) {
  const d = buf.getChannelData(0);
  const win = Math.floor(buf.sampleRate * 0.05);
  const levels = [];
  for (let i = 0; i + win <= d.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += d[j] * d[j];
    levels.push(Math.sqrt(s / win));
  }
  const loud = levels.filter((v) => v > 0.005).sort((a, b) => a - b);
  if (!loud.length) return 1;
  const typical = loud[Math.floor(loud.length * 0.7)];
  return Math.min(6, Math.max(0.5, 0.1 / typical));
}

export async function mixAudio({ engine, sourceAudio, assets, analysis }) {
  const { timeline: tl, spec } = engine;
  const A = spec.audio;
  const outDur = tl.outDuration;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(outDur * OUT_RATE)), OUT_RATE);
  const master = ctx.createGain();
  master.connect(ctx.destination);

  if (sourceAudio && sourceAudio.channels[0].length) {
    const voice = stitchVoice(ctx, sourceAudio, tl);
    const node = ctx.createBufferSource();
    node.buffer = voice;
    const gain = ctx.createGain();
    gain.gain.value = (+A.volume || 0) * (A.enhance ? voiceGain(voice) : 1);
    node.connect(gain);
    if (A.enhance) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.knee.value = 8; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.18;
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -2; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.08;
      gain.connect(comp); comp.connect(limit); limit.connect(master);
    } else gain.connect(master);
    node.start(0);
  }

  const m = A.music;
  if (m?.src) {
    try {
      const buf = await decodeUrl(ctx, assets.url(m.src));
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.loop = true;
      const g = ctx.createGain();
      node.connect(g); g.connect(master);
      const vol = m.volume ?? 0.15, duck = m.duck ?? 0.35, fi = m.fadeIn ?? 0.5, fo = m.fadeOut ?? 1.5;
      const silences = findSilences(analysis?.audio, { minGap: 0.35 });
      const talking = (src) => !silences.some(([a, b]) => src >= a && src < b);
      const step = 0.1;
      g.gain.setValueAtTime(0, 0);
      for (let t = 0; t <= outDur + step; t += step) {
        let v = vol * (duck < 1 && analysis?.audio && talking(tl.toSrc(t)) ? duck : 1);
        v *= Math.min(1, fi > 0 ? t / fi : 1) * Math.min(1, fo > 0 ? Math.max(0, outDur - t) / fo : 1);
        g.gain.setTargetAtTime(v, t, 0.08);
      }
      node.start(0, Math.max(0, +m.offset || 0) % Math.max(0.01, buf.duration));
    } catch (e) { engine.warnings.push(`Music "${m.src}" couldn't be loaded.`); }
  }

  for (const s of A.sfx || []) {
    if (!s?.src || tl.isCut(+s.at)) continue;
    try {
      const buf = await decodeUrl(ctx, assets.url(s.src));
      const node = ctx.createBufferSource();
      node.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = s.volume ?? 0.7;
      node.connect(g); g.connect(master);
      node.start(tl.toOut(+s.at));
    } catch { engine.warnings.push(`Sound "${s.src}" couldn't be loaded.`); }
  }

  for (const l of engine.layers) {
    if (l.type !== 'video' || !(+l.volume > 0) || !l.src) continue;
    try {
      const buf = await decodeUrl(ctx, assets.url(l.src));
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.playbackRate.value = +l.speed || 1;
      node.loop = !!l.loop;
      const g = ctx.createGain();
      g.gain.value = +l.volume;
      node.connect(g); g.connect(master);
      const [a, dur] = engine.layerTiming(l);
      node.start(a, +l.from || 0, l.loop ? undefined : dur * (+l.speed || 1));
      if (l.loop) node.stop(a + dur);
    } catch { /* clip without audio */ }
  }

  return ctx.startRendering();
}
