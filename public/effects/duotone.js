// Two-color duotone: shadows go to one color, highlights to another.
export const meta = {
  name: 'Duotone',
  category: 'Look',
  description: 'Recolors the video in two tones, shadows in one color and highlights in another, like a poster print. Use it for a bold section or to match your brand colors.',
  props: {
    dark: '#1A1446', // color for the shadows
    light: '#FF7AB6', // color for the highlights
    amount: 1, // 0 = original video, 1 = full duotone
  },
  presets: {
    'Midnight pink': { dark: '#1A1446', light: '#FF7AB6' },
    'Ocean': { dark: '#0B1D3A', light: '#5CE1E6' },
    'Sunset': { dark: '#2B0F3A', light: '#FFB347' },
    'Newsprint': { dark: '#141414', light: '#F2EDE4' },
    'Lime ink': { dark: '#0E0E10', light: '#C6FF3D' },
  },
  duration: 4,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

export default function draw(ctx, fx) {
  const video = fx.composite ? fx.composite() : fx.video();
  if (!video) return;
  const p = fx.props || {};
  const { ease, clamp } = fx;
  const inK = ease.inOutCubic(clamp(fx.t / 0.4));
  const outK = ease.inOutCubic(clamp((fx.duration - fx.t) / 0.25));
  const k = clamp(num(p.amount, 1)) * Math.min(inK, outK);
  if (k <= 0.001) return;

  // grey -> multiply by the light color (white maps to light) -> screen the dark color (black maps to dark).
  const c = fx.canvas('duotone');
  const x = c.getContext('2d');
  x.save();
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, c.width, c.height);
  x.filter = 'grayscale(1) contrast(1.12)';
  x.drawImage(video, 0, 0);
  x.filter = 'none';
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = p.light || '#FF7AB6';
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'screen';
  x.fillStyle = p.dark || '#1A1446';
  x.fillRect(0, 0, c.width, c.height);
  // The fills painted the empty area too; keep only the picture.
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(video, 0, 0);
  x.restore();

  ctx.globalAlpha *= k;
  ctx.drawImage(c, 0, 0);
}
