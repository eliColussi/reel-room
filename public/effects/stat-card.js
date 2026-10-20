// A frosted-glass stat card: a big number counts up, a label sits under it, and a green-up or red-down delta pill pops in.
export const meta = {
  name: 'Stat Card',
  category: 'Explainer',
  description: 'A frosted card with one big stat, a short label, and an optional up/down change pill. Use it to show a result like "$12k saved every month".',
  props: {
    value: '$12k',
    label: 'saved every month',
    delta: '+38%', // '' = no pill. Starts with + or ↑ = green, - or ↓ = red
    accent: '#C8FF3D', // pill color when the delta has no sign
    up: '#34C759',
    down: '#FF453A',
    bg: 'rgba(18,18,20,0.72)',
    color: '#FFFFFF',
    frost: true, // blur the video behind the card
    x: 0.5,
    y: 0.28,
    width: 0.72,
    size: 150, // stat size
    font: 'Inter',
    radius: 36,
    count: true, // count the number up
  },
  presets: {
    'Light': { bg: 'rgba(250,250,247,0.8)', color: '#111111' },
    'Down': { value: '2.4s', label: 'average load time', delta: '-61%', down: '#34C759' },
    'No delta': { delta: '' },
  },
  fonts: ['Inter'],
  duration: 3.5,
};

function setFont(ctx, weight, px, family, spacing = 0) {
  ctx.font = `${weight} ${Math.max(1, px)}px "${String(family || 'Inter').replace(/"/g, '')}", system-ui, sans-serif`;
  try { ctx.letterSpacing = `${spacing}px`; } catch (e) { /* older canvas */ }
}

// Blurred copy of the video behind a rounded box (absolute output coordinates).
function frost(ctx, fx, x, y, w, h, r) {
  const v = typeof fx.video === 'function' ? fx.video() : null;
  if (!v || w < 2 || h < 2) return false;
  const m = 32 * fx.u, k = 1 / 8;
  const sw = Math.max(4, Math.ceil((w + m * 2) * k)), sh = Math.max(4, Math.ceil((h + m * 2) * k));
  const c = fx.canvas('frost', sw, sh);
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, sw, sh);
  g.filter = 'blur(2.5px) saturate(1.3)';
  g.drawImage(v, x - m, y - m, w + m * 2, h + m * 2, 0, 0, sw, sh);
  g.filter = 'none';
  ctx.save();
  fx.roundRect(x, y, w, h, r);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, x - m, y - m, w + m * 2, h + m * 2);
  ctx.restore();
  return true;
}

