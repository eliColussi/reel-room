// An editorial quote card rises in: an accent quote badge on the edge, the quote set in a serif, and an author line.
export const meta = {
  name: 'Quote Card',
  category: 'Text',
  description: 'A clean magazine-style card with a big quote mark, the quote in a serif, and who said it. Use it to put a line on screen word for word.',
  props: {
    text: 'Make the thing you wish someone else had already made.',
    author: 'Your Name',
    role: '', // optional second line under the author
    font: 'Instrument Serif',
    bodyFont: 'Inter',
    size: 72,
    bg: '#F4F1EA',
    color: '#141414',
    accent: '#C8FF3D',
    x: 0.5,
    y: 0.32,
    width: 0.82,
    radius: 30,
  },
  presets: {
    'Dark': { bg: '#141414', color: '#F4F1EA' },
    'Lime': { bg: '#C8FF3D', color: '#141414', accent: '#141414' },
  },
  fonts: ['Instrument Serif', 'Inter'],
  duration: 4,
};

function setFont(ctx, weight, px, family, spacing = 0) {
  ctx.font = `${weight} ${Math.max(1, px)}px "${String(family || 'Inter').replace(/"/g, '')}", Georgia, serif`;
  try { ctx.letterSpacing = `${spacing}px`; } catch (e) { /* older canvas */ }
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxW) { out.push(line); line = word; } else line = test;
    }
    if (line) out.push(line);
  }
  return out;
}

function luminance(c) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!m) return 0.5;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  const n = parseInt(h, 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const color = p.color || '#141414';
  const bg = p.bg || '#F4F1EA';
  const accent = p.accent || '#C8FF3D';
  const cardW = W * clamp(+p.width || 0.82, 0.3, 1);
  const pad = 64 * u;
  const qpx = Math.max(6, (+p.size || 72) * u);
  const apx = 32 * u;

  setFont(ctx, 400, qpx, p.font);
  const quote = String(p.text ?? '').replace(/^["“]+|["”]+$/g, '');
  const lines = wrap(ctx, quote, cardW - pad * 2);
  const lh = qpx * 1.1;
  const authorH = p.author ? apx * 1.4 + (p.role ? apx * 1.3 : 0) : 0;
  const cardH = pad * 1.15 + lines.length * lh + (authorH ? pad * 0.55 + authorH : 0) + pad;

  const cx = W * (p.x ?? 0.5);
  const cardX = cx - cardW / 2;
  const cardY = H * (p.y ?? 0.32) - cardH / 2;

  const base = ctx.globalAlpha;
  const enter = ease.outCubic(clamp(t / 0.5));
  const exitK = clamp((duration - t) / 0.28);
  const exit = ease.outCubic(exitK);
  if (Math.min(enter, exitK) <= 0) return;
  const lift = (1 - enter) * 70 * u + (1 - exit) * 24 * u;

  ctx.save();
  ctx.translate(0, lift);
  ctx.globalAlpha = base * Math.min(clamp(t / 0.25), exitK);

  // Card
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 50 * u;
  ctx.shadowOffsetY = 18 * u;
  ctx.fillStyle = bg;
  fx.roundRect(cardX, cardY, cardW, cardH, (+p.radius >= 0 ? +p.radius : 30) * u);
  ctx.fill();
  ctx.restore();

  // Quote badge sitting on the card's top edge
  const bk = clamp((t - 0.15) / 0.45);
  if (bk > 0) {
    const r = 54 * u;
    const bx = cardX + pad + r * 0.2, by = cardY;
    const s = ease.outBack(bk);
    ctx.save();
    ctx.translate(bx + r, by);
    ctx.scale(s, s);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = luminance(accent) > 0.5 ? (luminance(color) < luminance(bg) ? color : bg) : (luminance(color) > luminance(bg) ? color : bg);
    setFont(ctx, 400, r * 2.5, p.font);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // Center the glyph's ink, not its em box.
    const m = ctx.measureText('“');
    const gx = ((m.actualBoundingBoxLeft || 0) - (m.actualBoundingBoxRight || r)) / 2;
    const gy = ((m.actualBoundingBoxAscent || r) - (m.actualBoundingBoxDescent || 0)) / 2;
    ctx.fillText('“', gx, gy);
    ctx.restore();
  }

  // Quote lines rise in one after another
  setFont(ctx, 400, qpx, p.font);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const textTop = cardY + pad * 1.15;
  lines.forEach((line, i) => {
    const k = ease.outCubic(clamp((t - 0.22 - i * 0.08) / 0.45));
    if (k <= 0) return;
    ctx.save();
    ctx.globalAlpha *= k;
    ctx.fillText(line, cardX + pad, textTop + i * lh + lh / 2 + (1 - k) * 16 * u);
    ctx.restore();
  });

  // Author line
  if (p.author) {
    const k = ease.outCubic(clamp((t - 0.4 - lines.length * 0.08) / 0.4));
    if (k > 0) {
      const ay = textTop + lines.length * lh + pad * 0.55 + apx * 0.7;
      ctx.save();
      ctx.globalAlpha *= k;
      ctx.fillStyle = color;
      const rule = 36 * u;
      ctx.save();
      ctx.globalAlpha *= 0.4;
      ctx.fillRect(cardX + pad, ay - 1 * u, rule * k, 2 * u);
      ctx.restore();
      setFont(ctx, 700, apx * 0.9, p.bodyFont, 2.4 * u);
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p.author).toUpperCase(), cardX + pad + rule + 18 * u, ay);
      if (p.role) {
        setFont(ctx, 400, apx * 0.9, p.bodyFont);
        ctx.globalAlpha *= 0.6;
        ctx.fillText(String(p.role), cardX + pad + rule + 18 * u, ay + apx * 1.3);
      }
      ctx.restore();
    }
  }
  ctx.restore();
}
