// Text layout and drawing on canvas: wrapping, *accent* words, outline, shadow, boxes.

const EMOJI_FONTS = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';
export const fontFamily = (f) => `"${String(f || 'Inter').replace(/"/g, '')}", ${EMOJI_FONTS}, system-ui, sans-serif`;
export const fontCss = (o, px) => `${o.italic ? 'italic ' : ''}${o.weight ?? 700} ${Math.max(1, px)}px ${fontFamily(o.font)}`;

export function roundRect(ctx, x, y, w, h, r, keepPath = false) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!keepPath) ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// "*stars*" mark accent words. Returns words: [{ text, accent, br }] where br = line break before.
export function parseMarkup(text) {
  const out = [];
  let accent = false;
  String(text ?? '').split('\n').forEach((line, li) => {
    let first = true;
    for (const raw of line.split(/\s+/).filter(Boolean)) {
      let w = raw;
      let a = accent;
      const starts = w.startsWith('*'), ends = w.endsWith('*') && w.length > 1;
      if (starts) { w = w.slice(1); a = true; if (!ends) accent = true; }
      if (ends) { w = w.slice(0, -1); if (!starts) accent = false; }
      if (w.includes('*')) w = w.replace(/\*/g, '');
      if (w) out.push({ text: w, accent: a, br: first && li > 0 });
      first = false;
    }
    if (!line.trim() && li > 0) out.push({ text: '', accent: false, br: true });
  });
  return out;
}

function setFont(ctx, o, px, u) {
  ctx.font = fontCss(o, px);
  try { ctx.letterSpacing = `${(o.letterSpacing || 0) * u}px`; } catch {}
}

// Lay out words (with per-word scale) into lines no wider than maxWidth (pixels).
export function layoutWords(ctx, words, o, u, maxWidth) {
  const px = (o.size ?? 80) * u;
  setFont(ctx, o, px, u);
  const space = ctx.measureText(' ').width;
  const lines = [];
  let line = { words: [], width: 0 };
  for (const w of words) {
    const scale = w.scale || 1;
    let width;
    if (scale !== 1) { setFont(ctx, o, px * scale, u); width = ctx.measureText(w.display).width; setFont(ctx, o, px, u); }
    else width = ctx.measureText(w.display).width;
    const add = (line.words.length ? space : 0) + width;
    if ((w.br || (line.width + add > maxWidth)) && line.words.length) { lines.push(line); line = { words: [], width: 0 }; }
    line.words.push({ ...w, width, x: line.width + (line.words.length ? space : 0) });
    line.width += (line.words.length > 1 ? space : 0) + width;
  }
  if (line.words.length) lines.push(line);
  const lh = px * (o.lineHeight ?? 1.15);
  return { lines, lineHeight: lh, px, space, height: lines.length * lh, width: Math.max(0, ...lines.map((l) => l.width)) };
}

// Draw a laid-out block centered at (cx, cy). style(word) can override color per word.
export function drawLayout(ctx, layout, o, u, cx, cy, { reveal = 1, wordStyle, onWordBox } = {}) {
  const { lines, lineHeight, px } = layout;
  const align = o.align || 'center';
  const top = cy - layout.height / 2;
  const totalChars = lines.reduce((n, l) => n + l.words.reduce((m, w) => m + w.display.length, 0), 0);
  let budget = reveal >= 1 ? Infinity : Math.floor(totalChars * reveal);
  const bg = o.background;
  const stroke = (o.stroke || 0) * u;
  const shadow = (o.shadow || 0) * u;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const lineX = (line) => (align === 'left' ? cx - layout.width / 2 : align === 'right' ? cx + layout.width / 2 - line.width : cx - line.width / 2);

  // Boxes behind lines go in one path and one fill, so overlaps don't show as darker bands.
  if (bg && bg.color && lines.length) {
    const pad = (bg.padding ?? 16) * u;
    ctx.save();
    ctx.fillStyle = bg.color;
    ctx.beginPath();
    lines.forEach((line, li) => {
      const ly = top + li * lineHeight + lineHeight / 2;
      roundRect(ctx, lineX(line) - pad, ly - lineHeight / 2 - pad * 0.35, line.width + pad * 2, lineHeight + pad * 0.7, (bg.radius ?? 14) * u, true);
    });
    ctx.fill('nonzero');
    ctx.restore();
  }

  lines.forEach((line, li) => {
    const lx = lineX(line);
    const ly = top + li * lineHeight + lineHeight / 2;
    for (const w of line.words) {
      if (budget <= 0) return;
      let text = w.display;
      if (budget < text.length) text = text.slice(0, budget);
      budget -= w.display.length;
      const ws = wordStyle ? wordStyle(w) : {};
      const base = px * (w.scale || 1); // size the word was measured at
      const x = lx + w.x, y = ly;
      ctx.save();
      if (ws.scale && ws.scale !== 1) { ctx.translate(x + w.width / 2, y); ctx.scale(ws.scale, ws.scale); ctx.translate(-(x + w.width / 2), -y); }
      setFont(ctx, o, base, u);
      if (ws.box) {
        const pad = (ws.box.padding ?? 12) * u;
        ctx.fillStyle = ws.box.color;
        roundRect(ctx, x - pad, y - base * 0.62, w.width + pad * 2, base * 1.24, (ws.box.radius ?? 12) * u);
        ctx.fill();
      }
      onWordBox?.(w, x, y - base / 2, w.width, base);
      const isEmoji = w.emojiOnly;
      if (shadow > 0) { ctx.shadowColor = o.shadowColor || 'rgba(0,0,0,0.5)'; ctx.shadowBlur = shadow; ctx.shadowOffsetY = shadow * 0.25; }
      if (stroke > 0 && !isEmoji) {
        ctx.strokeStyle = ws.strokeColor || o.strokeColor || '#000';
        ctx.lineWidth = stroke * 2;
        ctx.strokeText(text, x, y);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = ws.color || (w.accent ? o.accent || o.highlight || '#FFE14D' : o.color || '#FFFFFF');
      ctx.fillText(text, x, y);
      if (ws.underline) {
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = ws.underline;
        roundRect(ctx, x, y + base * 0.5, w.width, Math.max(3, base * 0.1), base * 0.05);
        ctx.fill();
      }
      ctx.restore();
    }
  });
}

// Convenience used by text layers and custom effects.
export function drawText(ctx, text, cx, cy, o, u, maxWidthPx, extra) {
  const words = parseMarkup(o.uppercase ? String(text).toUpperCase() : text).map((w) => ({ ...w, display: w.text }));
  const layout = layoutWords(ctx, words, o, u, maxWidthPx);
  drawLayout(ctx, layout, o, u, cx, cy, extra);
  return layout;
}
