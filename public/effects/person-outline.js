// A clean border traced around the speaker's silhouette: sticker edge, neon glow or thin ink line.
export const meta = {
  name: 'Person outline',
  category: 'Person',
  description: 'Traces a border around you like a die-cut sticker or a neon sign. Use it to lift you off a busy background.',
  props: {
    color: '#FFFFFF',
    width: 10, // outline thickness (1080-px units)
    glow: 0, // glow blur in the outline color, 0 = none
    shadow: 24, // soft drop shadow under the outline, 0 = none
    fade: 0.35, // seconds for the outline to grow in
  },
  presets: {
    'Sticker': { color: '#FFFFFF', width: 14, glow: 0, shadow: 30 },
    'Neon': { color: '#39FF14', width: 4, glow: 40, shadow: 0 },
    'Ink': { color: '#111111', width: 8, glow: 0, shadow: 0 },
  },
  needs: ['person'],
  duration: 3,
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);

// The person mask comes from a ~384px model, so the silhouette work runs at reduced
// resolution: it looks the same and the dilation passes cost a fraction of full frame.
const SCALE = 0.4;
const RING = 12;

export default function draw(ctx, fx) {
  const mask = fx.mask();
  const person = fx.person();
  if (!mask || !person) return;
  const p = fx.props || {};
  const { ease, clamp, u } = fx;
  const W = fx.width, H = fx.height;

  const fade = Math.max(0, num(p.fade, 0.35));
  const outDur = Math.min(0.22, fade);
  const inK = fade > 0 ? ease.outCubic(clamp(fx.t / fade)) : 1;
  const outK = outDur > 0 ? ease.outCubic(clamp((fx.duration - fx.t) / outDur)) : 1;
  const k = Math.min(inK, outK);
  if (k <= 0.001) return;

  const color = p.color || '#FFFFFF';
  const sw = Math.max(8, Math.round(W * SCALE)), sh = Math.max(8, Math.round(H * SCALE));

  // 1. Silhouette in the outline color.
  const sil = fx.canvas('silhouette', sw, sh);
  const s = sil.getContext('2d');
  s.globalAlpha = 1;
  s.globalCompositeOperation = 'source-over';
  s.clearRect(0, 0, sw, sh);
  s.drawImage(mask, 0, 0, sw, sh);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = color;
  s.fillRect(0, 0, sw, sh);
  s.globalCompositeOperation = 'source-over';

  // 2. Dilate: stamp the silhouette around a circle. The overlap also hardens the soft mask edge.
  const r = Math.max(0, num(p.width, 10)) * u * SCALE * k;
  const dil = fx.canvas('dilated', sw, sh);
  const d = dil.getContext('2d');
  d.globalAlpha = 1;
  d.globalCompositeOperation = 'source-over';
  d.clearRect(0, 0, sw, sh);
  d.drawImage(sil, 0, 0);
  if (r > 0.2) {
    for (let i = 0; i < RING; i++) {
      const a = (i / RING) * Math.PI * 2;
      d.drawImage(sil, Math.cos(a) * r, Math.sin(a) * r);
    }
    // An inner ring fills gaps around thin details (fingers, hair) on thick outlines.
    if (r > 4) {
      for (let i = 0; i < 6; i++) {
        const a = ((i + 0.5) / 6) * Math.PI * 2;
        d.drawImage(sil, Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
      }
    }
  }

  // 3. Composite outline (+ shadow / glow) and the person on top, off-screen, then place it once.
  const comp = fx.canvas('composite');
  const c = comp.getContext('2d');
  c.save();
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, comp.width, comp.height);
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  const shadow = Math.max(0, num(p.shadow, 24)) * u;
  const glow = Math.max(0, num(p.glow, 0)) * u;
  let drawn = false;
  if (shadow > 0) {
    c.shadowColor = `rgba(0,0,0,${(0.42 * k).toFixed(3)})`;
    c.shadowBlur = shadow;
    c.shadowOffsetY = shadow * 0.35;
    c.drawImage(dil, 0, 0, W, H);
    drawn = true;
  }
  if (glow > 0) {
    c.shadowColor = color;
    c.shadowOffsetY = 0;
    c.shadowBlur = glow * k;
    c.drawImage(dil, 0, 0, W, H);
    c.shadowBlur = glow * 0.35 * k; // hot inner glow
    c.drawImage(dil, 0, 0, W, H);
    drawn = true;
  }
  c.shadowColor = 'transparent';
  c.shadowBlur = 0;
  c.shadowOffsetY = 0;
  if (!drawn) c.drawImage(dil, 0, 0, W, H);
  c.drawImage(person, 0, 0);
  c.restore();

  ctx.drawImage(comp, 0, 0);
}
