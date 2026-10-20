// Cinematic black bars slide in from the top and bottom, then slide away.
export const meta = {
  name: 'Letterbox',
  category: 'Look',
  description: 'Movie-style bars glide in top and bottom for a cinematic moment, then glide back out. Good for a story beat or a dramatic pause.',
  props: {
    size: 0.11, // height of each bar, fraction of the frame height
    color: '#000000',
    speed: 0.5, // seconds for the bars to slide in
  },
  presets: {
    'Cinema': { size: 0.11 },
    'Thin': { size: 0.07 },
    'Heavy': { size: 0.16 },
    'Ivory': { color: '#F2EDE4', size: 0.09 },
  },
  duration: 4,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { ease, clamp } = fx;
  const W = fx.width, H = fx.height;
  const speed = Math.max(0, num(p.speed, 0.5));
  const outDur = speed * 0.7;
  const inK = speed > 0 ? ease.inOutCubic(clamp(fx.t / speed)) : 1;
  const outK = outDur > 0 ? ease.inOutCubic(clamp((fx.duration - fx.t) / outDur)) : 1;
  const bar = Math.round(clamp(num(p.size, 0.11), 0, 0.5) * H * Math.min(inK, outK));
  if (bar <= 0) return;
  ctx.fillStyle = p.color || '#000000';
  ctx.fillRect(0, 0, W, bar);
  ctx.fillRect(0, H - bar, W, bar);
}
