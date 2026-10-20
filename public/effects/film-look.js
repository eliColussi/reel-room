// Analog film texture: slow warm light leaks drifting in from the edges, dust, scratches and a gentle exposure flicker.
export const meta = {
  name: 'Film look',
  category: 'Look',
  description: 'Makes digital footage feel shot on film: warm light leaks drift across, specks of dust and the odd scratch pass by. Good for nostalgic or story-driven reels.',
  props: {
    leak: 0.5, // light leak strength, 0 = off
    dust: 0.4, // dust specks and scratches, 0 = off
    flicker: 0.3, // exposure flicker, 0 = off
    warmth: '#FF8A3D', // light leak color
  },
  presets: {
    'Warm film': { leak: 0.5, dust: 0.4, flicker: 0.3, warmth: '#FF8A3D' },
    'Golden hour': { leak: 0.85, dust: 0.25, flicker: 0.2, warmth: '#FFB347' },
    'Dusty print': { leak: 0.15, dust: 0.8, flicker: 0.45 },
    'Cool leak': { leak: 0.6, dust: 0.3, warmth: '#7FB2FF' },
  },
  duration: 6,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

function rgbOf(ctx, color) {
  const prev = ctx.fillStyle;
  ctx.fillStyle = '#FF8A3D';
  ctx.fillStyle = color || '#FF8A3D';
  const s = String(ctx.fillStyle);
  ctx.fillStyle = prev;
  if (s[0] === '#') {
    const n = parseInt(s.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/[\d.]+/g) || [255, 138, 61];
  return [+m[0] || 0, +m[1] || 0, +m[2] || 0];
}

// Smooth 0..1 wobble from two detuned sines.
const wave = (t, s) => 0.5 + 0.5 * (0.6 * Math.sin(t * 0.7 + s) + 0.4 * Math.sin(t * 1.9 + s * 2.3));

// Where each leak lives: mostly hugging an edge, drifting slowly.
const LEAKS = [
  { x: 1.02, y: 0.28, dx: 0.04, dy: 0.18, r: 0.95, s: 0.0 },
  { x: -0.06, y: 0.78, dx: 0.05, dy: 0.12, r: 0.8, s: 2.1 },
  { x: 0.62, y: -0.06, dx: 0.28, dy: 0.03, r: 0.6, s: 4.4 },
];

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { clamp, ease, random, u } = fx;
  const W = fx.width, H = fx.height, S = Math.min(W, H);
  const env = Math.min(ease.outCubic(clamp(fx.t / 0.5)), ease.outCubic(clamp((fx.duration - fx.t) / 0.3)));
  if (env <= 0.001) return;
  const T = fx.outTime;
  const ff = Math.floor(T * 24); // texture changes at film's 24 fps, whatever the export rate
  ctx.globalAlpha *= env;

  // 1. Light leaks ('screen' only ever brightens).
  const leak = clamp(num(p.leak, 0.5));
  if (leak > 0) {
    const [r, g, b] = rgbOf(ctx, p.warmth);
    const hot = [r, g, b].map((v) => Math.round(v + (255 - v) * 0.45));
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const L of LEAKS) {
      const x = (L.x + L.dx * Math.sin(T * 0.21 + L.s)) * W;
      const y = (L.y + L.dy * Math.sin(T * 0.17 + L.s * 1.3)) * H;
      const R = L.r * S * (0.9 + 0.2 * wave(T * 0.6, L.s + 1));
      const a = leak * 0.8 * (0.25 + 0.75 * wave(T, L.s));
      const grad = ctx.createRadialGradient(x, y, 0, x, y, R);
      grad.addColorStop(0, `rgba(${hot[0]},${hot[1]},${hot[2]},${a.toFixed(3)})`);
      grad.addColorStop(0.35, `rgba(${r},${g},${b},${(a * 0.65).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R);
      const x1 = Math.min(W, x + R), y1 = Math.min(H, y + R);
      if (x1 > x0 && y1 > y0) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.restore();
  }

  // 2. Dust, hairs and scratches.
  const dust = clamp(num(p.dust, 0.4));
  if (dust > 0) {
    ctx.save();
    const slots = Math.round(4 + dust * 14);
    for (let i = 0; i < slots; i++) {
      const sd = ff * 131 + i * 17;
      if (random(sd) > 0.55 * dust + 0.1) continue;
      const x = random(sd + 1) * W, y = random(sd + 2) * H;
      const rad = (0.8 + Math.pow(random(sd + 3), 3) * 4.5) * u;
      const light = random(sd + 4) < 0.3;
      ctx.fillStyle = light ? 'rgba(255,250,240,0.55)' : 'rgba(12,10,8,0.6)';
      ctx.beginPath();
      ctx.ellipse(x, y, rad, rad * (0.55 + 0.45 * random(sd + 5)), random(sd + 6) * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // A hair caught in the gate, now and then.
    if (random(ff * 7 + 3) < dust * 0.1) {
      const hs = ff * 7 + 3;
      const x = random(hs + 1) * W, y = random(hs + 2) * H;
      const len = (30 + random(hs + 3) * 70) * u;
      const ang = random(hs + 4) * Math.PI * 2;
      ctx.strokeStyle = 'rgba(12,10,8,0.5)';
      ctx.lineWidth = Math.max(1, 1.3 * u);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(
        x + Math.cos(ang + 0.9) * len * 0.6, y + Math.sin(ang + 0.9) * len * 0.6,
        x + Math.cos(ang) * len, y + Math.sin(ang) * len,
      );
      ctx.stroke();
    }
    // A thin vertical scratch that lingers for a beat, jittering slightly frame to frame.
    const epoch = Math.floor(T * 1.4);
    if (random(epoch * 13 + 5) < dust * 0.6 && random(ff * 11 + 1) > 0.2) {
      const sx = random(epoch * 13 + 6) * W + (random(ff * 3 + 1) - 0.5) * 3 * u;
      const top = random(epoch * 13 + 7) < 0.5 ? 0 : random(epoch * 13 + 8) * H * 0.5;
      const a = 0.1 + 0.16 * random(ff * 5 + 2);
      ctx.fillStyle = `rgba(255,248,235,${a.toFixed(3)})`;
      ctx.fillRect(sx, top, Math.max(1, 1.2 * u), H - top);
    }
    ctx.restore();
  }

  // 3. Exposure flicker: tiny brightness pumps, per film frame plus a slow breath.
  const flicker = clamp(num(p.flicker, 0.3));
  if (flicker > 0) {
    const v = (random(ff * 3.17 + 11) - 0.5) * 1.2 + 0.4 * Math.sin(T * 7.3);
    const a = Math.min(0.2, Math.abs(v) * flicker * 0.12);
    if (a > 0.002) {
      ctx.save();
      if (v > 0) { ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = `rgba(255,244,230,${a.toFixed(3)})`; }
      else ctx.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }
}
