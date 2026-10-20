// A quick camera-flash on every jump cut inside the layer's window.
export const meta = {
  name: 'Cut flash',
  category: 'Transition',
  description: 'A short flash on each jump cut so the edits feel deliberate. Stretch it across the whole video.',
  props: {
    color: '#FFFFFF',
    duration: 0.12, // seconds each flash lasts
    intensity: 0.7, // peak strength, 0 to 1
    every: 1, // flash on every Nth cut (2 = every other cut)
  },
  presets: {
    'White flash': { color: '#FFFFFF', intensity: 0.7, duration: 0.12 },
    'Soft': { intensity: 0.35, duration: 0.18 },
    'Black dip': { color: '#000000', intensity: 0.85, duration: 0.1 },
    'Every other cut': { every: 2 },
  },
  duration: 60,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

export default function draw(ctx, fx) {
  const cuts = Array.isArray(fx.cuts) ? fx.cuts : [];
  if (!cuts.length) return;
  const p = fx.props || {};
  const dur = Math.max(0.02, num(p.duration, 0.12));
  const every = Math.max(1, Math.round(num(p.every, 1)));
  const start = fx.outTime - fx.t;
  const end = start + fx.duration;

  let n = 0, k = 0;
  for (const c of cuts) {
    if (!(c >= start - 1e-6 && c < end)) continue;
    const idx = n++;
    if (idx % every) continue;
    const dt = fx.outTime - c;
    if (dt < 0 || dt >= dur) continue;
    const q = 1 - dt / dur;
    k = Math.max(k, q * q); // hits at full on the cut frame, falls off fast
  }
  const a = fx.clamp(num(p.intensity, 0.7)) * k;
  if (a <= 0.001) return;
  ctx.globalAlpha *= a;
  ctx.fillStyle = p.color || '#FFFFFF';
  ctx.fillRect(0, 0, fx.width, fx.height);
}
