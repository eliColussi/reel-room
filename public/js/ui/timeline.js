// Timeline strip: waveform with the pauses marked, cuts, captions, layers and zooms.
// Click to seek. Click a pause to cut it. Drag across the waveform to select a part, then cut it.
// Drag a bar to move it, drag its edge to trim it.
import { h, fmtTime } from '../lib.js';
import { findSilences } from '../render/timeline.js';

const COLORS = { text: '#c8ff3d', emoji: '#ffd60a', gif: '#ff7ab6', image: '#5ce1e6', video: '#a78bfa', shape: '#fb923c', progress: '#94a3b8', custom: '#60a5fa', zoom: '#f472b6' };
const PAD = 12;
const WAVE_TOP = 22, WAVE_H = 40;

export class Timeline {
  constructor(ed) {
    this.ed = ed;
    this.canvas = h('canvas');
    this.pauseInfo = h('span', { class: 'muted' });
    this.pauseBtn = h('button', { class: 'btn small', onclick: () => this.toggleAllPauses() });
    this.selInfo = h('span', { class: 'sel-info' });
    this.cutBtn = h('button', { class: 'btn small danger', style: { display: 'none' }, onclick: () => this.cutSelection() }, '✂ Cut selection');
    this.head = h('div', { class: 'tl-head' },
      h('span', { class: 'tl-pauses' }, h('i', { class: 'swatch' }), this.pauseInfo), this.pauseBtn,
      h('div', { class: 'spacer' }), this.selInfo, this.cutBtn,
      h('span', { class: 'hint tl-tip' }, 'Click a pause to cut it · drag across the sound wave to select'));
    this.el = h('div', { class: 'timeline' }, this.head, this.canvas);
    this.bars = [];
    this.pauses = [];
    this.selection = null;
    this.drag = null;
    this.hover = null;
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointerleave', () => { if (this.hover) { this.hover = null; this.draw(); } });
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(this.el);
  }

  destroy() { this.ro.disconnect(); }

  get dur() { return Math.max(0.01, this.ed.engine?.timeline?.outDuration || 1); }
  xOf(t) { return PAD + (t / this.dur) * (this.cw - PAD * 2); }
  tOf(x) { return Math.max(0, Math.min(this.dur, ((x - PAD) / (this.cw - PAD * 2)) * this.dur)); }

  // Pauses in the speech (source seconds) with the padding the silence cutter would keep.
  allPauses() {
    const eng = this.ed.engine, audio = this.ed.analysis?.audio;
    const sil = eng.spec.cuts.silence || {};
    const minGap = +sil.minGap || 0.45, pad = Math.max(0, +sil.padding || 0.12);
    const key = `${minGap}|${pad}|${audio?.db?.length}`;
    if (this.pauseKey !== key) {
      const D = eng.timeline.duration;
      this.pauseCache = findSilences(audio, { minGap }).map(([a, b]) => [a <= 0.05 ? 0 : a + pad, b >= D - 0.05 ? D : b - pad]).filter(([a, b]) => b - a > 0.1);
      this.pauseKey = key;
    }
    return this.pauseCache;
  }

  draw() {
    const ed = this.ed, eng = ed.engine;
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const cw = (this.cw = c.clientWidth), ch = (this.ch = c.clientHeight);
    if (!cw) return;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, cw, ch);
    if (!eng?.timeline) return;
    const tl = eng.timeline, dur = this.dur;
    this.bars = [];

    // Ruler.
    x.fillStyle = '#5d5d68';
    x.font = '10px ui-monospace, monospace';
    const step = dur > 120 ? 10 : dur > 40 ? 5 : dur > 15 ? 2 : 1;
    for (let t = 0; t <= dur; t += step) {
      const px = this.xOf(t);
      x.fillRect(px, 14, 1, 4);
      x.fillText(fmtTime(t).replace(/\.\d$/, ''), px + 3, 11);
    }

    // Waveform of the kept audio.
    const top = WAVE_TOP, wh = WAVE_H;
    x.fillStyle = '#1a1a1f';
    x.fillRect(PAD, top, cw - PAD * 2, wh);

