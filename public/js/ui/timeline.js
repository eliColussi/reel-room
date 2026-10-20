// Timeline strip: waveform, cuts, caption blocks, layers and zooms. Click to seek,
// drag a bar to move it, drag its edge to trim it.
import { h, fmtTime } from '../lib.js';

const COLORS = { text: '#c8ff3d', emoji: '#ffd60a', gif: '#ff7ab6', image: '#5ce1e6', video: '#a78bfa', shape: '#fb923c', progress: '#94a3b8', custom: '#60a5fa', zoom: '#f472b6' };
const PAD = 12;

export class Timeline {
  constructor(ed) {
    this.ed = ed;
    this.canvas = h('canvas');
    this.el = h('div', { class: 'timeline' }, this.canvas);
    this.bars = [];
    this.drag = null;
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(this.el);
  }

  destroy() { this.ro.disconnect(); }

  get dur() { return Math.max(0.01, this.ed.engine?.timeline?.outDuration || 1); }
  xOf(t) { return PAD + (t / this.dur) * (this.cw - PAD * 2); }
  tOf(x) { return Math.max(0, Math.min(this.dur, ((x - PAD) / (this.cw - PAD * 2)) * this.dur)); }

  draw() {
    const ed = this.ed, eng = ed.engine;
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const cw = (this.cw = c.clientWidth), ch = (this.ch = c.clientHeight);
    if (!cw) return;
    if (c.width !== Math.round(cw * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
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

    // Waveform of the kept audio + cut markers.
    const top = 22, wh = 34;
    x.fillStyle = '#1a1a1f';
    x.fillRect(PAD, top, cw - PAD * 2, wh);
    const env = ed.analysis?.audio;
    if (env?.db?.length) {
      x.fillStyle = '#3a3a44';
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

    // Caption blocks.
    let y = top + wh + 6;
    x.fillStyle = '#2b2b33';
    for (const p of eng.captions.pages) {
      const a = this.xOf(tl.toOut(p.s)), b = this.xOf(tl.toOut(p.e));
      if (b - a > 0.5) x.fillRect(a, y, Math.max(1, b - a - 1), 10);
    }
    y += 16;

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
  }

  hit(px, py) {
    for (let i = this.bars.length - 1; i >= 0; i--) {
      const b = this.bars[i];
      if (px >= b.x0 - 3 && px <= b.x1 + 3 && py >= b.y0 - 2 && py <= b.y1 + 2) return b;
    }
    return null;
  }

  pos(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  down(e) {
    const [px, py] = this.pos(e);
    this.canvas.setPointerCapture(e.pointerId);
    const bar = this.hit(px, py);
    if (bar) {
      const edge = px < bar.x0 + 6 ? 'start' : px > bar.x1 - 6 ? 'end' : 'move';
      this.drag = { bar, edge, x0: px, a: bar.a, b: bar.b, moved: false };
      this.ed.select(bar.kind === 'zoom' ? `zoom:${bar.index}` : bar.l._key);
    } else {
      this.drag = { scrub: true };
      this.ed.seekOut(this.tOf(px));
    }
  }

  move(e) {
    const [px, py] = this.pos(e);
    if (!this.drag) {
      const bar = this.hit(px, py);
      this.canvas.style.cursor = bar ? (px < bar.x0 + 6 || px > bar.x1 - 6 ? 'ew-resize' : 'grab') : 'pointer';
      return;
    }
    if (this.drag.scrub) { this.ed.seekOut(this.tOf(px)); return; }
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
    if (!d || d.scrub || !d.moved || d.na == null) return;
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
