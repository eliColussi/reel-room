// A big number counts up with an eased roll, lands with a tiny pulse, and a label fades in underneath.
export const meta = {
  name: 'Counter',
  category: 'Explainer',
  description: 'A big number that counts up to your stat, with a short label under it. Use it when you say a number you want people to feel.',
  props: {
    from: 0,
    to: 1000,
    decimals: 0,
    prefix: '',
    suffix: '',
    label: '',
    font: 'Anton',
    labelFont: 'Inter',
    size: 200,
    color: '#FFFFFF',
    labelColor: 'rgba(255,255,255,0.8)',
    accent: null, // colors the prefix/suffix, e.g. '#C8FF3D'
    x: 0.5,
    y: 0.3,
    countDuration: 1.2,
    delay: 0.15,
    separator: true, // 1,000 instead of 1000
  },
  presets: {
    'Money': { prefix: '$' },
    'Percent': { suffix: '%', to: 87 },
    'Followers': { to: 10000, suffix: '+', label: 'new followers', accent: '#C8FF3D' },
  },
  fonts: ['Anton', 'Inter'],
  duration: 3,
};

function setFont(ctx, weight, px, family, spacing = 0) {
  const fam = String(family || 'Anton').replace(/"/g, '');
  ctx.font = `${weight} ${Math.max(1, px)}px "${fam}", ${/anton|bebas|oswald/i.test(fam) ? 'Impact, ' : ''}system-ui, sans-serif`;
  try { ctx.letterSpacing = `${spacing}px`; } catch (e) { /* older canvas */ }
}

function format(v, decimals, sep) {
  const d = Math.max(0, Math.min(6, Math.round(+decimals || 0)));
  let s = Math.abs(v).toFixed(d);
  if (sep) {
    const [i, f] = s.split('.');
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '');
  }
  return (v < 0 && +s.replace(/,/g, '') !== 0 ? '−' : '') + s;
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const from = Number.isFinite(+p.from) ? +p.from : 0;
  const to = Number.isFinite(+p.to) ? +p.to : 1000;
  const delay = +p.delay >= 0 ? +p.delay : 0.15;
  const cd = Math.max(0.05, +p.countDuration || 1.2);
  const k = ease.outCubic(clamp((t - delay) / cd));
  const str = format(fx.lerp(from, to, k), p.decimals, p.separator !== false);

  const base = ctx.globalAlpha;
  const enter = ease.outCubic(clamp(t / 0.4));
  const exit = clamp((duration - t) / 0.25);
  const alpha = Math.min(clamp(t / 0.2), exit);
  if (alpha <= 0) return;

  const px = Math.max(8, (+p.size || 200) * u);
  setFont(ctx, 400, px, p.font);
  // Tabular digits: every digit gets the same slot so the number doesn't wobble while it rolls.
  let slot = 0;
  for (let d = 0; d <= 9; d++) slot = Math.max(slot, ctx.measureText(String(d)).width);
  const chars = [...str].map((c) => ({ c, w: /\d/.test(c) ? slot : ctx.measureText(c).width }));
  const numW = chars.reduce((a, c) => a + c.w, 0);
  const digitH = ctx.measureText('0').actualBoundingBoxAscent || px * 0.72;

  const isSymbol = (s) => s && !/[A-Za-z0-9]/.test(s);
  const apx = px * 0.56;
  const pre = String(p.prefix ?? ''), suf = String(p.suffix ?? '');
  setFont(ctx, 400, apx, p.font);
  const preW = pre ? ctx.measureText(pre).width + px * 0.03 : 0;
  const sufW = suf ? ctx.measureText(suf).width + px * 0.03 : 0;
  const preH = pre ? ctx.measureText(pre).actualBoundingBoxAscent || apx * 0.72 : 0;
  const sufH = suf ? ctx.measureText(suf).actualBoundingBoxAscent || apx * 0.72 : 0;

  const totalW = preW + numW + sufW;
  const cx = W * (p.x ?? 0.5), cy = H * (p.y ?? 0.3);
  const baseline = cy + digitH / 2;
  const tc = delay + cd;
  const pulse = t > tc && t < tc + 0.32 ? 1 + 0.045 * Math.sin(Math.PI * ((t - tc) / 0.32)) : 1;
  const s = (0.88 + 0.12 * enter) * pulse;

  ctx.save();
  ctx.globalAlpha = base * alpha;
  ctx.translate(cx, cy + (1 - enter) * 24 * u);
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);
  ctx.shadowColor = 'rgba(0,0,0,0.32)';
  ctx.shadowBlur = 30 * u;
  ctx.shadowOffsetY = 6 * u;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';

  let x = cx - totalW / 2;
  const affixColor = p.accent || p.color || '#FFFFFF';
  if (pre) {
    setFont(ctx, 400, apx, p.font);
    ctx.fillStyle = affixColor;
    ctx.textAlign = 'left';
    ctx.fillText(pre, x, isSymbol(pre) ? baseline - digitH + preH : baseline);
    x += preW;
  }
  setFont(ctx, 400, px, p.font);
  ctx.fillStyle = p.color || '#FFFFFF';
  ctx.textAlign = 'center';
  for (const ch of chars) {
    ctx.fillText(ch.c, x + ch.w / 2, baseline);
    x += ch.w;
  }
  if (suf) {
    setFont(ctx, 400, apx, p.font);
    ctx.fillStyle = affixColor;
    ctx.textAlign = 'left';
    ctx.fillText(suf, x + px * 0.03, isSymbol(suf) ? baseline - digitH + sufH : baseline);
  }

  if (p.label) {
    const lk = ease.outCubic(clamp((t - delay - 0.25) / 0.45));
    if (lk > 0) {
      const lpx = px * 0.2;
      setFont(ctx, 700, lpx, p.labelFont || 'Inter', lpx * 0.02);
      ctx.globalAlpha = base * alpha * lk;
      ctx.fillStyle = p.labelColor || 'rgba(255,255,255,0.8)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = 18 * u;
      ctx.fillText(String(p.label), cx, baseline + px * 0.12 + lpx * 0.75 + (1 - lk) * 12 * u);
    }
  }
  ctx.restore();
}
