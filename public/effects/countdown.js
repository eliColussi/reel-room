// A 3-2-1 countdown: each number pops in big while a thin ring sweeps around it, with an optional final word.
export const meta = {
  name: 'Countdown',
  category: 'Text',
  description: 'A 3, 2, 1 countdown with a ring sweeping around each number, ending on an optional word like GO. Use it before a reveal or a before/after.',
  props: {
    from: 3,
    every: 1, // seconds per number
    font: 'Anton',
    size: 260,
    color: '#FFFFFF',
    ring: '#C8FF3D',
    track: 'rgba(255,255,255,0.16)',
    thickness: 12,
    x: 0.5,
    y: 0.4,
    end: '', // optional final word, e.g. 'GO'
  },
  presets: {
    'With GO': { end: 'GO' },
    'Fast': { every: 0.6 },
    'From 5': { from: 5 },
  },
  fonts: ['Anton'],
  duration: 3,
};

function setFont(ctx, px, family) {
  const fam = String(family || 'Anton').replace(/"/g, '');
  ctx.font = `400 ${Math.max(1, px)}px "${fam}", ${/anton|bebas|oswald/i.test(fam) ? 'Impact, ' : ''}system-ui, sans-serif`;
  try { ctx.letterSpacing = '0px'; } catch (e) { /* older canvas */ }
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const from = Math.max(1, Math.min(99, Math.round(+p.from || 3)));
  const every = Math.max(0.2, +p.every || 1);
  const end = String(p.end ?? '').trim();
  const idx = Math.floor(t / every);
  const isEnd = idx >= from;
  if (isEnd && !end) return;
  const lt = isEnd ? t - from * every : t - idx * every; // time inside this beat

  const base = ctx.globalAlpha;
  const exit = clamp((duration - t) / 0.2);
  if (exit <= 0) return;
  const cx = W * (p.x ?? 0.5), cy = H * (p.y ?? 0.4);
  const px = Math.max(8, (+p.size || 260) * u);
  const R = px * 0.62;
  const th = Math.max(2, (+p.thickness || 12) * u);

  ctx.save();
  ctx.globalAlpha = base * exit;

  // Ring: faint track plus a sweep that fills over the beat. On the final word it flashes outward.
  ctx.lineCap = 'round';
  ctx.lineWidth = th;
  if (!isEnd) {
    const ringIn = clamp(lt / 0.2);
    ctx.save();
    ctx.globalAlpha *= ringIn;
    ctx.strokeStyle = p.track || 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    const sweep = ease.inOutQuad(clamp(lt / (every * 0.92)));
    if (sweep > 0.002) {
      ctx.strokeStyle = p.ring || '#C8FF3D';
      ctx.beginPath();
      ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(sweep, 0.9999));
      ctx.stroke();
    }
    ctx.restore();
  } else {
    const k = clamp(lt / 0.5);
    ctx.save();
    ctx.globalAlpha *= 1 - ease.outCubic(k);
    ctx.strokeStyle = p.ring || '#C8FF3D';
    ctx.lineWidth = th * (1 - 0.6 * k);
    ctx.beginPath();
    ctx.arc(cx, cy, R * (1 + 0.45 * ease.outCubic(k)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Number / word: pops in, then shrinks away just before the next beat.
  const label = isEnd ? end : String(from - idx);
  const kin = clamp(lt / 0.28);
  let scale = isEnd ? fx.lerp(0.4, 1, ease.outBack(kin)) : fx.lerp(1.55, 1, ease.outCubic(kin));
  let a = clamp(lt / 0.08);
  if (!isEnd) {
    const kout = clamp((every - lt) / 0.14);
    a *= kout;
    scale *= fx.lerp(0.8, 1, kout);
  }
  setFont(ctx, px, p.font);
  let fit = 1;
  if (isEnd) {
    const w = ctx.measureText(label).width;
    if (w > W * 0.86) fit = (W * 0.86) / w;
  }
  const m = ctx.measureText(label);
  const asc = m.actualBoundingBoxAscent || px * 0.72, desc = m.actualBoundingBoxDescent || 0;
  ctx.globalAlpha *= a;
  ctx.translate(cx, cy);
  ctx.scale(scale * fit, scale * fit);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 30 * u;
  ctx.shadowOffsetY = 6 * u;
  ctx.fillStyle = p.color || '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, 0, (asc - desc) / 2);
  ctx.restore();
}
