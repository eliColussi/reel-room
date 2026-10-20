// Easing curves and the entrance / exit / loop animations shared by every layer.

export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;

export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outElastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

const DEG = Math.PI / 180;

// p goes 0 → 1 as the element arrives (entrance) or 1 → 0 as it leaves (exit).
function applyAnim(kind, p, s, phase) {
  if (!kind || kind === 'none' || p >= 1) return;
  const e = ease.outCubic(p);
  switch (kind) {
    case 'fade': s.alpha *= p; break;
    case 'pop':
      s.scale *= phase === 'in' ? lerp(0.4, 1, ease.outBack(p)) : lerp(0.7, 1, p);
      s.alpha *= clamp(p * 3);
      break;
    case 'zoom': s.scale *= lerp(1.6, 1, e); s.alpha *= p; break;
    case 'slide-up': s.dy += (1 - e) * 160; s.alpha *= clamp(p * 2); break;
    case 'slide-down': s.dy -= (1 - e) * 160; s.alpha *= clamp(p * 2); break;
    case 'slide-left': s.dx += (1 - e) * 220; s.alpha *= clamp(p * 2); break;
    case 'slide-right': s.dx -= (1 - e) * 220; s.alpha *= clamp(p * 2); break;
    case 'drop': s.dy -= (1 - (phase === 'in' ? ease.outBounce(p) : p)) * 380; s.alpha *= clamp(p * 4); break;
    case 'spin': s.rot += (1 - e) * -200 * DEG; s.scale *= lerp(0.2, 1, phase === 'in' ? ease.outBack(p) : p); s.alpha *= clamp(p * 2); break;
    case 'typewriter': case 'draw': if (phase === 'in') s.reveal = p; else s.alpha *= p; break;
    default: s.alpha *= p;
  }
}

function applyLoop(kind, t, s) {
  switch (kind) {
    case 'float': s.dy += Math.sin(t * Math.PI * 1.1) * 12; break;
    case 'wiggle': s.rot += Math.sin(t * Math.PI * 4) * 5 * DEG; break;
    case 'pulse': s.scale *= 1 + Math.sin(t * Math.PI * 2.4) * 0.05; break;
    case 'spin': s.rot += t * 120 * DEG; break;
    case 'shake': s.dx += Math.sin(t * 61) * 5; s.dy += Math.cos(t * 47) * 5; break;
    default: break;
  }
}

// Transform for an element that lives from 0 to dur (output seconds) at local time t.
// dx/dy are in 1080-px design units; the caller multiplies by the frame's unit.
export function animState(t, dur, o = {}) {
  const s = { alpha: 1, scale: 1, dx: 0, dy: 0, rot: 0, reveal: 1 };
  const inDur = o.inDuration ?? (o.in === 'typewriter' ? Math.min(1.2, dur * 0.5) : o.in === 'draw' ? Math.min(0.6, dur * 0.4) : 0.3);
  const outDur = o.outDuration ?? 0.2;
  if (o.in && o.in !== 'none') applyAnim(o.in, inDur > 0 ? clamp(t / inDur) : 1, s, 'in');
  if (o.out && o.out !== 'none' && Number.isFinite(dur)) applyAnim(o.out, outDur > 0 ? clamp((dur - t) / outDur) : 1, s, 'out');
  if (o.loop && o.loop !== 'none') applyLoop(o.loop, t, s);
  return s;
}

// Deterministic pseudo-random numbers (same input, same output) for effects and grain.
export function random(seed) {
  let x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
