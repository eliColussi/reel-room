// A circular ring on a dark disc fills to a percentage while the number in the middle counts up.
export const meta = {
  name: 'Progress Ring',
  category: 'Explainer',
  description: 'A ring that fills up to a percentage with the number in the middle. Use it for completion rates, scores, or "87% of people…" stats.',
  props: {
    value: 75,
    max: 100,
    suffix: '%',
    label: '',
    color: '#C8FF3D', // ring fill
    track: 'rgba(255,255,255,0.18)',
    textColor: '#FFFFFF',
    bg: 'rgba(12,12,14,0.6)', // disc behind the ring; null = none
    size: 300, // ring diameter
    thickness: 26,
    x: 0.5,
    y: 0.3,
    font: 'Inter',
    fillDuration: 1.2,
    delay: 0.2,
  },
  presets: {
    'Big': { size: 440, thickness: 34 },
    'No disc': { bg: null },
    'Score': { value: 9.2, max: 10, suffix: '/10' },
  },
  fonts: ['Inter'],
  duration: 3,
};

function setFont(ctx, weight, px, family, spacing = 0) {
  ctx.font = `${weight} ${Math.max(1, px)}px "${String(family || 'Inter').replace(/"/g, '')}", system-ui, sans-serif`;
  try { ctx.letterSpacing = `${spacing}px`; } catch (e) { /* older canvas */ }
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const value = Number.isFinite(+p.value) ? +p.value : 75;
  const max = +p.max > 0 ? +p.max : 100;
  const delay = +p.delay >= 0 ? +p.delay : 0.2;
  const fd = Math.max(0.05, +p.fillDuration || 1.2);
  const k = ease.outCubic(clamp((t - delay) / fd));
  const frac = clamp(value / max) * k;

  const base = ctx.globalAlpha;
  const enterK = clamp(t / 0.45);
  const exit = clamp((duration - t) / 0.25);
  const alpha = Math.min(clamp(t / 0.2), exit);
  if (alpha <= 0) return;
  const s = fx.lerp(0.82, 1, ease.outBack(enterK)) * (0.96 + 0.04 * exit);

  const R = Math.max(10, (+p.size || 300) * u) / 2;
  const th = Math.max(2, Math.min(R * 0.6, (+p.thickness || 26) * u));
  const rr = R - th / 2;
  const cx = W * (p.x ?? 0.5), cy = H * (p.y ?? 0.3);

  ctx.save();
  ctx.globalAlpha = base * alpha;
  ctx.translate(cx, cy);
  ctx.scale(s, s);

  if (p.bg) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 40 * u;
    ctx.shadowOffsetY = 12 * u;
    ctx.fillStyle = p.bg;
    ctx.beginPath();
    ctx.arc(0, 0, R + th * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.lineWidth = th;
  ctx.strokeStyle = p.track || 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.arc(0, 0, rr, 0, Math.PI * 2);
  ctx.stroke();

  if (frac > 0.0005) {
    const a0 = -Math.PI / 2;
    ctx.strokeStyle = p.color || '#C8FF3D';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, rr, a0, a0 + Math.PI * 2 * Math.min(frac, 0.9999));
    ctx.stroke();
  }

  // The number, with a smaller suffix.
  const decimals = Math.round(value) === value ? 0 : Math.min(2, (String(value).split('.')[1] || '').length);
  const num = (value * k).toFixed(decimals);
  const suffix = String(p.suffix ?? '');
  const npx = R * 0.56;
  const spx = npx * 0.48;
  setFont(ctx, 800, npx, p.font, -npx * 0.03);
  const nw = ctx.measureText(num).width;
  const capH = ctx.measureText('0').actualBoundingBoxAscent || npx * 0.72;
  setFont(ctx, 700, spx, p.font);
  const sw = suffix ? ctx.measureText(suffix).width + npx * 0.04 : 0;
  const lift = p.label ? R * 0.12 : 0;
  const baseline = capH / 2 - lift;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = p.textColor || '#FFFFFF';
  setFont(ctx, 800, npx, p.font, -npx * 0.03);
  const x0 = -(nw + sw) / 2;
  ctx.fillText(num, x0, baseline);
  if (suffix) {
    setFont(ctx, 700, spx, p.font);
    ctx.save();
    ctx.globalAlpha *= 0.85;
    ctx.fillText(suffix, x0 + nw + npx * 0.04, baseline - capH + (ctx.measureText(suffix).actualBoundingBoxAscent || spx * 0.72));
    ctx.restore();
  }
  if (p.label) {
    const lk = clamp((t - delay - 0.2) / 0.4);
    const lpx = R * 0.13;
    setFont(ctx, 700, lpx, p.font, lpx * 0.12);
    ctx.save();
    ctx.globalAlpha *= 0.7 * lk;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.label).toUpperCase(), 0, baseline + lpx * 1.25, rr * 1.6);
    ctx.restore();
  }
  ctx.restore();
}
