// A hand-drawn marker ellipse loops around a spot, slightly more than once, with an uneven human wobble.
export const meta = {
  name: 'Circle It',
  category: 'Explainer',
  description: 'A hand-drawn circle that loops around something on screen, like a red pen on a screenshot. Use it to call out one detail.',
  props: {
    x: 0.5, // center, as fractions of the frame
    y: 0.4,
    w: 0.4, // ellipse width as a fraction of frame width
    h: 0.18, // ellipse height as a fraction of frame height
    color: '#FF3B30',
    width: 9,
    loops: 1.12, // a bit more than one loop looks hand-drawn
    speed: 0.6, // seconds to draw
    delay: 0.05,
    tilt: -4, // degrees
    wobble: 0.05, // 0 = perfect ellipse
    seed: 1, // change for a different hand
  },
  presets: {
    'Lime': { color: '#C8FF3D' },
    'Tight': { w: 0.24, h: 0.1, width: 7 },
    'Messy': { wobble: 0.1, loops: 1.3 },
  },
  fonts: [],
  duration: 2.5,
};

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const exit = clamp((duration - t) / 0.25);
  const speed = Math.max(0.05, +p.speed || 0.6);
  const delay = +p.delay >= 0 ? +p.delay : 0.05;
  const k = ease.inOutQuad(clamp((t - delay) / speed));
  if (k <= 0 || exit <= 0) return;

  const cx = W * (p.x ?? 0.5), cy = H * (p.y ?? 0.4);
  const rx = (W * (+p.w || 0.4)) / 2, ry = (H * (+p.h || 0.18)) / 2;
  const loops = Math.max(0.2, +p.loops || 1.12);
  const wob = Math.max(0, Number.isFinite(+p.wobble) ? +p.wobble : 0.05);
  const seed = +p.seed || 1;
  const ph1 = fx.random(seed * 3.1) * Math.PI * 2;
  const ph2 = fx.random(seed * 7.7 + 1) * Math.PI * 2;
  const a0 = (-100 + (fx.random(seed * 1.9 + 2) - 0.5) * 30) * (Math.PI / 180);
  const tilt = ((Number.isFinite(+p.tilt) ? +p.tilt : -4) * Math.PI) / 180;
  const ct = Math.cos(tilt), st = Math.sin(tilt);

  const total = loops * Math.PI * 2;
  const N = Math.max(24, Math.round(96 * loops));
  const end = k * N;
  const n = Math.floor(end);
  const at = (i) => {
    const s = i / N;
    const th = a0 + s * total;
    // Radius drifts outward over the loop so the overlap doesn't sit on itself, plus a low-frequency wobble.
    const r = 1 + wob * (0.6 * Math.sin(2 * th + ph1) + 0.4 * Math.sin(3 * th + ph2)) + 0.05 * s;
    const ex = Math.cos(th) * rx * r, ey = Math.sin(th) * ry * r;
    return [cx + ex * ct - ey * st, cy + ex * st + ey * ct];
  };

  const base = ctx.globalAlpha;
  ctx.save();
  ctx.globalAlpha = base * exit;
  ctx.strokeStyle = p.color || '#FF3B30';
  ctx.lineWidth = Math.max(1, (+p.width || 9) * u);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 8 * u;
  ctx.shadowOffsetY = 2 * u;
  ctx.beginPath();
  const first = at(0);
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i <= n; i++) { const q = at(i); ctx.lineTo(q[0], q[1]); }
  if (n < N) { const q = at(end); ctx.lineTo(q[0], q[1]); }
  ctx.stroke();
  ctx.restore();
}
