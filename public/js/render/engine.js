// The compositor. Given a moment in the source video, it draws the finished frame.
// The live preview and the exporter call the same draw(), so what you see is what you export.
import { normalize, outputSize } from '../spec.js';
import { buildTimeline } from './timeline.js';
import { Captions, wordKept } from './captions.js';
import { buildFaceTrack, zoomAt, computeView } from './camera.js';
import { animState, ease, random, clamp } from './anim.js';
import { drawText, roundRect } from './text.js';
import { frameAt, ensureFont } from './media.js';
import { loadSegmenter, PersonMask } from './segment.js';

const LAYER_DEFAULTS = {
  text: { size: 80, font: 'Montserrat', weight: 800, color: '#FFFFFF', accent: '#FFE14D', stroke: 0, shadow: 16, shadowColor: 'rgba(0,0,0,0.55)', maxWidth: 0.84, in: 'pop', out: 'fade' },
  emoji: { width: 220, in: 'pop', out: 'fade', loop: 'float' },
  gif: { width: 520, in: 'pop', out: 'fade', radius: 18 },
  image: { width: 300, in: 'pop', out: 'fade' },
  video: { in: 'fade', out: 'fade', inDuration: 0.12, outDuration: 0.12, fit: 'cover', width: 860, volume: 0 },
  shape: { width: 300, height: 300, color: null, stroke: 0, strokeColor: '#FFFFFF', in: 'pop', out: 'fade' },
  progress: { y: 0, height: 10, color: '#FFFFFF', background: 'rgba(255,255,255,0.25)', in: 'none', out: 'none', z: 120 },
  custom: { in: 'none', out: 'none' },
};
const TYPES = new Set(Object.keys(LAYER_DEFAULTS));
const ABSOLUTE = (l) => l.type === 'progress' || l.type === 'custom' || (l.type === 'video' && l.fullscreen);

export const dims = (el) => el ? [el.videoWidth || el.displayWidth || el.naturalWidth || el.width || 0, el.videoHeight || el.displayHeight || el.naturalHeight || el.height || 0] : [0, 0];

function drawCover(ctx, img, W, H, x = 0, y = 0, mode = 'cover', overscan = 1) {
  const [iw, ih] = dims(img);
  if (!iw || !ih) return;
  const k = (mode === 'contain' ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih)) * overscan;
  const w = iw * k, h = ih * k;
  ctx.drawImage(img, x + (W - w) / 2, y + (H - h) / 2, w, h);
}

function gradeFilter(g) {
  const f = [];
  if (+g.brightness !== 1) f.push(`brightness(${+g.brightness})`);
  if (+g.contrast !== 1) f.push(`contrast(${+g.contrast})`);
  if (+g.saturation !== 1) f.push(`saturate(${+g.saturation})`);
  if (g.blackAndWhite) f.push('grayscale(1)');
  return f.join(' ') || 'none';
}

export class Engine {
  constructor(assets) {
    this.assets = assets;
    this.errors = new Map();
    this.warnings = [];
    this.hits = [];
    this.mask = new PersonMask();
    this.segmenter = null;
    this.layerImages = new Map();
    this.modules = new Map();
    this.customImages = new Map();
    this.bgImage = null;
    this.scratch = {};
  }

  configure({ spec, transcript, analysis, meta, resolution = 1080 }) {
    const { spec: s, warnings } = normalize(spec);
    this.raw = spec;
    this.spec = s;
    this.warnings = [...warnings];
    this.meta = meta;
    [this.W, this.H] = outputSize(s, resolution);
    this.u = Math.min(this.W, this.H) / 1080;
    this.fps = s.format.fps;
    this.words = transcript?.words || [];
    this.timeline = buildTimeline({ duration: meta.duration, spec: s, words: this.words, audio: analysis?.audio });
    this.captions = new Captions(s, this.words, this.timeline);
    this.face = buildFaceTrack(analysis?.faces, meta.duration);
    this.wordCache = new Map();
    this.cutTimes = null;
    this.layers = s.layers.map((l, i) => {
      if (!TYPES.has(l.type)) this.warnings.push(`Layer ${i} has unknown type "${l.type}". Types: ${[...TYPES].join(', ')}.`);
      const L = { z: 50, ...(LAYER_DEFAULTS[l.type] || {}), ...l, _key: String(l.id || `${l.type}-${i}`), _i: i };
      L.start = Number.isFinite(+L.start) && L.start !== null ? +L.start : 0;
      L.end = L.end == null ? Infinity : +L.end;
      if (!(L.end > L.start)) this.warnings.push(`Layer ${i} (${l.type}) ends before it starts.`);
      return L;
    }).filter((l) => TYPES.has(l.type)).sort((a, b) => a.z - b.z || a._i - b._i);
    this.needsSegmenter = s.background.remove || this.layers.some((l) => l.behindSubject);
    if (this.errors.size) this.errors = new Map();
  }

