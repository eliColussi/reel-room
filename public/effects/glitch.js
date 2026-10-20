// Short digital glitch bursts: torn horizontal slices and a red/cyan channel split.
export const meta = {
  name: 'Glitch',
  category: 'Transition',
  description: 'A quick digital glitch that tears the picture for a split second. Use it as a hard transition, on a reveal, or on your jump cuts.',
  props: {
    times: [0], // seconds from the layer start when a burst fires
    onCuts: false, // also burst on every jump cut inside the layer
    duration: 0.25, // seconds per burst
    intensity: 0.6, // 0 to 1
  },
  presets: {
    'Burst': { times: [0], intensity: 0.6 },
    'Subtle': { intensity: 0.3, duration: 0.18 },
    'Heavy': { intensity: 1, duration: 0.35 },
    'On every cut': { times: [], onCuts: true, duration: 0.16, intensity: 0.5 },
  },
  duration: 1,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

export default function draw(ctx, fx) {
  const video = fx.composite ? fx.composite() : fx.video();
  if (!video) return;
  const p = fx.props || {};
  const { clamp, random, u } = fx;
  const W = fx.width, H = fx.height;
  const dur = Math.max(0.04, num(p.duration, 0.25));
  const I = clamp(num(p.intensity, 0.6));
  if (I <= 0) return;

  const starts = (Array.isArray(p.times) ? p.times : p.times == null ? [] : [p.times])
    .map((v) => num(v, NaN)).filter(Number.isFinite);
  if (p.onCuts && Array.isArray(fx.cuts)) {
    const a = fx.outTime - fx.t;
    for (const c of fx.cuts) {
      const l = c - a;
      if (l >= -1e-6 && l < fx.duration) starts.push(Math.max(0, l));
    }
  }
  // Most recent burst still running.
  let st = -1;
  for (const s of starts) if (fx.t >= s && fx.t - s < dur && s > st) st = s;
  if (st < 0) return;
  const q = (fx.t - st) / dur;

  // Glitches step at ~20 Hz regardless of fps, and some steps are nearly clean: that stutter sells it.
  const step = Math.floor(fx.outTime * 20);
  const seed = step * 131 + Math.round(st * 1000);
  const on = random(seed) > 0.22;
  const strength = I * (1 - q * q) * (on ? 1 : 0.15);
  if (strength <= 0.01) return;

  // 1. Torn slices, wrapped around so no empty edge shows.
  const n = 3 + Math.round(7 * I);
  for (let i = 0; i < n; i++) {
    const s = seed + i * 17;
    if (random(s + 1) > 0.8) continue;
    const y = Math.floor(random(s + 2) * H);
    const h = Math.max(2, Math.round(H * (0.008 + 0.08 * Math.pow(random(s + 3), 2))));
    const hh = Math.min(h, H - y);
    if (hh <= 0) continue;
    const dx = Math.round((random(s + 4) - 0.5) * 2 * W * 0.12 * strength);
    if (!dx) continue;
    ctx.drawImage(video, 0, y, W, hh, dx, y, W, hh);
    ctx.drawImage(video, 0, y, W, hh, dx - Math.sign(dx) * W, y, W, hh);
  }

  // 2. Channel split: swap the red channel for a shifted copy.
  const off = Math.round((6 + 26 * random(seed + 7)) * u * strength) * (random(seed + 8) < 0.5 ? -1 : 1);
  if (off) {
    const rc = fx.canvas('red');
    const r = rc.getContext('2d');
    r.globalAlpha = 1;
    r.globalCompositeOperation = 'source-over';
    r.fillStyle = '#000';
    r.fillRect(0, 0, rc.width, rc.height);
    r.drawImage(video, 0, 0);
    r.globalCompositeOperation = 'multiply';
    r.fillStyle = '#FF0000';
    r.fillRect(0, 0, rc.width, rc.height);
    r.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#00FFFF';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(rc, off, 0);
    // Fill the strip the shift uncovered with the edge column.
    if (off > 0) ctx.drawImage(rc, 0, 0, 1, H, 0, 0, off, H);
    else ctx.drawImage(rc, W - 1, 0, 1, H, W + off, 0, -off, H);
    ctx.restore();
  }

  // 3. A couple of hairline tears.
  const lines = Math.round(1 + 3 * I);
  for (let i = 0; i < lines; i++) {
    const s = seed + 500 + i * 11;
    if (random(s) > 0.6) continue;
    ctx.fillStyle = `rgba(255,255,255,${(0.25 + 0.5 * random(s + 1)) * strength})`;
    ctx.fillRect(0, random(s + 2) * H, W, Math.max(1, Math.round(2 * u)));
  }
}
