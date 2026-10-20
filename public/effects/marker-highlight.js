// A phrase gets a highlighter-marker swipe behind it; the text flips from white to ink as the marker passes.
export const meta = {
  name: 'Marker Highlight',
  category: 'Text',
  description: 'A highlighter swipes across a phrase, like someone marking the key line in a book. Use it to land the one point that matters.',
  props: {
    text: 'the part that matters',
    font: 'Inter',
    weight: 800,
    size: 80,
    textColor: '#111111', // text color on the marker
    textBefore: '#FFFFFF', // text color before the marker reaches it
    color: '#FFE14D', // marker color
    x: 0.5,
    y: 0.3,
    angle: -2,
    speed: 0.45, // seconds for the swipe
    delay: 0.25,
    maxWidth: 0.84,
  },
  presets: {
    'Lime': { color: '#C8FF3D' },
    'Pink': { color: '#FF8FB1' },
    'Serif': { font: 'Instrument Serif', weight: 400, size: 96 },
  },
  fonts: ['Inter'],
  duration: 2.5,
};

function setFont(ctx, weight, px, family) {
  ctx.font = `${weight} ${Math.max(1, px)}px "${String(family || 'Inter').replace(/"/g, '')}", system-ui, sans-serif`;
  try { ctx.letterSpacing = '0px'; } catch (e) { /* older canvas */ }
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

// One rough marker pass from x0 to x1 with chisel-cut ends and slightly wobbly edges.
function markerPath(ctx, fx, x0, x1, yc, h, seed, u) {
  const slant = h * 0.22;
  const step = 34 * u;
  const n = Math.max(2, Math.ceil((x1 - x0) / step));
  const top = yc - h / 2, bot = yc + h / 2;
  ctx.beginPath();
  ctx.moveTo(x0 + slant, top + (fx.random(seed) - 0.5) * 3 * u);
  for (let i = 1; i <= n; i++) {
    const x = Math.min(x1 + slant, x0 + slant + (x1 - x0) * (i / n));
    ctx.lineTo(x, top + (fx.random(seed + i * 1.7) - 0.5) * 4 * u);
  }
  for (let i = n; i >= 0; i--) {
    const x = x0 + (x1 - x0) * (i / n);
    ctx.lineTo(x, bot + (fx.random(seed + 50 + i * 2.3) - 0.5) * 4 * u);
  }
  ctx.closePath();
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const px = Math.max(6, (+p.size || 80) * u);
  setFont(ctx, p.weight || 800, px, p.font);
  const lines = wrap(ctx, p.text, W * (+p.maxWidth || 0.84));
  if (!lines.length) return;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const lh = px * 1.28;
  const padX = px * 0.22;
  const bandH = px * 0.92;

  const base = ctx.globalAlpha;
  const enter = ease.outCubic(clamp(t / 0.3));
  const exit = clamp((duration - t) / 0.25);
  const alpha = Math.min(enter, exit);
  if (alpha <= 0) return;

  // Swipe time is shared across lines in proportion to their width.
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  const speed = Math.max(0.05, +p.speed || 0.45);
  const delay = +p.delay >= 0 ? +p.delay : 0.25;

  ctx.save();
  ctx.globalAlpha = base * alpha;
  ctx.translate(W * (p.x ?? 0.5), H * (p.y ?? 0.3) + (1 - enter) * 18 * u);
  ctx.rotate(((+p.angle || 0) * Math.PI) / 180);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  let before = 0;
  lines.forEach((line, i) => {
    const w = widths[i];
    const lx = -w / 2;
    const ly = (i - (lines.length - 1) / 2) * lh;
    const t0 = delay + (before / total) * speed;
    const t1 = t0 + (w / total) * speed;
    before += w;
    const k = t1 > t0 ? clamp((t - t0) / (t1 - t0)) : 1;
    const x0 = lx - padX, x1 = lx + w + padX;
    const front = x0 + (x1 - x0) * ease.inOutQuad(k);

    if (k > 0) {
      ctx.save();
      ctx.fillStyle = p.color || '#FFE14D';
      const yc = ly + px * 0.04;
      // Three layered passes: the overlap is near solid, the edges stay rough.
      ctx.globalAlpha = base * alpha * 0.85;
      markerPath(ctx, fx, x0, front, yc, bandH, 11 + i * 97, u);
      ctx.fill();
      ctx.globalAlpha = base * alpha * 0.4;
      markerPath(ctx, fx, x0 + 4 * u, front - 2 * u, yc - 3 * u, bandH * 0.96, 37 + i * 97, u);
      ctx.fill();
      ctx.globalAlpha = base * alpha * 0.3;
      markerPath(ctx, fx, x0 - 2 * u, front + 2 * u, yc + 3 * u, bandH * 0.9, 71 + i * 97, u);
      ctx.fill();
      ctx.restore();
    }

    setFont(ctx, p.weight || 800, px, p.font);
    // Ink-colored text where the marker has been, light text ahead of it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(front, ly - lh, W * 2, lh * 2);
    ctx.clip();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 16 * u;
    ctx.shadowOffsetY = 3 * u;
    ctx.fillStyle = p.textBefore || '#FFFFFF';
    ctx.fillText(line, lx, ly);
    ctx.restore();
    if (k > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 - W, ly - lh, front - x0 + W, lh * 2);
      ctx.clip();
      ctx.fillStyle = p.textColor || '#111111';
      ctx.fillText(line, lx, ly);
      ctx.restore();
    }
  });
  ctx.restore();
}