  // Load fonts, images, stickers, effects and models this edit needs. Safe to call repeatedly.
  async prepare({ resolveGif } = {}) {
    const { spec, assets, u } = this;
    const jobs = [];
    const fonts = new Set();
    if (spec.captions.enabled) fonts.add(`${spec.captions.font}|${spec.captions.weight}`);
    for (const l of this.layers) {
      if (l.type === 'text') fonts.add(`${l.font}|${l.weight}`);
      if (l.type === 'custom') for (const f of l.fonts || []) { fonts.add(`${f}|400`); fonts.add(`${f}|700`); fonts.add(`${f}|800`); }
    }
    for (const f of fonts) { const [fam, w] = f.split('|'); jobs.push(ensureFont(fam, w)); }
    // Emoji used in caption emphasis render as text with the system emoji font; nothing to load.

    const want = new Set();
    for (const l of this.layers) {
      const size = Math.round(Math.max(64, Math.min(1080, (l.width || 300) * u * 1.25)));
      const load = (url, label) => {
        want.add(l._key);
        return assets.image(url, size).then((img) => this.layerImages.set(l._key, img)).catch(() => {
          this.layerImages.delete(l._key);
          this.warnings.push(`${label} couldn't be loaded.`);
        });
      };
      if (l.type === 'image') jobs.push(load(assets.url(l.src), `Image "${l.src}"`));
      if (l.type === 'emoji' && l.emoji) jobs.push(load(assets.emojiUrl(l.emoji), `Emoji ${l.emoji}`).catch(() => {}));
      if (l.type === 'gif') {
        jobs.push((async () => {
          let src = l.src;
          if (!src && l.query && resolveGif) src = await resolveGif(l.query).catch(() => null);
          if (src) return load(assets.url(src), `GIF "${l.query || src}"`);
          if (l.fallbackEmoji) return load(assets.emojiUrl(l.fallbackEmoji), `Emoji ${l.fallbackEmoji}`);
        })());
      }
      if (l.type === 'custom') {
        jobs.push(assets.module(assets.url(l.file)).then((m) => {
          if (typeof m.default !== 'function') throw new Error('it must `export default function draw(ctx, fx)`');
          this.modules.set(l._key, m);
        }).catch((e) => { this.modules.delete(l._key); this.errors.set(l._key, `Effect ${l.file}: ${e.message}`); }));
        if (Array.isArray(l.images)) {
          jobs.push(Promise.all(l.images.map((s) => assets.image(assets.url(s), 1080).catch(() => null))).then((imgs) => this.customImages.set(l._key, imgs.map((i) => i && frameAt(i, 0)))));
        }
      }
    }
    for (const k of [...this.layerImages.keys()]) if (!want.has(k)) this.layerImages.delete(k);

    const bg = spec.background;
    this.bgImage = null;
    if (bg.type === 'image' && bg.src) jobs.push(assets.image(assets.url(bg.src), 1920).then((i) => { this.bgImage = i; }).catch(() => this.warnings.push(`Background image "${bg.src}" couldn't be loaded.`)));
    await Promise.allSettled(jobs);
    // Effects declare what they need in `export const meta = { fonts, needs: ['person'] }`.
    const late = [];
    for (const l of this.layers) {
      if (l.type !== 'custom') continue;
      const meta = this.modules.get(l._key)?.meta || {};
      if (l.person || (meta.needs || []).includes('person')) this.needsSegmenter = true;
      const props = { ...(meta.props || {}), ...(l.props || {}) };
      for (const f of [...(meta.fonts || []), props.font, props.titleFont, props.bodyFont].filter(Boolean)) late.push(ensureFont(f, 400), ensureFont(f, 700), ensureFont(f, 800));
    }
    await Promise.allSettled(late);
    if (this.needsSegmenter && !this.segmenter) {
      await loadSegmenter().then((s) => { this.segmenter = s; }).catch((e) => this.warnings.push(`Person cut-out couldn't start: ${e.message}`));
    }
  }

