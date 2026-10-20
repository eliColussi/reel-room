// A screenshot inside a clean desktop browser window (traffic lights, URL pill) that pops in; tall screenshots scroll.
export const meta = {
  name: 'Browser Window',
  category: 'UI',
  description: 'Your screenshot framed in a tidy browser window with the site address on top. Use it to show a website, a tool, or a dashboard.',
  props: {
    url: 'yourproduct.com',
    x: 0.5,
    y: 0.36,
    width: 0.88,
    maxHeight: 0.55, // tallest the page area gets, as a fraction of frame height
    dark: false,
    radius: 22,
    shadow: 40,
    scroll: true, // scroll tall screenshots from top to bottom
    font: 'Inter',
  },
  presets: {
    'Dark': { dark: true },
    'Full width': { width: 0.96, radius: 16 },
  },
  fonts: ['Inter'],
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

function placeholder(ctx, x, y, w, h, dark) {
  ctx.fillStyle = dark ? '#18181B' : '#FFFFFF';
  ctx.fillRect(x, y, w, h);
  const ink = (a) => (dark ? `rgba(255,255,255,${a})` : `rgba(17,17,20,${a})`);
  const block = (bx, by, bw, bh, r, a) => { ctx.fillStyle = ink(a); roundPath(ctx, bx, by, bw, bh, r); ctx.fill(); };
  const m = w * 0.06;
  block(x + m, y + h * 0.08, w * 0.12, w * 0.028, w * 0.014, 0.85);
  for (let i = 0; i < 3; i++) block(x + w - m - (i + 1) * w * 0.1, y + h * 0.08 + w * 0.004, w * 0.07, w * 0.02, w * 0.01, 0.25);
  const hy = y + h * 0.3;
  block(x + m, hy, w * 0.62, w * 0.05, w * 0.012, 0.85);
  block(x + m, hy + w * 0.07, w * 0.44, w * 0.05, w * 0.012, 0.85);
  block(x + m, hy + w * 0.16, w * 0.5, w * 0.022, w * 0.011, 0.25);
  block(x + m, hy + w * 0.2, w * 0.38, w * 0.022, w * 0.011, 0.25);
  block(x + m, hy + w * 0.26, w * 0.18, w * 0.06, w * 0.03, 0.9);
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const dark = !!p.dark;
  const winW = W * clamp(+p.width || 0.88, 0.3, 1);
  const barH = 66 * u;
  const img = (fx.images || []).find(Boolean);
  const maxContent = H * clamp(+p.maxHeight || 0.55, 0.1, 0.9);
  const natural = img && img.width && img.height ? (winW * img.height) / img.width : winW / 1.6;
  const contentH = Math.min(natural, maxContent);
  const winH = barH + contentH;
  const r = Math.max(0, +p.radius >= 0 ? +p.radius : 22) * u;

  const k = clamp(t / 0.5);
  const exitK = clamp((duration - t) / 0.25);
  if (exitK <= 0) return;
  const s = fx.lerp(0.88, 1, ease.outBack(k)) * fx.lerp(0.97, 1, exitK);
  const cx = W * (p.x ?? 0.5), cy = H * (p.y ?? 0.36);

  const base = ctx.globalAlpha;
  ctx.save();
  ctx.globalAlpha = base * clamp(k * 3) * exitK;
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  const x0 = -winW / 2, y0 = -winH / 2;

  // Window with shadow
  const sh0 = Math.max(0, +p.shadow >= 0 ? +p.shadow : 40) * u;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = sh0;
  ctx.shadowOffsetY = sh0 * 0.4;
  ctx.fillStyle = dark ? '#232327' : '#ECECEF';
  roundPath(ctx, x0, y0, winW, winH, r);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundPath(ctx, x0, y0, winW, winH, r);
  ctx.clip();
  // Page
  const py = y0 + barH;
  if (img && img.width && img.height) {
    if (p.scroll !== false && natural > contentH * 1.05) {
      const span = Math.max(0.5, duration - 1.8);
      const sk = ease.inOutCubic(clamp((t - 0.9) / span));
      ctx.drawImage(img, x0, py - (natural - contentH) * sk, winW, natural);
    } else {
      fx.cover(img, x0, py, winW, contentH);
    }
  } else {
    placeholder(ctx, x0, py, winW, contentH, dark);
  }
  // Bar
  ctx.fillStyle = dark ? '#2B2B30' : '#ECECEF';
  ctx.fillRect(x0, y0, winW, barH);
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  ctx.fillRect(x0, py - Math.max(1, u), winW, Math.max(1, u));
  ctx.restore();

  // Traffic lights
  const lr = 9.5 * u;
  ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x0 + 30 * u + i * 30 * u, y0 + barH / 2, lr, 0, Math.PI * 2);
    ctx.fill();
  });

  // URL pill with a small padlock
  const url = String(p.url ?? '').replace(/^https?:\/\//, '');
  if (url) {
    const fpx = 25 * u;
    ctx.font = `400 ${fpx}px "${String(p.font || 'Inter').replace(/"/g, '')}", system-ui, sans-serif`;
    try { ctx.letterSpacing = '0px'; } catch (e) { /* older canvas */ }
    const lock = 16 * u;
    const tw = ctx.measureText(url).width;
    const pillH = 42 * u;
    const maxPill = winW - (30 * u + 90 * u) * 2;
    const pw = Math.max(Math.min(winW * 0.5, maxPill), Math.min(maxPill, tw + lock + 60 * u));
    const px0 = -pw / 2, py0 = y0 + (barH - pillH) / 2;
    ctx.fillStyle = dark ? '#1C1C1F' : '#FFFFFF';
    roundPath(ctx, px0, py0, pw, pillH, pillH / 2);
    ctx.fill();
    const fg = dark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,20,0.66)';
    const groupW = Math.min(tw, pw - lock - 50 * u) + lock + 10 * u;
    let lx = -groupW / 2;
    const ly = py0 + pillH / 2;
    // padlock
    ctx.strokeStyle = fg;
    ctx.fillStyle = fg;
    ctx.lineWidth = Math.max(1, 2 * u);
    ctx.beginPath();
    ctx.arc(lx + lock / 2, ly - lock * 0.1, lock * 0.27, Math.PI, 0);
    ctx.stroke();
    roundPath(ctx, lx + lock * 0.12, ly - lock * 0.1, lock * 0.76, lock * 0.6, lock * 0.1);
    ctx.fill();
    lx += lock + 10 * u;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(url, lx, ly + 1 * u, pw - lock - 50 * u);
  }
  ctx.restore();
}
