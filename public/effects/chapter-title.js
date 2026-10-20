// A chapter marker: a small spaced-out "PART 01" label with thin rules drawing outward, and a big serif title rising from a mask.
export const meta = {
  name: 'Chapter Title',
  category: 'Text',
  description: 'A "PART 01" label with a big title under it, like a chapter in a film. Use it to split a longer reel into clear sections.',
  props: {
    number: '01',
    label: 'PART',
    title: 'The setup',
    font: 'Inter',
    titleFont: 'Instrument Serif',
    size: 130, // title size
    color: '#FFFFFF',
    accent: '#C8FF3D',
    x: 0.5,
    y: 0.3,
    background: 'rgba(0,0,0,0)', // e.g. 'rgba(0,0,0,0.55)' to dim the video behind
  },
  presets: {
    'Dimmed': { background: 'rgba(0,0,0,0.55)' },
    'Bold sans': { titleFont: 'Inter', size: 110 },
    'Step': { label: 'STEP', number: '1' },
  },
  fonts: ['Inter', 'Instrument Serif'],
  duration: 2.5,
};

function setFont(ctx, weight, px, family, spacing = 0) {
  ctx.font = `${weight} ${Math.max(1, px)}px "${String(family || 'Inter').replace(/"/g, '')}", system-ui, sans-serif`;
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

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const base = ctx.globalAlpha;
  const exitK = clamp((duration - t) / 0.3);
  if (exitK <= 0) return;
  const exitE = ease.inCubic(1 - exitK); // 0 → 1 while leaving
  const color = p.color || '#FFFFFF';
  const cx = W * (p.x ?? 0.5);
  const cy = H * (p.y ?? 0.3);

  // Optional full-frame dim.
  if (p.background && p.background !== 'transparent' && !/,\s*0(\.0*)?\s*\)\s*$/.test(String(p.background))) {
    ctx.globalAlpha = base * clamp(t / 0.35) * exitK;
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, W, H);
  }

  const tpx = Math.max(6, (+p.size || 130) * u);
  setFont(ctx, 400, tpx, p.titleFont);
  const lines = wrap(ctx, p.title, W * 0.86);
  const tlh = tpx * 1.04;
  const lpx = 26 * u;
  const gap = 34 * u;
  const blockH = lpx + gap + lines.length * tlh;
  const top = cy - blockH / 2 - exitE * 20 * u;

  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 24 * u;
  ctx.shadowOffsetY = 4 * u;
  ctx.textBaseline = 'middle';

  // Label: "PART" in the text color, the number in the accent.
  const labelText = String(p.label ?? '').toUpperCase();
  const num = String(p.number ?? '');
  const spacing = lpx * 0.38;
  setFont(ctx, 700, lpx, p.font, spacing);
  const lw = labelText ? ctx.measureText(labelText + ' ').width : 0;
  const nw = num ? ctx.measureText(num).width : 0;
  const total = lw + nw - spacing; // trailing letter-spacing isn't ink
  const ly = top + lpx / 2;
  const lk = ease.outCubic(clamp(t / 0.35));
  ctx.globalAlpha = base * lk * (1 - exitE);
  ctx.textAlign = 'left';
  const lx = cx - total / 2;
  if (labelText) { ctx.fillStyle = color; ctx.fillText(labelText + ' ', lx, ly + (1 - lk) * 10 * u); }
  if (num) { ctx.fillStyle = p.accent || '#C8FF3D'; ctx.fillText(num, lx + lw, ly + (1 - lk) * 10 * u); }

  // Rules drawing outward from the label.
  const rk = ease.outCubic(clamp((t - 0.1) / 0.55));
  if (rk > 0 && (labelText || num)) {
    const len = 120 * u * rk;
    const off = total / 2 + 22 * u;
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = base * 0.55 * (1 - exitE);
    ctx.fillStyle = color;
    ctx.fillRect(cx + off, ly - 1 * u, len, 2 * u);
    ctx.fillRect(cx - off - len, ly - 1 * u, len, 2 * u);
    ctx.restore();
  }

  // Title lines rise out of a mask, one after another.
  setFont(ctx, 400, tpx, p.titleFont, -0.5 * u);
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  lines.forEach((line, i) => {
    const k = ease.outCubic(clamp((t - 0.2 - i * 0.09) / 0.55));
    if (k <= 0) return;
    const y = top + lpx + gap + i * tlh + tlh / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y - tlh * 0.62, W, tlh * 1.3);
    ctx.clip();
    ctx.globalAlpha = base * clamp(k * 1.5) * (1 - exitE);
    ctx.fillText(line, cx, y + (1 - k) * tlh * 0.9);
    ctx.restore();
  });
}