  // Video clips that must be playing at source time t: [{ key, url, time, loop, volume }].
  videoNeeds(t) {
    const out = [];
    const outT = this.timeline.toOut(t);
    for (const l of this.layers) {
      if (l.type !== 'video' || !l.src || t < l.start || t >= l.end) continue;
      const a = this.timeline.toOut(l.start);
      out.push({ key: l._key, url: this.assets.url(l.src), time: Math.max(0, (+l.from || 0) + (outT - a) * (+l.speed || 1)), loop: !!l.loop, volume: +l.volume || 0 });
    }
    const bg = this.spec.background;
    if (bg.type === 'video' && bg.src && (bg.remove || this.spec.frame.fit === 'fit')) out.push({ key: '__bg', url: this.assets.url(bg.src), time: outT, loop: true, volume: 0 });
    return out;
  }

  videoSources() {
    const out = new Map();
    for (const l of this.layers) if (l.type === 'video' && l.src) out.set(l._key, { key: l._key, url: this.assets.url(l.src), loop: !!l.loop });
    const bg = this.spec.background;
    if (bg.type === 'video' && bg.src) out.set('__bg', { key: '__bg', url: this.assets.url(bg.src), loop: true });
    return [...out.values()];
  }

  canvas(name, W = this.W, H = this.H) {
    let c = this.scratch[name];
    if (!c) c = this.scratch[name] = document.createElement('canvas');
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    return c;
  }

  // src = { main, mainW, mainH, videos: { key: drawable } }
  draw(ctx, t, src = {}) {
    const { W, H, u, spec } = this;
    this.hits = [];
    const outT = this.timeline.toOut(t);
    const face = this.face?.at(t) || null;
    const zoom = zoomAt(spec, this.timeline, t);
    const view = src.main && src.mainW ? computeView({ srcW: src.mainW, srcH: src.mainH, W, H, frame: spec.frame, face, zoom }) : null;
    const visible = this.layers.filter((l) => t >= l.start && t < l.end);
    const behind = visible.filter((l) => l.behindSubject);
    const front = visible.filter((l) => !l.behindSubject);
    const filter = gradeFilter(spec.grade);

    // Per-frame buffers that effects can ask for: the graded video, the person mask, the cut-out.
    const fr = this.fr = { src, view, filter, t, frame: null, mask: undefined, person: null, faceOut: null };
    if (face && view) {
      const k = view.dw / view.sw;
      fr.faceOut = {
        x: (face.x * src.mainW - view.sx) * k + view.dx,
        y: (face.y * src.mainH - view.sy) * k + view.dy,
        h: face.h * src.mainH * k,
      };
      fr.faceOut.w = fr.faceOut.h * 0.8;
    }

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (spec.background.remove || (view && (view.dw < W - 1 || view.dh < H - 1))) this.drawBackground(ctx, src, outT, filter);

    if (view) {
      const cutout = (spec.background.remove || behind.length) && this.segmenter;
      if (cutout) {
        const frame = this.getFrame();
        const person = this.getPerson();
        if (!spec.background.remove || !person) ctx.drawImage(frame, 0, 0);
        for (const l of behind) this.drawLayer(ctx, l, t, outT, src);
        if (person) ctx.drawImage(person, 0, 0);
      } else {
        ctx.filter = filter;
        ctx.drawImage(src.main, view.sx, view.sy, view.sw, view.sh, view.dx, view.dy, view.dw, view.dh);
        ctx.filter = 'none';
        for (const l of behind) this.drawLayer(ctx, l, t, outT, src);
      }
    }
    this.drawGrade(ctx, outT);

    let captionsDone = false;
    for (const l of front) {
      if (!captionsDone && l.z > spec.captions.z) { this.captions.draw(ctx, t, W, H, u, this.hits); captionsDone = true; }
      this.drawLayer(ctx, l, t, outT, src);
    }
    if (!captionsDone) this.captions.draw(ctx, t, W, H, u, this.hits);
    ctx.restore();
  }

