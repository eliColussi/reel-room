// An impact camera shake that hits hard and dies away, with a slight zoom so the edges never show.
export const meta = {
  name: 'Shake',
  category: 'Transition',
  description: 'A short camera shake, like something just hit the room. Put it on a punchline, a bass drop or a big reveal.',
  props: {
    intensity: 0.6, // 0 to 1
    duration: 0.4, // seconds until the shake has died out
    frequency: 18, // shakes per second; lower = heavier rumble
  },
  presets: {
    'Impact': { intensity: 0.6, duration: 0.4, frequency: 18 },
    'Hit': { intensity: 1, duration: 0.3, frequency: 24 },
    'Rumble': { intensity: 0.3, duration: 1.2, frequency: 9 },
    'Nudge': { intensity: 0.25, duration: 0.25, frequency: 16 },
  },
  duration: 0.6,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

// Smooth deterministic noise in about -1..1: three detuned sines.
const noise = (x, s) => 0.55 * Math.sin(x * 6.283 + s) + 0.3 * Math.sin(x * 11.7 + s * 2.1) + 0.15 * Math.sin(x * 23.3 + s * 3.7);

export default function draw(ctx, fx) {
  const video = fx.composite ? fx.composite() : fx.video();
  if (!video) return;
  const p = fx.props || {};
  const { clamp } = fx;
  const W = fx.width, H = fx.height, S = Math.min(W, H);
  const dur = Math.max(0.05, num(p.duration, 0.4));
  if (fx.t >= dur) return;
  const I = clamp(num(p.intensity, 0.6), 0, 1.5);
  const freq = Math.max(1, num(p.frequency, 18));

  const q = fx.t / dur;
  const decay = Math.pow(1 - q, 2); // the first hit is the biggest
  const ph = fx.t * freq;
  const amp = I * 0.035 * S;
  const rotAmp = I * 1.2 * (Math.PI / 180);
  const dx = noise(ph, 1.3) * amp * decay;
  const dy = noise(ph, 4.1) * amp * 0.8 * decay;
  const rot = noise(ph * 0.8, 7.7) * rotAmp * decay;

  // Just enough zoom to hide the edges at this moment's peak, easing back to 1 as the shake dies.
  const aspect = Math.max(W / H, H / W);
  const need = (Math.cos(rotAmp) + aspect * Math.sin(rotAmp)) + (2 * amp) / S;
  const s = 1 + (need - 1) * decay * 1.02;

  ctx.translate(W / 2 + dx, H / 2 + dy);
  ctx.rotate(rot);
  ctx.scale(s, s);
  ctx.translate(-W / 2, -H / 2);
  ctx.drawImage(video, 0, 0);
}
