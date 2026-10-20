// Spoken words slam onto the screen one at a time in big type, stack into a few lines, then clear for the next phrase.
export const meta = {
  name: 'Kinetic Words',
  category: 'Text',
  description: 'Each word you say slams in big and stacks into bold lines. Use it for the hook or the one sentence you want people to remember.',
  props: {
    text: 'Say the thing *nobody* else will say', // used only when there is no transcript
    font: 'Anton',
    weight: 400,
    size: 150,
    color: '#FFFFFF',
    accent: '#FFE14D',
    accentEvery: 0, // 0 = only *starred* words, n = every nth word
    uppercase: true,
    x: 0.5,
    y: 0.42,
    maxLines: 3,
    maxWidth: 0.86,
    lineHeight: 0.98,
    shadow: true,
    pause: 1.2, // a silence this long (s) starts a fresh screen
  },
  presets: {
    'Accent every 3rd word': { accentEvery: 3 },
    'Serif, lowercase': { font: 'Instrument Serif', uppercase: false, size: 140, lineHeight: 1.02 },
    'Inter heavy': { font: 'Inter', weight: 800, size: 120, lineHeight: 1.04 },
    'One line at a time': { maxLines: 1, size: 170 },
  },
  fonts: ['Anton'],
  duration: 4,
};

function setFont(ctx, weight, px, family) {
  ctx.font = `${weight} ${Math.max(1, px)}px "${String(family || 'Anton').replace(/"/g, '')}", Impact, system-ui, sans-serif`;
  try { ctx.letterSpacing = '0px'; } catch (e) { /* older canvas */ }
}

function getWords(fx, p) {
  const up = p.uppercase !== false;
  const trim = (s) => String(s || '').replace(/^[\s"'“”‘’(\[]+/, '').replace(/[\s"'“”‘’)\],.;:]+$/, '');
  let list;
  if (Array.isArray(fx.words) && fx.words.length) {
    list = fx.words.map((w) => ({ text: w.text, t: +w.t || 0, d: Math.max(0.05, +w.d || 0.3) }));
  } else {
    const parts = String(p.text ?? '').split(/\s+/).filter(Boolean);
    const span = Math.max(0.5, (fx.duration || 3) - 0.8);
    const step = parts.length ? Math.min(0.5, span / parts.length) : 0;
    list = parts.map((text, i) => ({ text, t: 0.1 + i * step, d: step * 0.9 }));
  }
  return list.map((w) => {
    let s = trim(w.text);
    const accent = s.includes('*');
    s = s.replace(/\*/g, '');
    return { t: w.t, d: w.d, accent, display: up ? s.toUpperCase() : s };
  }).filter((w) => w.display);
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const words = getWords(fx, p);
  if (!words.length) return;

  const px = Math.max(8, (+p.size || 150) * u);
  const weight = p.weight || 400;
  setFont(ctx, weight, px, p.font);
  const maxW = W * (+p.maxWidth || 0.86);
  const space = ctx.measureText(' ').width;
  const maxLines = Math.max(1, Math.round(+p.maxLines || 3));
  const pause = +p.pause > 0 ? +p.pause : 1.2;
  const every = Math.max(0, Math.round(+p.accentEvery || 0));

  // Lay every word out once into pages of up to maxLines lines. Positions are final, so nothing shifts.
  const pages = [];
  let page = null, line = null;
  const startPage = (w) => { line = { words: [], width: 0 }; page = { start: w.t, lines: [line] }; pages.push(page); };
  words.forEach((w, i) => {
    const natural = ctx.measureText(w.display).width;
    const fit = Math.min(1, maxW / Math.max(1, natural));
    const ww = natural * fit;
    const prev = words[i - 1];
    if (!page || (prev && w.t - (prev.t + prev.d) > pause)) startPage(w);
    else if (line.words.length && line.width + space + ww > maxW) {
      if (page.lines.length >= maxLines) startPage(w);
      else { line = { words: [], width: 0 }; page.lines.push(line); }
    }
    const x = line.words.length ? line.width + space : 0;
    line.words.push({ ...w, x, w: ww, fit, n: i });
    line.width = x + ww;
  });

  let pi = -1;
  for (let i = 0; i < pages.length; i++) if (pages[i].start <= t) pi = i;
  if (pi < 0) return;
  const cur = pages[pi];
  const next = pages[pi + 1];

  const base = ctx.globalAlpha;
  const exit = clamp((duration - t) / 0.25);
  const pageFade = next ? clamp((next.start - t) / 0.1) : 1;
  const alpha = exit * pageFade;
  if (alpha <= 0) return;

  const lh = px * (+p.lineHeight || 0.98);
  const cx = W * (p.x ?? 0.5);
  const top = H * (p.y ?? 0.42) - (cur.lines.length * lh) / 2;
  const capH = ctx.measureText('H').actualBoundingBoxAscent || px * 0.7;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (p.shadow !== false) {
    ctx.shadowColor = 'rgba(0,0,0,0.38)';
    ctx.shadowBlur = 28 * u;
    ctx.shadowOffsetY = 8 * u;
  }

  cur.lines.forEach((ln, li) => {
    // Keep what's visible on this line centered; slide over as each new word lands.
    let n = 0;
    while (n < ln.words.length && ln.words[n].t <= t) n++;
    if (!n) return;
    const shiftFor = (k) => (ln.width - (ln.words[k - 1].x + ln.words[k - 1].w)) / 2;
    let shift = shiftFor(n);
    if (n > 1) shift = fx.lerp(shiftFor(n - 1), shift, ease.outCubic(clamp((t - ln.words[n - 1].t) / 0.2)));
    const lx = cx - ln.width / 2 + shift;
    const ly = top + li * lh + lh / 2;
    for (const w of ln.words) {
      const wt = t - w.t;
      if (wt < 0) continue;
      const k = clamp(wt / 0.24);
      const scale = fx.lerp(1.85, 1, ease.outBack(k)) * w.fit;
      const rot = (w.n % 2 ? 1 : -1) * (7 * Math.PI / 180) * (1 - ease.outCubic(k));
      const isAccent = w.accent || (every > 0 && (w.n + 1) % every === 0);
      ctx.save();
      ctx.globalAlpha = base * alpha * clamp(wt / 0.06);
      ctx.translate(lx + w.x + w.w / 2, ly);
      ctx.rotate(rot);
      ctx.scale(scale, scale);
      ctx.fillStyle = isAccent ? (p.accent || '#FFE14D') : (p.color || '#FFFFFF');
      ctx.fillText(w.display, 0, capH / 2);
      ctx.restore();
    }
  });
}
