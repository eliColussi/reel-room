// An end card: the video blurs and dims, then an avatar, your handle, a call to action and a button rise in, one after another.
export const meta = {
  name: 'End Card',
  category: 'Brand',
  description: 'A closing screen with your photo, handle, a call to action and a follow button. Use it in the last two seconds of a reel.',
  props: {
    handle: '@yourname',
    cta: 'Follow for part 2',
    button: 'Follow', // '' = no button
    pressed: '', // e.g. 'Following': the button gets tapped and switches to this
    accent: '#C8FF3D',
    buttonText: '#0B0B0C',
    color: '#FFFFFF',
    dim: 0.55,
    blur: true, // blur the video behind
    font: 'Inter',
    y: 0.42,
    avatarSize: 220,
  },
  presets: {
    'Tap to follow': { pressed: 'Following' },
    'Link in bio': { cta: 'Free template in my bio', button: 'Link in bio' },
    'No button': { button: '' },
  },
  fonts: ['Inter'],
  duration: 3,
};

function setFont(ctx, weight, px, family, spacing = 0) {
  ctx.font = `${weight} ${Math.max(1, px)}px "${String(family || 'Inter').replace(/"/g, '')}", system-ui, sans-serif`;
  try { ctx.letterSpacing = `${spacing}px`; } catch (e) { /* older canvas */ }
}

function initials(handle) {
  const parts = String(handle || '').replace(/^@/, '').split(/[._\-\s]+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0][0]).toUpperCase();
}

export default function draw(ctx, fx) {
  const p = fx.props || {};
  const { t, duration, width: W, height: H, u, ease, clamp } = fx;
  const base = ctx.globalAlpha;
  const exit = clamp((duration - t) / 0.3);
  if (exit <= 0) return;
  const accent = p.accent || '#C8FF3D';
  const color = p.color || '#FFFFFF';
  const at = (d, len = 0.45) => ease.outCubic(clamp((t - d) / len));

  // Backdrop: blurred, dimmed video.
  const bk = at(0, 0.4) * exit;
  const v = p.blur !== false && typeof fx.video === 'function' ? fx.video() : null;
  if (v && bk > 0) {
    const sw = Math.max(8, Math.ceil(W / 10)), sh = Math.max(8, Math.ceil(H / 10));
    const c = fx.canvas('blur', sw, sh);
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, sw, sh);
    g.filter = 'blur(3px)';
    g.drawImage(v, -6, -6, sw + 12, sh + 12);
    g.filter = 'none';
    ctx.save();
    ctx.globalAlpha = base * bk;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, W, H);
    ctx.restore();
  }
  const dim = clamp(Number.isFinite(+p.dim) ? +p.dim : 0.55);
  if (dim > 0 && bk > 0) {
    ctx.save();
    ctx.globalAlpha = base * bk;
    ctx.fillStyle = `rgba(0,0,0,${dim})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // Stack layout, centered on y.
  const A = Math.max(20, (+p.avatarSize || 220) * u);
  const hpx = 64 * u, cpx = 40 * u, bpx = 36 * u;
  const btnH = bpx * 2.5;
  const hasBtn = !!String(p.button ?? '').trim();
  const stackH = A + 40 * u + hpx * 1.15 + (p.cta ? 14 * u + cpx * 1.3 : 0) + (hasBtn ? 46 * u + btnH : 0);
  const cx = W / 2;
  let y = H * (p.y ?? 0.42) - stackH / 2;

  ctx.save();
  ctx.globalAlpha = base * exit;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Avatar
  const ak = clamp((t - 0.1) / 0.5);
  if (ak > 0) {
    const s = fx.lerp(0.6, 1, ease.outBack(ak));
    const acy = y + A / 2;
    ctx.save();
    ctx.globalAlpha *= clamp(ak * 3);
    ctx.translate(cx, acy);
    ctx.scale(s, s);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5 * u;
    ctx.beginPath();
    ctx.arc(0, 0, A / 2 + 10 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ease.outCubic(clamp((t - 0.2) / 0.6)));
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, A / 2, 0, Math.PI * 2);
    ctx.clip();
    const img = (fx.images || []).find(Boolean);
    if (img) fx.cover(img, -A / 2, -A / 2, A, A);
    else {
      ctx.fillStyle = '#26262A';
      ctx.fillRect(-A / 2, -A / 2, A, A);
      setFont(ctx, 800, A * 0.36, p.font, -A * 0.01);
      ctx.fillStyle = color;
      ctx.fillText(initials(p.handle), 0, A * 0.02);
    }
    ctx.restore();
    ctx.restore();
  }
  y += A + 40 * u;

  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 20 * u;
  ctx.shadowOffsetY = 4 * u;
  const hk = at(0.28);
  if (hk > 0) {
    ctx.save();
    ctx.globalAlpha *= hk;
    setFont(ctx, 800, hpx, p.font, -0.6 * u);
    ctx.fillStyle = color;
    ctx.fillText(String(p.handle ?? ''), cx, y + hpx * 0.575 + (1 - hk) * 18 * u, W * 0.9);
    ctx.restore();
  }
  y += hpx * 1.15;
  if (p.cta) {
    y += 14 * u;
    const ck = at(0.38);
    if (ck > 0) {
      ctx.save();
      ctx.globalAlpha *= ck * 0.8;
      setFont(ctx, 400, cpx, p.font);
      ctx.fillStyle = color;
      ctx.fillText(String(p.cta), cx, y + cpx * 0.65 + (1 - ck) * 14 * u, W * 0.9);
      ctx.restore();
    }
    y += cpx * 1.3;
  }

  if (hasBtn) {
    y += 46 * u;
    const bk2 = clamp((t - 0.5) / 0.45);
    if (bk2 > 0) {
      const pressAt = 1.5;
      const pressed = String(p.pressed ?? '').trim();
      const isPressed = pressed && t >= pressAt + 0.12;
      const label = isPressed ? pressed : String(p.button);
      setFont(ctx, 700, bpx, p.font);
      const bw = Math.max(btnH * 2.6, ctx.measureText(label).width + btnH * 1.1);
      const press = pressed ? 1 - 0.07 * Math.sin(Math.PI * clamp((t - pressAt) / 0.24)) : 1;
      const s = fx.lerp(0.7, 1, ease.outBack(bk2)) * press;
      const bcy = y + btnH / 2;
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha *= clamp(bk2 * 3);
      // A soft ring that breathes out from the button to pull the eye.
      if (!isPressed) {
        const ph = ((t - 1.0) % 1.8 + 1.8) % 1.8;
        const rk = t > 1.0 ? clamp(ph / 0.9) : 0;
        if (rk > 0 && rk < 1) {
          ctx.save();
          ctx.globalAlpha *= 0.5 * (1 - rk);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 3 * u;
          const g = 18 * u * ease.outCubic(rk);
          fx.roundRect(cx - bw / 2 - g, bcy - btnH / 2 - g, bw + g * 2, btnH + g * 2, btnH / 2 + g);
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.translate(cx, bcy);
      ctx.scale(s, s);
      ctx.fillStyle = isPressed ? 'rgba(255,255,255,0.16)' : accent;
      fx.roundRect(-bw / 2, -btnH / 2, bw, btnH, btnH / 2);
      ctx.fill();
      ctx.fillStyle = isPressed ? color : p.buttonText || '#0B0B0C';
      ctx.fillText(label, 0, 1 * u);
      ctx.restore();
    }
  }
  ctx.restore();
}
