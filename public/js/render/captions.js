// Captions built from the word-level transcript.
import { layoutWords, drawLayout } from './text.js';
import { ease, clamp, lerp } from './anim.js';

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}'$%]+/gu, '');

// Apply replacements like { "cloud code": "Claude Code" } across word sequences.
export function applyReplacements(words, replacements = {}) {
  const out = words.map((w, i) => ({ text: w.w, s: w.s, e: w.e, i }));
  const rules = Object.entries(replacements)
    .map(([from, to]) => ({ from: String(from).split(/\s+/).map(norm).filter(Boolean), to: String(to) }))
    .filter((r) => r.from.length)
    .sort((a, b) => b.from.length - a.from.length);
  if (!rules.length) return out;
  const keys = out.map((w) => norm(w.text));
  for (let i = 0; i < out.length; i++) {
    for (const r of rules) {
      if (i + r.from.length > out.length) continue;
      if (!r.from.every((f, k) => keys[i + k] === f)) continue;
      const last = out[i + r.from.length - 1].text;
      const trail = (last.match(/[.,!?;:]+$/) || [''])[0];
      out[i].text = r.to + (r.to.match(/[.,!?;:]$/) ? '' : trail);
      for (let k = 1; k < r.from.length; k++) out[i + k].text = '';
      i += r.from.length - 1;
      break;
    }
  }
  return out;
}

// A word counts as kept if its start survives the cuts (start times are far more reliable
// than end times in speech recognition).
export const wordKept = (w, timeline) => !timeline.isCut(w.s + Math.min(0.08, Math.max(0, (w.e - w.s) / 2)));

export function buildPages(words, cfg, timeline) {
  const kept = words.filter((w) => w.text && wordKept(w, timeline));
  const pages = [];
  let cur = [];
  const charsOf = (arr) => arr.reduce((n, w) => n + w.text.length + 1, 0);
  const maxWords = cfg.mode === 'word' ? 1 : Math.max(1, cfg.maxWords | 0);
  const maxChars = Math.max(6, (cfg.maxChars | 0) * Math.max(1, cfg.lines | 0));
  const push = () => { if (cur.length) pages.push({ words: cur }); cur = []; };
  for (const w of kept) {
    const prev = cur[cur.length - 1];
    if (prev) {
      // A cut between two words also starts a new caption, so text doesn't jump mid-caption.
      const gap = timeline.toOut(w.s) - timeline.toOut(prev.e);
      if (cur.length >= maxWords || charsOf(cur) + w.text.length > maxChars || gap > 0.5 || /[.?!]$/.test(prev.text) || (/,$/.test(prev.text) && cur.length >= 2)) push();
    }
    cur.push(w);
  }
  push();
  pages.forEach((p, i) => {
    const next = pages[i + 1];
    p.s = p.words[0].s;
    const last = p.words[p.words.length - 1];
    p.e = next ? Math.min(next.words[0].s, Math.max(last.e + 0.35, last.e)) : last.e + 0.6;
    if (next && next.words[0].s - last.e < 0.35) p.e = next.words[0].s;
  });
  return pages;
}

function displayText(text, cfg) {
  let t = text;
  if (!cfg.punctuation) t = t.replace(/[.,!?;:]+$/g, '').replace(/^["“]+|["”]+$/g, '');
  if (cfg.uppercase) t = t.toUpperCase();
  return t;
}

export class Captions {
  constructor(spec, words, timeline) {
    this.cfg = spec.captions;
    this.timeline = timeline;
    this.words = applyReplacements(words, this.cfg.replacements);
    this.pages = this.cfg.enabled ? buildPages(this.words, this.cfg, timeline) : [];
    this.cache = new Map();
  }

  pageAt(t) {
    let lo = 0, hi = this.pages.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, p = this.pages[mid];
      if (t < p.s) hi = mid - 1; else if (t >= p.e) lo = mid + 1; else return { page: p, index: mid };
    }
    return null;
  }

  draw(ctx, t, W, H, u, hits) {
    const cfg = this.cfg;
    if (!cfg.enabled || !this.pages.length) return;
    if (cfg.hidden.some((h) => t >= +h.start && t < +h.end)) return;
    const hit = this.pageAt(t);
    if (!hit) return;
    const { page, index } = hit;
    const tl = this.timeline;
    const outT = tl.toOut(t);
    const local = outT - tl.toOut(page.s);

    let layout = this.cache.get(index);
    if (!layout) {
      const words = page.words.map((w) => {
        const emph = cfg.emphasis[String(w.i)] || null;
        let display = displayText(w.text, cfg);
        if (emph?.emoji) display = `${display} ${emph.emoji}`;
        return { display, i: w.i, s: w.s, e: w.e, scale: emph?.scale || 1, emph };
      });
      layout = layoutWords(ctx, words, cfg, u, cfg.maxWidth * W);
      this.cache.set(index, layout);
      if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value);
    }

    let active = -1;
    for (const w of page.words) if (w.s <= t + 0.01) active = w.i;

    // Page entrance.
    let alpha = 1, scale = 1, dy = 0;
    const p = clamp(local / 0.16);
    switch (cfg.animation) {
      case 'pop': scale = lerp(0.82, 1, ease.outBack(p)); alpha = clamp(p * 2.5); break;
      case 'fade': alpha = p; break;
      case 'slide': dy = (1 - ease.outCubic(p)) * 28 * u; alpha = p; break;
      default: break;
    }
    const cx = cfg.x * W, cy = cfg.y * H + dy;
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (scale !== 1) { ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy); }

    const hl = cfg.highlightStyle;
    const reveal = cfg.mode === 'reveal';
    drawLayout(ctx, layout, cfg, u, cx, cy, {
      wordStyle: (w) => {
        const s = {};
        if (w.emph?.color) s.color = w.emph.color;
        const isActive = w.i === active;
        if (reveal && w.s > t + 0.01) s.color = 'rgba(0,0,0,0)', s.strokeColor = 'rgba(0,0,0,0)';
        if (isActive && hl !== 'none') {
          if (hl === 'color') s.color = w.emph?.color || cfg.highlight;
          if (hl === 'scale') { s.color = w.emph?.color || cfg.highlight; s.scale = 1.12; }
          if (hl === 'underline') s.underline = cfg.highlight;
          if (hl === 'box') { s.box = { color: cfg.boxColor || cfg.highlight, radius: 14, padding: 12 }; s.color = cfg.boxTextColor || cfg.color; }
        }
        if (cfg.animation === 'bounce' || reveal) {
          const wl = outT - tl.toOut(w.s);
          if (wl >= 0 && wl < 0.15) s.scale = (s.scale || 1) * lerp(1.25, 1, ease.outCubic(wl / 0.15));
        }
        return s;
      },
    });
    ctx.restore();
    hits?.push({ id: '__captions', x: cx - layout.width / 2, y: cy - layout.height / 2, w: layout.width, h: layout.height });
  }
}