  // The graded source video as it is framed in this output frame (transparent outside it).
  getFrame() {
    const fr = this.fr;
    if (!fr?.view) return null;
    if (!fr.frame) {
      const c = this.canvas('frame');
      const x = c.getContext('2d');
      const v = fr.view;
      x.clearRect(0, 0, c.width, c.height);
      x.filter = fr.filter;
      x.drawImage(fr.src.main, v.sx, v.sy, v.sw, v.sh, v.dx, v.dy, v.dw, v.dh);
      x.filter = 'none';
      fr.frame = c;
    }
    return fr.frame;
  }

  // Soft alpha mask of the person (white where they are). Null if segmentation isn't available.
  getMask() {
    const fr = this.fr;
    if (!fr) return null;
    if (fr.mask === undefined) fr.mask = this.segmenter && this.getFrame() ? this.mask.compute(this.segmenter, this.getFrame(), fr.t) : null;
    return fr.mask;
  }

  // Just the person, cut out of the frame.
  getPerson() {
    const fr = this.fr;
    if (!fr) return null;
    if (!fr.person) {
      const mask = this.getMask();
      if (!mask) return null;
      const c = this.canvas('person');
      const x = c.getContext('2d');
      x.clearRect(0, 0, c.width, c.height);
      x.drawImage(this.getFrame(), 0, 0);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(mask, 0, 0);
      x.globalCompositeOperation = 'source-over';
      fr.person = c;
    }
    return fr.person;
  }

