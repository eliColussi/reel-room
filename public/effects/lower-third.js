// A name-and-title lower third: an accent bar draws in, a dark panel wipes open, the name slides in, the title follows.
export const meta = {
  name: 'Lower Third',
  category: 'Brand',
  description: 'Your name and what you do in a clean bar near the bottom of the frame. Use it in the first seconds so new viewers know who is talking.',
  props: {
    name: 'Your Name',
    title: 'What you do',
    accent: '#C8FF3D',
    color: '#FFFFFF',
    bg: 'rgba(10,10,12,0.72)', // null = no panel
    x: 0.08, // left edge
    y: 0.78, // vertical center
    font: 'Inter',
    size: 56, // name size; the title scales with it
    radius: 14,
  },
  presets: {
    'Light': { bg: 'rgba(250,250,247,0.92)', color: '#111111', accent: '#111111' },
    'No panel': { bg: null },
    'Top left': { y: 0.12 },
  },
  fonts: ['Inter'],
  duration: 4,
};

function setFont(ctx, weight, px, family, spacing = 0) {
  ctx.font = `${weight} ${Math.max(1, px)}px "${String(family || 'Inter').replace(/"/g, '')}", system-ui, sans-serif`;
  try { ctx.letterSpacing = `${spacing}px`; } catch (e) { /* older canvas */ }
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const npx = Math.max(6, (+p.size || 56) * u);
  const tpx = npx * 0.6;
  const name = String(p.name ?? '');
  const title = String(p.title ?? '');
  if (!name && !title) return;

  setFont(ctx, 800, npx, p.font, -0.5 * u);
  const nameW = ctx.measureText(name).width;
  setFont(ctx, 400, tpx, p.font, 0.2 * u);
  const titleW = title ? ctx.measureText(title).width : 0;

  const padX = npx * 0.55, padY = npx * 0.42;
  const gap = title ? npx * 0.22 : 0;
  const nameH = npx * 1.05, titleH = title ? tpx * 1.2 : 0;
  const panelH = padY * 2 + nameH + gap + titleH;
  const panelW = Math.min(W * 0.9, Math.max(nameW, titleW) + padX * 2);
  const barW = Math.max(4, 8 * u);
  const left = W * (p.x ?? 0.08);
  const top = H * (p.y ?? 0.78) - panelH / 2;
  const panelX = left + barW + 10 * u;

  const base = ctx.globalAlpha;
  const out = clamp((duration - t) / 0.35); // 1 → 0 while leaving
  if (out <= 0) return;
  const outE = ease.outCubic(out);

  // 1. Accent bar grows from its center.
  const barK = ease.outCubic(clamp(t / 0.3)) * (out < 1 ? clamp(out * 2.5) : 1);
  if (barK > 0) {
    ctx.globalAlpha = base;
    ctx.fillStyle = p.accent || '#C8FF3D';
    const bh = panelH * barK;
    fx.roundRect(left, top + (panelH - bh) / 2, barW, bh, barW / 2);
    ctx.fill();
  }

  // 2. Panel wipes open from the bar (and closes back into it on exit).
  const wipe = ease.outCubic(clamp((t - 0.12) / 0.45)) * outE;
  if (wipe <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(panelX - 2 * u, top - 40 * u, panelW * wipe + 4 * u, panelH + 80 * u);
  ctx.clip();
  if (p.bg) {
    ctx.save();
    ctx.globalAlpha = base;
    ctx.shadowColor = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur = 30 * u;
    ctx.shadowOffsetY = 8 * u;
    ctx.fillStyle = p.bg;
    fx.roundRect(panelX, top, panelW, panelH, (+p.radius >= 0 ? +p.radius : 14) * u);
    ctx.fill();
    ctx.restore();
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  if (!p.bg) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 16 * u;
    ctx.shadowOffsetY = 3 * u;
  }
  // 3. Name slides in.
  const nk = ease.outCubic(clamp((t - 0.22) / 0.45));
  if (nk > 0) {
    ctx.globalAlpha = base * nk;
    ctx.fillStyle = p.color || '#FFFFFF';
    setFont(ctx, 800, npx, p.font, -0.5 * u);
    ctx.fillText(name, panelX + padX - (1 - nk) * 40 * u, top + padY + nameH / 2);
  }
  // 4. Title fades up after.
  const tk = ease.outCubic(clamp((t - 0.45) / 0.4));
  if (title && tk > 0) {
    ctx.globalAlpha = base * tk * 0.72;
    ctx.fillStyle = p.color || '#FFFFFF';
    setFont(ctx, 400, tpx, p.font, 0.2 * u);
    ctx.fillText(title, panelX + padX, top + padY + nameH + gap + titleH / 2 + (1 - tk) * 10 * u);
  }
  ctx.restore();
}
