// Edit by text: click a word to jump there, select words to cut or emphasise them,
// double-click a word to fix its spelling.
import { api, h, prompt, confirmBox } from '../lib.js';
import { wordKept } from '../render/captions.js';

export class TranscriptPanel {
  constructor(ed) {
    this.ed = ed;
    this.el = h('div', { class: 'panel' });
    this.spans = [];
    this.nowIdx = -1;
    this.el.addEventListener('mouseup', () => setTimeout(() => this.onSelect(), 0));
  }

  show() { this.draw(); }

  selectedRange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !this.el.contains(sel.anchorNode)) return null;
    const idx = (node) => { const el = node?.nodeType === 3 ? node.parentElement : node; return el?.closest?.('[data-i]') ? +el.closest('[data-i]').dataset.i : null; };
    let a = idx(sel.anchorNode), b = idx(sel.focusNode);
    if (a == null || b == null) return null;
    if (a > b) [a, b] = [b, a];
    return [a, b];
  }

  onSelect() {
    const r = this.selectedRange();
    this.bar?.remove();
    if (!r) return;
    const [a, b] = r;
    const n = b - a + 1;
    const ids = Array.from({ length: n }, (_, k) => a + k);
    const ed = this.ed;
    const struck = new Set(ed.spec?.cuts?.words || []);
    const allStruck = ids.every((i) => struck.has(i));
    this.bar = h('div', { class: 'sel-bar' },
      h('span', { class: 'muted' }, `${n} word${n === 1 ? '' : 's'}`), h('div', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => this.setCut(ids, !allStruck) }, allStruck ? 'Restore' : '✂︎ Cut'),
      h('button', { class: 'btn small', onclick: () => this.emphasise(ids) }, 'Emphasise'),
      h('button', { class: 'btn small ghost', onclick: () => { ed.chatPanel.input.value = `For the words "${ids.map((i) => ed.transcript.words[i].w).join(' ')}" (${ed.transcript.words[a].s.toFixed(2)}s–${ed.transcript.words[b].e.toFixed(2)}s): `; ed.showTab('ai'); ed.chatPanel.input.focus(); } }, 'Ask AI'));
    this.el.prepend(this.bar);
  }

  setCut(ids, cut) {
    window.getSelection()?.removeAllRanges();
    this.bar?.remove();
    this.ed.patchSpec((s) => {
      s.cuts ||= {};
      const set = new Set(s.cuts.words || []);
      for (const i of ids) cut ? set.add(i) : set.delete(i);
      s.cuts.words = [...set].sort((x, y) => x - y);
    }, cut ? 'cut words' : 'restore words').then(() => this.draw());
  }

  emphasise(ids) {
    window.getSelection()?.removeAllRanges();
    this.bar?.remove();
    this.ed.patchSpec((s) => {
      s.captions ||= {};
      s.captions.emphasis ||= {};
      const color = this.ed.engine.spec.captions.highlight || '#FFE14D';
      const on = ids.some((i) => !s.captions.emphasis[i]);
      for (const i of ids) { if (on) s.captions.emphasis[i] = { color, scale: 1.15 }; else delete s.captions.emphasis[i]; }
    }, 'emphasis').then(() => this.draw());
  }

  async fixWord(i) {
    const ed = this.ed;
    const w = ed.transcript.words[i];
    const v = await prompt('Fix this word (captions use it)', w.w);
    if (v == null || v.trim() === w.w) return;
    w.w = v.trim();
    await api.put(`/api/projects/${ed.id}/files/transcript.json`, ed.transcript);
    await ed.setTranscript(ed.transcript);
    this.draw();
  }

  async retranscribe() {
    if (!(await confirmBox('Transcribe again?', 'This re-runs speech recognition with your current Settings (choose "Accurate" there for better results). Your manual word fixes will be replaced.', 'Transcribe'))) return;
    await this.ed.rerunAnalysis(['transcript']);
    this.draw();
  }

  draw() {
    const ed = this.ed;
    const words = ed.transcript?.words || [];
    const tl = ed.engine?.timeline;
    const struck = new Set(ed.spec?.cuts?.words || []);
    const emph = ed.spec?.captions?.emphasis || {};
    this.el.innerHTML = '';
    this.bar = null;
    const silence = ed.engine?.spec?.cuts?.silence?.enabled;
    this.el.append(h('div', { class: 'row', style: { marginBottom: '10px' } },
      h('label', { class: 'row muted' }, h('input', { type: 'checkbox', class: 'toggle', checked: !!silence, onchange: (e) => ed.patchSpec((s) => { s.cuts ||= {}; s.cuts.silence = { ...(ed.engine.spec.cuts.silence || {}), enabled: e.target.checked }; }, 'silence').then(() => this.draw()) }), 'Cut silences'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn small ghost', onclick: () => this.retranscribe() }, 'Transcribe again')));
    if (!words.length) { this.el.append(h('p', { class: 'muted' }, 'No speech found in this video.')); return; }
    this.el.append(h('div', { class: 'hint', style: { marginBottom: '8px' } }, 'Select words to cut them. Double-click a word to fix it. Grey = removed by silence or AI cuts.'));
    const box = h('div', { class: 'words' });
    this.spans = words.map((w, i) => {
      const cls = ['word', struck.has(i) ? 'struck' : tl && !wordKept(w, tl) ? 'cut' : '', emph[i] ? 'emph' : ''].join(' ');
      const sp = h('span', { class: cls, 'data-i': i, title: `${w.s.toFixed(2)}s`, onclick: () => { if (window.getSelection()?.isCollapsed) ed.seekSrc(w.s + 0.01); }, ondblclick: (e) => { e.preventDefault(); this.fixWord(i); } }, w.w);
      box.append(sp, ' ');
      if (i < words.length - 1 && words[i + 1].s - w.e > 1.2) box.append(h('br'));
      return sp;
    });
    this.el.append(box);
    this.nowIdx = -1;
  }

  tick(t) {
    if (!this.spans.length || !this.el.isConnected) return;
    const words = this.ed.transcript?.words || [];
    let i = this.nowIdx;
    if (i < 0 || i >= words.length || t < words[i].s || (words[i + 1] && t >= words[i + 1].s)) {
      i = -1;
      for (let k = 0; k < words.length; k++) { if (words[k].s <= t) i = k; else break; }
    }
    if (i === this.nowIdx) return;
    this.spans[this.nowIdx]?.classList.remove('now');
    this.nowIdx = i;
    const sp = this.spans[i];
    if (sp) {
      sp.classList.add('now');
      const r = sp.getBoundingClientRect(), pr = this.el.getBoundingClientRect();
      if (r.top < pr.top + 40 || r.bottom > pr.bottom - 20) this.el.scrollTop += r.top - pr.top - pr.height / 3;
    }
  }
}
