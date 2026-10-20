// Gallery of built-in effects. Add one at the playhead, or ask the AI to place it where it fits.
import { api, h, add, toast } from '../lib.js';

const ORDER = ['Person', 'Text', 'Explainer', 'UI', 'Brand', 'Transition', 'Look', 'Overlay', 'Particles'];

export class EffectsPanel {
  constructor(ed) {
    this.ed = ed;
    this.el = h('div', { class: 'panel' });
    this.list = null;
    this.filter = '';
  }

  async show() {
    if (!this.list) this.list = (await api.get('/api/effects')).filter((e) => !e.error);
    this.draw();
  }

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
    this.ed.chatPanel.input.value = `Use the "${e.name}" effect (${e.file}) where it fits this video best. Adapt its props (text, colours, position, timing) to what I'm saying.`;
    this.ed.showTab('ai');
    this.ed.chatPanel.input.focus();
  }

  draw() {
    const groups = new Map();
    const q = this.filter.toLowerCase();
    for (const e of this.list) {
      if (q && !`${e.name} ${e.description} ${e.category}`.toLowerCase().includes(q)) continue;
      const c = e.category || 'Other';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(e);
    }
    const cats = [...groups.keys()].sort((a, b) => (ORDER.indexOf(a) + 99) % 99 - (ORDER.indexOf(b) + 99) % 99);
    const search = h('input', { class: 'input', placeholder: `Search ${this.list.length} effects…`, value: this.filter, oninput: (ev) => { this.filter = ev.target.value; this.draw(); search.focus(); } });
    this.el.innerHTML = '';
    add(this.el,
      search,
      h('div', { class: 'hint', style: { margin: '8px 0 0' } }, 'Every effect is editable code. Add one, then tell the AI how to change it: colours, shapes, timing, anything.'),
      cats.map((c) => [
        h('div', { class: 'fx-cat' }, c),
        h('div', { class: 'fx-grid' }, groups.get(c).map((e) => h('div', { class: 'fx-item' },
          h('div', { class: 't' }, e.name, (e.needs || []).includes('person') ? h('span', { class: 'faint', title: 'Uses AI person cut-out' }, ' ✂︎') : null),
          h('div', { class: 'd' }, e.description),
          e.presets && Object.keys(e.presets).length ? h('div', { class: 'chips' }, Object.keys(e.presets).map((p) => h('button', { class: 'chip', onclick: () => this.add(e, p) }, p))) : null,
          h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => this.add(e) }, 'Add here'), h('button', { class: 'btn small ghost', onclick: () => this.ask(e) }, 'Ask AI'))))),
      ]));
  }
}
