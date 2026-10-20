// On every jump cut the frame punches in and settles back, with a brief zoom blur.
export const meta = {
  name: 'Cut punch',
  category: 'Transition',
  description: 'Each jump cut lands with a quick punch-in that settles back, so cuts hit like beats. Stretch it across the whole video.',
  props: {
    scale: 1.1, // how far it punches in on the cut
    duration: 0.22, // seconds to settle
    blur: 6, // motion blur at the start of the punch (1080-px units), 0 = none
    every: 1, // punch on every Nth cut
  },
  presets: {
    'Punch': { scale: 1.1, duration: 0.22, blur: 6 },
    'Subtle': { scale: 1.05, duration: 0.2, blur: 3 },
    'Hard hit': { scale: 1.18, duration: 0.18, blur: 10 },
    'Every other cut': { every: 2 },
  },
  duration: 60,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

export default function draw(ctx, fx) {
  const cuts = Array.isArray(fx.cuts) ? fx.cuts : [];
  if (!cuts.length) return;
  const video = fx.composite ? fx.composite() : fx.video();
  if (!video) return;
  const p = fx.props || {};
  const { ease, clamp, u } = fx;
  const W = fx.width, H = fx.height;
  const dur = Math.max(0.04, num(p.duration, 0.22));
  const every = Math.max(1, Math.round(num(p.every, 1)));
  const start = fx.outTime - fx.t;
  const end = start + fx.duration;

  // Most recent qualifying cut that's still settling.
  let n = 0, dt = -1;
  for (const c of cuts) {
    if (!(c >= start - 1e-6 && c < end)) continue;
    const idx = n++;
    if (idx % every) continue;
    const d = fx.outTime - c;
    if (d >= 0 && d < dur && (dt < 0 || d < dt)) dt = d;
  }
  if (dt < 0) return;

  const q = dt / dur;
  const e = ease.outCubic(q);
  const s = 1 + (Math.max(1, num(p.scale, 1.1)) - 1) * (1 - e);
  const a = 1 - ease.inQuad(q); // hold the punched frame, then let the real one through
  if (a <= 0.001 || s <= 1.0005) return;
  const blur = Math.max(0, num(p.blur, 6)) * u * (1 - e);
  // Punch toward the face so the speaker stays put; scaling >= 1 around a point inside the frame never shows an edge.
  const ax = fx.face ? clamp(fx.face.x, 0, W) : W / 2;
  const ay = fx.face ? clamp(fx.face.y, 0, H) : H / 2;

  ctx.globalAlpha *= a;
  if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(2)}px)`;
  ctx.translate(ax, ay);
  ctx.scale(s, s);
  ctx.translate(-ax, -ay);
  ctx.drawImage(video, 0, 0);
  ctx.filter = 'none';
}
