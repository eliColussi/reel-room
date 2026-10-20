// Your own material: screenshots, logos, clips, music, sounds. Real material beats stock every time.
import { api, h, add, toast } from '../lib.js';

const kind = (p) => (/\.(png|jpe?g|webp|avif|svg)$/i.test(p) ? 'image' : /\.gif$/i.test(p) ? 'gif' : /\.(mp4|mov|webm|m4v|mkv)$/i.test(p) ? 'video' : /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(p) ? 'audio' : 'file');
const ICON = { image: '🖼️', gif: '🎞️', video: '🎬', audio: '🎵', file: '📄' };

export class MediaPanel {
  constructor(ed) {
    this.ed = ed;
    this.el = h('div', { class: 'panel' });
  }

  async show() {
    this.library = await api.get('/api/library').catch(() => []);
    this.draw();
  }

  async upload(files, toLibrary) {
    const ed = this.ed;
    for (const f of files) {
      const name = f.name.replace(/[^\w.\- ]+/g, '_');
      try {
        if (toLibrary) {
          const folder = /^audio\//.test(f.type) ? 'music' : /^video\//.test(f.type) ? 'clips' : 'images';
          await api.upload(`/api/library/${folder}/${encodeURIComponent(name)}`, f);
        } else await api.upload(`/api/projects/${ed.id}/files/assets/${encodeURIComponent(name)}`, f);
      } catch (e) { toast(e.message, 'error'); }
    }
    await ed.reloadFiles();
    await this.show();
    toast(`Added ${files.length} file${files.length === 1 ? '' : 's'}. The AI can use ${files.length === 1 ? 'it' : 'them'} now.`, 'ok');
  }

  addLayer(path, k) {
    const ed = this.ed;
    const tl = ed.engine.timeline;
    const start = ed.currentSrc();
    const end = tl.toSrc(Math.min(tl.outDuration, tl.toOut(start) + 3));
    let key = `${k}-${Math.random().toString(36).slice(2, 6)}`;
    ed.patchSpec((s) => {
      s.layers ||= [];
      if (k === 'image') s.layers.push({ type: 'image', id: key, src: path, start: +start.toFixed(2), end: +end.toFixed(2), x: 0.5, y: 0.28, width: 520, radius: 18, shadow: 30 });
      if (k === 'gif') s.layers.push({ type: 'gif', id: key, src: path, start: +start.toFixed(2), end: +end.toFixed(2), x: 0.5, y: 0.26, width: 520 });
      if (k === 'video') s.layers.push({ type: 'video', id: key, src: path, start: +start.toFixed(2), end: +end.toFixed(2), fullscreen: true });
    }, `add ${k}`).then(() => ed.select(key));
  }

  setMusic(path) {
    this.ed.patchSpec((s) => { s.audio ||= {}; s.audio.music = { src: path, volume: 0.15, duck: 0.35, fadeIn: 0.5, fadeOut: 1.5, offset: 0 }; }, 'music').then(() => toast('Music added under your voice. It ducks when you talk.', 'ok'));
  }

  addSfx(path) {
    const at = +this.ed.currentSrc().toFixed(2);
    this.ed.patchSpec((s) => { s.audio ||= {}; s.audio.sfx = [...(s.audio.sfx || []), { src: path, at, volume: 0.7 }]; }, 'sound').then(() => toast(`Sound placed at ${at}s.`, 'ok'));
  }

  row(path, url, isLib) {
    const k = kind(path);
    const th = h('div', { class: 'th' }, k === 'image' || k === 'gif' ? '' : ICON[k]);
    if (k === 'image' || k === 'gif') th.style.backgroundImage = `url("${url}")`;
    const actions = [];
    if (k === 'image') actions.push(h('button', { class: 'btn small', onclick: () => this.addLayer(path, 'image') }, 'Add'));
    if (k === 'gif') actions.push(h('button', { class: 'btn small', onclick: () => this.addLayer(path, 'gif') }, 'Add'));
    if (k === 'video') actions.push(h('button', { class: 'btn small', onclick: () => this.addLayer(path, 'video') }, 'B-roll'));
    if (k === 'audio') actions.push(h('button', { class: 'btn small', onclick: () => this.setMusic(path) }, 'Music'), h('button', { class: 'btn small ghost', onclick: () => this.addSfx(path) }, 'Sound here'));
    actions.push(h('button', { class: 'icon-btn', title: 'Remove', onclick: async () => {
      if (isLib) await api.del(`/api/library/${path.slice(8)}`); else await api.del(`/api/projects/${this.ed.id}/files/${path}`);
      await this.ed.reloadFiles(); this.show();
    } }, '✕'));
    return h('div', { class: 'asset' }, th, h('div', {}, h('div', { class: 'nm', title: path }, path.split('/').pop()), h('div', { class: 'hint' }, isLib ? 'Library' : 'This video')), h('div', { class: 'row' }, actions));
  }

  draw() {
    const ed = this.ed;
    const own = (ed.files || []).filter((f) => f.path.startsWith('assets/'));
    const input = h('input', { type: 'file', multiple: true, style: { display: 'none' }, onchange: () => this.upload([...input.files], toLib.checked) });
    const toLib = h('input', { type: 'checkbox', class: 'toggle' });
    const drop = h('div', { class: 'drop', style: { padding: '22px 12px' }, onclick: () => input.click() },
      h('b', {}, 'Drop screenshots, logos, clips, music'), h('p', { class: 'hint' }, 'The AI sees everything here and uses it instead of generic stock.'), input);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); this.upload([...e.dataTransfer.files], toLib.checked); });
    this.el.innerHTML = '';
    add(this.el, drop,
      h('label', { class: 'row muted', style: { margin: '8px 0 12px', fontSize: '12.5px' } }, toLib, 'Save to my library (reuse in every video)'),
      own.length ? h('div', {}, own.map((f) => this.row(f.path, `/files/projects/${ed.id}/${f.path}`, false))) : null,
      (this.library || []).length ? h('div', { class: 'fx-cat' }, 'Library') : null,
      (this.library || []).map((f) => this.row(`library/${f.path}`, `/files/library/${f.path}`, true)),
      !own.length && !(this.library || []).length ? h('p', { class: 'hint' }, 'Nothing here yet.') : null);
  }
}
