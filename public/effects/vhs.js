// VHS playback: soft smeared picture, red/cyan channel offset, scanlines, a rolling tracking band and a PLAY readout.
export const meta = {
  name: 'VHS',
  category: 'Look',
  description: 'Turns the clip into an old VHS tape: color fringing, scanlines, a tracking band rolling through and a PLAY readout in the corner. Great for throwbacks and "back in my day" bits.',
  props: {
    intensity: 0.6, // 0 to 1
    label: 'PLAY ▶', // top-left on-screen text, '' = no readout
    counter: true, // tape counter under the label
    font: 'VT323',
  },
  presets: {
    'Tape': { intensity: 0.6 },
    'Clean tape': { intensity: 0.3 },
    'Worn out': { intensity: 1 },
    'Rewind': { label: '◀◀ REW', intensity: 0.75 },
    'No readout': { label: '', counter: false },
  },
  fonts: ['VT323'],
  duration: 4,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

function tapeTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { ease, clamp, random, u } = fx;
  const W = fx.width, H = fx.height;
  const I = clamp(num(p.intensity, 0.6));
  const env = Math.min(ease.outCubic(clamp(fx.t / 0.12)), ease.outCubic(clamp((fx.duration - fx.t) / 0.2)));
  if (env <= 0.001) return;
  // Tape spin-up: extra wobble in the first moments that settles down.
  const surge = 1 + 1.6 * (1 - ease.outCubic(clamp(fx.t / 0.4)));
  const T = fx.outTime;
  const frame = Math.floor(T * 30);
  const video = fx.composite ? fx.composite() : fx.video();

  if (video && I > 0) {
    // 1. A soft, bled, half-resolution copy of the picture.
    const sw = Math.max(16, Math.round(W / 2)), sh = Math.max(16, Math.round(H / 2));
    const lo = fx.canvas('lo', sw, sh);
    const l = lo.getContext('2d');
    l.globalAlpha = 1;
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, sw, sh);
    l.filter = 'blur(0.7px) saturate(1.3) contrast(0.9) brightness(1.05)';
    l.drawImage(video, 0, 0, sw, sh);
    l.filter = 'none';

    // 2. Its red channel alone, on black so the 'lighter' add below is a no-op outside the picture.
    const rc = fx.canvas('red', sw, sh);
    const r = rc.getContext('2d');
    r.globalAlpha = 1;
    r.globalCompositeOperation = 'source-over';
    r.fillStyle = '#000';
    r.fillRect(0, 0, sw, sh);
    r.drawImage(lo, 0, 0);
    r.globalCompositeOperation = 'multiply';
    r.fillStyle = '#FF0000';
    r.fillRect(0, 0, sw, sh);
    r.globalCompositeOperation = 'source-over';

    const mix = clamp((0.45 + 0.55 * I) * env);
    const off = Math.max(1, Math.round((3 + 9 * I) * u * surge)); // whole pixels so the edge strip below meets it cleanly

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha *= mix * 0.7;
    ctx.drawImage(lo, 0, 0, W, H);
    ctx.restore();

    // 3. Pull red down by `mix`, then add it back shifted left: the red/cyan fringe.
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${Math.round(255 * (1 - mix))},255,255)`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= mix;
    ctx.drawImage(rc, 0, 0, sw, sh, -off, 0, W, H);
    ctx.drawImage(rc, sw - 1, 0, 1, sh, W - off, 0, off, H); // fill the strip the shift left behind
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha *= env;

  // 4. Scanlines.
  const period = Math.max(2, Math.round(4 * u));
  const sc = fx.canvas('scan', 1, period);
  const s = sc.getContext('2d');
  s.clearRect(0, 0, 1, period);
  s.fillStyle = '#000';
  s.fillRect(0, 0, 1, Math.max(1, Math.round(period * 0.45)));
  const pat = ctx.createPattern(sc, 'repeat');
  if (pat) {
    ctx.save();
    ctx.globalAlpha *= 0.1 + 0.2 * I;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // 5. Tracking band rolling down the frame: torn slices plus white noise streaks.
  const cycle = 6.5;
  const phase = ((T / cycle) % 1 + 1) % 1;
  const bandH = H * (0.03 + 0.035 * I);
  const by = -bandH + phase * (H + bandH * 2);
  const band = (y0, h, seed, strength) => {
    if (video) {
      const slices = 5;
      for (let i = 0; i < slices; i++) {
        const ys = Math.max(0, Math.floor(y0 + (i / slices) * h));
        const ye = Math.min(H, Math.ceil(y0 + ((i + 1) / slices) * h));
        if (ye <= ys) continue;
        const shift = (random(seed + i * 7) - 0.5) * 2 * (6 + 22 * I) * u * strength * surge;
        ctx.drawImage(video, 0, ys, W, ye - ys, shift, ys, W, ye - ys);
      }
    }
    const n = Math.round((8 + 26 * I) * strength);
    for (let i = 0; i < n; i++) {
      const sd = seed + 1000 + i * 13;
      const y = y0 + random(sd) * h;
      if (y < 0 || y > H) continue;
      ctx.fillStyle = `rgba(255,255,255,${(0.12 + 0.45 * random(sd + 4)).toFixed(3)})`;
      ctx.fillRect(random(sd + 1) * W, y, (20 + random(sd + 2) * 180) * u, Math.max(1, (1 + random(sd + 3) * 2) * u));
    }
  };
  if (I > 0 && by + bandH > 0 && by < H) band(by, bandH, frame * 31, 1);
  // Head-switching noise along the very bottom edge.
  if (I > 0) band(H - H * 0.014, H * 0.014, frame * 17 + 5, 0.6);

  // 6. On-screen readout.
  const label = p.label == null ? '' : String(p.label);
  const showCounter = p.counter !== false && p.counter !== 'false';
  if (label || showCounter) {
    const family = String(p.font || 'VT323').replace(/"/g, '');
    const fpx = Math.max(10, 64 * u);
    const x = W * 0.08 + (random(frame * 5 + 1) - 0.5) * 2 * u * I;
    let y = H * (H > W ? 0.115 : 0.09);
    ctx.font = `${fpx}px "${family}", ui-monospace, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 6 * u;
    const lines = [];
    if (label) lines.push(label);
    if (showCounter) lines.push(tapeTime(T));
    for (const line of lines) {
      ctx.fillStyle = 'rgba(255,60,90,0.5)';
      ctx.fillText(line, x - 2 * u, y);
      ctx.fillStyle = 'rgba(60,220,255,0.5)';
      ctx.fillText(line, x + 2 * u, y);
      ctx.fillStyle = '#F2F2F2';
      ctx.fillText(line, x, y);
      y += fpx * 0.95;
    }
  }
  ctx.restore();
}
