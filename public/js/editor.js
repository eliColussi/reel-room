// The editor screen: live preview and timeline on the left, the chat on the right. Style, Effects,
// Transcript, Media and Code are tools that open above the chat box, which never goes away.
import { api, h, add, toast, fmtTime, debounce, canvasBlob, confirmBox } from './lib.js';
import { Engine } from './render/engine.js';
import { Assets } from './render/media.js';
import { applyLook, clone } from './spec.js';
import { analyze, openInput } from './analyze.js';
import { autoClean } from './cleanup.js';
import { findSilences } from './render/timeline.js';
import { loadMediabunny } from './cdn.js';
import { Timeline } from './ui/timeline.js';
import { ChatPanel } from './ui/chat.js';
import { StylePanel } from './ui/style-panel.js';
import { EffectsPanel } from './ui/effects-panel.js';
import { TranscriptPanel } from './ui/transcript.js';
import { MediaPanel } from './ui/media-panel.js';
import { openExport } from './ui/export-modal.js';
import { aiPill } from './ui/settings.js';

export async function openEditor(root, id, state) {
  const data = await api.get(`/api/projects/${id}`);
  const ed = new Editor(root, id, state, data);
  window.__ed = ed; // handy in DevTools
  await ed.init();
  return ed;
}

const TABS = [['ai', '💬 Chat'], ['style', 'Style'], ['effects', 'Effects'], ['text', 'Transcript'], ['media', 'Media'], ['json', 'Code']];

class Editor {
  constructor(root, id, state, data) {
    this.root = root;
    this.id = id;
    this.state = state;
    this.project = data.project;
    this.spec = data.edit;
    this.style = data.style;
    this.transcript = data.transcript || { words: [] };
    this.analysis = data.analysis || {};
    this.files = data.files || [];
    this.chat = data.chat || [];
    this.variants = data.variants || [];
    this.aiBusyAtOpen = data.aiBusy;
    this.canUndo = data.canUndo;
    this.canRedo = data.canRedo;
    this.assets = new Assets(id);
    this.engine = new Engine(this.assets);
    this.playing = false;
    this.dirty = true;
    this.selected = null;
    this.safeZones = false;
    this.clips = new Map();
    this.clipFrames = {};
    this.gifCache = new Map();
    this.prepToken = 0;
    this.resolveGif = (q) => {
      if (!this.gifCache.has(q)) this.gifCache.set(q, api.get(`/api/projects/${id}/gif?q=${encodeURIComponent(q)}`).then((r) => r.src).catch(() => null));
      return this.gifCache.get(q);
    };
    this.webCache = new Map();
    this.resolveWeb = (q) => {
      if (!this.webCache.has(q)) this.webCache.set(q, api.get(`/api/projects/${id}/web-image?q=${encodeURIComponent(q)}`).then((r) => r.src).catch(() => null));
      return this.webCache.get(q);
    };
    this.reportSoon = debounce(() => this.writeReport(), 1500);
  }

