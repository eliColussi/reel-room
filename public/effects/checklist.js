// A dark card list where items slide in one by one and each gets a checkmark drawn into an accent circle.
export const meta = {
  name: 'Checklist',
  category: 'Explainer',
  description: 'A list where each item appears and gets ticked off in turn. Use it for steps, requirements, or "here is what you get".',
  props: {
    title: '',
    items: ['First thing', 'Second thing', 'Third thing'],
    every: 0.8, // seconds between items
    times: null, // e.g. [0.5, 1.8, 3.2]: seconds from start for each item, overrides `every`
    start: 0.45, // when the first item appears (if no times)
    x: 0.5,
    y: 0.35, // card center
    width: 0.78,
    size: 50,
    bg: 'rgba(12,12,14,0.78)', // null = no card
    color: '#FFFFFF',
    accent: '#C8FF3D',
    check: '#0C0C0E', // checkmark color inside the accent circle
    font: 'Inter',
    radius: 32,
  },
  presets: {
    'Light': { bg: 'rgba(250,250,247,0.94)', color: '#111111', accent: '#111111', check: '#FFFFFF' },
    'With title': { title: 'What you need', items: ['A phone', 'Good light', 'One clear idea'] },
  },
  fonts: ['Inter'],
  duration: 4,
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
  return out.length ? out : [''];
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const items = (Array.isArray(p.items) ? p.items : String(p.items || '').split('\n')).map((s) => String(s ?? '')).filter(Boolean);
  if (!items.length && !p.title) return;

  const color = p.color || '#FFFFFF';
  const accent = p.accent || '#C8FF3D';
  const cardW = W * clamp(+p.width || 0.78, 0.3, 1);
  const pad = 48 * u;
  const ipx = Math.max(6, (+p.size || 50) * u);
  const lh = ipx * 1.3;
  const d = ipx * 1.05; // check circle diameter
  const textX = pad + d + ipx * 0.55;
  const textMax = cardW - textX - pad;
  const rowGap = ipx * 0.6;

  setFont(ctx, 400, ipx, p.font);
  const rows = items.map((s) => {
    const lines = wrap(ctx, s, textMax);
    return { lines, h: Math.max(d, lines.length * lh) };
  });
  const tpx = ipx * 1.15;
  setFont(ctx, 800, tpx, p.font, -0.4 * u);
  const titleLines = p.title ? wrap(ctx, p.title, cardW - pad * 2) : [];
  const tlh = tpx * 1.2;
  const titleBlock = titleLines.length ? titleLines.length * tlh + ipx * 1.1 : 0;
  const cardH = pad * 2 + titleBlock + rows.reduce((a, r) => a + r.h, 0) + rowGap * Math.max(0, rows.length - 1);
  const cardX = W * (p.x ?? 0.5) - cardW / 2;
  const cardY = H * (p.y ?? 0.35) - cardH / 2;

  const base = ctx.globalAlpha;
  const enter = ease.outCubic(clamp(t / 0.4));
  const exit = clamp((duration - t) / 0.25);
  const alpha = Math.min(clamp(t / 0.25), exit);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = base * alpha;
  ctx.translate(0, (1 - enter) * 30 * u);
  if (p.bg) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 44 * u;
    ctx.shadowOffsetY = 14 * u;
    ctx.fillStyle = p.bg;
    fx.roundRect(cardX, cardY, cardW, cardH, (+p.radius >= 0 ? +p.radius : 32) * u);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 16 * u;
    ctx.shadowOffsetY = 3 * u;
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let y = cardY + pad;
  if (titleLines.length) {
    setFont(ctx, 800, tpx, p.font, -0.4 * u);
    ctx.fillStyle = color;
    titleLines.forEach((ln, i) => ctx.fillText(ln, cardX + pad, y + i * tlh + tlh / 2));
    ctx.save();
    ctx.globalAlpha *= 0.14;
    ctx.fillRect(cardX + pad, y + titleLines.length * tlh + ipx * 0.55 - 0.5 * u, cardW - pad * 2, Math.max(1, 1.5 * u));
    ctx.restore();
    y += titleBlock;
  }

  const every = +p.every > 0 ? +p.every : 0.8;
  const start = +p.start >= 0 ? +p.start : 0.45;
  const times = Array.isArray(p.times) ? p.times : null;
  rows.forEach((row, i) => {
    const at = times && Number.isFinite(+times[i]) ? +times[i] : start + i * every;
    const k = ease.outCubic(clamp((t - at) / 0.35));
    const rowY = y;
    y += row.h + rowGap;
    if (k <= 0) return;
    ctx.save();
    ctx.globalAlpha *= k;
    ctx.translate((1 - k) * 18 * u, (1 - k) * 14 * u);
    const ccx = cardX + pad + d / 2;
    const ccy = rowY + Math.max(d, lh) / 2; // lines up with the first line of text
    // Empty ring until it gets checked.
    const ck = clamp((t - at - 0.3) / 0.3);
    ctx.save();
    ctx.globalAlpha *= 0.4 * (1 - ck);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, 2.5 * u);
    ctx.beginPath();
    ctx.arc(ccx, ccy, d / 2 - 1.25 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (ck > 0) {
      const s = ease.outBack(ck);
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.translate(ccx, ccy);
      ctx.scale(s, s);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(0, 0, d / 2, 0, Math.PI * 2);
      ctx.fill();
      // Checkmark draws itself.
      const mk = ease.outCubic(clamp((t - at - 0.38) / 0.28));
      if (mk > 0) {
        const r = d / 2;
        const a = [-0.42 * r, 0.02 * r], b = [-0.12 * r, 0.32 * r], c = [0.44 * r, -0.3 * r];
        const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
        const len = (l1 + l2) * mk;
        ctx.strokeStyle = p.check || '#0C0C0E';
        ctx.lineWidth = Math.max(2, r * 0.2);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        if (len <= l1) ctx.lineTo(a[0] + (b[0] - a[0]) * (len / l1), a[1] + (b[1] - a[1]) * (len / l1));
        else {
          ctx.lineTo(b[0], b[1]);
          const q = (len - l1) / l2;
          ctx.lineTo(b[0] + (c[0] - b[0]) * q, b[1] + (c[1] - b[1]) * q);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    setFont(ctx, 400, ipx, p.font);
    ctx.fillStyle = color;
    const off = (Math.max(d, lh) - lh) / 2;
    row.lines.forEach((ln, li) => ctx.fillText(ln, cardX + textX, rowY + off + li * lh + lh / 2));
    ctx.restore();
  });
  ctx.restore();
}
