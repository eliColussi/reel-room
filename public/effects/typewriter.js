// Text types itself out character by character in a mono font, with a blinking caret, on a soft dark box.
export const meta = {
  name: 'Typewriter',
  category: 'Text',
  description: 'Text types itself out letter by letter with a blinking cursor. Use it for prompts, searches, code, or a line you want people to read along with.',
  props: {
    text: 'Type anything here',
    font: 'JetBrains Mono',
    weight: 400,
    size: 64,
    color: '#FFFFFF',
    background: 'rgba(0,0,0,0.55)', // null = no box
    radius: 18,
    cps: 18, // characters per second
    delay: 0.35, // seconds before typing starts
    humanize: true, // uneven, human typing rhythm
    caret: 'bar', // 'bar' | 'block' | 'none'
    caretColor: null, // defaults to the text color
    x: 0.5,
    y: 0.25,
    align: 'center', // 'left' puts the box's left edge at x, 'right' its right edge
    maxWidth: 0.84,
  },
  presets: {
    'Terminal': { color: '#C8FF3D', background: 'rgba(8,8,10,0.85)', caret: 'block', align: 'left', x: 0.08, text: '$ npm run ship' },
    'Search bar': { font: 'Inter', size: 54, color: '#111111', background: '#FFFFFF', radius: 60, text: 'how to edit reels faster' },
    'No box': { background: null, size: 72 },
  },
  fonts: ['JetBrains Mono'],
  duration: 3,
};

function setFont(ctx, weight, px, family) {
  ctx.font = `${weight} ${Math.max(1, px)}px "${String(family || 'JetBrains Mono').replace(/"/g, '')}", ui-monospace, Menlo, monospace`;
  try { ctx.letterSpacing = '0px'; } catch (e) { /* older canvas */ }
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxW) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const px = Math.max(6, (+p.size || 64) * u);
  setFont(ctx, p.weight || 400, px, p.font);

  const lines = wrap(ctx, p.text, W * (+p.maxWidth || 0.84));
  const widths = lines.map((l) => ctx.measureText(l).width);
  const lh = px * 1.38;
  const padX = px * 0.6, padY = px * 0.42;
  const textW = Math.max(px, ...widths);
  const boxW = textW + padX * 2, boxH = lines.length * lh + padY * 2;
  const align = p.align === 'left' || p.align === 'right' ? p.align : 'center';
  const ax = W * (p.x ?? 0.5);
  const boxX = align === 'left' ? ax : align === 'right' ? ax - boxW : ax - boxW / 2;
  const boxY = H * (p.y ?? 0.25) - boxH / 2;

  // Character timeline: when each character lands.
  const cps = Math.max(1, +p.cps || 18);
  const delay = +p.delay >= 0 ? +p.delay : 0.35;
  const chars = lines.join('');
  const times = [];
  let acc = delay;
  for (let i = 0; i < chars.length; i++) {
    let step = 1 / cps;
    if (p.humanize !== false) {
      step *= 0.55 + 0.9 * fx.random(i * 7.31 + 3);
      if (/[,.;:!?]/.test(chars[i - 1] || '')) step += 2.2 / cps;
    }
    acc += step;
    times.push(acc);
  }
  let shown = 0;
  while (shown < times.length && times[shown] <= t) shown++;
  const doneAt = times.length ? times[times.length - 1] : delay;

  const base = ctx.globalAlpha;
  const enter = ease.outCubic(clamp(t / 0.3));
  const exit = clamp((duration - t) / 0.25);
  const alpha = Math.min(enter, exit);
  if (alpha <= 0) return;

  ctx.save();
  const s = 0.94 + 0.06 * enter;
  const cx = boxX + boxW / 2, cy = boxY + boxH / 2;
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);
  ctx.globalAlpha = base * alpha;

  if (p.background) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 30 * u;
    ctx.shadowOffsetY = 10 * u;
    ctx.fillStyle = p.background;
    fx.roundRect(boxX, boxY, boxW, boxH, Math.min(boxH / 2, (+p.radius >= 0 ? +p.radius : 18) * u));
    ctx.fill();
    ctx.restore();
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 18 * u;
    ctx.shadowOffsetY = 4 * u;
  }

  ctx.fillStyle = p.color || '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let left = shown;
  let caret = null;
  lines.forEach((line, i) => {
    const lx = align === 'left' ? boxX + padX : align === 'right' ? boxX + boxW - padX - widths[i] : cx - widths[i] / 2;
    const ly = boxY + padY + i * lh + lh / 2;
    const n = Math.max(0, Math.min(line.length, left));
    const sub = line.slice(0, n);
    if (sub) ctx.fillText(sub, lx, ly);
    if (caret === null && (left <= line.length || i === lines.length - 1)) caret = { x: lx + ctx.measureText(sub).width, y: ly };
    left -= line.length;
  });

  const style = p.caret === false ? 'none' : p.caret || 'bar';
  if (caret && style !== 'none') {
    const typing = t < doneAt;
    const on = typing || Math.floor((t - doneAt) / 0.53) % 2 === 0;
    if (on) {
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = p.caretColor || p.color || '#FFFFFF';
      const ch = px * 1.05;
      if (style === 'block') {
        ctx.globalAlpha = base * alpha * 0.85;
        ctx.fillRect(caret.x + px * 0.04, caret.y - ch / 2, px * 0.58, ch);
      } else {
        ctx.fillRect(caret.x + px * 0.06, caret.y - ch / 2, Math.max(2, px * 0.075), ch);
      }
    }
  }
  ctx.restore();
}
