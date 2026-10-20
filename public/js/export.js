// Frame-accurate MP4 export in the browser: decode → composite → encode (WebCodecs via Mediabunny).
import { loadMediabunny } from './cdn.js';
import { openInput, decodeSourceAudio } from './analyze.js';
import { mixAudio } from './audio.js';

async function pickVideoCodec(MB, W, H) {
  for (const c of ['avc', 'hevc', 'vp9', 'av1']) {
    if (await MB.canEncodeVideo(c, { width: W, height: H }).catch(() => false)) return c;
  }
  throw new Error('This browser can\'t encode video. Use a recent Chrome or Edge.');
}

export async function exportVideo({ engine, project, analysis, onProgress, signal }) {
  const MB = await loadMediabunny();
  const { W, H, fps, timeline } = engine;
  const N = Math.max(1, Math.round(timeline.outDuration * fps));
  const url = `/files/projects/${project.id}/${encodeURIComponent(project.source)}`;
  const check = () => { if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError'); };

  onProgress?.(0, 'Preparing');
  const { input } = await openInput(url);
  const track = await input.getPrimaryVideoTrack();
  const first = Math.max(0, await track.getFirstTimestamp().catch(() => 0));
  const srcTimes = Array.from({ length: N }, (_, i) => Math.max(first, timeline.toSrc(i / fps) + 1e-4));
  const mainSink = new MB.CanvasSink(track, { poolSize: 0 });
  const mainIt = mainSink.canvasesAtTimestamps(srcTimes)[Symbol.asyncIterator]();

  // B-roll and background clips: work out exactly which clip frame each output frame needs.
  const perFrame = Array.from({ length: N }, () => []);
  const schedule = new Map();
  for (let i = 0; i < N; i++) {
    for (const need of engine.videoNeeds(srcTimes[i])) {
      if (!schedule.has(need.key)) schedule.set(need.key, { url: need.url, loop: need.loop, times: [] });
      schedule.get(need.key).times.push(need.time);
      perFrame[i].push(need.key);
    }
  }
  const clipIts = new Map();
  for (const [key, s] of schedule) {
    try {
      const { input: ci } = await openInput(s.url);
      const ct = await ci.getPrimaryVideoTrack();
      const dur = await ci.computeDuration();
      const big = Math.max(ct.displayWidth, ct.displayHeight);
      const sink = new MB.CanvasSink(ct, big > 1920 ? (ct.displayWidth >= ct.displayHeight ? { width: 1920, poolSize: 0 } : { height: 1920, poolSize: 0 }) : { poolSize: 0 });
      const times = s.times.map((t) => (s.loop ? t % Math.max(0.05, dur) : Math.min(t, Math.max(0, dur - 0.02))));
      clipIts.set(key, sink.canvasesAtTimestamps(times)[Symbol.asyncIterator]());
    } catch (e) { engine.warnings.push(`Clip for ${key} couldn't be opened: ${e.message}`); }
  }

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });

  const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
  const vcodec = await pickVideoCodec(MB, W, H);
  const videoSource = new MB.CanvasSource(canvas, { codec: vcodec, bitrate: MB.QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps });

  onProgress?.(0, 'Mixing audio');
  const sourceAudio = await decodeSourceAudio(url).catch(() => null);
  check();
  const mixed = await mixAudio({ engine, sourceAudio, assets: engine.assets, analysis });
  const acodec = (await MB.canEncodeAudio('aac').catch(() => false)) ? 'aac' : 'opus';
  const audioSource = new MB.AudioBufferSource({ codec: acodec, bitrate: 192000 });
  output.addAudioTrack(audioSource);

  await output.start();
  try {
    await audioSource.add(mixed);
    audioSource.close();
    let last = null;
    const lastClip = new Map();
    const started = performance.now();
    for (let i = 0; i < N; i++) {
      check();
      const r = await mainIt.next();
      if (r.value) last = r.value.canvas;
      const videos = {};
      for (const key of perFrame[i]) {
        const it = clipIts.get(key);
        if (!it) continue;
        const c = await it.next();
        if (c.value) lastClip.set(key, c.value.canvas);
        if (lastClip.has(key)) videos[key] = lastClip.get(key);
      }
      engine.draw(ctx, srcTimes[i], last ? { main: last, mainW: last.width, mainH: last.height, videos } : { videos });
      await videoSource.add(i / fps, 1 / fps);
      if (i % 5 === 0 || i === N - 1) {
        const elapsed = (performance.now() - started) / 1000;
        const eta = i > 10 ? (elapsed / (i + 1)) * (N - i - 1) : null;
        onProgress?.((i + 1) / N, `Rendering frame ${i + 1} of ${N}`, eta);
      }
    }
    videoSource.close();
    onProgress?.(1, 'Finishing');
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}
