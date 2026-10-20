// HUD corner brackets that snap onto the speaker's face and settle, with an optional label chip.
export const meta = {
  name: 'Focus brackets',
  category: 'Overlay',
  description: 'Camera-style corner brackets lock onto your face, with an optional little label. Use it to introduce yourself or flag "this is the person who...".',
  props: {
    color: '#FFFFFF',
    label: '', // text in the chip above the brackets, '' = no chip
    pad: 0.25, // space around the face, fraction of the face size
    thickness: 6, // bracket line thickness (1080-px units)
    length: 0.22, // bracket arm length, fraction of the box
    font: 'JetBrains Mono',
  },
  presets: {
    'Clean': { label: '' },
    'Tagged': { label: 'SPEAKER' },
    'Lime': { color: '#C6FF3D', label: 'LIVE' },
    'Thin': { thickness: 3, length: 0.16 },
  },
  fonts: ['JetBrains Mono'],
  duration: 2.5,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

function luminance(ctx, color) {
  const prev = ctx.fillStyle;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillStyle = color || '#FFFFFF';
  const s = String(ctx.fillStyle);
  ctx.fillStyle = prev;
  let r = 255, g = 255, b = 255;
  if (s[0] === '#') { const n = parseInt(s.slice(1, 7), 16); r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; }
  else { const m = s.match(/[\d.]+/g); if (m) { r = +m[0]; g = +m[1]; b = +m[2]; } }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { ease, clamp, lerp, u } = fx;
  const W = fx.width, H = fx.height, S = Math.min(W, H);

  // Target box: the face plus padding, or a centered box when no face was found.
  let bx, by, bw, bh;
  if (fx.face) {
    const pad = Math.max(0, num(p.pad, 0.25));
    bx = fx.face.x; by = fx.face.y;
    bw = fx.face.w * (1 + 2 * pad);
    bh = fx.face.h * (1 + 2 * pad);
  } else {
    bx = W / 2; by = H / 2;
    bw = S * 0.42; bh = S * 0.5;
  }

  // Lock on: start wide, snap in with a small overshoot, settle. Leave: open up and fade.
  const LOCK = 0.42;
  const inP = clamp(fx.t / LOCK);
  const outP = clamp((fx.duration - fx.t) / 0.2);
  let scale = lerp(1.4, 1, ease.outBack(inP));
  scale = lerp(1.12, scale, ease.outCubic(outP));
  const alpha = clamp(fx.t / 0.12) * ease.outCubic(outP);
  if (alpha <= 0.001) return;

  const color = p.color || '#FFFFFF';
  const th = Math.max(1, num(p.thickness, 6) * u);
  const hw = (bw / 2) * scale, hh = (bh / 2) * scale;
  const len = Math.max(th * 2, clamp(num(p.length, 0.22), 0.02, 0.5) * Math.min(bw, bh));
  const x0 = bx - hw, x1 = bx + hw, y0 = by - hh, y1 = by + hh;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = th;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 10 * u;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + len); ctx.lineTo(x0, y0); ctx.lineTo(x0 + len, y0);
  ctx.moveTo(x1 - len, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + len);
  ctx.moveTo(x1, y1 - len); ctx.lineTo(x1, y1); ctx.lineTo(x1 - len, y1);
  ctx.moveTo(x0 + len, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - len);
  ctx.stroke();
  ctx.restore();

  // Label chip: opens after the lock, then the text types in.
  const label = String(p.label ?? '').trim().toUpperCase();
  if (!label) return;
  const chipT = fx.t - LOCK * 0.6;
  if (chipT <= 0) return;
  const open = ease.outCubic(clamp(chipT / 0.25));
  const chars = Math.ceil(label.length * clamp((chipT - 0.08) / 0.3));
  const fpx = Math.max(8, 26 * u);
  const family = String(p.font || 'JetBrains Mono').replace(/"/g, '');
  ctx.save();
  ctx.font = `600 ${fpx}px "${family}", ui-monospace, monospace`;
  try { ctx.letterSpacing = `${(fpx * 0.12).toFixed(2)}px`; } catch (e) { /* older canvas */ }
  const tw = ctx.measureText(label).width;
  const padX = fpx * 0.6;
  const chipW = tw + padX * 2, chipH = fpx * 1.7;
  const gap = th + 8 * u;
  let cy = y0 - gap - chipH;
  if (cy < H * 0.03) cy = y1 + gap; // no room above: hang it below the box
  const cx = x0;
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  fx.roundRect(cx, cy, Math.max(chipH * 0.2, chipW * open), chipH, 4 * u);
  ctx.fill();
  if (chars > 0 && open > 0.6) {
    ctx.beginPath();
    ctx.rect(cx, cy, chipW * open, chipH);
    ctx.clip();
    ctx.fillStyle = luminance(ctx, color) > 0.55 ? '#0A0A0A' : '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.slice(0, chars), cx + padX, cy + chipH / 2 + fpx * 0.04);
  }
  ctx.restore();
}
