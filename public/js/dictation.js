// Talk instead of typing. Records the mic and writes it down with the same Whisper model that
// makes the captions, on this computer. Your voice is never sent anywhere.
import { dictate, preloadWhisper } from './analyze.js';

export class Dictation {
  constructor(settings = {}) {
    this.settings = settings;
    this.state = 'idle'; // idle | recording | writing
  }

  async start(onLevel) {
    preloadWhisper(this.settings.whisper || 'base');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    this.ctx = new AudioContext();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    this.ctx.createMediaStreamSource(this.stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (this.state !== 'recording') return;
      analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      onLevel?.(Math.min(1, Math.sqrt(s / buf.length) * 6));
      this.raf = requestAnimationFrame(tick);
    };
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.stopped = new Promise((resolve) => { this.rec.onstop = resolve; });
    this.rec.start(250);
    this.startedAt = performance.now();
    this.state = 'recording';
    tick();
  }

  get seconds() { return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0; }

  release() {
    cancelAnimationFrame(this.raf);
    for (const t of this.stream?.getTracks() || []) t.stop();
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
  }

  cancel() {
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    this.state = 'idle';
    this.release();
  }

  // Stops recording and returns what was said ('' if nothing was).
  async stop() {
    if (this.state !== 'recording') return '';
    this.state = 'writing';
    this.rec.stop();
    await this.stopped;
    this.release();
    try {
      const blob = new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' });
      if (blob.size < 1000) return '';
      // decodeAudioData resamples to the context's rate, which gives Whisper its 16 kHz directly.
      const decoded = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await blob.arrayBuffer());
      const pcm = new Float32Array(decoded.length);
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const d = decoded.getChannelData(c);
        for (let i = 0; i < d.length; i++) pcm[i] += d[i] / decoded.numberOfChannels;
      }
      const lang = this.settings.language || 'english';
      return await dictate(pcm, { model: this.settings.whisper || 'base', language: lang });
    } finally {
      this.state = 'idle';
    }
  }
}
