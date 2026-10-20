// Copies of the speaker: smaller clones standing either side, or ghost echoes that fan out sideways.
export const meta = {
  name: 'Person clones',
  category: 'Person',
  description: 'Clones of you slide out from behind you, or ghost echoes fan out to the sides. Use it for "me, me and me" jokes or to sell a big idea.',
  props: {
    count: 2, // number of copies (max 8)
    mode: 'side', // 'side' = smaller clones standing behind you, 'echo' = full-size ghosts that fan out
    direction: 'both', // 'both' | 'left' | 'right'
    spacing: 0.28, // gap between copies, fraction of frame width
    scale: 0.85, // size of each step back (side mode); echoes shrink half as fast
    opacity: 0.55,
    tint: null, // null = natural color, or a color to wash the copies in
  },
  presets: {
    'Squad': { mode: 'side', count: 2, spacing: 0.28, scale: 0.85, opacity: 0.9 },
    'Crowd': { mode: 'side', count: 4, spacing: 0.2, scale: 0.86, opacity: 0.85 },
    'Echo': { mode: 'echo', count: 4, spacing: 0.1, opacity: 0.4 },
    'Blue ghosts': { mode: 'echo', count: 2, spacing: 0.16, opacity: 0.5, tint: '#3D7BFF' },
    'Trail right': { mode: 'echo', direction: 'right', count: 3, spacing: 0.09, opacity: 0.45 },
  },
  needs: ['person'],
  duration: 3,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

export default function draw(ctx, fx) {
  const person = fx.person();
  if (!person) return;
  const p = fx.props || {};
  const { ease, clamp, lerp } = fx;
  const W = fx.width, H = fx.height;

  const count = Math.max(0, Math.min(8, Math.round(num(p.count, 2))));
  if (!count) return;
  const echo = p.mode === 'echo';
  const dir = p.direction === 'left' ? -1 : p.direction === 'right' ? 1 : 0;
  const spacing = num(p.spacing, 0.28) * W;
  const scale = clamp(num(p.scale, 0.85), 0.2, 1.5);
  const opacity = clamp(num(p.opacity, 0.55));
  const ax = fx.face ? fx.face.x : W / 2; // the speaker's center line

  // Optional tint, applied once to a copy of the cut-out.
  let src = person;
  if (p.tint) {
    const c = fx.canvas('tinted');
    const x = c.getContext('2d');
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(person, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    x.globalAlpha = 0.6;
    x.fillStyle = p.tint;
    x.fillRect(0, 0, c.width, c.height);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    src = c;
  }

  // Lay out copies: alternate sides (or one side), stepping further out each ring.
  const clones = [];
  for (let i = 0; i < count; i++) {
    const ring = dir ? i + 1 : Math.floor(i / 2) + 1;
    const sign = dir || (i % 2 === 0 ? -1 : 1);
    clones.push({ ring, sign });
  }
  const outK = ease.outCubic(clamp((fx.duration - fx.t) / 0.25));
  // Echo: quick spread, then a slow drift outward for the rest of the layer.
  const fan = echo ? 0.8 * ease.outCubic(clamp(fx.t / 0.5)) + 0.2 * ease.inOutQuad(clamp(fx.t / Math.max(0.6, fx.duration))) : 1;

  // Furthest copies first so nearer ones overlap them.
  clones.sort((a, b) => b.ring - a.ring);
  for (const { ring, sign } of clones) {
    const delay = (ring - 1) * 0.07;
    const inK = ease.outCubic(clamp((fx.t - delay) / 0.45));
    const k = Math.min(inK, outK);
    if (k <= 0.001) continue;
    const s = echo ? Math.pow(lerp(1, scale, 0.5), ring) : Math.pow(scale, ring);
    const alpha = opacity * (echo ? Math.pow(0.65, ring - 1) : Math.pow(0.8, ring - 1)) * clamp(k * 1.6);
    const dx = sign * ring * spacing * k * fan;
    const sk = lerp(1, s, k);
    ctx.save();
    ctx.globalAlpha *= alpha;
    // Scale from the bottom edge so every copy stands on the same floor.
    ctx.translate(ax + dx, H);
    ctx.scale(sk, sk);
    ctx.translate(-ax, -H);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  }

  // The real speaker stays in front.
  ctx.drawImage(person, 0, 0);
}
