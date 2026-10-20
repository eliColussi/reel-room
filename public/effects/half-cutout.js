// Splits the frame along a line: one side swaps its background (speaker stays on top), the other side stays real.
export const meta = {
  name: 'Half cutout',
  category: 'Person',
  description: 'Half your frame keeps the real room, the other half swaps to a color, gradient, blur or black and white while you stay in front. Good for before/after and "two worlds" moments.',
  props: {
    side: 'right', // which side gets the new background: 'left' | 'right' | 'top' | 'bottom'
    split: 0.5, // where the line sits, 0 to 1 across the frame
    angle: 0, // tilt of the line in degrees
    background: 'color', // 'color' | 'gradient' | 'blur' | 'mono' | 'none'
    color: '#0E0E10',
    colors: ['#1B1B3A', '#6C2BD9'], // gradient, from the line out to the edge
    line: '#FFFFFF', // divider color, null = no line
    lineWidth: 4,
    wipe: 0.6, // seconds for the line to sweep in from the edge, 0 = appears instantly
  },
  presets: {
    'Studio dark': { background: 'color', color: '#0E0E10' },
    'Purple gradient': { background: 'gradient', colors: ['#1B1B3A', '#6C2BD9'] },
    'Black and white': { background: 'mono', line: null },
    'Dreamy blur': { background: 'blur', line: '#FFFFFF', lineWidth: 2 },
    'Diagonal': { background: 'gradient', angle: 14, colors: ['#0B0B0F', '#FF5A36'] },
    'Top half': { side: 'top', split: 0.42, background: 'color', color: '#F2EDE4', line: null },
  },
  needs: ['person'],
  duration: 4,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);
const NORMALS = { right: [1, 0], left: [-1, 0], top: [0, -1], bottom: [0, 1] };

// Path covering the half-plane {X : (X - Q)·n >= 0}, big enough to cover any frame.
function halfPlane(ctx, qx, qy, nx, ny, L) {
  const dx = -ny, dy = nx;
  const ax = qx + dx * L, ay = qy + dy * L;
  const bx = qx - dx * L, by = qy - dy * L;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + nx * L, ay + ny * L);
  ctx.lineTo(bx + nx * L, by + ny * L);
  ctx.lineTo(bx, by);
  ctx.closePath();
}

export default function draw(ctx, fx) {
  const person = fx.person();
  const video = fx.composite ? fx.composite() : fx.video(); // what is on screen now (respects a replaced background)
  // No cut-out means the new background would cover the speaker. Skip rather than do that.
  if (!person || !video) return;
  const p = fx.props || {};
  const { ease, clamp, u } = fx;
  const W = fx.width, H = fx.height;

  const side = NORMALS[p.side] ? p.side : 'right';
  const split = clamp(num(p.split, 0.5));
  const vertical = side === 'left' || side === 'right';
  const px = vertical ? split * W : W / 2;
  const py = vertical ? H / 2 : split * H;
  const a = (num(p.angle, 0) * Math.PI) / 180;
  const [n0x, n0y] = NORMALS[side];
  const nx = n0x * Math.cos(a) - n0y * Math.sin(a);
  const ny = n0x * Math.sin(a) + n0y * Math.cos(a);
  const lw = Math.max(0, num(p.lineWidth, 4)) * u;

  // How far the line must travel to be fully off-frame on the replaced side.
  let reach = 0;
  for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]]) reach = Math.max(reach, (cx - px) * nx + (cy - py) * ny);
  reach += lw + 2;

  const wipe = Math.max(0, num(p.wipe, 0.6));
  const outDur = wipe > 0 ? Math.min(0.3, wipe * 0.6) : 0;
  const inK = wipe > 0 ? ease.outCubic(clamp(fx.t / wipe)) : 1;
  const outK = outDur > 0 ? ease.outCubic(clamp((fx.duration - fx.t) / outDur)) : 1;
  const f = Math.min(inK, outK);
  if (f <= 0.0005) return;
  const off = reach * (1 - f);
  const qx = px + nx * off, qy = py + ny * off;
  const L = (W + H) * 2;

  // 1. New background on the replaced side.
  const mode = p.background || 'color';
  if (mode !== 'none') {
    ctx.save();
    halfPlane(ctx, qx, qy, nx, ny, L);
    ctx.clip();
    if (mode === 'mono') {
      ctx.filter = 'grayscale(1) contrast(1.1) brightness(0.92)';
      ctx.drawImage(video, 0, 0);
      ctx.filter = 'none';
    } else if (mode === 'blur') {
      // Shrink, soften, scale back up: a strong blur for the price of a small canvas.
      const sw = Math.max(16, Math.round(W / 10)), sh = Math.max(16, Math.round(H / 10));
      const small = fx.canvas('blur', sw, sh);
      const s = small.getContext('2d');
      s.clearRect(0, 0, sw, sh);
      s.filter = 'blur(2px)';
      const over = 1.15; // overscan so the blur doesn't pull dark edges in
      s.drawImage(video, (sw - sw * over) / 2, (sh - sh * over) / 2, sw * over, sh * over);
      s.filter = 'none';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, W, H);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(0, 0, W, H);
    } else if (mode === 'gradient') {
      const cs = Array.isArray(p.colors) && p.colors.length ? p.colors : ['#1B1B3A', '#6C2BD9'];
      // Anchored to the final line position so the gradient doesn't slide during the wipe.
      const g = ctx.createLinearGradient(px, py, px + nx * reach, py + ny * reach);
      cs.forEach((col, i) => g.addColorStop(cs.length === 1 ? 0 : i / (cs.length - 1), col));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = p.color || '#0E0E10';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  // 2. Divider line, drawn before the person so they overlap it.
  if (p.line && lw > 0) {
    const dx = -ny, dy = nx;
    ctx.save();
    ctx.strokeStyle = p.line;
    ctx.lineWidth = lw;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(qx - dx * L, qy - dy * L);
    ctx.lineTo(qx + dx * L, qy + dy * L);
    ctx.stroke();
    ctx.restore();
  }

  // 3. The speaker back on top, only where something changed (replaced side + the line).
  ctx.save();
  const m = lw / 2 + 2;
  halfPlane(ctx, qx - nx * m, qy - ny * m, nx, ny, L);
  ctx.clip();
  ctx.drawImage(person, 0, 0);
  ctx.restore();
}
