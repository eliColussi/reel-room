// An iOS-style notification banner springs down from the top of the frame: frosted glass, app icon, app name, time, bold title, two-line body.
export const meta = {
  name: 'Notification',
  category: 'UI',
  description: 'A phone notification that drops in from the top, like a text or a payment alert. Use it for "you just got a sale" moments or a message reveal.',
  props: {
    app: 'Messages',
    icon: '💬', // an emoji; empty = the app's first letter
    iconBg: '#34C759',
    title: 'New message',
    body: 'You should see this',
    time: 'now',
    x: 0.5,
    y: 0.1, // top edge of the banner
    dark: true,
    width: 0.9,
    frost: true, // blur the video behind the banner
    font: 'Inter',
    radius: 54,
  },
  presets: {
    'Payment': { app: 'Stripe', icon: '💸', iconBg: '#635BFF', title: 'Payment received', body: '$2,500.00 from a new client' },
    'Email': { app: 'Mail', icon: '✉️', iconBg: '#0A84FF', title: 'Re: your proposal', body: 'Let’s do it. When can you start?' },
    'Light': { dark: false },
  },
  fonts: ['Inter'],
  duration: 3,
};

function setFont(ctx, weight, px, family, spacing = 0) {
  ctx.font = `${weight} ${Math.max(1, px)}px "${String(family || 'Inter').replace(/"/g, '')}", -apple-system, system-ui, sans-serif`;
  try { ctx.letterSpacing = `${spacing}px`; } catch (e) { /* older canvas */ }
}

function wrap(ctx, text, maxW, maxLines) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (line && ctx.measureText(test).width > maxW) {
      out.push(line);
      line = words[i];
      if (out.length === maxLines) { line = ''; out[maxLines - 1] += ` ${words.slice(i).join(' ')}`; break; }
    } else line = test;
  }
  if (line) out.push(line);
  if (out.length > maxLines) out.length = maxLines;
  // Ellipsize the last line if it overflows.
  const last = out.length - 1;
  if (last >= 0 && ctx.measureText(out[last]).width > maxW) {
    let s = out[last];
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
    out[last] = `${s.trimEnd()}…`;
  }
  return out;
}

function frost(ctx, fx, x, y, w, h, r) {
  const v = typeof fx.video === 'function' ? fx.video() : null;
  if (!v || w < 2 || h < 2) return;
  const m = 32 * fx.u, k = 1 / 8;
  const sw = Math.max(4, Math.ceil((w + m * 2) * k)), sh = Math.max(4, Math.ceil((h + m * 2) * k));
  const c = fx.canvas('frost', sw, sh);
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, sw, sh);
  g.filter = 'blur(2.5px) saturate(1.4)';
  g.drawImage(v, x - m, y - m, w + m * 2, h + m * 2, 0, 0, sw, sh);
  g.filter = 'none';
  ctx.save();
  fx.roundRect(x, y, w, h, r);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, x - m, y - m, w + m * 2, h + m * 2);
  ctx.restore();
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, clamp } = fx;
  const dark = p.dark !== false;
  const fg = dark ? '#FFFFFF' : '#000000';
  const cardW = W * clamp(+p.width || 0.9, 0.4, 1);
  const pad = 34 * u;
  const icon = 96 * u;
  const hpx = 28 * u, tpx = 40 * u, bpx = 38 * u;
  const blh = bpx * 1.28;
  const textX = pad + icon + 26 * u;
  const textW = cardW - textX - pad;

  setFont(ctx, 400, bpx, p.font);
  const body = wrap(ctx, p.body, textW, 2);
  const cardH = Math.max(icon + pad * 2, pad * 0.9 + hpx * 1.3 + 4 * u + tpx * 1.25 + body.length * blh + pad * 0.9);
  const cardX = W * (p.x ?? 0.5) - cardW / 2;
  const restY = H * (p.y ?? 0.1);

  // Spring down on enter, slide back up on exit.
  const travel = restY + cardH + 40 * u;
  const k = clamp(t / 0.75);
  const spring = k >= 1 ? 1 : 1 - Math.exp(-9 * k) * Math.cos(8 * k);
  const exitK = clamp((duration - t) / 0.3);
  if (exitK <= 0) return;
  const up = 1 - exitK;
  const cardY = restY - travel * (1 - spring) - travel * up * up * up;
  const radius = Math.min(cardH / 2, (+p.radius >= 0 ? +p.radius : 54) * u);

  const base = ctx.globalAlpha;
  ctx.save();
  ctx.globalAlpha = base * clamp(t / 0.15);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 44 * u;
  ctx.shadowOffsetY = 14 * u;
  ctx.fillStyle = dark ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)';
  fx.roundRect(cardX, cardY, cardW, cardH, radius);
  ctx.fill();
  ctx.restore();
  if (p.frost !== false) frost(ctx, fx, cardX, cardY, cardW, cardH, radius);
  ctx.fillStyle = dark ? 'rgba(30,30,32,0.72)' : 'rgba(246,246,248,0.8)';
  fx.roundRect(cardX, cardY, cardW, cardH, radius);
  ctx.fill();
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
  ctx.lineWidth = Math.max(1, 1.5 * u);
  fx.roundRect(cardX + 0.75 * u, cardY + 0.75 * u, cardW - 1.5 * u, cardH - 1.5 * u, radius);
  ctx.stroke();

  // App icon
  const ix = cardX + pad, iy = cardY + (cardH - icon) / 2;
  ctx.fillStyle = p.iconBg || '#34C759';
  fx.roundRect(ix, iy, icon, icon, icon * 0.24);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const glyph = String(p.icon ?? '').trim();
  if (glyph) {
    ctx.font = `${Math.round(icon * 0.56)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    try { ctx.letterSpacing = '0px'; } catch (e) { /* older canvas */ }
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(glyph, ix + icon / 2, iy + icon / 2 + icon * 0.03);
  } else {
    setFont(ctx, 700, icon * 0.46, p.font);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(String(p.app || '?').trim().charAt(0).toUpperCase(), ix + icon / 2, iy + icon / 2 + icon * 0.02);
  }

  // Text
  const tx = cardX + textX;
  let y = cardY + pad * 0.9;
  ctx.textAlign = 'left';
  ctx.fillStyle = fg;
  setFont(ctx, 400, hpx, p.font, 0.3 * u);
  ctx.save();
  ctx.globalAlpha *= 0.55;
  ctx.fillText(String(p.app ?? '').toUpperCase(), tx, y + hpx * 0.65);
  if (p.time) {
    ctx.textAlign = 'right';
    ctx.fillText(String(p.time), cardX + cardW - pad, y + hpx * 0.65);
  }
  ctx.restore();
  y += hpx * 1.3 + 4 * u;
  setFont(ctx, 700, tpx, p.font, -0.2 * u);
  ctx.textAlign = 'left';
  let title = String(p.title ?? '');
  if (ctx.measureText(title).width > textW) {
    while (title.length > 1 && ctx.measureText(`${title}…`).width > textW) title = title.slice(0, -1);
    title = `${title.trimEnd()}…`;
  }
  ctx.fillText(title, tx, y + tpx * 0.62);
  y += tpx * 1.25;
  setFont(ctx, 400, bpx, p.font);
  ctx.save();
  ctx.globalAlpha *= 0.9;
  body.forEach((ln, i) => ctx.fillText(ln, tx, y + i * blh + blh / 2));
  ctx.restore();
  ctx.restore();
}
