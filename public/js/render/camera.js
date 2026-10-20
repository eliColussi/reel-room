// Virtual camera: smooth face tracking, auto-reframe, and zooms.
import { ease, clamp, lerp } from './anim.js';

// faces: [{ t, x, y, w, h }] with x/y = face center, all normalized to the source frame.
export function buildFaceTrack(faces, duration) {
  const pts = (faces || []).filter((f) => f && Number.isFinite(f.x)).sort((a, b) => a.t - b.t);
  if (!pts.length) return null;
  const step = 0.1;
  const n = Math.max(2, Math.ceil(duration / step) + 1);
  const xs = new Float32Array(n), ys = new Float32Array(n), hs = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = i * step;
    while (j < pts.length - 1 && pts[j + 1].t <= t) j++;
    const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
    let k = 0;
    if (t <= pts[0].t) { k = 0; } else if (b !== a && b.t - a.t < 1.5) k = clamp((t - a.t) / (b.t - a.t));
    else if (b !== a && t - a.t > b.t - t) k = 1;
    xs[i] = lerp(a.x, b.x, k); ys[i] = lerp(a.y, b.y, k); hs[i] = lerp(a.h, b.h, k);
  }
  // Gaussian smoothing (sigma 0.5s) so the camera glides instead of jittering.
  const smooth = (arr) => {
    const sigma = 5, r = 15, out = new Float32Array(n);
    const wts = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
    for (let i = 0; i < n; i++) {
      let sum = 0, wsum = 0;
      for (let k = -r; k <= r; k++) { const idx = i + k; if (idx < 0 || idx >= n) continue; sum += arr[idx] * wts[k + r]; wsum += wts[k + r]; }
      out[i] = sum / wsum;
    }
    return out;
  };
  const sx = smooth(xs), sy = smooth(ys), sh = smooth(hs);
  // Dead zone: ignore drifts under 3% so a still speaker gets a perfectly still frame.
  const dz = 0.03;
  const cx = new Float32Array(n), cy = new Float32Array(n);
  cx[0] = sx[0]; cy[0] = sy[0];
  for (let i = 1; i < n; i++) {
    const dxv = sx[i] - cx[i - 1], dyv = sy[i] - cy[i - 1];
    cx[i] = Math.abs(dxv) > dz ? sx[i] - Math.sign(dxv) * dz : cx[i - 1];
    cy[i] = Math.abs(dyv) > dz ? sy[i] - Math.sign(dyv) * dz : cy[i - 1];
  }
  const cxs = smooth(cx), cys = smooth(cy);
  return {
    at(t) {
      const f = clamp(t / step, 0, n - 1);
      const i = Math.floor(f), k = f - i, i2 = Math.min(n - 1, i + 1);
      return { x: lerp(cxs[i], cxs[i2], k), y: lerp(cys[i], cys[i2], k), h: lerp(sh[i], sh[i2], k) };
    },
  };
}

// Zoom factor and focus at this moment, from the zooms list (output-time easing) and punchZoom.
export function zoomAt(spec, timeline, srcT) {
  const outT = timeline.toOut(srcT);
  let z = 1, focus = null;
  for (const zm of spec.zooms) {
    const s = +zm.start, e = +zm.end;
    if (srcT < s || srcT >= e) continue;
    const a = timeline.toOut(s), b = timeline.toOut(e);
    const dur = Math.max(0.01, b - a), lt = clamp(outT - a, 0, dur);
    const target = Math.max(1, +zm.scale || 1.2);
    let k;
    switch (zm.ease) {
      case 'snap': k = 1; break;
      case 'push': k = ease.inOutQuad(lt / dur); break;
      case 'pull': k = 1 - ease.inOutQuad(lt / dur); break;
      default: {
        const r = Math.min(0.4, dur / 3);
        k = lt < r ? ease.inOutCubic(lt / r) : lt > dur - r ? ease.inOutCubic((dur - lt) / r) : 1;
      }
    }
    const zz = lerp(1, target, k);
    if (zz > z) { z = zz; focus = zm.focus ?? 'face'; }
  }
  const pz = +spec.cuts.punchZoom || 1;
  if (pz !== 1) {
    const seg = timeline.segmentAt(srcT);
    if (seg && seg.i % 2 === 1) z *= pz;
  }
  return { z, focus };
}

// Which part of the source to draw, and where. Returns source rect + destination rect.
export function computeView({ srcW, srcH, W, H, frame, face, zoom }) {
  const fit = frame.fit === 'fit';
  const scale = Math.max(0.2, +frame.scale || 1);
  const base = (fit ? Math.min(W / srcW, H / srcH) : Math.max(W / srcW, H / srcH)) * scale;
  // Destination: full frame for fill; centered box for fit.
  let dw = W, dh = H, dx = 0, dy = 0;
  let vw = W / base, vh = H / base;
  if (fit) {
    dw = srcW * base; dh = srcH * base;
    dx = (W - dw) / 2; dy = (H - dh) / 2 + (+frame.offsetY || 0) * (H - dh) / 2;
    vw = srcW; vh = srcH;
  }
  vw = Math.min(vw, srcW); vh = Math.min(vh, srcH);
  if (!fit && vw < W / base - 0.5) { dw = vw * base; dx = (W - dw) / 2; }
  if (!fit && vh < H / base - 0.5) { dh = vh * base; dy = (H - dh) / 2; }

  // Camera center in source pixels.
  let cx = srcW / 2, cy = srcH / 2;
  const useFace = face && frame.track === 'face';
  if (useFace) {
    cx = face.x * srcW;
    // Keep the face a little above center, with headroom like a camera operator would.
    cy = face.y * srcH + vh * 0.08;
  }
  if (!fit) {
    cx += (+frame.offsetX || 0) * Math.max(0, srcW - vw) / 2;
    cy += (+frame.offsetY || 0) * Math.max(0, srcH - vh) / 2;
  } else { cx = srcW / 2; cy = srcH / 2; }

  const z = zoom?.z || 1;
  if (z > 1.0001) {
    vw /= z; vh /= z;
    let fx = cx, fy = cy;
    const f = zoom.focus;
    if (Array.isArray(f)) { fx = clamp(+f[0]) * srcW; fy = clamp(+f[1]) * srcH; }
    else if (f === 'face' && face) { fx = face.x * srcW; fy = face.y * srcH + vh * 0.06; }
    else if (f === 'center') { fx = srcW / 2; fy = srcH / 2; }
    const k = clamp((z - 1) / 0.12);
    cx = lerp(cx, fx, k); cy = lerp(cy, fy, k);
  }
  const sx = clamp(cx - vw / 2, 0, Math.max(0, srcW - vw));
  const sy = clamp(cy - vh / 2, 0, Math.max(0, srcH - vh));
  return { sx, sy, sw: vw, sh: vh, dx, dy, dw, dh };
}
