// Camera viewfinder HUD: corner marks, blinking REC dot, running timecode, battery and format labels.
export const meta = {
  name: 'Viewfinder',
  category: 'Overlay',
  description: 'Frames the shot like a camcorder screen, with a blinking REC dot, running timecode and battery. Good for vlog openers and behind-the-scenes bits.',
  props: {
    color: '#FFFFFF',
    label: 'REC', // text next to the red dot, '' = dot only
    font: 'JetBrains Mono',
    inset: 0.06, // distance of the frame marks from the edges, fraction of the frame
  },
  presets: {
    'Camcorder': { color: '#FFFFFF', label: 'REC' },
    'Amber': { color: '#FFC24D' },
    'Live': { label: 'LIVE' },
    'Wide margins': { inset: 0.1 },
  },
  fonts: ['JetBrains Mono'],
  duration: 5,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);
const pad2 = (n) => String(n).padStart(2, '0');

function timecode(sec, fps) {
  const f = Math.max(1, Math.round(fps || 30));
  const total = Math.max(0, Math.floor(sec * f + 1e-6));
  const ff = total % f;
  const s = Math.floor(total / f);
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}:${pad2(ff)}`;
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { ease, clamp, u } = fx;
  const W = fx.width, H = fx.height, S = Math.min(W, H);
  const inK = ease.outCubic(clamp(fx.t / 0.35));
  const outK = ease.outCubic(clamp((fx.duration - fx.t) / 0.2));
  const alpha = Math.min(inK, outK);
  if (alpha <= 0.001) return;

  const color = p.color || '#FFFFFF';
  const inset = clamp(num(p.inset, 0.06), 0, 0.3);
  // Marks start a touch wide and settle onto the frame.
  const grow = 1 + 0.05 * (1 - inK);
  const ix = W * inset, iy = H * inset;
  const x0 = W / 2 - (W / 2 - ix) * grow, x1 = W / 2 + (W / 2 - ix) * grow;
  const y0 = H / 2 - (H / 2 - iy) * grow, y1 = H / 2 + (H / 2 - iy) * grow;
  const len = S * 0.075;
  const th = Math.max(1, 4 * u);

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 8 * u;

  // Corner marks.
  ctx.strokeStyle = color;
  ctx.lineWidth = th;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(x0, y0 + len); ctx.lineTo(x0, y0); ctx.lineTo(x0 + len, y0);
  ctx.moveTo(x1 - len, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + len);
  ctx.moveTo(x1, y1 - len); ctx.lineTo(x1, y1); ctx.lineTo(x1 - len, y1);
  ctx.moveTo(x0 + len, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - len);
  ctx.stroke();

  // Center cross.
  const arm = 22 * u, gap = 8 * u;
  ctx.save();
  ctx.globalAlpha *= 0.7;
  ctx.lineWidth = Math.max(1, 2 * u);
  ctx.beginPath();
  ctx.moveTo(W / 2 - gap - arm, H / 2); ctx.lineTo(W / 2 - gap, H / 2);
  ctx.moveTo(W / 2 + gap, H / 2); ctx.lineTo(W / 2 + gap + arm, H / 2);
  ctx.moveTo(W / 2, H / 2 - gap - arm); ctx.lineTo(W / 2, H / 2 - gap);
  ctx.moveTo(W / 2, H / 2 + gap); ctx.lineTo(W / 2, H / 2 + gap + arm);
  ctx.stroke();
  ctx.restore();

  // Text: fades in a beat after the frame.
  const textA = clamp((fx.t - 0.12) / 0.25);
  if (textA > 0) {
    ctx.globalAlpha *= textA;
    const family = String(p.font || 'JetBrains Mono').replace(/"/g, '');
    const fpx = Math.max(8, 32 * u);
    ctx.font = `500 ${fpx}px "${family}", ui-monospace, monospace`;
    try { ctx.letterSpacing = `${(fpx * 0.08).toFixed(2)}px`; } catch (e) { /* older canvas */ }
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    const m = 30 * u; // margin inside the marks
    const ty = y0 + m + fpx * 0.5;
    const by = y1 - m - fpx * 0.5;

    // REC: hard 1 Hz blink, tied to video time so export matches preview.
    const blinkOn = ((fx.outTime % 1) + 1) % 1 < 0.6;
    const dotR = fpx * 0.32;
    if (blinkOn) {
      ctx.save();
      ctx.fillStyle = '#FF3B30';
      ctx.beginPath();
      ctx.arc(x0 + m + dotR, ty, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const label = String(p.label ?? '').trim().toUpperCase();
    if (label) {
      ctx.textAlign = 'left';
      ctx.fillText(label, x0 + m + dotR * 2 + fpx * 0.4, ty);
    }

    // Timecode, top right.
    ctx.textAlign = 'right';
    ctx.fillText(timecode(fx.outTime, fx.fps), x1 - m, ty);

    // Format, bottom left.
    ctx.textAlign = 'left';
    ctx.fillText(`4K  ${Math.round(fx.fps || 30)}P`, x0 + m, by);

    // Battery, bottom right: outline, nub, three bars.
    const bw = 46 * u, bh = 22 * u, nub = 4 * u;
    const bx = x1 - m - nub - bw, byTop = by - bh / 2;
    ctx.lineWidth = Math.max(1, 2.5 * u);
    ctx.strokeStyle = color;
    fx.roundRect(bx, byTop, bw, bh, 3 * u);
    ctx.stroke();
    ctx.fillRect(bx + bw, by - bh * 0.22, nub, bh * 0.44);
    const inner = 4 * u, barGap = 3 * u;
    const barW = (bw - inner * 2 - barGap * 2) / 3;
    for (let i = 0; i < 3; i++) ctx.fillRect(bx + inner + i * (barW + barGap), byTop + inner, barW, bh - inner * 2);
  }
  ctx.restore();
}
