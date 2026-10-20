// A clean bar chart on a dark card: bars grow in one after another while their values count up; one bar is highlighted.
export const meta = {
  name: 'Bar Chart',
  category: 'Explainer',
  description: 'A simple bar chart whose bars grow in and count up. Use it for before/after, this vs that, or any comparison you say out loud.',
  props: {
    title: '',
    bars: [{ label: 'Before', value: 20 }, { label: 'After', value: 85 }],
    unit: '', // shown after each value, e.g. '%' or ' hrs'
    prefix: '', // shown before each value, e.g. '$'
    decimals: null, // null = automatic
    max: null, // null = the biggest bar fills the chart
    highlight: 'last', // 'last' | 'max' | 'all' | 'none' | a bar index (0, 1, ...)
    x: 0.5,
    y: 0.35,
    width: 0.8,
    height: 0.26,
    color: '#FFFFFF',
    accent: '#C8FF3D',
    bg: 'rgba(12,12,14,0.78)', // null = no card
    font: 'Inter',
    horizontal: false,
    stagger: 0.15,
    radius: 28,
  },
  presets: {
    'Horizontal': { horizontal: true, bars: [{ label: 'Manual', value: 6 }, { label: 'With AI', value: 1.5 }], unit: ' hrs', highlight: 'min' },
    'Percent': { unit: '%', max: 100 },
    'Light': { bg: 'rgba(250,250,247,0.94)', color: '#111111', accent: '#111111' },
  },
  fonts: ['Inter'],
  duration: 4,
};

function setFont(ctx, weight, px, family, spacing = 0) {
  ctx.font = `${weight} ${Math.max(1, px)}px "${String(family || 'Inter').replace(/"/g, '')}", system-ui, sans-serif`;
  try { ctx.letterSpacing = `${spacing}px`; } catch (e) { /* older canvas */ }
}