    // Pauses still in the video: amber, with a ✂ on hover.
    this.pauses = [];
    for (const [a, b] of this.allPauses()) {
      if (tl.isCut((a + b) / 2)) continue;
      const oa = tl.toOut(a), ob = tl.toOut(b);
      if (ob - oa < 0.1) continue;
      const pa = this.xOf(oa), pb = this.xOf(ob);
      const hot = this.hover?.kind === 'pause' && this.hover.a === a;
      x.fillStyle = hot ? 'rgba(255,181,71,0.42)' : 'rgba(255,181,71,0.16)';
      x.fillRect(pa, top, Math.max(2, pb - pa), wh);
      if (hot) {
        x.fillStyle = '#ffb547';
        x.font = '600 11px Inter, sans-serif';
        x.textAlign = 'center';
        x.fillText(`✂ ${(b - a).toFixed(1)}s`, (pa + pb) / 2, top + wh / 2 + 4);
        x.textAlign = 'left';
      }
      this.pauses.push({ a, b, x0: pa, x1: pb });
    }

    const env = ed.analysis?.audio;
    if (env?.db?.length) {
      x.fillStyle = '#4a4a56';
      for (let px = PAD; px < cw - PAD; px += 2) {
        const src = tl.toSrc(this.tOf(px));
        const db = env.db[Math.min(env.db.length - 1, Math.floor(src * env.rate))] ?? -90;
        const amp = Math.max(0, (db + 60) / 60);
        const hh = Math.max(1, amp * (wh - 6));
        x.fillRect(px, top + wh / 2 - hh / 2, 1.5, hh);
      }
    }
    x.fillStyle = '#ff5a5f';
    for (const s of tl.segments.slice(1)) x.fillRect(this.xOf(s.out) - 0.5, top, 1, wh);

    // Selection.
    const sel = this.drag?.select ? [Math.min(this.drag.a, this.drag.b), Math.max(this.drag.a, this.drag.b)] : this.selection;
    if (sel) {
      const sa = this.xOf(sel[0]), sb = this.xOf(sel[1]);
      x.fillStyle = 'rgba(255,90,95,0.22)';
      x.fillRect(sa, top, sb - sa, wh);
      x.strokeStyle = '#ff5a5f';
      x.lineWidth = 1;
      x.strokeRect(sa + 0.5, top + 0.5, sb - sa - 1, wh - 1);
    }

    // Caption blocks with their words.
    let y = top + wh + 6;
    x.font = '500 9.5px Inter, sans-serif';
    for (const p of eng.captions.pages) {
      const a = this.xOf(tl.toOut(p.s)), b = this.xOf(tl.toOut(p.e));
      if (b - a <= 0.5) continue;
      x.fillStyle = '#2b2b33';
      x.fillRect(a, y, Math.max(1, b - a - 1), 13);
      if (b - a > 22) {
        x.fillStyle = '#a3a3ad';
        x.save(); x.beginPath(); x.rect(a, y, b - a - 3, 13); x.clip();
        x.fillText(p.words.map((w) => w.text).join(' '), a + 3, y + 10);
        x.restore();
      }
    }
    y += 19;

    // Layers packed into lanes.
    const lanes = [];
    const items = eng.layers.map((l) => ({ kind: 'layer', l, a: tl.toOut(l.start), b: Number.isFinite(l.end) ? tl.toOut(Math.min(l.end, tl.duration)) : dur }));
    for (const it of items.sort((p, q) => p.a - q.a)) {
      let lane = lanes.findIndex((end) => end <= it.a + 0.01);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = it.b;
      it.lane = Math.min(lane, 3);
    }
    for (const it of items) {
      const by = y + it.lane * 15, a = this.xOf(it.a), b = Math.max(a + 4, this.xOf(it.b));
      x.fillStyle = COLORS[it.l.type] || '#888';
      x.globalAlpha = ed.selected === it.l._key ? 1 : 0.75;
      roundRect(x, a, by, b - a, 12, 3); x.fill();
      x.globalAlpha = 1;
      if (ed.selected === it.l._key) { x.strokeStyle = '#fff'; x.lineWidth = 1.5; roundRect(x, a, by, b - a, 12, 3); x.stroke(); }
      if (b - a > 40) {
        x.fillStyle = '#0b0b0d';
        x.font = '600 9.5px Inter, sans-serif';
        const label = it.l.type === 'text' ? String(it.l.text || '').replace(/\*/g, '') : it.l.type === 'custom' ? String(it.l.file || '').split('/').pop().replace('.js', '') : it.l.emoji || it.l.query || it.l.type;
        x.save(); x.beginPath(); x.rect(a, by, b - a - 4, 12); x.clip(); x.fillText(label, a + 4, by + 9); x.restore();
      }
      this.bars.push({ ...it, x0: a, x1: b, y0: by, y1: by + 12 });
    }
    y += Math.max(1, Math.min(4, lanes.length)) * 15 + 2;

