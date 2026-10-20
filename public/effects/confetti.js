// Paper confetti that bursts up from the bottom (or rains from the top) and flutters down, flipping as it falls.
export const meta = {
  name: 'Confetti',
  category: 'Particles',
  description: 'Paper confetti shoots up and flutters down, or rains in from the top. Save it for a real win: a launch, a milestone, a result.',
  props: {
    colors: ['#FFFFFF', '#FFE14D', '#FF5A5F', '#3DDC97', '#4D9DE0'],
    count: 120,
    mode: 'burst', // 'burst' = shoots up from the bottom center, 'fall' = rains from the top
    size: 18, // piece size (1080-px units)
  },
  presets: {
    'Burst': { mode: 'burst' },
    'Rain': { mode: 'fall', count: 90 },
    'Gold': { colors: ['#FFE14D', '#F5C542', '#FFF4C2', '#FFFFFF'] },
    'Mono': { colors: ['#FFFFFF', '#E6E6E6', '#BDBDBD'] },
    'Brand lime': { colors: ['#C6FF3D', '#FFFFFF', '#0E0E10'] },
  },
  duration: 3,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);
const DEFAULT_COLORS = ['#FFFFFF', '#FFE14D', '#FF5A5F', '#3DDC97', '#4D9DE0'];

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { clamp, random, u } = fx;
  const W = fx.width, H = fx.height;
  const colors = Array.isArray(p.colors) && p.colors.length ? p.colors : DEFAULT_COLORS;
  const count = Math.max(0, Math.min(400, Math.round(num(p.count, 120))));
  if (!count) return;
  const size = Math.max(2, num(p.size, 18)) * u;
  const fall = p.mode === 'fall';
  const endFade = clamp((fx.duration - fx.t) / 0.35);
  if (endFade <= 0) return;

  const base = ctx.getTransform();
  const alpha0 = ctx.globalAlpha;
  const baseAlpha = alpha0 * endFade;
  const t = fx.t;
  const margin = size * 3;
  // Rain builds up over the first stretch, then keeps going for any layer length.
  const rainIn = Math.min(1.5, fx.duration * 0.5);

  for (let i = 0; i < count; i++) {
    const r = (k) => random(i * 13.17 + k * 2.71 + 5);
    let x, y, a;
    if (!fall) {
      a = t - r(0) * 0.1;
      if (a <= 0) continue;
      // Linear drag: fast launch, then it hangs and settles at a slow paper fall speed.
      const k = 2.6 + r(3) * 1.4;
      const vTerm = H * (0.08 + 0.07 * r(4));
      const ang = (r(1) * 2 - 1) * 0.62; // +-35 degrees off vertical
      const speed = H * (1.3 + 1.2 * r(2));
      const vx = Math.sin(ang) * speed, vy = -Math.cos(ang) * speed;
      const e = (1 - Math.exp(-k * a)) / k;
      const swayAmp = size * (1.5 + 2 * r(5)) * (1 - Math.exp(-k * a));
      x = W / 2 + (r(10) - 0.5) * W * 0.08 + vx * e + Math.sin(a * (3 + 3 * r(6)) + r(7) * 6.28) * swayAmp;
      y = H + margin + vTerm * a + (vy - vTerm) * e;
    } else {
      a = t - r(0) * rainIn;
      if (a <= 0) continue;
      const vy = H * (0.22 + 0.16 * r(2));
      const span = H + margin * 2;
      y = -margin + ((vy * a) % span);
      const swayAmp = size * (1.5 + 2.5 * r(5));
      x = r(1) * W + Math.sin(a * (2 + 2.5 * r(6)) + r(7) * 6.28) * swayAmp + (r(8) - 0.5) * W * 0.05 * a;
    }
    if (x < -margin || x > W + margin || y < -margin || y > H + margin) continue;

    // Paper flutter: spin in-plane, and flip around its own axis (cos width) for a 3D tumble.
    const flip = Math.cos(a * (6 + 9 * r(11)) + r(12) * 6.28);
    const rot = r(13) * 6.28 + (r(14) - 0.5) * 2 * (1 + 3 * r(15)) * a;
    const strip = r(16) < 0.25;
    const w = strip ? size * 0.32 : size * (0.7 + 0.3 * r(17));
    const h = strip ? size * (0.95 + 0.4 * r(18)) : w * 0.55;

    ctx.setTransform(base);
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(Math.abs(flip) < 0.04 ? 0.04 : flip, 1);
    ctx.globalAlpha = baseAlpha * clamp(a / 0.05);
    ctx.fillStyle = colors[Math.floor(r(9) * colors.length) % colors.length];
    ctx.fillRect(-w / 2, -h / 2, w, h);
    // Shade the piece as it turns edge-on.
    const shade = (1 - Math.abs(flip)) * 0.35;
    if (shade > 0.02) {
      ctx.fillStyle = `rgba(0,0,0,${shade.toFixed(3)})`;
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
  }
  ctx.setTransform(base);
  ctx.globalAlpha = alpha0;
}
