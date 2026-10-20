// Person cut-out with MediaPipe's selfie segmenter. Runs on the GPU in the browser.
import { CDN } from '../cdn.js';

let segmenterPromise = null;

export function loadSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import(CDN.mediapipe);
      const vision = await FilesetResolver.forVisionTasks(CDN.mediapipeWasm);
      const make = (delegate) => ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: CDN.selfieModel, delegate },
        runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
      });
      try { return await make('GPU'); } catch { return await make('CPU'); }
    })();
    segmenterPromise.catch(() => { segmenterPromise = null; });
  }
  return segmenterPromise;
}

// Produces a soft alpha mask for whatever was drawn on `source` (a canvas the size of the output).
export class PersonMask {
  constructor() {
    this.small = document.createElement('canvas');
    this.smallCtx = this.small.getContext('2d', { willReadFrequently: true });
    this.mask = document.createElement('canvas');
    this.maskCtx = this.mask.getContext('2d');
    this.prev = null;
    this.prevT = -1;
  }

  // Returns a canvas (same size as source) whose alpha is the person. Null if not ready.
  compute(segmenter, source, t) {
    const W = source.width, H = source.height;
    const k = 384 / Math.max(W, H);
    const w = Math.max(16, Math.round(W * k)), h = Math.max(16, Math.round(H * k));
    if (this.small.width !== w || this.small.height !== h) { this.small.width = w; this.small.height = h; this.prev = null; }
    this.smallCtx.drawImage(source, 0, 0, w, h);
    let conf;
    try {
      const result = segmenter.segment(this.small);
      const m = result.confidenceMasks?.[0];
      if (!m) { result.close?.(); return null; }
      conf = m.getAsFloat32Array().slice();
      result.close?.();
    } catch { return null; }
    if (conf.length !== w * h) return null;
    // Smooth over time (only between neighbouring frames) to stop edge flicker.
    if (this.prev && this.prev.length === conf.length && Math.abs(t - this.prevT) < 0.1) {
      for (let i = 0; i < conf.length; i++) conf[i] = conf[i] * 0.65 + this.prev[i] * 0.35;
    }
    this.prev = conf; this.prevT = t;
    const img = this.smallCtx.createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < conf.length; i++) {
      // Tighten the edge (smoothstep between 0.45 and 0.8 confidence) so no halo of the old room shows.
      let a = (conf[i] - 0.45) / 0.35;
      a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
      const o = i * 4;
      d[o] = d[o + 1] = d[o + 2] = 255;
      d[o + 3] = a * 255;
    }
    this.smallCtx.putImageData(img, 0, 0);
    if (this.mask.width !== W || this.mask.height !== H) { this.mask.width = W; this.mask.height = H; }
    const mc = this.maskCtx;
    mc.clearRect(0, 0, W, H);
    mc.filter = `blur(${Math.max(1, Math.round(W / 540))}px)`;
    mc.imageSmoothingQuality = 'high';
    mc.drawImage(this.small, 0, 0, W, H);
    mc.filter = 'none';
    return this.mask;
  }
}