// Rounded-rect subpath without beginPath, so it can be combined with other shapes.
function roundPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function parseStat(s) {
  const m = /^(\D*?)(-?[\d,]*\.?\d+)(.*)$/.exec(String(s ?? ''));
  if (!m) return null;
  const n = +m[2].replace(/,/g, '');
  if (!Number.isFinite(n)) return null;
  return { pre: m[1], n, post: m[3], dec: (m[2].split('.')[1] || '').length, commas: m[2].includes(',') };
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const color = p.color || '#FFFFFF';
  const cardW = W * clamp(+p.width || 0.72, 0.3, 1);
  const pad = 56 * u;

  // Delta pill
  const delta = String(p.delta ?? '').trim();
  const sign = /^[+↑▲]/.test(delta) ? 1 : /^[-−↓▼]/.test(delta) ? -1 : 0;
  const dText = delta.replace(/^[↑↓▲▼]\s*/, '');
  const dpx = 36 * u;
  setFont(ctx, 700, dpx, p.font);
  const arrow = sign ? dpx * 0.62 : 0;
  const pillH = dpx * 1.75;
  const pillW = delta ? ctx.measureText(dText).width + pillH * 0.7 + (arrow ? arrow + dpx * 0.35 : 0) : 0;

  // Value, shrunk to fit beside the pill.
  let vpx = Math.max(8, (+p.size || 150) * u);
  const stat = parseStat(p.value);
  const fullText = String(p.value ?? '');
  setFont(ctx, 800, vpx, p.font, -vpx * 0.035);
  const room = cardW - pad * 2 - (delta ? pillW + 24 * u : 0);
  const fullW = ctx.measureText(fullText).width;
  if (fullW > room) vpx *= room / fullW;
  setFont(ctx, 800, vpx, p.font, -vpx * 0.035);
  const capH = ctx.measureText('0').actualBoundingBoxAscent || vpx * 0.72;

  const lpx = 40 * u;
  const lh = lpx * 1.3;
  const cardH = pad + capH + (p.label ? vpx * 0.3 + lh : 0) + pad * 1.05;
  const cardX = W * (p.x ?? 0.5) - cardW / 2;

  const base = ctx.globalAlpha;
  const enter = ease.outCubic(clamp(t / 0.45));
  const exit = clamp((duration - t) / 0.25);
  const alpha = Math.min(clamp(t / 0.25), exit);
  if (alpha <= 0) return;
  const cardY = H * (p.y ?? 0.28) - cardH / 2 + (1 - enter) * 40 * u + (1 - exit) * 16 * u;
  const radius = (+p.radius >= 0 ? +p.radius : 36) * u;

  ctx.save();
  ctx.globalAlpha = base * alpha;
  // Soft shadow kept outside the card, then frosted video, tint, hairline.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-W, -H, W * 3, H * 3);
  roundPath(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.clip('evenodd');
  ctx.shadowColor = 'rgba(0,0,0,0.32)';
  ctx.shadowBlur = 50 * u;
  ctx.shadowOffsetY = 16 * u;
  ctx.fillStyle = '#000';
  fx.roundRect(cardX, cardY, cardW, cardH, radius);
  ctx.fill();
  ctx.restore();
  if (p.frost !== false) frost(ctx, fx, cardX, cardY, cardW, cardH, radius);
  ctx.fillStyle = p.bg || 'rgba(18,18,20,0.72)';
  fx.roundRect(cardX, cardY, cardW, cardH, radius);
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = Math.max(1, 1.5 * u);
  fx.roundRect(cardX + 0.75 * u, cardY + 0.75 * u, cardW - 1.5 * u, cardH - 1.5 * u, radius);
  ctx.stroke();
  ctx.restore();

  // Value counts up.
  const ck = p.count === false ? 1 : ease.outCubic(clamp((t - 0.2) / 1));
  let shown = fullText;
  if (stat && ck < 1) {
    let num = (stat.n * ck).toFixed(stat.dec);
    if (stat.commas) num = num.replace(/^(-?\d+)/, (d) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    shown = stat.pre + num + stat.post;
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(shown, cardX + pad, cardY + pad + capH);

  if (p.label) {
    const lk = ease.outCubic(clamp((t - 0.35) / 0.4));
    ctx.save();
    ctx.globalAlpha *= 0.7 * lk;
    setFont(ctx, 400, lpx, p.font);
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.label), cardX + pad, cardY + pad + capH + vpx * 0.3 + lh / 2 + (1 - lk) * 8 * u);
    ctx.restore();
  }

  if (delta) {
    const pk = clamp((t - 0.55) / 0.4);
    if (pk > 0) {
      const pc = sign > 0 ? p.up || '#34C759' : sign < 0 ? p.down || '#FF453A' : p.accent || '#C8FF3D';
      const px0 = cardX + cardW - pad - pillW;
      const py0 = cardY + pad + capH / 2 - pillH / 2;
      const s = ease.outBack(pk);
      ctx.save();
      ctx.translate(px0 + pillW / 2, py0 + pillH / 2);
      ctx.scale(s, s);
      ctx.translate(-(px0 + pillW / 2), -(py0 + pillH / 2));
      ctx.save();
      ctx.globalAlpha *= 0.18;
      ctx.fillStyle = pc;
      fx.roundRect(px0, py0, pillW, pillH, pillH / 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = pc;
      let tx = px0 + pillH * 0.35;
      if (arrow) {
        const ay = py0 + pillH / 2;
        ctx.beginPath();
        if (sign > 0) { ctx.moveTo(tx, ay + arrow * 0.42); ctx.lineTo(tx + arrow, ay + arrow * 0.42); ctx.lineTo(tx + arrow / 2, ay - arrow * 0.45); }
        else { ctx.moveTo(tx, ay - arrow * 0.42); ctx.lineTo(tx + arrow, ay - arrow * 0.42); ctx.lineTo(tx + arrow / 2, ay + arrow * 0.45); }
        ctx.closePath();
        ctx.fill();
        tx += arrow + dpx * 0.35;
      }
      setFont(ctx, 700, dpx, p.font);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(dText, tx, py0 + pillH / 2 + 1 * u);
      ctx.restore();
    }
  }
  ctx.restore();
}