  drawBackground(ctx, src, outT, filter) {
    const { W, H, u, spec } = this;
    const bg = spec.background;
    ctx.save();
    let dim = 0;
    switch (bg.type) {
      case 'color': ctx.fillStyle = bg.color; ctx.fillRect(0, 0, W, H); break;
      case 'gradient': {
        const a = ((+bg.angle || 0) - 90) * Math.PI / 180, r = Math.hypot(W, H) / 2;
        const g = ctx.createLinearGradient(W / 2 - Math.cos(a) * r, H / 2 - Math.sin(a) * r, W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
        const cs = (bg.colors?.length ? bg.colors : ['#1d1d1f', '#3a3a3c']);
        cs.forEach((c, i) => g.addColorStop(cs.length === 1 ? 0 : i / (cs.length - 1), c));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); break;
      }
      case 'image':
        if (this.bgImage) drawCover(ctx, frameAt(this.bgImage, outT), W, H);
        else { ctx.fillStyle = bg.color; ctx.fillRect(0, 0, W, H); }
        dim = +bg.dim || 0; break;
      case 'video':
        if (src.videos?.__bg) drawCover(ctx, src.videos.__bg, W, H);
        else { ctx.fillStyle = bg.color; ctx.fillRect(0, 0, W, H); }
        dim = +bg.dim || 0; break;
      default: {
        // Cheap, strong blur: shrink the frame, soften it, scale it back up.
        if (!src.main) break;
        const sw = Math.max(16, Math.round(W / 8)), sh = Math.max(16, Math.round(H / 8));
        const small = this.canvas('blur', sw, sh);
        const sctx = small.getContext('2d');
        sctx.filter = `blur(${Math.max(1, (+bg.blur || 40) * u / 8)}px) ${filter === 'none' ? '' : filter}`;
        drawCover(sctx, src.main, sw, sh, 0, 0, 'cover', 1.15);
        sctx.filter = 'none';
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(small, 0, 0, W, H);
        dim = +bg.dim || 0;
      }
    }
    if (dim > 0) { ctx.fillStyle = `rgba(0,0,0,${clamp(dim)})`; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  drawGrade(ctx, outT) {
    const { W, H, spec } = this;
    const g = spec.grade;
    if (+g.warmth) {
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      const k = Math.min(1, Math.abs(+g.warmth)) * 0.45;
      ctx.fillStyle = +g.warmth > 0 ? `rgba(255,140,30,${k})` : `rgba(30,120,255,${k})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (+g.vignette > 0) {
      ctx.save();
      const r0 = Math.min(W, H) * 0.3, r1 = Math.hypot(W, H) * 0.55;
      const vg = ctx.createRadialGradient(W / 2, H / 2, r0, W / 2, H / 2, r1);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(0,0,0,${clamp(+g.vignette) * 0.85})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (+g.grain > 0) {
      if (!this.grain) {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const x = c.getContext('2d');
        const img = x.createImageData(256, 256);
        for (let i = 0; i < 256 * 256; i++) { const v = random(i) * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
        x.putImageData(img, 0, 0);
        this.grain = c;
      }
      const f = Math.floor(outT * 24);
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = clamp(+g.grain) * 0.35;
      const pat = ctx.createPattern(this.grain, 'repeat');
      ctx.translate(-Math.floor(random(f) * 256), -Math.floor(random(f + 7) * 256));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W + 256, H + 256);
      ctx.restore();
    }
  }

  layerTiming(l) {
    const tl = this.timeline;
    const a = tl.toOut(l.start);
    const b = Number.isFinite(l.end) ? tl.toOut(Math.min(l.end, this.meta.duration)) : tl.outDuration;
    return [a, Math.max(0.01, b - a)];
  }

  drawLayer(ctx, l, t, outT, src) {
    const [a, dur] = this.layerTiming(l);
    const lt = outT - a;
    const st = animState(lt, dur, l);
    if (st.alpha <= 0.001) return;
    const { W, H, u } = this;
    ctx.save();
    ctx.globalAlpha *= clamp(st.alpha * (l.opacity ?? 1));
    try {
      if (ABSOLUTE(l)) {
        this[`draw_${l.type}`](ctx, l, { lt, dur, st, outT, t, src });
      } else {
        // follow: "face" pins the layer to the speaker's face; x/y become offsets from it.
        const fo = l.follow === 'face' ? this.fr?.faceOut : null;
        const bx = fo ? fo.x + (+l.x || 0) * W : (l.x ?? 0.5) * W;
        const by = fo ? fo.y + (+l.y || 0) * H : (l.y ?? 0.5) * H;
        const x = bx + st.dx * u, y = by + st.dy * u;
        ctx.translate(x, y);
        const rot = (+l.rotation || 0) * Math.PI / 180 + st.rot;
        if (rot) ctx.rotate(rot);
        if (st.scale !== 1) ctx.scale(st.scale, st.scale);
        const box = this[`draw_${l.type}`](ctx, l, { lt, dur, st, outT, t, src });
        if (box) this.hits.push({ id: l._key, index: l._i, x: x - (box.w * st.scale) / 2, y: y - (box.h * st.scale) / 2, w: box.w * st.scale, h: box.h * st.scale });
      }
    } catch (e) {
      this.errors.set(l._key, `${l.type} layer "${l._key}" at ${t.toFixed(2)}s: ${e.message}`);
    }
    ctx.restore();
  }

  draw_text(ctx, l, { st }) {
    const layout = drawText(ctx, l.text ?? '', 0, 0, l, this.u, (l.maxWidth ?? 0.84) * this.W, { reveal: st.reveal });
    return { w: layout.width, h: layout.height };
  }

  drawGlyph(ctx, emoji, w) {
    ctx.font = `${Math.round(w * 0.85)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 0, 0);
    return { w, h: w };
  }

  drawBitmap(ctx, l, img, lt) {
    const u = this.u;
    const w = (+l.width || 300) * u;
    const h = l.height ? +l.height * u : (w * img.height) / img.width;
    const bmp = frameAt(img, lt);
    if (+l.shadow) { ctx.shadowColor = l.shadowColor || 'rgba(0,0,0,0.45)'; ctx.shadowBlur = +l.shadow * u; ctx.shadowOffsetY = +l.shadow * u * 0.3; }
    if (+l.radius) {
      if (+l.shadow) { ctx.fillStyle = 'rgba(0,0,0,1)'; roundRect(ctx, -w / 2, -h / 2, w, h, +l.radius * u); ctx.fill(); ctx.shadowColor = 'transparent'; }
      roundRect(ctx, -w / 2, -h / 2, w, h, +l.radius * u);
      ctx.clip();
    }
    ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
    return { w, h };
  }

  draw_image(ctx, l, { lt }) {
    const img = this.layerImages.get(l._key);
    return img ? this.drawBitmap(ctx, l, img, lt) : null;
  }

  draw_emoji(ctx, l, { lt }) {
    const img = this.layerImages.get(l._key);
    if (img) return this.drawBitmap(ctx, { ...l, radius: 0 }, img, lt);
    return this.drawGlyph(ctx, l.emoji || '✨', (+l.width || 220) * this.u);
  }

  draw_gif(ctx, l, { lt }) {
    const img = this.layerImages.get(l._key);
    if (img) return this.drawBitmap(ctx, img.total === Infinity && l.fallbackEmoji && !l.src ? { ...l, radius: 0 } : l, img, lt);
    if (l.fallbackEmoji) return this.drawGlyph(ctx, l.fallbackEmoji, (+l.width || 300) * this.u * 0.6);
    return null;
  }

  draw_video(ctx, l, { src }) {
    const v = src.videos?.[l._key];
    const { W, H, u } = this;
    if (l.fullscreen) {
      if (v) drawCover(ctx, v, W, H, 0, 0, l.fit === 'contain' ? 'contain' : 'cover');
      return null;
    }
    const [vw, vh] = dims(v);
    const w = (+l.width || 860) * u;
    const h = l.height ? +l.height * u : vw ? (w * vh) / vw : w * 0.5625;
    if (+l.shadow) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = +l.shadow * u; ctx.fillStyle = '#000'; roundRect(ctx, -w / 2, -h / 2, w, h, (+l.radius || 0) * u); ctx.fill(); ctx.restore(); }
    roundRect(ctx, -w / 2, -h / 2, w, h, (+l.radius || 0) * u);
    ctx.clip();
    if (v && vw) {
      ctx.translate(-w / 2, -h / 2);
      drawCover(ctx, v, w, h, 0, 0, l.fit === 'contain' ? 'contain' : 'cover');
    } else { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(-w / 2, -h / 2, w, h); }
    return { w, h };
  }

  draw_shape(ctx, l, { st }) {
    const { W, H, u } = this;
    const w = (+l.width || 300) * u, h = (+(l.height ?? l.width) || 300) * u;
    const stroke = (+l.stroke || 0) * u;
    const reveal = l.in === 'draw' ? st.reveal : 1;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (l.shape === 'line' || l.shape === 'arrow') {
      const x2 = ((l.x2 ?? l.x ?? 0.5) - (l.x ?? 0.5)) * W, y2 = ((l.y2 ?? (l.y ?? 0.5) + 0.1) - (l.y ?? 0.5)) * H;
      const ex = x2 * reveal, ey = y2 * reveal;
      ctx.strokeStyle = l.color || l.strokeColor || '#FFFFFF';
      ctx.lineWidth = stroke || 10 * u;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(ex, ey); ctx.stroke();
      if (l.shape === 'arrow' && reveal > 0.05) {
        const ang = Math.atan2(y2, x2), hl = (ctx.lineWidth * 3.2);
        ctx.beginPath();
        ctx.moveTo(ex - hl * Math.cos(ang - 0.5), ey - hl * Math.sin(ang - 0.5));
        ctx.lineTo(ex, ey);
        ctx.lineTo(ex - hl * Math.cos(ang + 0.5), ey - hl * Math.sin(ang + 0.5));
        ctx.stroke();
      }
      return { w: Math.abs(x2) || 20, h: Math.abs(y2) || 20 };
    }
    ctx.beginPath();
    if (l.shape === 'circle') ctx.ellipse(0, 0, w / 2, h / 2, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * reveal);
    else roundRect(ctx, -w / 2, -h / 2, w, h, (+l.radius || 0) * u);
    if (l.color && reveal >= 1) { ctx.fillStyle = l.color; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = l.strokeColor || '#FFFFFF'; ctx.lineWidth = stroke; ctx.stroke(); }
    return { w, h };
  }

  draw_progress(ctx, l, { outT }) {
    const { W, H, u } = this;
    const h = (+l.height || 10) * u;
    const y = clamp(+l.y || 0) * (H - h);
    const p = clamp(outT / Math.max(0.01, this.timeline.outDuration));
    if (l.background) { ctx.fillStyle = l.background; ctx.fillRect(0, y, W, h); }
    ctx.fillStyle = l.color || '#FFFFFF';
    ctx.fillRect(0, y, W * p, h);
  }

  wordsIn(l, a) {
    if (this.wordCache.has(l._key)) return this.wordCache.get(l._key);
    const tl = this.timeline;
    const list = this.captions.words.filter((w) => w.text && w.s >= l.start && w.s < l.end && wordKept(w, tl))
      .map((w) => ({ text: w.text, t: tl.toOut(w.s) - a, d: Math.max(0.05, tl.toOut(w.e) - tl.toOut(w.s)), index: w.i }));
    this.wordCache.set(l._key, list);
    return list;
  }

  draw_custom(ctx, l, { lt, dur, outT, t }) {
    const mod = this.modules.get(l._key);
    if (!mod) return;
    const { W, H, u } = this;
    const a = outT - lt;
    const tl = this.timeline;
    this.cutTimes ||= tl.segments.slice(1).map((s) => s.out);
    mod.default(ctx, {
      t: lt, duration: dur, progress: clamp(lt / dur), width: W, height: H, u,
      props: { ...(mod.meta?.props || {}), ...(l.props || {}) }, images: this.customImages.get(l._key) || [],
      fps: this.fps, frame: Math.round(outT * this.fps), time: t, outTime: outT, outDuration: tl.outDuration,
      ease, random, clamp, lerp: (x, y, k) => x + (y - x) * k,
      words: this.wordsIn(l, a),
      cuts: this.cutTimes,
      face: this.fr?.faceOut ? { ...this.fr.faceOut } : null,
      video: () => this.getFrame(),
      // Everything drawn so far (background, video, lower layers): what full-frame distortions should warp.
      composite: () => {
        const c = this.canvas(`fx:${l._key}:composite`, ctx.canvas.width, ctx.canvas.height);
        const cx = c.getContext('2d');
        cx.clearRect(0, 0, c.width, c.height);
        cx.drawImage(ctx.canvas, 0, 0);
        return c;
      },
      person: () => this.getPerson(),
      mask: () => this.getMask(),
      canvas: (name, w = W, h = H) => this.canvas(`fx:${l._key}:${name}`, w, h),
      roundRect: (x, y, w, h, r) => roundRect(ctx, x, y, w, h, r),
      cover: (img, x = 0, y = 0, w = W, h = H) => { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); drawCover(ctx, img, w, h, x, y); ctx.restore(); },
      text: (str, x, y, o = {}) => drawText(ctx, str, x, y, { font: 'Inter', weight: 700, size: 80, color: '#FFFFFF', ...o }, u, o.maxWidth ?? W * 0.9),
    });
  }

  hitTest(x, y) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }

  report() {
    const tl = this.timeline;
    return {
      aspect: this.spec.format.aspect, width: this.W, height: this.H,
      outDuration: +tl.outDuration.toFixed(2), segments: tl.segments.length, removed: +tl.removed.toFixed(2),
      captionPages: this.captions.pages.length, layers: this.layers.length, zooms: this.spec.zooms.length,
      warnings: [...new Set(this.warnings)].slice(0, 20), errors: [...this.errors.values()].slice(0, 20),
    };
  }
}
