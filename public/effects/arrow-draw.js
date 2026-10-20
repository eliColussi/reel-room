// A hand-drawn curved arrow draws itself from one point to another, the head flicks on at the end, with an optional handwritten label at the tail.
export const meta = {
  name: 'Arrow',
  category: 'Explainer',
  description: 'A hand-drawn arrow that draws itself toward something on screen, with an optional scribbled note. Use it to point at a product, a detail, or your face.',
  props: {
    from: [0.25, 0.25], // tail, as fractions of the frame [x, y]
    to: [0.5, 0.45], // tip
    bend: 0.3, // curve amount; negative bends the other way
    color: '#FFFFFF',
    width: 9,
    label: '',
    labelFont: 'Caveat',
    labelSize: 72,
    labelColor: null, // defaults to the arrow color
    speed: 0.5, // seconds to draw
    delay: 0.1,
    head: 1, // arrowhead size
  },
  presets: {
    'With note': { label: 'look here' },
    'Lime': { color: '#C8FF3D' },
    'Straight': { bend: 0 },
  },
  fonts: ['Caveat'],
  duration: 2.5,
};

function pt(v, d) {
  if (Array.isArray(v) && v.length >= 2 && Number.isFinite(+v[0]) && Number.isFinite(+v[1])) return [+v[0], +v[1]];
  if (v && typeof v === 'object' && Number.isFinite(+v.x) && Number.isFinite(+v.y)) return [+v.x, +v.y];
  return d;
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const f = pt(p.from, [0.25, 0.25]), e = pt(p.to, [0.5, 0.45]);
  const P0 = [f[0] * W, f[1] * H], P2 = [e[0] * W, e[1] * H];
  const dx = P2[0] - P0[0], dy = P2[1] - P0[1];
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return;
  const nx = -dy / dist, ny = dx / dist;
  const bend = Number.isFinite(+p.bend) ? +p.bend : 0.3;
  const P1 = [(P0[0] + P2[0]) / 2 + nx * bend * dist, (P0[1] + P2[1]) / 2 + ny * bend * dist];

  // Sample the curve with a gentle hand wobble that is zero at both ends.
  const N = 72;
  const amp = Math.min(6 * u, dist * 0.012);
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N, a = 1 - s;
    const x = a * a * P0[0] + 2 * a * s * P1[0] + s * s * P2[0];
    const y = a * a * P0[1] + 2 * a * s * P1[1] + s * s * P2[1];
    const tx = 2 * a * (P1[0] - P0[0]) + 2 * s * (P2[0] - P1[0]);
    const ty = 2 * a * (P1[1] - P0[1]) + 2 * s * (P2[1] - P1[1]);
    const tl = Math.hypot(tx, ty) || 1;
    const w = amp * Math.sin(Math.PI * s) * (0.6 * Math.sin(s * 8.2 + 1.3) + 0.4 * Math.sin(s * 17.1 + 0.4));
    pts.push([x - (ty / tl) * w, y + (tx / tl) * w]);
  }

  const base = ctx.globalAlpha;
  const exit = clamp((duration - t) / 0.25);
  if (exit <= 0) return;
  const color = p.color || '#FFFFFF';
  const lw = Math.max(1, (+p.width || 9) * u);
  const hasLabel = !!String(p.label ?? '').trim();
  const delay = (+p.delay >= 0 ? +p.delay : 0.1) + (hasLabel ? 0.2 : 0);
  const speed = Math.max(0.05, +p.speed || 0.5);
  const k = ease.inOutQuad(clamp((t - delay) / speed));

  ctx.save();
  ctx.globalAlpha = base * exit;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 10 * u;
  ctx.shadowOffsetY = 2 * u;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;

  if (hasLabel) {
    const lk = ease.outCubic(clamp(t / 0.35));
    const lpx = Math.max(6, (+p.labelSize || 72) * u);
    ctx.font = `700 ${lpx}px "${String(p.labelFont || 'Caveat').replace(/"/g, '')}", "Comic Neue", cursive`;
    try { ctx.letterSpacing = '0px'; } catch (er) { /* older canvas */ }
    const tw = ctx.measureText(String(p.label)).width;
    const th = lpx * 0.9;
    let ox = P0[0] - P1[0], oy = P0[1] - P1[1];
    const ol = Math.hypot(ox, oy) || 1;
    ox /= ol; oy /= ol;
    const off = Math.abs(ox) * (tw / 2) + Math.abs(oy) * (th / 2) + 20 * u;
    ctx.save();
    ctx.globalAlpha *= lk;
    ctx.fillStyle = p.labelColor || color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.label), P0[0] + ox * off, P0[1] + oy * off + (1 - lk) * 10 * u);
    ctx.restore();
  }

  if (k > 0) {
    const end = k * N;
    const n = Math.floor(end);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i <= n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (n < N) {
      const q = end - n;
      ctx.lineTo(pts[n][0] + (pts[n + 1][0] - pts[n][0]) * q, pts[n][1] + (pts[n + 1][1] - pts[n][1]) * q);
    }
    ctx.stroke();
  }

  // Arrowhead flicks on once the line arrives.
  const hk = ease.outCubic(clamp((t - delay - speed) / 0.16));
  if (hk > 0) {
    let bx = P2[0] - P1[0], by = P2[1] - P1[1];
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl; by /= bl;
    const L = Math.max(16 * u, lw * 4.4) * (+p.head > 0 ? +p.head : 1) * hk;
    const tip = pts[N];
    ctx.beginPath();
    for (const sgn of [1, -1]) {
      const a = (sgn * 28 * Math.PI) / 180;
      const rx = -(bx * Math.cos(a) - by * Math.sin(a));
      const ry = -(bx * Math.sin(a) + by * Math.cos(a));
      ctx.moveTo(tip[0], tip[1]);
      ctx.lineTo(tip[0] + rx * L, tip[1] + ry * L);
    }
    ctx.stroke();
  }
  ctx.restore();
}
