// A rubber-stamp word slams down onto the frame with a small shake: rough double border, slight tilt, worn ink.
export const meta = {
  name: 'Stamp',
  category: 'Text',
  description: 'A word stamped onto the screen like a rubber stamp, with worn ink and a quick shake. Use it for verdicts: APPROVED, SOLD, DONE, NOPE.',
  props: {
    text: 'APPROVED',
    color: '#E5383B',
    x: 0.5,
    y: 0.32,
    size: 110,
    rotation: -10,
    font: 'Archivo Black',
    texture: 0.6, // 0 = clean ink, 1 = very worn
    border: true,
    opacity: 0.92,
  },
  presets: {
    'Green': { text: 'DONE', color: '#2BB673' },
    'Rejected': { text: 'REJECTED', color: '#E5383B', rotation: 8 },
    'White': { color: '#FFFFFF', texture: 0.4 },
  },
  fonts: ['Archivo Black'],
  duration: 2.5,
};

function setFont(ctx, px, family, spacing = 0) {
  ctx.font = `400 ${Math.max(1, px)}px "${String(family || 'Archivo Black').replace(/"/g, '')}", Impact, system-ui, sans-serif`;
  try { ctx.letterSpacing = `${spacing}px`; } catch (e) { /* older canvas */ }
}

// Points around a rounded rectangle, nudged a little so the line looks inked, not vector-perfect.
function roughRect(c, fx, x, y, w, h, r, jitter, seed) {
  const pts = [];
  const step = Math.max(6, Math.min(w, h) / 10);
  const edge = (x0, y0, x1, y1) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let i = 0; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  };
  const arc = (cx, cy, a0) => { for (let i = 0; i < 4; i++) { const a = a0 + (i / 4) * (Math.PI / 2); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  edge(x + r, y, x + w - r, y); arc(x + w - r, y + r, -Math.PI / 2);
  edge(x + w, y + r, x + w, y + h - r); arc(x + w - r, y + h - r, 0);
  edge(x + w - r, y + h, x + r, y + h); arc(x + r, y + h - r, Math.PI / 2);
  edge(x, y + h - r, x, y + r); arc(x + r, y + r, Math.PI);
  c.beginPath();
  pts.forEach(([px, py], i) => {
    const jx = (fx.random(seed + i * 1.31) - 0.5) * 2 * jitter;
    const jy = (fx.random(seed + i * 2.17 + 9) - 0.5) * 2 * jitter;
    if (i) c.lineTo(px + jx, py + jy); else c.moveTo(px + jx, py + jy);
  });
  c.closePath();
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const text = String(p.text ?? '').toUpperCase();
  if (!text) return;
  const color = p.color || '#E5383B';

  // Build the stamp artwork on a scratch canvas so the worn-ink cut-outs only affect the stamp.
  let px = Math.max(8, (+p.size || 110) * u);
  setFont(ctx, px, p.font, px * 0.03);
  let tw = ctx.measureText(text).width;
  const maxTw = W * 0.72;
  if (tw > maxTw) { px *= maxTw / tw; setFont(ctx, px, p.font, px * 0.03); tw = ctx.measureText(text).width; }
  const m = ctx.measureText(text);
  const capH = m.actualBoundingBoxAscent || px * 0.72;
  const bt = Math.max(3, px * 0.075);
  const padX = px * 0.42, padY = px * 0.34;
  const bw = tw + padX * 2, bh = capH + padY * 2;
  const margin = Math.ceil(bt * 2 + 8 * u);
  const cw = Math.ceil(bw + margin * 2), ch = Math.ceil(bh + margin * 2);
  const canvas = fx.canvas('stamp', cw, ch);
  const c = canvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.clearRect(0, 0, cw, ch);
  c.fillStyle = color;
  c.strokeStyle = color;
  c.lineJoin = 'round';
  if (p.border !== false) {
    c.lineWidth = bt;
    roughRect(c, fx, margin, margin, bw, bh, px * 0.12, 1.2 * u, 3);
    c.stroke();
    const ins = bt * 1.7;
    c.lineWidth = Math.max(1.5, bt * 0.35);
    roughRect(c, fx, margin + ins, margin + ins, bw - ins * 2, bh - ins * 2, px * 0.07, 0.9 * u, 41);
    c.stroke();
  }
  c.font = ctx.font;
  try { c.letterSpacing = `${px * 0.03}px`; } catch (e) { /* older canvas */ }
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillText(text, cw / 2, ch / 2 + capH / 2);

  // Worn ink: deterministic speckles and a few faded patches knocked out of the artwork.
  const amount = clamp(+p.texture >= 0 ? +p.texture : 0.6);
  if (amount > 0) {
    c.globalCompositeOperation = 'destination-out';
    const specks = Math.round(140 * amount);
    for (let i = 0; i < specks; i++) {
      const r = (0.5 + Math.pow(fx.random(i * 1.37 + 5), 2.2) * 3.4) * u;
      c.globalAlpha = 0.45 + 0.55 * fx.random(i * 4.1 + 2);
      c.beginPath();
      c.arc(fx.random(i * 3.11 + 1) * cw, fx.random(i * 5.73 + 2) * ch, r, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 6; i++) {
      c.globalAlpha = (0.1 + 0.18 * fx.random(i * 7.7 + 30)) * amount;
      c.beginPath();
      c.ellipse(fx.random(i * 2.9 + 31) * cw, fx.random(i * 6.1 + 32) * ch, (20 + 40 * fx.random(i + 33)) * u, (8 + 14 * fx.random(i + 34)) * u, fx.random(i + 35) * Math.PI, 0, Math.PI * 2);
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }

  // Motion: accelerate down into the frame, squash and shake on impact, settle.
  const slam = 0.16;
  const k = clamp(t / slam);
  let scale = fx.lerp(2.3, 1, ease.inQuad(k));
  let dx = 0, dy = 0;
  if (t > slam) {
    const a = t - slam;
    scale *= 1 - 0.04 * Math.sin(Math.PI * clamp(a / 0.14));
    const shake = clamp(1 - a / 0.3);
    dx = Math.sin(a * 95) * 7 * u * shake;
    dy = Math.cos(a * 71) * 4 * u * shake;
  }
  const exitK = clamp((duration - t) / 0.25);
  scale *= 1 + (1 - exitK) * 0.05;
  const rot = (((+p.rotation || 0) + (1 - k) * -6) * Math.PI) / 180;

  const base = ctx.globalAlpha;
  ctx.save();
  ctx.globalAlpha = base * clamp(k * 3) * exitK * clamp(+p.opacity > 0 ? +p.opacity : 0.92);
  ctx.translate(W * (p.x ?? 0.5) + dx, H * (p.y ?? 0.32) + dy);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = 10 * u;
  ctx.shadowOffsetY = 2 * u;
  ctx.drawImage(canvas, -cw / 2, -ch / 2);
  ctx.restore();
}
