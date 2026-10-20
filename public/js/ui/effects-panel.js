// Effects: the ones you saved, the ones the AI wrote for this video, and the built-in gallery.
// Add one at the playhead, or ask the AI to place it where it fits.
import { api, h, add, toast } from '../lib.js';
import { saveEffectToLibrary, deleteMyEffect, effectName } from './my-effects.js';

const ORDER = ['Person', 'Text', 'Explainer', 'UI', 'Brand', 'Transition', 'Look', 'Overlay', 'Particles'];

export class EffectsPanel {
  constructor(ed) {
    this.ed = ed;
    this.el = h('div', { class: 'panel' });
    this.list = null;
    this.mine = [];
    this.filter = '';
  }

  async show() {
    if (!this.list) this.list = (await api.get('/api/effects')).filter((e) => !e.error);
    this.mine = await api.get('/api/my-effects').catch(() => []);
    this.draw();
  }

  refresh() { if (this.el.isConnected) this.show(); }

  add(e, presetName) {
    const ed = this.ed;
    const tl = ed.engine.timeline;
    const start = ed.currentSrc();
    const end = tl.toSrc(Math.min(tl.outDuration, tl.toOut(start) + (e.duration || 3)));
    const props = presetName ? { ...(e.presets?.[presetName] || {}) } : {};
    let key;
    ed.patchSpec((s) => {
      s.layers ||= [];
      key = `fx-${e.file.split('/').pop().replace('.js', '')}-${Math.random().toString(36).slice(2, 5)}`;
      s.layers.push({ type: 'custom', id: key, file: e.file, start: +start.toFixed(2), end: +Math.max(start + 0.5, end).toFixed(2), props });
    }, `add ${e.name}`).then(() => { ed.select(key); toast(`Added ${e.name}. Drag it on the timeline or ask the AI to adjust it.`, 'ok'); });
  }

  ask(e) {
    const ed = this.ed;
    ed.chatPanel.input.value = `Use the "${e.name}" effect (${e.file}) where it fits this video best. Adapt its props (text, colours, position, timing) to what I'm saying.`;
    ed.chatPanel.onInput();
    ed.showTab('ai');
    ed.chatPanel.input.focus();
  }

  item(e, { mine = false } = {}) {
    return h('div', { class: 'fx-item' },
      h('div', { class: 't' }, e.name, (e.needs || []).includes('person') ? h('span', { class: 'faint', title: 'Uses AI person cut-out' }, ' ✂︎') : null),
      e.description ? h('div', { class: 'd' }, e.description) : null,
      e.presets && Object.keys(e.presets).length ? h('div', { class: 'chips' }, Object.keys(e.presets).map((p) => h('button', { class: 'chip', onclick: () => this.add(e, p) }, p))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => this.add(e) }, 'Add here'),
        h('button', { class: 'btn small ghost', onclick: () => this.ask(e) }, 'Ask AI'),
        mine ? h('button', { class: 'icon-btn', title: 'Delete from my effects', onclick: async () => { if (await deleteMyEffect(e)) this.show(); } }, '✕') : null));
  }

  draw() {
    const ed = this.ed;
    const q = this.filter.toLowerCase();
    const match = (e) => !q || `${e.name} ${e.description} ${e.category}`.toLowerCase().includes(q);
    const groups = new Map();
    for (const e of this.list.filter(match)) {
      const c = e.category || 'Other';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(e);
    }
    const cats = [...groups.keys()].sort((a, b) => (ORDER.indexOf(a) + 99) % 99 - (ORDER.indexOf(b) + 99) % 99);
    const search = h('input', { class: 'input', placeholder: `Search ${this.list.length + this.mine.length} effects…`, value: this.filter, oninput: (ev) => { this.filter = ev.target.value; this.draw(); search.focus(); } });

    // Effects the AI wrote for this video, each one a click away from your library.
    const savedNames = new Set(this.mine.map((m) => m.name));
    const here = (ed.files || []).filter((f) => /^effects\/[\w.-]+\.js$/.test(f.path));
    const hereList = here.length ? h('div', { class: 'fx-here' }, here.map((f) => {
      const label = h('b', {}, f.path.slice(8).replace(/\.js$/, ''));
      const btn = h('button', { class: 'btn small', onclick: async () => { if (await saveEffectToLibrary(ed, f.path)) this.show(); } }, 'Save to my effects');
      effectName(ed, f.path).then((n) => { if (n) { label.textContent = n; if (savedNames.has(n)) { btn.textContent = 'Saved ✓'; btn.title = 'Already in your effects. Click to save this version over it.'; } } });
      return h('div', { class: 'row fx-here-row' }, '✨', label, h('div', { class: 'spacer' }), btn);
    })) : null;

    this.el.innerHTML = '';
    add(this.el,
      search,
      h('div', { class: 'hint', style: { margin: '8px 0 0' } }, 'Every effect is editable code. Add one, then tell the AI how to change it. Describe one that doesn\'t exist and the AI builds it.'),
      hereList ? [h('div', { class: 'fx-cat' }, 'Made for this video'), hereList] : null,
      h('div', { class: 'fx-cat' }, 'My effects'),
      this.mine.filter(match).length
        ? h('div', { class: 'fx-grid' }, this.mine.filter(match).map((e) => this.item(e, { mine: true })))
        : h('p', { class: 'hint' }, q ? 'None of yours match.' : 'Effects you save show up here and in every video. Ask the AI for something new ("a neon ring around me that pulses on the beat"), then press Save under its reply.'),
      cats.map((c) => [
        h('div', { class: 'fx-cat' }, c),
        h('div', { class: 'fx-grid' }, groups.get(c).map((e) => this.item(e))),
      ]));
  }
}
