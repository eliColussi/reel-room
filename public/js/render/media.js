// Loads everything an edit can reference: fonts, images, animated GIF/WebP stickers,
// emoji, and custom effect modules. Shared by the live preview and the exporter.
import { api } from '../lib.js';

const SYSTEM_FONTS = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'Arial', 'Helvetica', 'Helvetica Neue', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Verdana', 'Trebuchet MS', '-apple-system', 'SF Pro Display', 'Segoe UI']);
const fontPromises = new Map();

export function ensureFont(family, weight = 400) {
  const fam = String(family || '').trim();
  if (!fam || SYSTEM_FONTS.has(fam)) return Promise.resolve(true);
  const w = Math.round((+weight || 400) / 100) * 100;
  const key = `${fam}|${w}`;
  if (fontPromises.has(key)) return fontPromises.get(key);
  const p = (async () => {
    const enc = encodeURIComponent(fam).replace(/%20/g, '+');
    const tryLink = (href) => new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      link.onload = () => resolve(true); link.onerror = () => { link.remove(); resolve(false); };
      document.head.appendChild(link);
    });
    const ok = (await tryLink(`https://fonts.googleapis.com/css2?family=${enc}:wght@${w}&display=block`)) ||
      (await tryLink(`https://fonts.googleapis.com/css2?family=${enc}&display=block`));
    if (!ok) return false;
    try { await document.fonts.load(`${w} 40px "${fam}"`, 'AaBb'); } catch {}
    return document.fonts.check(`${w} 40px "${fam}"`);
  })();
  fontPromises.set(key, p);
  return p;
}

export function emojiCode(str) {
  return [...String(str)].map((c) => c.codePointAt(0)).filter((cp) => cp !== 0xfe0f).map((cp) => cp.toString(16)).join('_');
}

export class Assets {
  constructor(projectId) {
    this.projectId = projectId;
    this.images = new Map(); // url -> Promise<{ frames:[{bitmap, start, dur}], total, width, height } | null>
    this.modules = new Map(); // url -> Promise<module>
    this.version = Date.now();
  }

  url(src) {
    if (!src) return null;
    const s = String(src);
    if (/^(https?:|data:|blob:)/.test(s)) return s;
    if (s.startsWith('/')) return s;
    if (s.startsWith('builtin/')) return `/app/effects/${s.slice(8)}`;
    if (s.startsWith('library/')) return `/files/${s.split('/').map(encodeURIComponent).join('/')}`;
    return `/files/projects/${this.projectId}/${s.split('/').map(encodeURIComponent).join('/')}`;
  }

  emojiUrl(emoji) { return `/api/emoji/${emojiCode(emoji)}.webp`; }

  // Decodes every frame up front so any moment can be drawn instantly (and identically on export).
  image(url, maxSize = 640) {
    if (!url) return Promise.resolve(null);
    const key = `${url}|${maxSize}`;
    if (this.images.has(key)) return this.images.get(key);
    const p = (async () => {
      const res = url.startsWith('/api/') ? await api.raw(url) : await fetch(url);
      if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
      const type = (res.headers.get('content-type') || '').split(';')[0];
      const data = await res.arrayBuffer();
      const fit = (w, h) => { const k = Math.min(1, maxSize / Math.max(w, h)); return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))]; };
      if (typeof ImageDecoder !== 'undefined' && /gif|webp|png|apng|avif/.test(type)) {
        try {
          const dec = new ImageDecoder({ data, type });
          await dec.tracks.ready;
          const track = dec.tracks.selectedTrack;
          const count = track?.frameCount || 1;
          if (track?.animated && count > 1) {
            const frames = [];
            let t = 0;
            for (let i = 0; i < Math.min(count, 300); i++) {
              const { image } = await dec.decode({ frameIndex: i });
              const [w, h] = fit(image.displayWidth, image.displayHeight);
              const bitmap = await createImageBitmap(image, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
              const dur = Math.max(0.02, (image.duration || 100000) / 1e6);
              image.close();
              frames.push({ bitmap, start: t, dur });
              t += dur;
            }
            dec.close();
            return { frames, total: t, width: frames[0].bitmap.width, height: frames[0].bitmap.height };
          }
          dec.close();
        } catch { /* fall through to a still image */ }
      }
      const blob = new Blob([data], { type: type || 'image/png' });
      let bitmap;
      if (type === 'image/svg+xml') {
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await img.decode();
        bitmap = await createImageBitmap(img, { resizeWidth: Math.max(1, img.naturalWidth * 2 || 512), resizeHeight: Math.max(1, img.naturalHeight * 2 || 512) });
      } else {
        const probe = await createImageBitmap(blob);
        const [w, h] = fit(probe.width, probe.height);
        bitmap = w === probe.width ? probe : await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      }
      return { frames: [{ bitmap, start: 0, dur: Infinity }], total: Infinity, width: bitmap.width, height: bitmap.height };
    })();
    p.catch(() => this.images.delete(key));
    this.images.set(key, p);
    return p;
  }

  module(url) {
    const key = `${url}?v=${this.version}`;
    if (!this.modules.has(key)) {
      const p = import(key);
      p.catch(() => this.modules.delete(key));
      this.modules.set(key, p);
    }
    return this.modules.get(key);
  }

  // Call after the AI edits files so effects and changed assets reload.
  bust() {
    this.version = Date.now();
    this.modules.clear();
    for (const k of [...this.images.keys()]) if (!k.startsWith('/api/emoji/')) this.images.delete(k);
  }
}

export function frameAt(img, t) {
  if (!img) return null;
  if (img.frames.length === 1) return img.frames[0].bitmap;
  const tt = ((t % img.total) + img.total) % img.total;
  let lo = 0, hi = img.frames.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (img.frames[mid].start <= tt) lo = mid; else hi = mid - 1; }
  return img.frames[lo].bitmap;
}