  // ---------- layout ----------
  build() {
    // Two players take turns: while one plays a kept part, the other already waits at the start of
    // the next one. Cuts then play back instantly, with no seek stall and no black frame.
    this.players = [0, 1].map(() => h('video', { playsinline: true, preload: 'auto', style: { position: 'fixed', left: '-9999px', width: '2px', height: '2px', opacity: 0 } }));
    this.cur = 0;
    this.canvas = h('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.overlay = h('canvas', { class: 'overlay' });
    this.wrap = h('div', { class: 'canvas-wrap' }, this.canvas, this.overlay);
    this.stageInner = h('div', { class: 'stage-inner' }, this.wrap);
    this.playBtn = h('button', { class: 'play-btn', title: 'Play (space)', onclick: () => (this.playing ? this.pause() : this.play()) }, '▶');
    this.timeEl = h('div', { class: 'time' }, '0:00.0');
    this.undoBtn = h('button', { class: 'btn small ghost', title: 'Undo (⌘Z)', onclick: () => this.undo() }, '↶ Undo');
    this.redoBtn = h('button', { class: 'btn small ghost', title: 'Redo (⇧⌘Z)', onclick: () => this.redo() }, '↷ Redo');
    this.pillSlot = h('span');
    const safeBtn = h('button', { class: 'btn small ghost', onclick: () => { this.safeZones = !this.safeZones; safeBtn.classList.toggle('on', this.safeZones); safeBtn.textContent = this.safeZones ? '▣ Safe zones on' : '▢ Safe zones'; this.dirty = true; } }, '▢ Safe zones');
    this.versionsEl = h('div', { class: 'versions' });
    this.stage = h('div', { class: 'stage' },
      h('div', { class: 'busy-badge' }, h('span', { class: 'spin-logo small' }, '▶'), 'AI is editing…'),
      this.versionsEl,
      this.stageInner,
      h('div', { class: 'stage-controls' }, this.playBtn, this.timeEl, h('div', { class: 'spacer' }),
        h('button', { class: 'btn small ghost', title: 'Copy this edit into a new version, to try something different without losing it', onclick: () => this.duplicateVariant() }, '⧉ New version'),
        safeBtn));

    this.tabBtns = new Map();
    this.panelSlot = h('div', { style: { minHeight: 0, display: 'grid' } });
    const tabs = h('div', { class: 'tabs' }, TABS.map(([k, label]) => {
      const b = h('button', { onclick: () => this.showTab(k) }, label);
      this.tabBtns.set(k, b);
      return b;
    }));
    this.chatPanel = new ChatPanel(this);
    this.side = h('div', { class: 'side' }, tabs, this.panelSlot, this.chatPanel.composer);

    const title = h('input', { class: 'title-input', value: this.project.name || '', onchange: async (e) => { await api.patch(`/api/projects/${this.id}`, { name: e.target.value }); this.project.name = e.target.value; } });
    this.timeline = new Timeline(this);
    this.el = h('div', { class: 'editor' },
      h('div', { class: 'topbar' },
        h('a', { class: 'brand', href: '#/', title: 'All videos' }, h('span', { class: 'brand-mark' }, '▶')),
        h('a', { class: 'btn small ghost', href: '#/' }, '← Videos'),
        title, h('div', { class: 'spacer' }), this.pillSlot, this.undoBtn, this.redoBtn,
        h('button', { class: 'btn primary', onclick: () => this.engine.timeline && openExport(this) }, 'Export')),
      h('div', { class: 'workspace' }, this.stage, this.side),
      this.timeline.el, this.players);
    this.root.append(this.el);
    this.refreshPill();
    this.updateUndo();
    this.renderVersions();

    this.panels = {
      ai: this.chatPanel,
      style: new StylePanel(this),
      effects: new EffectsPanel(this),
      text: new TranscriptPanel(this),
      media: new MediaPanel(this),
      json: { el: h('div', { class: 'panel' }), show: () => this.showJson() },
    };
    this.ro = new ResizeObserver(() => this.fitCanvas());
    this.ro.observe(this.stageInner);
    this.bindInput();
  }

  refreshPill() {
    this.pillSlot.innerHTML = '';
    this.pillSlot.append(aiPill(this.state, () => this.refreshPill()));
  }

  setAiBusy(b) {
    this.stage.classList.toggle('ai-busy', b);
    const dot = this.pillSlot.querySelector('.dot');
    if (dot) dot.className = `dot ${b ? 'busy' : this.state.info?.provider ? 'ok' : 'bad'}`;
    this.undoBtn.disabled = b || !this.canUndo;
    this.redoBtn.disabled = b || !this.canRedo;
  }

  showTab(k) {
    this.tab = k;
    for (const [key, b] of this.tabBtns) b.classList.toggle('on', key === k);
    this.side.classList.toggle('tool-open', k !== 'ai');
    const p = this.panels[k];
    this.panelSlot.innerHTML = '';
    this.panelSlot.append(p.el);
    p.show?.();
  }

  fitCanvas() {
    const W = this.engine.W || 1080, H = this.engine.H || 1920;
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; this.dirty = true; }
    const r = this.stageInner.getBoundingClientRect();
    const k = Math.min((r.width - 36) / W, (r.height - 36) / H);
    const cw = Math.max(80, Math.floor(W * k)), ch = Math.max(80, Math.floor(H * k));
    this.wrap.style.width = `${cw}px`;
    this.wrap.style.height = `${ch}px`;
    const dpr = window.devicePixelRatio || 1;
    this.overlay.width = Math.round(cw * dpr);
    this.overlay.height = Math.round(ch * dpr);
    this.dirty = true;
  }

  // ---------- lifecycle ----------
  async init() {
    this.build();
    const url = `/files/projects/${this.id}/${encodeURIComponent(this.project.source)}`;
    const a = this.project.analysis || {};
    if (!(a.meta && a.audio && a.transcript && a.faces && a.frames)) {
      const ok = await this.runAnalysis();
      if (!ok) return;
    }
    this.players.forEach((v, i) => {
      v.src = url;
      v.muted = i !== this.cur;
      v.addEventListener('seeked', () => { this.dirty = true; });
      v.addEventListener('loadeddata', () => { this.dirty = true; });
      v.addEventListener('error', () => { if (!this.destroyed && v === this.video) this.showDecodeProblem(); });
    });

    if (!this.spec) await this.startFresh();
    await this.rebuild();
    this.fitCanvas();
    const first = this.engine.captions.pages[0];
    this.seekSrc(first ? first.s + Math.min(0.4, (first.e - first.s) / 2) : this.engine.timeline.segments[0].s);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    this.showTab('ai');
    this.reportCleanup();
    if (this.freshStart) toast('Tip: pick a starting look in Style, or just tell the AI what you want.', 'info', 6000);
    if (this.aiBusyAtOpen) this.chatPanel.waitForRunning();
    setTimeout(() => this.uploadPreview().catch(() => {}), 1500);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.timeline?.destroy();
    for (const v of this.players || []) { v.pause(); v.removeAttribute('src'); }
    for (const el of this.clips.values()) { el.pause(); el.removeAttribute('src'); }
    this.music?.pause();
    document.removeEventListener('keydown', this.onKey);
    this.flushSave();
  }