function fmt(v, dec) {
  const s = Math.abs(v).toFixed(dec);
  const [i, f] = s.split('.');
  return (v < 0 ? '−' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '');
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const bars = (Array.isArray(p.bars) ? p.bars : [])
    .map((b, i) => (typeof b === 'number' ? { label: '', value: b } : { label: String(b?.label ?? ''), value: +b?.value || 0, color: b?.color }))
    .slice(0, 12);
  if (!bars.length) return;

  const color = p.color || '#FFFFFF';
  const accent = p.accent || '#C8FF3D';
  const values = bars.map((b) => b.value);
  const maxV = +p.max > 0 ? +p.max : Math.max(1e-9, ...values.map(Math.abs));
  const dec = p.decimals != null && Number.isFinite(+p.decimals) ? Math.max(0, Math.min(4, Math.round(+p.decimals))) : (values.some((v) => Math.round(v) !== v) ? 1 : 0);
  const hl = p.highlight ?? 'last';
  const iMax = values.indexOf(Math.max(...values)), iMin = values.indexOf(Math.min(...values));
  const isHi = (i) => hl === 'all' || (hl === 'last' && i === bars.length - 1) || (hl === 'max' && i === iMax) || (hl === 'min' && i === iMin) || (typeof hl === 'number' && hl === i) || (String(+hl) === String(hl) && +hl === i);

  const cardW = W * clamp(+p.width || 0.8, 0.3, 1);
  const cardH = H * clamp(+p.height || 0.26, 0.1, 0.9);
  const cardX = W * (p.x ?? 0.5) - cardW / 2;
  const cardY = H * (p.y ?? 0.35) - cardH / 2;
  const pad = 44 * u;

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
    fx.roundRect(cardX, cardY, cardW, cardH, (+p.radius >= 0 ? +p.radius : 28) * u);
    ctx.fill();
    ctx.restore();
  }

  let top = cardY + pad;
  ctx.textBaseline = 'middle';
  if (p.title) {
    // Title shrinks to fit on one line.
    let tpx = 44 * u;
    setFont(ctx, 800, tpx, p.font, -0.4 * u);
    const tw = ctx.measureText(String(p.title)).width;
    if (tw > cardW - pad * 2) { tpx *= (cardW - pad * 2) / tw; setFont(ctx, 800, tpx, p.font, -0.4 * u); }
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(String(p.title), cardX + pad, top + tpx * 0.55);
    top += tpx * 1.1 + 26 * u;
  }

  const stagger = +p.stagger >= 0 ? +p.stagger : 0.15;
  const grow = (i) => ease.outCubic(clamp((t - 0.35 - i * stagger) / 0.8));
  const vpx = 44 * u, lpx = 34 * u;
  const r = (+p.radius >= 0 ? Math.min(+p.radius, 12) : 10) * u;
  const label = (v) => `${p.prefix || ''}${fmt(v, dec)}${p.unit || ''}`;

  if (!p.horizontal) {
    const bottom = cardY + cardH - pad - lpx * 1.5;
    const plotTop = top + vpx * 1.4;
    const plotH = Math.max(10, bottom - plotTop);
    const groupW = cardW - pad * 2;
    const n = bars.length;
    const barW = Math.min(groupW / (n + (n - 1) * 0.4), 200 * u);
    const gap = n > 1 ? Math.min((groupW - n * barW) / (n - 1), barW * 1.2) : 0;
    const total = n * barW + (n - 1) * gap;
    let x = cardX + cardW / 2 - total / 2;

    ctx.save();
    ctx.globalAlpha *= 0.2;
    ctx.fillStyle = color;
    ctx.fillRect(cardX + pad, bottom, cardW - pad * 2, Math.max(1, 1.5 * u));
    ctx.restore();

    bars.forEach((b, i) => {
      const k = grow(i);
      const h = (plotH * Math.max(0, b.value)) / maxV * k;
      const hi = isHi(i);
      if (h > 0.5) {
        ctx.save();
        // Rounded top, square bottom: draw past the baseline and clip there.
        ctx.beginPath();
        ctx.rect(x - 2, cardY, barW + 4, bottom - cardY);
        ctx.clip();
        ctx.fillStyle = b.color || (hi ? accent : color);
        if (!b.color && !hi) ctx.globalAlpha *= 0.3;
        fx.roundRect(x, bottom - h, barW, h + Math.min(r, barW / 2), Math.min(r, barW / 2));
        ctx.fill();
        ctx.restore();
      }
      ctx.textAlign = 'center';
      if (k > 0) {
        ctx.save();
        ctx.globalAlpha *= clamp(k * 2);
        setFont(ctx, 800, vpx, p.font, -0.3 * u);
        ctx.fillStyle = color;
        ctx.fillText(label(b.value * k), x + barW / 2, bottom - h - vpx * 0.75);
        ctx.restore();
      }
      if (b.label) {
        ctx.save();
        ctx.globalAlpha *= 0.7 * clamp((t - 0.25 - i * stagger) / 0.3);
        setFont(ctx, 400, lpx, p.font);
        ctx.fillStyle = color;
        ctx.fillText(b.label, x + barW / 2, bottom + lpx * 0.95);
        ctx.restore();
      }
      x += barW + gap;
    });
  } else {
    const bottom = cardY + cardH - pad;
    const n = bars.length;
    const rowH = (bottom - top) / n;
    const barH = Math.max(6 * u, Math.min(56 * u, rowH - lpx * 1.6));
    setFont(ctx, 800, vpx, p.font, -0.3 * u);
    const valueRoom = Math.max(...bars.map((b) => ctx.measureText(label(b.value)).width)) + 20 * u;
    const plotW = Math.max(10, cardW - pad * 2 - valueRoom);
    bars.forEach((b, i) => {
      const k = grow(i);
      const ry = top + i * rowH;
      const barY = ry + (rowH - barH - lpx * 1.4) / 2 + lpx * 1.4;
      if (b.label) {
        ctx.save();
        ctx.globalAlpha *= 0.7 * clamp((t - 0.25 - i * stagger) / 0.3);
        setFont(ctx, 400, lpx, p.font);
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.fillText(b.label, cardX + pad, barY - lpx * 0.75);
        ctx.restore();
      }
      const w = (plotW * Math.max(0, b.value)) / maxV * k;
      const hi = isHi(i);
      ctx.save();
      ctx.fillStyle = color;
      ctx.globalAlpha *= 0.08;
      fx.roundRect(cardX + pad, barY, plotW, barH, Math.min(r, barH / 2));
      ctx.fill();
      ctx.restore();
      if (w > 0.5) {
        ctx.save();
        ctx.fillStyle = b.color || (hi ? accent : color);
        if (!b.color && !hi) ctx.globalAlpha *= 0.35;
        fx.roundRect(cardX + pad, barY, w, barH, Math.min(r, barH / 2, w / 2));
        ctx.fill();
        ctx.restore();
      }
      if (k > 0) {
        ctx.save();
        ctx.globalAlpha *= clamp(k * 2);
        setFont(ctx, 800, vpx, p.font, -0.3 * u);
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.fillText(label(b.value * k), cardX + pad + w + 16 * u, barY + barH / 2);
        ctx.restore();
      }
    });
  }
  ctx.restore();
}
