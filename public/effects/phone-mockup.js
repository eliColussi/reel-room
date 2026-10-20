// A screenshot inside a minimal modern phone (thin bezel, dynamic-island pill) that slides up with a slight tilt and soft shadow.
export const meta = {
  name: 'Phone Mockup',
  category: 'UI',
  description: 'Your screenshot inside a clean phone frame that slides up into view; tall screenshots scroll. Use it to show an app, a post, or a DM.',
  props: {
    x: 0.5,
    y: 0.42,
    height: 0.55, // phone height as a fraction of frame height
    tilt: -4, // degrees
    color: '#1C1C1E', // phone body
    shadow: 40,
    scroll: true, // scroll tall screenshots from top to bottom
  },
  presets: {
    'Straight': { tilt: 0 },
    'Silver': { color: '#D9D9DE' },
    'Big': { height: 0.7, y: 0.5 },
  },
  fonts: [],
  duration: 4,
};

function roundPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A quiet app-like skeleton for when no screenshot was given.
function placeholder(ctx, x, y, w, h) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, '#2A2A2E');
  g.addColorStop(1, '#161618');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const m = w * 0.08;
  const block = (bx, by, bw, bh, r, a) => { ctx.fillStyle = `rgba(255,255,255,${a})`; roundPath(ctx, bx, by, bw, bh, r); ctx.fill(); };
  let yy = y + h * 0.1;
  block(x + m, yy, w * 0.42, w * 0.07, w * 0.02, 0.22);
  yy += w * 0.14;
  block(x + m, yy, w - m * 2, w * 0.62, w * 0.05, 0.08);
  yy += w * 0.7;
  for (let i = 0; i < 4 && yy + w * 0.14 < y + h - m; i++) {
    block(x + m, yy, w * 0.12, w * 0.12, w * 0.06, 0.12);
    block(x + m + w * 0.17, yy + w * 0.015, w * 0.45, w * 0.035, w * 0.015, 0.14);
    block(x + m + w * 0.17, yy + w * 0.07, w * 0.3, w * 0.03, w * 0.015, 0.08);
    yy += w * 0.19;
  }
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  let bodyH = H * clamp(+p.height || 0.55, 0.1, 1);
  let bodyW = bodyH * 0.49;
  if (bodyW > W * 0.9) { bodyW = W * 0.9; bodyH = bodyW / 0.49; }
  const bezel = bodyW * 0.034;
  const R = bodyW * 0.155;
  const sx = -bodyW / 2 + bezel, sy = -bodyH / 2 + bezel;
  const sw = bodyW - bezel * 2, sh = bodyH - bezel * 2;
  const sr = R - bezel;

  const enter = ease.outCubic(clamp(t / 0.65));
  const exitK = clamp((duration - t) / 0.3);
  if (exitK <= 0) return;
  const leave = ease.inCubic(1 - exitK);
  const tilt = ((Number.isFinite(+p.tilt) ? +p.tilt : -4) + (1 - enter) * 9) * (Math.PI / 180);
  const cx = W * (p.x ?? 0.5);
  const cy = H * (p.y ?? 0.42) + (1 - enter) * H * 0.32 + leave * H * 0.3;

  const base = ctx.globalAlpha;
  ctx.save();
  ctx.globalAlpha = base * clamp(t / 0.2) * clamp(exitK * 1.5);
  ctx.translate(cx, cy);
  ctx.rotate(tilt);

  const body = p.color || '#1C1C1E';
  // Side buttons, tucked just outside the body edge.
  ctx.fillStyle = body;
  const btn = (bx, by, bh) => { roundPath(ctx, bx, by, 5 * u, bh, 2.5 * u); ctx.fill(); };
  btn(-bodyW / 2 - 3.5 * u, -bodyH * 0.3, bodyH * 0.045);
  btn(-bodyW / 2 - 3.5 * u, -bodyH * 0.22, bodyH * 0.08);
  btn(-bodyW / 2 - 3.5 * u, -bodyH * 0.12, bodyH * 0.08);
  btn(bodyW / 2 - 1.5 * u, -bodyH * 0.2, bodyH * 0.12);

  // Body with shadow
  const sh0 = Math.max(0, +p.shadow >= 0 ? +p.shadow : 40) * u;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = sh0;
  ctx.shadowOffsetY = sh0 * 0.45;
  ctx.fillStyle = body;
  roundPath(ctx, -bodyW / 2, -bodyH / 2, bodyW, bodyH, R);
  ctx.fill();
  ctx.restore();
  // Edge highlight
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = Math.max(1, 2 * u);
  roundPath(ctx, -bodyW / 2 + 1 * u, -bodyH / 2 + 1 * u, bodyW - 2 * u, bodyH - 2 * u, R - 1 * u);
  ctx.stroke();
  ctx.restore();

  // Screen
  ctx.save();
  roundPath(ctx, sx, sy, sw, sh, sr);
  ctx.clip();
  ctx.fillStyle = '#000';
  ctx.fillRect(sx, sy, sw, sh);
  const img = (fx.images || []).find(Boolean);
  if (img && img.width && img.height) {
    const dh = (img.height / img.width) * sw;
    if (p.scroll !== false && dh > sh * 1.05) {
      const span = Math.max(0.5, duration - 1.8);
      const k = ease.inOutCubic(clamp((t - 0.9) / span));
      ctx.drawImage(img, sx, sy - (dh - sh) * k, sw, dh);
    } else {
      fx.cover(img, sx, sy, sw, sh);
    }
  } else {
    placeholder(ctx, sx, sy, sw, sh);
  }
  // Glass glare
  const gl = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh * 0.6);
  gl.addColorStop(0, 'rgba(255,255,255,0.09)');
  gl.addColorStop(0.45, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl;
  ctx.fillRect(sx, sy, sw, sh);
  ctx.restore();

  // Dynamic island
  const iw = sw * 0.3, ih = sw * 0.085;
  ctx.fillStyle = '#000';
  roundPath(ctx, -iw / 2, sy + sw * 0.035, iw, ih, ih / 2);
  ctx.fill();

  ctx.restore();
}
