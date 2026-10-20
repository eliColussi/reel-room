// The background drains to black and white (optionally tinted) while the speaker stays in full color.
export const meta = {
  name: 'Color pop',
  category: 'Person',
  description: 'The world around you goes black and white and only you stay in color. Put it on the line you want every eye on.',
  props: {
    amount: 1, // 0 = no change, 1 = fully drained background
    tint: null, // null = pure black and white, or a color like '#B98A5E' for a toned background
    fade: 0.4, // seconds for the color to drain out
  },
  presets: {
    'Classic': { amount: 1, tint: null },
    'Sepia': { tint: '#B98A5E' },
    'Cold steel': { tint: '#6F95B8' },
    'Half drain': { amount: 0.6 },
  },
  needs: ['person'],
  duration: 3,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

export default function draw(ctx, fx) {
  const video = fx.composite ? fx.composite() : fx.video(); // what is on screen now (respects a replaced background)
  const person = fx.person();
  // Without a cut-out the whole frame would go grey, which isn't the effect. Skip instead.
  if (!video || !person) return;
  const p = fx.props || {};
  const { ease, clamp } = fx;

  const fade = Math.max(0, num(p.fade, 0.4));
  const outDur = Math.min(0.25, fade);
  const inK = fade > 0 ? ease.inOutCubic(clamp(fx.t / fade)) : 1;
  const outK = outDur > 0 ? ease.inOutCubic(clamp((fx.duration - fx.t) / outDur)) : 1;
  const k = clamp(num(p.amount, 1)) * Math.min(inK, outK);
  if (k <= 0.001) return;

  // Build "grey world + color person" once, then cross-fade it over the frame.
  const c = fx.canvas('pop');
  const x = c.getContext('2d');
  x.save();
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, c.width, c.height);
  x.filter = 'grayscale(1) contrast(1.08) brightness(0.94)';
  x.drawImage(video, 0, 0);
  x.filter = 'none';
  if (p.tint) {
    // 'color' keeps the grey luminance and takes the tint's hue: a toned print, not a flat wash.
    x.globalCompositeOperation = 'color';
    x.globalAlpha = 0.85;
    x.fillStyle = p.tint;
    x.fillRect(0, 0, c.width, c.height);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(video, 0, 0);
  }
  x.globalCompositeOperation = 'source-over';
  x.drawImage(person, 0, 0);
  x.restore();

  ctx.globalAlpha *= k;
  ctx.drawImage(c, 0, 0);
}
