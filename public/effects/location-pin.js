// A map pin drops in and bounces with a ripple at its tip, then a white label card unfolds beside it.
export const meta = {
  name: 'Location Pin',
  category: 'UI',
  description: 'A map pin that drops onto the frame, with a place name card next to it. Use it when you say where you are or where something happened.',
  props: {
    label: 'Victoria, BC',
    sub: '', // optional second line, e.g. 'Canada' or '2 min away'
    color: '#FF3B30',
    x: 0.5, // the pin's tip
    y: 0.25,
    size: 140, // pin height
    side: 'auto', // 'auto' | 'right' | 'left': which side the card unfolds to
    cardBg: '#FFFFFF',
    textColor: '#111111',
    font: 'Inter',
  },
  presets: {
    'Lime': { color: '#C8FF3D' },
    'Dark card': { cardBg: '#141416', textColor: '#FFFFFF' },
    'With subtitle': { sub: 'Canada' },
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
  const exit = clamp((duration - t) / 0.25);
  if (exit <= 0) return;
  const color = p.color || '#FF3B30';
  const Ph = Math.max(10, (+p.size || 140) * u);
  const R = Ph * 0.36;
  const tipX = W * (p.x ?? 0.5), tipY = H * (p.y ?? 0.25);
  const fall = 380 * u;
  const dk = clamp(t / 0.7);
  const lift = (1 - ease.outBounce(dk)) * fall; // height above the ground
  const base = ctx.globalAlpha;

  ctx.save();
  ctx.globalAlpha = base * exit;

  // Ground shadow sharpens as the pin lands.
  const near = 1 - lift / fall;
  ctx.save();
  ctx.globalAlpha *= 0.32 * near * clamp(t / 0.15);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(tipX, tipY, R * (0.5 + 0.4 * near), R * (0.16 + 0.1 * near), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Ripple from the first touch-down.
  const rk = clamp((t - 0.26) / 0.75);
  if (rk > 0 && rk < 1) {
    const rx = R * (0.6 + 2.4 * ease.outCubic(rk));
    ctx.save();
    ctx.globalAlpha *= 0.55 * (1 - rk);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 3 * u);
    ctx.beginPath();
    ctx.ellipse(tipX, tipY, rx, rx * 0.32, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Pin: a teardrop whose tip is the anchor point.
  const d = Ph - R;
  const a = Math.acos(Math.min(1, R / d));
  const hx = tipX, hy = tipY - lift - d; // head center
  ctx.save();
  ctx.globalAlpha *= clamp(t / 0.1);
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 18 * u;
  ctx.shadowOffsetY = 6 * u;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY - lift);
  ctx.arc(hx, hy, R, Math.PI / 2 + a, Math.PI / 2 - a + Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(hx, hy, R * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Label card unfolds from the pin's side.
  const label = String(p.label ?? '').trim();
  const ck = ease.outCubic(clamp((t - 0.65) / 0.45));
  if (label && ck > 0) {
    const lpx = 44 * u, spx = 32 * u;
    const sub = String(p.sub ?? '').trim();
    setFont(ctx, 700, lpx, p.font, -0.3 * u);
    const lw = ctx.measureText(label).width;
    setFont(ctx, 400, spx, p.font);
    const sw = sub ? ctx.measureText(sub).width : 0;
    const padX = 28 * u, padY = 20 * u;
    const cw = Math.max(lw, sw) + padX * 2;
    const ch = padY * 2 + lpx * 1.15 + (sub ? spx * 1.3 : 0);
    const right = p.side === 'left' ? false : p.side === 'right' ? true : (p.x ?? 0.5) <= 0.62;
    const gap = R + 22 * u;
    const cardX = right ? hx + gap : hx - gap - cw;
    const cardY = hy - ch / 2;

    ctx.save();
    ctx.beginPath();
    if (right) ctx.rect(cardX - 30 * u, cardY - 40 * u, (cw + 30 * u) * ck + 30 * u, ch + 80 * u);
    else ctx.rect(cardX + cw - (cw + 30 * u) * ck, cardY - 40 * u, (cw + 30 * u) * ck + 30 * u, ch + 80 * u);
    ctx.clip();
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 30 * u;
    ctx.shadowOffsetY = 8 * u;
    ctx.fillStyle = p.cardBg || '#FFFFFF';
    fx.roundRect(cardX, cardY, cw, ch, 20 * u);
    ctx.fill();
    ctx.restore();
    const slide = (1 - ck) * 20 * u * (right ? -1 : 1);
    ctx.fillStyle = p.textColor || '#111111';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    setFont(ctx, 700, lpx, p.font, -0.3 * u);
    ctx.fillText(label, cardX + padX + slide, cardY + padY + lpx * 0.6);
    if (sub) {
      setFont(ctx, 400, spx, p.font);
      ctx.globalAlpha *= 0.6;
      ctx.fillText(sub, cardX + padX + slide, cardY + padY + lpx * 1.15 + spx * 0.65);
    }
    ctx.restore();
  }
  ctx.restore();
}
