// An iMessage-style conversation: bubbles pop in one by one, yours on the right in blue, theirs on the left in gray, with typing dots first.
export const meta = {
  name: 'Chat Bubbles',
  category: 'UI',
  description: 'A text conversation that plays out bubble by bubble, with typing dots before each reply. Use it to act out a DM, a client message, or a punchline.',
  props: {
    messages: [{ from: 'them', text: 'Did it work?' }, { from: 'me', text: 'First try.' }],
    every: 0.9, // seconds between messages
    times: null, // e.g. [0.4, 2.1]: seconds from start for each message, overrides `every`
    start: 0.3,
    x: 0.5,
    y: 0.25, // top of the stack
    width: 0.86,
    me: '#0A84FF',
    them: '#E9E9EB',
    meText: '#FFFFFF',
    themText: '#111111',
    font: 'Inter',
    size: 46,
    typing: true, // typing dots before each 'them' message
  },
  presets: {
    'Dark': { them: '#2C2C2E', themText: '#FFFFFF' },
    'Green (SMS)': { me: '#34C759' },
    'Lime': { me: '#C8FF3D', meText: '#111111' },
  },
  fonts: ['Inter'],
  duration: 4,
};

function setFont(ctx, weight, px, family) {
  ctx.font = `${weight} ${Math.max(1, px)}px "${String(family || 'Inter').replace(/"/g, '')}", -apple-system, system-ui, sans-serif`;
  try { ctx.letterSpacing = '0px'; } catch (e) { /* older canvas */ }
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxW) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}

// Rounded rect subpath (clockwise, no beginPath) so the tail can join it in one fill.
function roundPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// iMessage tail at the bottom corner. Same winding as the bubble so the overlap fills solid.
function tailPath(ctx, x, y, w, h, right, s) {
  const B = y + h;
  if (right) {
    const R = x + w;
    ctx.moveTo(R - 2 * s, B - 22 * s);
    ctx.quadraticCurveTo(R - 1 * s, B - 4 * s, R + 11 * s, B + 1 * s);
    ctx.quadraticCurveTo(R - 5 * s, B + 3 * s, R - 22 * s, B - 2 * s);
  } else {
    const L = x;
    ctx.moveTo(L + 22 * s, B - 2 * s);
    ctx.quadraticCurveTo(L + 5 * s, B + 3 * s, L - 11 * s, B + 1 * s);
    ctx.quadraticCurveTo(L + 1 * s, B - 4 * s, L + 2 * s, B - 22 * s);
  }
  ctx.closePath();
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const msgs = (Array.isArray(p.messages) ? p.messages : [])
    .map((m) => (typeof m === 'string' ? { from: 'me', text: m } : { from: String(m?.from || 'me').toLowerCase() === 'them' ? 'them' : 'me', text: String(m?.text ?? '') }))
    .filter((m) => m.text);
  if (!msgs.length) return;

  const px = Math.max(6, (+p.size || 46) * u);
  const s = px / 46;
  const colW = W * clamp(+p.width || 0.86, 0.3, 1);
  const left = W * (p.x ?? 0.5) - colW / 2;
  const maxBW = colW * 0.74;
  const padX = px * 0.62, padY = px * 0.4;
  const lh = px * 1.28;
  const every = +p.every > 0 ? +p.every : 0.9;
  const typingDur = p.typing === false ? 0 : Math.min(0.9, every * 0.75);
  const times = Array.isArray(p.times) ? p.times : null;

  // Layout and schedule.
  setFont(ctx, 400, px, p.font);
  let y = H * (p.y ?? 0.25);
  let cursor = +p.start >= 0 ? +p.start : 0.3;
  const items = msgs.map((m, i) => {
    const lines = wrap(ctx, m.text, maxBW - padX * 2);
    const w = Math.max(px * 1.4, ...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
    const h = lines.length * lh + padY * 2;
    const prev = msgs[i - 1];
    if (i > 0) y += prev.from === m.from ? 6 * u : 22 * u;
    const right = m.from === 'me';
    const item = { ...m, lines, w, h, x: right ? left + colW - w : left, y, right, tail: !msgs[i + 1] || msgs[i + 1].from !== m.from };
    y += h;
    const typed = !right && typingDur > 0;
    if (times && Number.isFinite(+times[i])) {
      item.show = +times[i];
      item.typeAt = typed ? Math.max(0, item.show - typingDur) : item.show;
    } else {
      item.typeAt = cursor;
      if (typed) cursor += typingDur;
      item.show = cursor;
      cursor += every;
    }
    return item;
  });

  const base = ctx.globalAlpha;
  const exit = clamp((duration - t) / 0.25);
  if (exit <= 0) return;
  ctx.save();
  ctx.globalAlpha = base * exit;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const radius = Math.min(px * 1.0, 48 * u);

  const pop = (x0, y0, k, right, h, w, paint) => {
    const sc = fx.lerp(0.5, 1, ease.outBack(k));
    const ox = right ? x0 + w : x0, oy = y0 + h;
    ctx.save();
    ctx.globalAlpha *= clamp(k * 4);
    ctx.translate(ox, oy);
    ctx.scale(sc, sc);
    ctx.translate(-ox, -oy);
    paint();
    ctx.restore();
  };

  for (const it of items) {
    // Typing dots in the slot the reply will take.
    if (!it.right && it.typeAt < it.show && t >= it.typeAt && t < it.show) {
      const tw = px * 2.5, th = lh + padY * 2;
      const k = clamp((t - it.typeAt) / 0.3);
      pop(it.x, it.y, k, false, th, tw, () => {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.16)';
        ctx.shadowBlur = 18 * u;
        ctx.shadowOffsetY = 4 * u;
        ctx.fillStyle = p.them || '#E9E9EB';
        ctx.beginPath();
        roundPath(ctx, it.x, it.y, tw, th, radius);
        tailPath(ctx, it.x, it.y, tw, th, false, s);
        ctx.fill();
        ctx.restore();
        for (let j = 0; j < 3; j++) {
          const wave = 0.5 + 0.5 * Math.sin((t - it.typeAt) * 9 - j * 0.9);
          ctx.save();
          ctx.globalAlpha *= 0.35 + 0.55 * wave;
          ctx.fillStyle = p.themText || '#111111';
          ctx.beginPath();
          ctx.arc(it.x + tw / 2 + (j - 1) * px * 0.42, it.y + th / 2 - wave * 3 * u, px * 0.13, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
    if (t < it.show) continue;
    const k = clamp((t - it.show) / 0.35);
    pop(it.x, it.y, k, it.right, it.h, it.w, () => {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.16)';
      ctx.shadowBlur = 18 * u;
      ctx.shadowOffsetY = 4 * u;
      ctx.fillStyle = it.right ? p.me || '#0A84FF' : p.them || '#E9E9EB';
      ctx.beginPath();
      roundPath(ctx, it.x, it.y, it.w, it.h, radius);
      if (it.tail) tailPath(ctx, it.x, it.y, it.w, it.h, it.right, s);
      ctx.fill();
      ctx.restore();
      setFont(ctx, 400, px, p.font);
      ctx.fillStyle = it.right ? p.meText || '#FFFFFF' : p.themText || '#111111';
      it.lines.forEach((ln, li) => ctx.fillText(ln, it.x + padX, it.y + padY + li * lh + lh / 2));
    });
  }
  ctx.restore();
}
