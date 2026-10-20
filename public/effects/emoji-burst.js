// A burst of emoji that pop out from a point, arc under gravity while spinning, and fade away.
export const meta = {
  name: 'Emoji burst',
  category: 'Particles',
  description: 'A handful of emoji pop out of one spot and tumble away. Use it on a reaction moment, and mix a few emoji for variety.',
  props: {
    emoji: '🔥', // one emoji or several to mix, e.g. '🎉✨'
    count: 14,
    x: 0.5, // burst origin, fraction of width
    y: 0.45, // burst origin, fraction of height
    spread: 0.5, // 0 = tight fountain straight up, 1 = wide fan
    size: 90, // emoji size (1080-px units)
    gravity: 1, // 0 = float, 2 = heavy
    from: 'point', // 'point' uses x / y, 'face' bursts from beside the speaker's head
  },
  presets: {
    'Fire': { emoji: '🔥' },
    'Hearts': { emoji: '❤️' },
    'Money': { emoji: '💸💰' },
    'Party': { emoji: '🎉✨', count: 18 },
    '100': { emoji: '💯', count: 10, size: 110 },
    'Mind blown': { emoji: '🤯', from: 'face', count: 10 },
  },
  duration: 1.6,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const JOINERS = /^[︎️‍\s]*$/;

// One shared, never-mutated segmenter (it carries no state between frames).
const SEGMENTER = (() => {
  try { return typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null; } catch (e) { return null; }
})();

function graphemes(str) {
  const s = String(str ?? '').trim();
  let parts = SEGMENTER ? Array.from(SEGMENTER.segment(s), (x) => x.segment) : Array.from(s);
  parts = parts.filter((g) => !JOINERS.test(g));
  return parts.length ? parts : ['🔥'];
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { ease, clamp, random, u } = fx;
  const W = fx.width, H = fx.height, S = Math.min(W, H);
  const glyphs = graphemes(p.emoji);
  const count = Math.max(0, Math.min(80, Math.round(num(p.count, 14))));
  if (!count) return;
  const spread = clamp(num(p.spread, 0.5));
  const size = Math.max(8, num(p.size, 90)) * u;
  const g = Math.max(0, num(p.gravity, 1)) * 1.6 * S; // px / s^2

  let ox = clamp(num(p.x, 0.5)) * W, oy = clamp(num(p.y, 0.45)) * H;
  if (p.from === 'face' && fx.face) { ox = fx.face.x; oy = fx.face.y - fx.face.h * 0.25; }

  const endFade = clamp((fx.duration - fx.t) / 0.2);
  if (endFade <= 0) return;

  // Set the font once at the largest size and scale down per particle so glyphs stay crisp.
  const maxScale = 1.3;
  ctx.font = `${Math.round(size * maxScale)}px ${EMOJI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const base = ctx.getTransform();
  const baseAlpha = ctx.globalAlpha;
  const half = spread * Math.PI * 0.45 + 0.12; // half-angle of the fan
  const drag = 2.2;

  for (let i = 0; i < count; i++) {
    const r = (k) => random(i * 7.31 + k * 1.93 + 11);
    const a = fx.t - r(0) * 0.12; // small stagger
    if (a <= 0) continue;
    const ang = -Math.PI / 2 + (r(1) * 2 - 1) * half;
    const speed = S * (0.55 + 0.7 * r(2)) * (0.6 + spread * 0.8);
    const vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed;
    const travel = (1 - Math.exp(-drag * a)) / drag;
    const x = ox + vx * travel;
    const y = oy + vy * travel + 0.5 * g * a * a;

    const life = 0.85 + r(3) * 0.6;
    const pop = ease.outBack(clamp(a / 0.22));
    const die = clamp((life - a) / 0.3);
    const alpha = clamp(a / 0.06) * ease.outQuad(die) * endFade;
    if (alpha <= 0.002) continue;
    const sc = Math.max(0, (0.7 + 0.55 * r(4)) * pop * (0.85 + 0.15 * die)) / maxScale;
    const rot = (r(5) - 0.5) * 0.6 + (r(6) - 0.5) * 2 * 2.6 * a;

    ctx.setTransform(base);
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(sc, sc);
    ctx.globalAlpha = baseAlpha * alpha;
    ctx.fillText(glyphs[i % glyphs.length], 0, 0);
  }
  ctx.setTransform(base);
  ctx.globalAlpha = baseAlpha;
}