  async startFresh() {
    const styles = await api.get('/api/styles');
    const s = styles.find((x) => x.id === 'clean') || styles[0];
    this.style = clone(s);
    this.spec = applyLook({}, s.look || {});
    await api.put(`/api/projects/${this.id}/files/style.json`, this.style);
    await api.patch(`/api/projects/${this.id}`, { styleId: s.id, styleName: s.name });
    this.freshStart = true;
    if ((this.state.info?.settings || {}).autoClean === 'off') {
      await api.put(`/api/projects/${this.id}/files/edit.json?reason=start`, this.spec);
      return;
    }
    // Save the untouched version first, so one Undo brings back every cut the clean-up made.
    const raw = clone(this.spec);
    raw.cuts = { ...(raw.cuts || {}), silence: { ...(raw.cuts?.silence || {}), enabled: false } };
    await api.put(`/api/projects/${this.id}/files/edit.json?reason=start`, raw);
    const cleaned = autoClean(this.spec, this.transcript?.words || []);
    this.spec = cleaned.spec;
    this.cleaned = cleaned;
    await api.put(`/api/projects/${this.id}/files/edit.json?reason=${encodeURIComponent('auto clean-up')}`, this.spec);
    this.canUndo = true;
  }

  // Tell the user what the automatic clean-up did, once, in the chat.
  async reportCleanup() {
    const c = this.cleaned;
    this.cleaned = null;
    if (!c) return;
    const tl = this.engine.timeline;
    const parts = [];
    if (c.retakes) parts.push(`${c.retakes} repeated take${c.retakes === 1 ? '' : 's'} (kept the last full one each time)`);
    parts.push('the pauses and dead air');
    const text = `✂️ Already cleaned up: cut ${parts.join(' and ')}. ${fmtTime(tl.duration).replace(/\.\d$/, '')} → ${fmtTime(tl.outDuration).replace(/\.\d$/, '')}. Press Undo to put it all back.`;
    await api.post(`/api/projects/${this.id}/chat/note`, { text, kind: 'clean' }).catch(() => {});
    this.chat = [...(this.chat || []), { role: 'system', text, kind: 'clean' }];
    this.chatPanel.render(this.chat);
    this.updateUndo();
  }

  async runAnalysis() {
    const steps = { meta: 'Reading the video', audio: 'Listening to the audio', transcript: 'Writing the transcript', faces: 'Finding your face', frames: 'Grabbing stills for the AI' };
    const rows = {};
    const box = h('div', { class: 'analysis-box' },
      h('b', {}, 'Getting your video ready'),
      h('div', { class: 'hint' }, 'Runs once, on your computer. The first time also downloads the speech model.'),
      Object.entries(steps).map(([k, label]) => {
        const bar = h('div', { class: 'progress' }, h('div'));
        const icon = h('span', {}, '○');
        const text = h('span', {}, label);
        rows[k] = { el: h('div', { class: 'step' }, icon, text, bar), icon, text, bar };
        bar.style.visibility = 'hidden';
        return rows[k].el;
      }));
    const overlay = h('div', { class: 'analysis' }, box);
    this.stage.append(overlay);
    try {
      const settings = this.state.info?.settings || {};
      const meta = await analyze({
        id: this.id, project: this.project, settings,
        onStep: (k, label, p, done) => {
          const r = rows[k];
          if (!r) return;
          r.el.className = `step ${done ? 'done' : 'active'}`;
          r.icon.textContent = done ? '✓' : '◌';
          r.text.textContent = label;
          r.bar.style.visibility = done || p == null ? 'hidden' : 'visible';
          if (p != null) r.bar.firstChild.style.width = `${Math.round(p * 100)}%`;
        },
      });
      const data = await api.get(`/api/projects/${this.id}`);
      this.project = data.project;
      this.project.meta ||= meta;
      this.transcript = data.transcript || { words: [] };
      this.analysis = data.analysis || {};
      this.files = data.files || [];
      overlay.remove();
      return true;
    } catch (e) {
      console.error(e);
      overlay.remove();
      if (e.code === 'decode') this.showDecodeProblem(e.message);
      else this.stage.append(h('div', { class: 'analysis' }, h('div', { class: 'analysis-box' }, h('b', {}, 'Analysis stopped'), h('p', { class: 'muted' }, e.message), h('button', { class: 'btn', onclick: () => location.reload() }, 'Try again'))));
      return false;
    }
  }

  async rerunAnalysis(stepsToRedo) {
    const analysis = { ...(this.project.analysis || {}) };
    for (const s of stepsToRedo) analysis[s] = false;
    await api.patch(`/api/projects/${this.id}`, { analysis });
    this.project.analysis = analysis;
    this.pause();
    if (await this.runAnalysis()) await this.rebuild();
  }

