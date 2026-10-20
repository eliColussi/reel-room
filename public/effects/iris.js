// A circular iris that opens on the speaker's face at the start, and can close again at the end.
export const meta = {
  name: 'Iris',
  category: 'Transition',
  description: 'The picture opens from a circle on your face, old-cinema style, and can close back down at the end. Use it to open a video or close out a story.',
  props: {
    color: '#000000',
    inDuration: 0.6, // seconds to open, 0 = no opening
    outDuration: 0, // seconds to close at the end, 0 = no closing
    from: 'face', // 'face' | 'center'
    feather: 0, // soft edge width (1080-px units), 0 = crisp
  },
  presets: {
    'Open': { inDuration: 0.6, outDuration: 0 },
    'Open and close': { inDuration: 0.6, outDuration: 0.5 },
    'Close only': { inDuration: 0, outDuration: 0.6 },
    'Soft ivory': { color: '#F7F5F0', feather: 40 },
  },
  duration: 1,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

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
  const { ease, clamp, u } = fx;
  const W = fx.width, H = fx.height;

  const inD = Math.max(0, num(p.inDuration, 0.6));
  const outD = Math.max(0, num(p.outDuration, 0));
  let open = 1;
  if (inD > 0 && fx.t < inD) open = Math.min(open, ease.inOutCubic(clamp(fx.t / inD)));
  if (outD > 0 && fx.duration - fx.t < outD) open = Math.min(open, ease.inOutCubic(clamp((fx.duration - fx.t) / outD)));
  if (open >= 1) return;

  const onFace = p.from !== 'center' && fx.face;
  const cx = onFace ? clamp(fx.face.x, 0, W) : W / 2;
  const cy = onFace ? clamp(fx.face.y, 0, H) : H / 2;
  const feather = Math.max(0, num(p.feather, 0)) * u;
  // Far enough to clear the furthest corner, soft edge included.
  const R = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy)) + feather + 2;
  const r = Math.max(0, R * open);
  const color = p.color || '#000000';

  if (feather > 0.5) {
    // Clear inside r - feather, solid beyond r, smoothstep between. One fill does it.
    const [cr, cg, cb] = rgbOf(ctx, color);
    const r0 = Math.max(0, r - feather);
    const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, Math.max(r0 + 0.5, r));
    for (let i = 0; i <= 6; i++) {
      const s = i / 6;
      g.addColorStop(s, `rgba(${cr},${cg},${cb},${(s * s * (3 - 2 * s)).toFixed(4)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    return;
  }

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
}