    // Zooms.
    eng.spec.zooms.forEach((z, i) => {
      const a = this.xOf(tl.toOut(+z.start)), b = Math.max(a + 3, this.xOf(tl.toOut(+z.end)));
      x.fillStyle = COLORS.zoom;
      x.globalAlpha = ed.selected === `zoom:${i}` ? 1 : 0.6;
      roundRect(x, a, y, b - a, 8, 2); x.fill();
      x.globalAlpha = 1;
      this.bars.push({ kind: 'zoom', index: i, z, a: tl.toOut(+z.start), b: tl.toOut(+z.end), x0: a, x1: b, y0: y, y1: y + 8 });
    });

    // Playhead.
    const ph = this.xOf(tl.toOut(ed.currentSrc()));
    x.fillStyle = '#ececf1';
    x.fillRect(ph - 1, 0, 2, ch);
    x.beginPath(); x.moveTo(ph - 5, 0); x.lineTo(ph + 5, 0); x.lineTo(ph, 6); x.fill();

    this.drawHead();
  }

  drawHead() {
    const eng = this.ed.engine;
    const on = !!eng.spec.cuts.silence?.enabled;
    const n = this.pauses.length, secs = this.pauses.reduce((t, p) => t + (p.b - p.a), 0);
    const total = this.allPauses().length;
    const key = `${on}|${n}|${secs.toFixed(1)}|${total}`;
    if (key !== this.headKey) {
      this.headKey = key;
      if (n) {
        this.pauseInfo.textContent = `${n} pause${n === 1 ? '' : 's'} · ${secs.toFixed(1)}s`;
        this.pauseBtn.textContent = '✂ Cut all pauses';
        this.pauseBtn.style.display = '';
      } else if (on && total) {
        this.pauseInfo.textContent = `Pauses cut (${total})`;
        this.pauseBtn.textContent = 'Put them back';
        this.pauseBtn.style.display = '';
      } else {
        this.pauseInfo.textContent = total ? 'No pauses left' : 'No long pauses';
        this.pauseBtn.style.display = 'none';
      }
    }
    const sel = this.selection;
    this.cutBtn.style.display = sel ? '' : 'none';
    this.selInfo.textContent = sel ? `${fmtTime(sel[0])} – ${fmtTime(sel[1])} (${(sel[1] - sel[0]).toFixed(1)}s)` : '';
  }

  toggleAllPauses() {
    const ed = this.ed;
    const on = !!ed.engine.spec.cuts.silence?.enabled;
    const leftover = this.pauses.length;
    ed.patchSpec((s) => {
      s.cuts ||= {};
      if (on && leftover) {
        // Silence cutting is on but some pauses were left (a bigger minGap): cut those one by one.
        s.cuts.ranges = [...(s.cuts.ranges || []), ...this.pauses.map((p) => ({ start: +p.a.toFixed(3), end: +p.b.toFixed(3), note: 'pause' }))];
      } else {
        s.cuts.silence = { ...(ed.engine.spec.cuts.silence || {}), enabled: !on };
        if (on) s.cuts.ranges = (s.cuts.ranges || []).filter((r) => r.note !== 'pause');
      }
    }, on && !leftover ? 'keep pauses' : 'cut pauses');
  }

  cutPause(p) {
    this.hover = null;
    this.ed.patchSpec((s) => {
      s.cuts ||= {};
      s.cuts.ranges = [...(s.cuts.ranges || []), { start: +p.a.toFixed(3), end: +p.b.toFixed(3), note: 'pause' }];
    }, 'cut pause');
  }

  cutSelection() {
    const sel = this.selection;
    if (!sel) return;
    const tl = this.ed.engine.timeline;
    const a = tl.toSrc(sel[0]), b = tl.toSrc(sel[1]);
    this.selection = null;
    if (b - a < 0.05) { this.draw(); return; }
    this.ed.patchSpec((s) => {
      s.cuts ||= {};
      s.cuts.ranges = [...(s.cuts.ranges || []), { start: +a.toFixed(3), end: +b.toFixed(3), note: 'cut by hand' }];
    }, 'cut part').then(() => this.ed.seekSrc(a));
  }

  hit(px, py) {
    for (let i = this.bars.length - 1; i >= 0; i--) {
      const b = this.bars[i];
      if (px >= b.x0 - 3 && px <= b.x1 + 3 && py >= b.y0 - 2 && py <= b.y1 + 2) return b;
    }
    return null;
  }

  inWave(py) { return py >= WAVE_TOP && py <= WAVE_TOP + WAVE_H; }
  pauseAt(px, py) { return this.inWave(py) ? this.pauses.find((p) => px >= p.x0 - 2 && px <= p.x1 + 2) : null; }

  pos(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  down(e) {
    const [px, py] = this.pos(e);
    this.canvas.setPointerCapture(e.pointerId);
    const bar = this.hit(px, py);
    if (bar) {
      const edge = px < bar.x0 + 6 ? 'start' : px > bar.x1 - 6 ? 'end' : 'move';
      this.drag = { bar, edge, x0: px, a: bar.a, b: bar.b, moved: false };
      this.ed.select(bar.kind === 'zoom' ? `zoom:${bar.index}` : bar.l._key);
    } else if (this.inWave(py)) {
      const t = this.tOf(px);
      this.drag = { select: true, x0: px, a: t, b: t, pause: this.pauseAt(px, py) };
      this.selection = null;
      this.ed.seekOut(t);
    } else {
      this.drag = { scrub: true };
      this.selection = null;
      this.ed.seekOut(this.tOf(px));
    }
  }

  move(e) {
    const [px, py] = this.pos(e);
    if (!this.drag) {
      const bar = this.hit(px, py);
      const pause = !bar && this.pauseAt(px, py);
      this.canvas.style.cursor = bar ? (px < bar.x0 + 6 || px > bar.x1 - 6 ? 'ew-resize' : 'grab') : pause ? 'pointer' : this.inWave(py) ? 'text' : 'pointer';
      const hv = pause ? { kind: 'pause', a: pause.a } : null;
      if ((hv?.a ?? null) !== (this.hover?.a ?? null)) { this.hover = hv; this.draw(); }
      return;
    }
    if (this.drag.scrub) { this.ed.seekOut(this.tOf(px)); return; }
    if (this.drag.select) {
      this.drag.b = this.tOf(px);
      if (Math.abs(px - this.drag.x0) > 3) this.drag.moved = true;
      this.draw();
      return;
    }
    const d = this.drag;
    const dt = ((px - d.x0) / (this.cw - PAD * 2)) * this.dur;
    if (Math.abs(px - d.x0) > 2) d.moved = true;
    if (!d.moved) return;
    let a = d.a, b = d.b;
    if (d.edge === 'move') { a = d.a + dt; b = d.b + dt; }
    if (d.edge === 'start') a = Math.min(d.b - 0.1, d.a + dt);
    if (d.edge === 'end') b = Math.max(d.a + 0.1, d.b + dt);
    a = Math.max(0, a); b = Math.min(this.dur, b);
    d.na = a; d.nb = b;
    this.ed.previewRetime(d.bar, a, b, d.edge);
  }

  up() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.select) {
      if (d.moved && Math.abs(d.b - d.a) > 0.08) this.selection = [Math.min(d.a, d.b), Math.max(d.a, d.b)];
      else if (d.pause) { this.cutPause(d.pause); return; }
      this.draw();
      return;
    }
    if (d.scrub || !d.moved || d.na == null) return;
    // previewRetime already moved it in the spec; this saves it as one undoable step.
    this.ed.patchSpec(() => {}, 'retime');
  }
}

function roundRect(x, a, y, w, hh, r) {
  x.beginPath();
  x.moveTo(a + r, y);
  x.arcTo(a + w, y, a + w, y + hh, r);
  x.arcTo(a + w, y + hh, a, y + hh, r);
  x.arcTo(a, y + hh, a, y, r);
  x.arcTo(a, y, a + w, y, r);
  x.closePath();
}