  showDecodeProblem(msg) {
    const canConvert = this.state.info?.ffmpeg;
    const box = h('div', { class: 'analysis-box' },
      h('b', {}, 'This video format won\'t play in the browser'),
      h('p', { class: 'muted' }, msg || 'Chrome can\'t decode this file.'),
      canConvert
        ? h('button', { class: 'btn primary', onclick: async (e) => {
          e.target.disabled = true; e.target.textContent = 'Converting… (can take a minute)';
          try { await api.post(`/api/projects/${this.id}/convert`); await api.patch(`/api/projects/${this.id}`, { analysis: {} }); location.reload(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
        } }, 'Convert it for me')
        : h('p', { class: 'hint' }, 'Fix: on iPhone set Settings → Camera → Formats → Most Compatible, or convert the file to an H.264 MP4 (HandBrake is free) and drop it in again.'));
    this.stage.append(h('div', { class: 'analysis' }, box));
  }

  // ---------- spec ----------
  async rebuild() {
    const eng = this.engine;
    eng.configure({ spec: this.spec || {}, transcript: this.transcript, analysis: this.analysis, meta: this.project.meta, resolution: 1080 });
    this.fitCanvas();
    // If the new cuts removed the moment on screen, jump to the next moment that's still in.
    if (this.video?.src && !this.playing && eng.timeline.isCut(this.currentSrc())) this.seekSrc(this.currentSrc());
    this.dirty = true;
    const token = ++this.prepToken;
    await eng.prepare({ resolveGif: this.resolveGif, resolveWeb: this.resolveWeb });
    if (token !== this.prepToken) return;
    this.dirty = true;
    this.timeline.draw();
    this.setupMusic();
    this.reportSoon();
  }

  async setSpec(next, { reason = 'edit', save = true } = {}) {
    this.spec = next;
    const p = this.rebuild();
    if (save) this.saveSoon(reason);
    if (this.tab === 'text') this.panels.text.draw();
    if (this.tab === 'json') this.showJson();
    await p;
  }

  patchSpec(fn, reason) {
    const next = clone(this.spec || {});
    fn(next);
    return this.setSpec(next, { reason });
  }

  async setTranscript(t) {
    this.transcript = t;
    await this.rebuild();
  }

  saveSoon(reason) {
    this.pendingReason = reason;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 500);
  }

  async flushSave() {
    clearTimeout(this.saveTimer);
    if (!this.pendingReason) return;
    const reason = this.pendingReason;
    this.pendingReason = null;
    await api.put(`/api/projects/${this.id}/files/edit.json?reason=${encodeURIComponent(reason)}`, this.spec).catch((e) => toast(`Couldn't save: ${e.message}`, 'error'));
    this.canUndo = true; this.canRedo = false;
    this.updateUndo();
  }

  updateUndo() {
    this.undoBtn.disabled = !this.canUndo;
    this.redoBtn.disabled = !this.canRedo;
  }

  async undo() { await this.flushSave(); this.moveHistory('undo'); }
  async redo() { await this.flushSave(); this.moveHistory('redo'); }
  async moveHistory(dir) {
    try {
      const r = await api.post(`/api/projects/${this.id}/${dir}`);
      this.spec = r.edit;
      this.canUndo = r.canUndo; this.canRedo = r.canRedo;
      this.updateUndo();
      await this.rebuild();
      if (this.tab === 'text') this.panels.text.draw();
      if (this.tab === 'json') this.showJson();
      toast(`${dir === 'undo' ? 'Undid' : 'Redid'}: ${r.reason}`);
    } catch (e) { toast(e.message); }
  }

  // ---------- versions (Main + trial reels) ----------
  renderVersions() {
    const el = this.versionsEl;
    if (!el) return;
    const vs = this.variants || [];
    el.innerHTML = '';
    el.style.display = vs.length > 1 ? '' : 'none';
    if (vs.length < 2) return;
    const cur = vs.find((v) => v.active);
    add(el,
      h('div', { class: 'ver-row' },
        vs.map((v) => h('button', { class: `ver ${v.active ? 'on' : ''}`, title: v.test ? `Tests: ${v.test}` : v.name, onclick: () => this.openVariant(v.id) },
          v.name,
          v.active || v.id === 'main' ? null : h('span', { class: 'x', title: 'Delete this version', onclick: (e) => { e.stopPropagation(); this.deleteVariant(v); } }, '✕')))),
      cur && (cur.test || cur.caption) ? h('div', { class: 'ver-info' },
        cur.test ? h('span', { class: 'muted' }, `Tests: ${cur.test}`) : null,
        h('div', { class: 'spacer' }),
        cur.caption ? h('button', { class: 'btn small ghost', title: cur.caption, onclick: () => navigator.clipboard.writeText(cur.caption).then(() => toast('Post caption copied.', 'ok')) }, '📋 Copy post caption') : null) : null);
  }

  async openVariant(id) {
    if ((this.variants || []).find((v) => v.active)?.id === id) return;
    if (this.chatPanel.busy) { toast('Wait for the AI to finish first.'); return; }
    await this.flushSave();
    this.pause();
    try {
      const data = await api.post(`/api/projects/${this.id}/variants/switch`, { to: id });
      this.spec = data.edit;
      this.canUndo = data.canUndo; this.canRedo = data.canRedo;
      this.variants = data.variants || [];
      this.files = data.files || this.files;
      this.selected = null;
      this.showInspector();
      this.updateUndo();
      this.renderVersions();
      await this.rebuild();
      if (this.tab === 'text') this.panels.text.draw();
      if (this.tab === 'json') this.showJson();
      const tl = this.engine.timeline;
      this.seekSrc(tl.segments[0].s + 0.05);
      this.uploadPreview().catch(() => {});
    } catch (e) { toast(e.message, 'error'); }
  }

  async duplicateVariant() {
    if (this.chatPanel.busy) { toast('Wait for the AI to finish first.'); return; }
    await this.flushSave();
    const r = await api.post(`/api/projects/${this.id}/variants/duplicate`).catch((e) => { toast(e.message, 'error'); return null; });
    if (!r) return;
    this.variants = r.variants;
    await this.openVariant(r.id);
    toast('Made a copy. Change anything; the other versions stay as they were.', 'ok', 5000);
  }

  async deleteVariant(v) {
    if (!(await confirmBox('Delete this version?', `"${v.name}" will be removed. The other versions stay.`, 'Delete'))) return;
    const r = await api.del(`/api/projects/${this.id}/variants/${v.id}`).catch((e) => { toast(e.message, 'error'); return null; });
    if (r) { this.variants = r.variants; this.renderVersions(); }
  }

  async reloadFiles() {
    const data = await api.get(`/api/projects/${this.id}`);
    this.files = data.files || [];
  }

  // After an AI turn: reload what it changed, check it renders, and bounce errors back once.
  async afterAI(result, { auto } = {}) {
    const data = await api.get(`/api/projects/${this.id}`);
    this.canUndo = data.canUndo; this.canRedo = data.canRedo;
    this.updateUndo();
    this.setAiBusy(false);
    if (result?.variants || data.variants) { this.variants = result?.variants || data.variants; this.renderVersions(); }
    if (result?.variantsChanged) toast('Your versions are ready above the preview. Click one to watch it.', 'ok', 6000);
    if (!result?.changed) return;
    this.spec = data.edit;
    this.style = data.style;
    this.transcript = data.transcript || this.transcript;
    this.files = data.files || [];
    this.assets.bust();
    this.webCache.clear();
    await this.rebuild();
    if (this.tab !== 'ai') this.panels[this.tab].show?.();
    const problems = this.checkRender();
    await this.uploadPreview().catch(() => {});
    if (problems.length && !auto) {
      this.chatPanel.send(`The app hit these problems rendering your last change. Please fix them:\n${problems.map((p) => `- ${p}`).join('\n')}`, { display: '🔧 Sent a rendering error back to the AI to fix', auto: true });
    }
  }

  // Draw the middle of every layer once to surface effect errors and missing files.
  checkRender() {
    const eng = this.engine;
    const src = this.mainSource();
    const c = document.createElement('canvas');
    c.width = eng.W; c.height = eng.H;
    const x = c.getContext('2d');
    const tl = eng.timeline;
    for (const l of eng.layers) {
      const a = tl.toOut(l.start), b = Number.isFinite(l.end) ? tl.toOut(Math.min(l.end, tl.duration)) : tl.outDuration;
      for (const k of [0.1, 0.5, 0.9]) eng.draw(x, tl.toSrc(a + (b - a) * k), { ...src, videos: this.clipFrames });
    }
    this.dirty = true;
    return [...eng.errors.values(), ...eng.warnings.filter((w) => /couldn't|unknown|ends before/i.test(w))];
  }

  async writeReport() {
    if (!this.engine.timeline) return;
    await api.put(`/api/projects/${this.id}/files/render-report.json`, this.engine.report()).catch(() => {});
  }

  // A 3×2 contact sheet of the current edit so the AI can see its own work next turn.
  async uploadPreview() {
    const eng = this.engine;
    if (!eng.timeline) return;
    if (!this.sheetSink) {
      const MB = await loadMediabunny();
      const { input } = await openInput(`/files/projects/${this.id}/${encodeURIComponent(this.project.source)}`);
      const track = await input.getPrimaryVideoTrack();
      this.sheetSink = new MB.CanvasSink(track, track.displayWidth >= track.displayHeight ? { width: 960 } : { height: 960 });
    }
    const tl = eng.timeline;
    const times = Array.from({ length: 6 }, (_, i) => tl.toSrc(((i + 0.5) / 6) * tl.outDuration));
    const full = document.createElement('canvas');
    full.width = eng.W; full.height = eng.H;
    const cw = Math.round(eng.W / 3.2), ch = Math.round(eng.H / 3.2);
    const sheet = document.createElement('canvas');
    sheet.width = cw * 3; sheet.height = ch * 2;
    const sx = sheet.getContext('2d');
    let i = 0;
    for await (const wc of this.sheetSink.canvasesAtTimestamps(times)) {
      const t = times[i];
      if (wc) {
        eng.draw(full.getContext('2d'), t, { main: wc.canvas, mainW: wc.canvas.width, mainH: wc.canvas.height, videos: {} });
        const cx = (i % 3) * cw, cy = Math.floor(i / 3) * ch;
        sx.drawImage(full, cx, cy, cw, ch);
        sx.fillStyle = 'rgba(0,0,0,0.6)'; sx.fillRect(cx, cy, 150, 30);
        sx.fillStyle = '#fff'; sx.font = '600 18px Inter, sans-serif';
        sx.fillText(`src ${t.toFixed(1)}s`, cx + 8, cy + 21);
      }
      i++;
    }
    this.dirty = true;
    await api.put(`/api/projects/${this.id}/files/preview.jpg`, await canvasBlob(sheet, 'image/jpeg', 0.78), 'image/jpeg');
    await this.writeReport();
  }

  // ---------- playback ----------
  get video() { return this.players?.[this.cur]; }

  // The frame to draw. Null while the player is still fetching it (right after a seek): the
  // canvas then keeps showing the previous frame instead of flashing black.
  mainSource() {
    const v = this.video;
    if (!v || v.readyState < 2 || !v.videoWidth || (v.seeking && this.lastDrawn)) return null;
    return { main: v, mainW: v.videoWidth, mainH: v.videoHeight };
  }
  currentSrc() { return this.video?.currentTime || 0; }

  seekSrc(t) {
    const tl = this.engine.timeline;
    if (tl) t = tl.nextKept(Math.max(0, Math.min(tl.duration - 0.01, t)));
    this.video.currentTime = t;
    this.dirty = true;
    if (this.playing) this.primeNext();
  }
  seekOut(o) { this.seekSrc(this.engine.timeline.toSrc(o)); }

  // Park the idle player at the start of the next kept part.
  primeNext() {
    const tl = this.engine.timeline;
    const idle = this.players[1 - this.cur];
    if (!tl || !idle) return;
    const seg = tl.segmentAt(this.currentSrc() + 0.02);
    const next = seg ? tl.segments[seg.i + 1] : tl.segments.find((x) => x.s > this.currentSrc());
    this.nextStart = next ? next.s : null;
    if (next && Math.abs(idle.currentTime - next.s) > 0.02) idle.currentTime = next.s;
  }

  // At a cut: hand over to the idle player if it's ready, otherwise fall back to seeking.
  jumpTo(t) {
    const idle = this.players[1 - this.cur];
    if (this.nextStart != null && Math.abs(this.nextStart - t) < 0.03 && Math.abs(idle.currentTime - t) < 0.05 && idle.readyState >= 2 && !idle.seeking) {
      const old = this.video;
      idle.muted = false;
      idle.play().catch(() => {});
      this.cur = 1 - this.cur;
      old.pause();
      old.muted = true;
      this.primeNext();
    } else {
      this.video.currentTime = t;
      this.primeNext();
    }
  }

  play() {
    const tl = this.engine.timeline;
    if (tl && tl.toOut(this.currentSrc()) >= tl.outDuration - 0.05) this.seekSrc(tl.segments[0].s);
    this.video.muted = false;
    this.video.play().then(() => { this.playing = true; this.playBtn.textContent = '❚❚'; this.primeNext(); }).catch((e) => toast(`Can't play: ${e.message}`, 'error'));
  }
  pause() {
    for (const v of this.players || []) v.pause();
    this.playing = false;
    this.playBtn.textContent = '▶';
    for (const el of this.clips.values()) el.pause();
    this.music?.pause();
    this.dirty = true;
  }

  setupMusic() {
    const m = this.engine.spec?.audio?.music;
    const url = m?.src ? this.assets.url(m.src) : null;
    if (!url) { this.music?.pause(); this.music = null; return; }
    if (!this.music || this.music.dataset.url !== url) {
      this.music?.pause();
      this.music = h('audio', { src: url, preload: 'auto', loop: true });
      this.music.dataset.url = url;
    }
    this.silences = findSilences(this.analysis?.audio, { minGap: 0.35 });
  }

  syncMusic() {
    const a = this.music;
    if (!a) return;
    const m = this.engine.spec.audio.music;
    if (!this.playing) { if (!a.paused) a.pause(); return; }
    const tl = this.engine.timeline, t = this.currentSrc(), outT = tl.toOut(t);
    const talking = !this.silences?.some(([s, e]) => t >= s && t < e);
    let v = (m.volume ?? 0.15) * (talking ? (m.duck ?? 0.35) : 1);
    v *= Math.min(1, (m.fadeIn ?? 0.5) > 0 ? outT / m.fadeIn : 1) * Math.min(1, (m.fadeOut ?? 1.5) > 0 ? Math.max(0, tl.outDuration - outT) / m.fadeOut : 1);
    a.volume = Math.max(0, Math.min(1, v));
    const target = a.duration ? ((+m.offset || 0) + outT) % a.duration : outT;
    if (Math.abs(a.currentTime - target) > 0.35) a.currentTime = target;
    if (a.paused) a.play().catch(() => {});
  }

  // Keep b-roll / background clips in step with the main video.
  syncClips() {
    const needs = this.engine.timeline ? this.engine.videoNeeds(this.currentSrc()) : [];
    const active = new Set();
    const frames = {};
    for (const n of needs) {
      active.add(n.key);
      let el = this.clips.get(n.key);
      if (!el || el.dataset.url !== n.url) {
        el?.pause();
        el = h('video', { src: n.url, muted: true, playsinline: true, preload: 'auto' });
        el.muted = true;
        el.dataset.url = n.url;
        el.addEventListener('seeked', () => { this.dirty = true; });
        el.addEventListener('loadeddata', () => { this.dirty = true; });
        this.clips.set(n.key, el);
      }
      const dur = el.duration;
      const target = Number.isFinite(dur) && dur > 0 ? (n.loop ? n.time % dur : Math.min(n.time, dur - 0.05)) : n.time;
      el.muted = !(n.volume > 0);
      if (n.volume > 0) el.volume = Math.min(1, n.volume);
      if (this.playing) {
        if (el.paused) el.play().catch(() => {});
        if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target;
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - target) > 0.04 && !el.seeking) el.currentTime = target;
      }
      if (el.readyState >= 2) frames[n.key] = el;
    }
    for (const [k, el] of this.clips) if (!active.has(k) && !el.paused) el.pause();
    this.clipFrames = frames;
  }

  loop() {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    const tl = this.engine.timeline;
    if (!tl) return;
    const v = this.video;
    if (this.playing) {
      const t = v.currentTime;
      if (v.ended || tl.toOut(t) >= tl.outDuration - 0.02) { this.pause(); }
      else if (tl.isCut(t + 0.03) && !v.seeking) {
        const nt = tl.nextKept(t + 0.03);
        if (nt >= tl.duration - 0.03) this.pause(); else this.jumpTo(nt);
      }
      this.dirty = true;
    }
    this.syncClips();
    this.syncMusic();
    const main = this.mainSource();
    if (this.dirty && (main || !this.lastDrawn)) {
      this.dirty = false;
      this.lastDrawn = !!main;
      const t = this.currentSrc();
      this.engine.draw(this.ctx, t, { ...main, videos: this.clipFrames });
      this.drawOverlay();
      const now = performance.now();
      if (!this.playing || now - (this.lastTl || 0) > 80) { this.timeline.draw(); this.lastTl = now; }
      this.timeEl.textContent = `${fmtTime(tl.toOut(t))} / ${fmtTime(tl.outDuration)}`;
      if (this.tab === 'text') this.panels.text.tick(t);
    }
  }

  drawOverlay() {
    const o = this.overlay, x = o.getContext('2d');
    x.clearRect(0, 0, o.width, o.height);
    const k = o.width / this.canvas.width;
    if (this.safeZones && this.engine.spec.format.aspect === '9:16') {
      x.fillStyle = 'rgba(255,90,95,0.18)';
      x.strokeStyle = 'rgba(255,90,95,0.6)';
      const zones = [[0, 0, 1, 0.1, 'App header'], [0, 0.82, 1, 0.18, 'Caption & username'], [0.86, 0.38, 0.14, 0.44, 'Buttons']];
      x.font = `${Math.round(11 * (window.devicePixelRatio || 1))}px Inter, sans-serif`;
      for (const [zx, zy, zw, zh, label] of zones) {
        x.fillRect(zx * o.width, zy * o.height, zw * o.width, zh * o.height);
        x.fillStyle = 'rgba(255,255,255,0.8)';
        x.fillText(label, zx * o.width + 6, zy * o.height + 16 * (window.devicePixelRatio || 1));
        x.fillStyle = 'rgba(255,90,95,0.18)';
      }
    }
    if (this.selected) {
      const hit = this.engine.hits.find((hh) => hh.id === this.selected);
      if (hit) {
        x.strokeStyle = '#c8ff3d';
        x.lineWidth = 2 * (window.devicePixelRatio || 1);
        x.setLineDash([6, 4]);
        x.strokeRect(hit.x * k - 4, hit.y * k - 4, hit.w * k + 8, hit.h * k + 8);
      }
    }
  }

  // ---------- selection & direct manipulation ----------
  select(key) {
    this.selected = key;
    this.dirty = true;
    this.timeline.draw();
    this.showInspector();
  }

  // While a timeline bar is dragged: update the spec in place and redraw, save on release.
  previewRetime(bar, a, b, edge) {
    const tl = this.engine.timeline;
    const s = +tl.toSrc(a).toFixed(3), e = +tl.toSrc(b).toFixed(3);
    if (bar.kind === 'zoom') { const z = this.spec.zooms?.[bar.index]; if (z) { z.start = s; z.end = e; } }
    else {
      const l = this.spec.layers?.[bar.l._i];
      if (!l) return;
      if (edge !== 'end') l.start = s;
      if (edge !== 'start' && !(edge === 'move' && l.end == null)) l.end = e;
    }
    this.engine.configure({ spec: this.spec, transcript: this.transcript, analysis: this.analysis, meta: this.project.meta, resolution: 1080 });
    this.dirty = true;
    this.timeline.draw();
  }

  layerIndex(key) {
    const l = this.engine.layers.find((x) => x._key === key);
    return l ? l._i : -1;
  }

  showInspector() {
    this.inspector?.remove();
    this.inspector = null;
    const key = this.selected;
    if (!key) return;
    let obj, apply, del, label;
    if (key === '__captions') {
      this.inspector = h('div', { class: 'inspector' }, h('b', {}, 'Captions'), h('div', { class: 'hint' }, 'Drag them on the preview to move them. Change their look in the Style tab, or ask the AI.'), h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => this.showTab('style') }, 'Open Style'), h('div', { class: 'spacer' }), h('button', { class: 'btn small ghost', onclick: () => this.select(null) }, 'Close')));
      this.stage.append(this.inspector);
      return;
    }
    if (key.startsWith('zoom:')) {
      const i = +key.slice(5);
      obj = this.spec.zooms?.[i];
      label = `Zoom ${i + 1}`;
      apply = (v) => this.patchSpec((s) => { s.zooms[i] = v; }, 'edit zoom');
      del = () => this.patchSpec((s) => { s.zooms.splice(i, 1); }, 'delete zoom');
    } else {
      const i = this.layerIndex(key);
      obj = this.spec.layers?.[i];
      label = obj ? `${obj.type} layer` : '';
      apply = (v) => this.patchSpec((s) => { s.layers[i] = v; }, `edit ${obj.type}`);
      del = () => this.patchSpec((s) => { s.layers.splice(i, 1); }, `delete ${obj.type}`);
    }
    if (!obj) return;
    const ta = h('textarea', { class: 'input', spellcheck: false }, JSON.stringify(obj, null, 2));
    this.inspector = h('div', { class: 'inspector' },
      h('div', { class: 'row' }, h('b', {}, label), h('div', { class: 'spacer' }), h('button', { class: 'icon-btn', title: 'Close', onclick: () => this.select(null) }, '✕')),
      ta,
      h('div', { class: 'row' },
        h('button', { class: 'btn small primary', onclick: () => { try { apply(JSON.parse(ta.value)); toast('Updated.', 'ok'); } catch (e) { toast(`Not valid JSON: ${e.message}`, 'error'); } } }, 'Apply'),
        h('button', { class: 'btn small', onclick: () => this.seekSrc(+obj.start || 0) }, 'Go to'),
        h('button', { class: 'btn small ghost', onclick: () => { this.chatPanel.input.value = `About the ${label}${obj.id ? ` "${obj.id}"` : ''} at ${(+obj.start || 0).toFixed(2)}s: `; this.showTab('ai'); this.chatPanel.input.focus(); } }, 'Ask AI'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn small danger', onclick: () => { del(); this.select(null); } }, 'Delete')));
    this.stage.append(this.inspector);
  }

  bindInput() {
    const toCanvas = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * this.canvas.width, ((e.clientY - r.top) / r.height) * this.canvas.height];
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = toCanvas(e);
      const hit = this.engine.hitTest(x, y);
      if (!hit) { this.select(null); return; }
      this.select(hit.id);
      this.canvas.setPointerCapture(e.pointerId);
      const isCap = hit.id === '__captions';
      const i = isCap ? -1 : this.layerIndex(hit.id);
      const base = isCap ? { x: this.engine.spec.captions.x, y: this.engine.spec.captions.y } : { x: +(this.spec.layers[i]?.x ?? 0.5), y: +(this.spec.layers[i]?.y ?? 0.5) };
      if (!isCap && this.spec.layers[i]?.follow === 'face') { base.x = +(this.spec.layers[i].x || 0); base.y = +(this.spec.layers[i].y || 0); }
      this.dragging = { x0: x, y0: y, base, i, isCap, moved: false };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const d = this.dragging;
      if (!d) return;
      const [x, y] = toCanvas(e);
      const dx = (x - d.x0) / this.canvas.width, dy = (y - d.y0) / this.canvas.height;
      if (Math.abs(x - d.x0) + Math.abs(y - d.y0) > 4) d.moved = true;
      if (!d.moved) return;
      const nx = +(d.base.x + dx).toFixed(3), ny = +(d.base.y + dy).toFixed(3);
      if (d.isCap) { this.spec.captions ||= {}; this.spec.captions.x = nx; this.spec.captions.y = ny; }
      else if (this.spec.layers[d.i]) { this.spec.layers[d.i].x = nx; this.spec.layers[d.i].y = ny; }
      this.engine.configure({ spec: this.spec, transcript: this.transcript, analysis: this.analysis, meta: this.project.meta, resolution: 1080 });
      this.dirty = true;
    });
    this.canvas.addEventListener('pointerup', () => {
      const d = this.dragging;
      this.dragging = null;
      if (d?.moved) { this.saveSoon(d.isCap ? 'move captions' : 'move layer'); this.rebuild(); this.showInspector(); }
    });

    this.onKey = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (typing) return;
      if (e.code === 'Space') { e.preventDefault(); this.playing ? this.pause() : this.play(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const tl = this.engine.timeline;
        this.seekOut(Math.max(0, Math.min(tl.outDuration, tl.toOut(this.currentSrc()) + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1))));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.timeline.selection && !this.selected) {
        e.preventDefault();
        this.timeline.cutSelection();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected && this.selected !== '__captions') {
        e.preventDefault();
        const key = this.selected;
        if (key.startsWith('zoom:')) this.patchSpec((s) => { s.zooms.splice(+key.slice(5), 1); }, 'delete zoom');
        else { const i = this.layerIndex(key); if (i >= 0) this.patchSpec((s) => { s.layers.splice(i, 1); }, 'delete layer'); }
        this.select(null);
      } else if (e.key === 'Escape') { this.select(null); if (this.timeline.selection) { this.timeline.selection = null; this.timeline.draw(); } }
    };
    document.addEventListener('keydown', this.onKey);
  }

  showJson() {
    const p = this.panels.json.el;
    const ta = h('textarea', { class: 'input', spellcheck: false, style: { height: 'calc(100vh - 280px)', fontFamily: 'ui-monospace, monospace', fontSize: '12px' } }, JSON.stringify(this.spec, null, 2));
    p.innerHTML = '';
    p.append(
      h('div', { class: 'hint', style: { marginBottom: '8px' } }, 'The whole edit as data. This is exactly what the AI edits. Change anything and press Apply.'),
      ta,
      h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { class: 'btn primary small', onclick: () => { try { this.setSpec(JSON.parse(ta.value), { reason: 'code edit' }); toast('Applied.', 'ok'); } catch (e) { toast(`Not valid JSON: ${e.message}`, 'error'); } } }, 'Apply'),
        h('button', { class: 'btn small ghost', onclick: async () => { if (await confirmBox('Reset the edit?', 'Clears every cut, layer and zoom and goes back to the current style\'s look. You can undo this.', 'Reset')) this.setSpec(applyLook({}, this.style?.look || {}), { reason: 'reset' }); } }, 'Reset edit'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn small ghost', onclick: () => api.post(`/api/projects/${this.id}/reveal`) }, 'Open project folder')));
  }
}
