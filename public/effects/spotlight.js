// Darkens the frame except for a soft circle of light on the speaker's face.
export const meta = {
  name: 'Spotlight',
  category: 'Look',
  description: 'Dims everything except a soft pool of light on your face, like a stage spot. Use it for a serious beat or a quiet confession.',
  props: {
    radius: 0.32, // size of the lit circle, fraction of the frame's short side
    dim: 0.7, // how dark the outside gets, 0 to 1
    feather: 0.5, // edge softness, 0 = hard edge, 1 = very soft
    color: '#000000', // color of the darkness
    follow: true, // track the face; false (or no face found) uses x / y
    x: 0.5,
    y: 0.5,
  },
  presets: {
    'Soft': { dim: 0.7, feather: 0.5 },
    'Hard stage light': { dim: 0.85, feather: 0.12, radius: 0.28 },
    'Subtle': { dim: 0.45, feather: 0.7, radius: 0.4 },
    'Midnight blue': { color: '#060B1E', dim: 0.75 },
  },
  duration: 3,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

// Any CSS color to [r, g, b], using the canvas itself as the parser.
function rgbOf(ctx, color) {
  const prev = ctx.fillStyle;
  ctx.fillStyle = '#000000';
  ctx.fillStyle = color || '#000000';
  const s = String(ctx.fillStyle);
  ctx.fillStyle = prev;
  if (s[0] === '#') {
    const n = parseInt(s.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/[\d.]+/g) || [0, 0, 0];
  return [+m[0] || 0, +m[1] || 0, +m[2] || 0];
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { ease, clamp } = fx;
  const W = fx.width, H = fx.height, S = Math.min(W, H);

  const inK = ease.outCubic(clamp(fx.t / 0.45));
  const outK = ease.outCubic(clamp((fx.duration - fx.t) / 0.25));
  const dim = clamp(num(p.dim, 0.7)) * Math.min(inK, outK);
  if (dim <= 0.001) return;

  const onFace = p.follow !== false && fx.face;
  const cx = onFace ? fx.face.x : num(p.x, 0.5) * W;
  const cy = onFace ? fx.face.y : num(p.y, 0.5) * H;
  const feather = clamp(num(p.feather, 0.5));
  // The pool starts wide and tightens onto the face as the light comes on.
  const r = Math.max(1, num(p.radius, 0.32) * S * (1 + 0.6 * (1 - inK)));
  const r0 = Math.max(0, r * (1 - feather * 0.7));
  const r1 = Math.max(r0 + 1, r * (1 + feather * 0.5));

  const [cr, cg, cb] = rgbOf(ctx, p.color);
  const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  // Smoothstep falloff in several stops so there's no visible ring where the dark starts.
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const a = s * s * (3 - 2 * s);
    g.addColorStop(s, `rgba(${cr},${cg},${cb},${(a * dim).toFixed(4)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
