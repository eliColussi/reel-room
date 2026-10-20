// Style panel: pick a starting style (with live thumbnails of YOUR video), tweak every knob by hand,
// describe a new style in words, and save styles to reuse on future videos.
import { api, h, toast, prompt, debounce } from '../lib.js';
import { applyLook, extractLook, clone } from '../spec.js';
import { Engine } from '../render/engine.js';
import { downloadStyle } from '../home.js';

const FONTS = ['Inter', 'Montserrat', 'Poppins', 'Archivo Black', 'Anton', 'Bebas Neue', 'Oswald', 'Space Grotesk', 'DM Sans', 'Manrope', 'Sora', 'Outfit', 'Plus Jakarta Sans', 'Instrument Serif', 'DM Serif Display', 'Playfair Display', 'Fraunces', 'Bangers', 'Luckiest Guy', 'Permanent Marker', 'Caveat', 'JetBrains Mono', 'VT323'];

const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function set(o, path, v) { const ks = path.split('.'); let a = o; for (const k of ks.slice(0, -1)) { a[k] ??= {}; a = a[k]; } a[ks[ks.length - 1]] = v; }

const KNOBS = [
  ['Captions'],
  { p: 'captions.enabled', l: 'Show captions', t: 'toggle' },
  { p: 'captions.mode', l: 'Mode', t: 'select', o: [['phrase', 'A few words'], ['word', 'One word'], ['reveal', 'Reveal as spoken']] },
  { p: 'captions.font', l: 'Font', t: 'font' },
  { p: 'captions.weight', l: 'Weight', t: 'select', o: [400, 500, 600, 700, 800, 900].map((w) => [w, String(w)]), num: true },
  { p: 'captions.size', l: 'Size', t: 'range', min: 30, max: 160, step: 1 },
  { p: 'captions.maxWords', l: 'Words at once', t: 'range', min: 1, max: 8, step: 1 },
  { p: 'captions.y', l: 'Height on screen', t: 'range', min: 0.1, max: 0.92, step: 0.01 },
  { p: 'captions.color', l: 'Text colour', t: 'color' },
  { p: 'captions.highlight', l: 'Highlight colour', t: 'color' },
  { p: 'captions.highlightStyle', l: 'Highlight style', t: 'select', o: [['color', 'Colour'], ['box', 'Box'], ['underline', 'Underline'], ['scale', 'Grow'], ['none', 'None']] },
  { p: 'captions.uppercase', l: 'Uppercase', t: 'toggle' },
  { p: 'captions.stroke', l: 'Outline', t: 'range', min: 0, max: 20, step: 1 },
  { p: 'captions.shadow', l: 'Shadow', t: 'range', min: 0, max: 40, step: 1 },
  { p: 'captions.animation', l: 'Animation', t: 'select', o: [['pop', 'Pop'], ['fade', 'Fade'], ['slide', 'Slide'], ['bounce', 'Bounce per word'], ['none', 'None']] },
  { p: 'captions.punctuation', l: 'Punctuation', t: 'toggle' },
  ['Pacing'],
  { p: 'cuts.silence.enabled', l: 'Cut silences', t: 'toggle' },
  { p: 'cuts.silence.minGap', l: 'Shortest pause cut', t: 'range', min: 0.2, max: 1.5, step: 0.05 },
  { p: 'cuts.punchZoom', l: 'Zoom on cuts', t: 'range', min: 1, max: 1.3, step: 0.01 },
  ['Framing'],
  { p: 'frame.fit', l: 'Fit', t: 'select', o: [['fill', 'Fill the frame'], ['fit', 'Show everything']] },
  { p: 'frame.track', l: 'Follow face', t: 'select', o: [['face', 'Yes'], ['center', 'No, centre']] },
  { p: 'frame.scale', l: 'Scale', t: 'range', min: 0.5, max: 2, step: 0.01 },
  ['Background'],
  { p: 'background.remove', l: 'Remove background', t: 'toggle' },
  { p: 'background.type', l: 'Replace with', t: 'select', o: [['blur', 'Blurred video'], ['color', 'Colour'], ['gradient', 'Gradient'], ['image', 'Image'], ['video', 'Video']] },
  { p: 'background.color', l: 'Colour', t: 'color' },
  { p: 'background.colors.0', l: 'Gradient from', t: 'color' },
  { p: 'background.colors.1', l: 'Gradient to', t: 'color' },
  { p: 'background.dim', l: 'Darken', t: 'range', min: 0, max: 0.9, step: 0.01 },
  ['Colour'],
  { p: 'grade.brightness', l: 'Brightness', t: 'range', min: 0.7, max: 1.3, step: 0.01 },
  { p: 'grade.contrast', l: 'Contrast', t: 'range', min: 0.7, max: 1.4, step: 0.01 },
  { p: 'grade.saturation', l: 'Saturation', t: 'range', min: 0, max: 1.6, step: 0.01 },
  { p: 'grade.warmth', l: 'Warmth', t: 'range', min: -1, max: 1, step: 0.01 },
  { p: 'grade.vignette', l: 'Vignette', t: 'range', min: 0, max: 1, step: 0.01 },
  { p: 'grade.grain', l: 'Film grain', t: 'range', min: 0, max: 1, step: 0.01 },
  { p: 'grade.blackAndWhite', l: 'Black & white', t: 'toggle' },
  ['Sound'],
  { p: 'audio.enhance', l: 'Even out voice', t: 'toggle' },
  { p: 'audio.volume', l: 'Voice volume', t: 'range', min: 0, max: 2, step: 0.05 },
];

export class StylePanel {
  constructor(ed) {
    this.ed = ed;
    this.el = h('div', { class: 'panel' });
    this.thumbs = new Map();
    this.thumbKey = '';
  }

  async show() {
    this.styles = await api.get('/api/styles');
    this.draw();
    this.renderThumbs();
  }

  draw() {
    const ed = this.ed;
    const cur = ed.style || {};
    const tiles = this.styles.map((s) => {
      const shot = h('div', { class: 'shot' }, this.thumbs.has(s.id) ? '' : (s.emoji || '🎨'));
      if (this.thumbs.has(s.id)) shot.style.backgroundImage = `url(${this.thumbs.get(s.id)})`;
      return h('button', { class: `style-tile ${cur.id === s.id ? 'on' : ''}`, title: s.description, onclick: () => this.apply(s) },
        shot, h('div', { class: 'lbl' }, s.emoji || '🎨', s.name));
    });
    const vibe = h('textarea', { class: 'input', rows: 5, placeholder: 'The creative brief the AI follows for this style.' }, cur.vibe || '');
    const saveVibe = debounce(async () => {
      ed.style = { ...cur, vibe: vibe.value };
      await api.put(`/api/projects/${ed.id}/files/style.json`, ed.style);
    }, 600);
    vibe.addEventListener('input', saveVibe);
    const describe = h('textarea', { class: 'input', rows: 3, placeholder: 'e.g. "Like a Nike ad: black and white, huge condensed type, fast cuts, one red accent"' });

    this.el.innerHTML = '';
    this.el.append(
      h('div', { class: 'row' }, h('b', {}, `Style: ${cur.name || 'none'}`), h('div', { class: 'spacer' }),
        h('button', { class: 'btn small', onclick: () => this.save(false) }, cur.id && !cur.builtin ? 'Save' : 'Save as my style'),
        cur.id && !cur.builtin ? h('button', { class: 'btn small ghost', onclick: () => this.save(true) }, 'Save as new') : null,
        h('button', { class: 'btn small ghost', onclick: () => downloadStyle(this.currentStyleObject()) }, 'Export')),
      h('div', { class: 'hint', style: { margin: '6px 0 10px' } }, 'Click a style to restyle instantly. Your cuts, zooms and overlays stay. Then ask the AI for a full edit in that style.'),
      h('div', { class: 'styles-grid' }, tiles),
      h('div', { class: 'knobs' },
        h('h4', {}, 'Make a new style with AI'),
        describe,
        h('div', { class: 'row' }, h('button', { class: 'btn small primary', onclick: () => {
          if (!describe.value.trim()) return toast('Describe the style first.');
          ed.chatPanel.send(`Create a new style from this description and apply it to this video: "${describe.value.trim()}". Update edit.json so the preview shows it, and update style.json with a fitting name, a one-line description, a detailed vibe (the creative brief for future edits) and the look. Keep my cuts and content.`);
          ed.showTab('ai');
        } }, '✨ Build this style')),
        h('h4', {}, 'Style brief (what the AI follows)'), vibe,
        ...this.knobs()));
  }

  knobs() {
    const ed = this.ed;
    const spec = ed.spec || {};
    const n = ed.engine?.spec || spec;
    const out = [h('h4', {}, 'Format'), h('div', { class: 'seg' }, ['9:16', '4:5', '1:1', '16:9'].map((a) => h('button', { class: (n.format?.aspect || '9:16') === a ? 'on' : '', onclick: () => ed.patchSpec((s) => { s.format ||= {}; s.format.aspect = a; }, 'format').then(() => this.draw()) }, a)))];
    for (const k of KNOBS) {
      if (Array.isArray(k)) { out.push(h('h4', {}, k[0])); continue; }
      const val = get(n, k.p);
      const commit = (v) => ed.patchSpec((s) => {
        if (k.p.startsWith('background.colors.')) { s.background ||= {}; s.background.colors = [...(get(n, 'background.colors') || ['#1d1d1f', '#3a3a3c'])]; }
        set(s, k.p, v);
      }, 'manual');
      let ctl, show = h('span', { class: 'val' });
      if (k.t === 'toggle') ctl = h('input', { type: 'checkbox', class: 'toggle', checked: !!val, onchange: (e) => commit(e.target.checked) });
      else if (k.t === 'range') {
        show.textContent = Number(val ?? 0).toFixed(k.step < 1 ? 2 : 0);
        ctl = h('input', { type: 'range', min: k.min, max: k.max, step: k.step, value: val ?? k.min, oninput: (e) => { show.textContent = Number(e.target.value).toFixed(k.step < 1 ? 2 : 0); commit(+e.target.value); } });
      } else if (k.t === 'color') ctl = h('input', { type: 'color', value: toHex(val), oninput: (e) => commit(e.target.value) });
      else if (k.t === 'select') {
        ctl = h('select', { class: 'input', onchange: (e) => commit(k.num ? +e.target.value : e.target.value) }, k.o.map(([v, label]) => h('option', { value: v }, label)));
        ctl.value = String(val);
      } else if (k.t === 'font') {
        const listId = 'font-list';
        ctl = h('span', {}, h('input', { type: 'text', class: 'input', list: listId, value: val || '', onchange: (e) => commit(e.target.value.trim()) }),
          h('datalist', { id: listId }, FONTS.map((f) => h('option', { value: f }))));
      }
      out.push(h('div', { class: 'knob' }, h('label', {}, k.l), ctl, show));
    }
    return out;
  }

  currentStyleObject() {
    const ed = this.ed;
    const cur = ed.style || {};
    return { name: cur.name || 'My style', emoji: cur.emoji || '🎨', description: cur.description || '', vibe: cur.vibe || '', look: extractLook(ed.spec || {}), effects: cur.effects };
  }

  async save(asNew) {
    const ed = this.ed;
    const cur = ed.style || {};
    let id = cur.id, name = cur.name;
    if (asNew || !id || cur.builtin) {
      name = await prompt('Name your style', cur.builtin ? `${cur.name} (mine)` : (cur.name || 'My style'));
      if (!name) return;
      id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'style'}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const style = { ...this.currentStyleObject(), name };
    // Bundle the code of custom effects the style's own layers use, so the style works anywhere.
    const effects = {};
    for (const l of style.look.layers || []) {
      if (l.type === 'custom' && String(l.file || '').startsWith('effects/')) {
        const r = await fetch(`/files/projects/${ed.id}/${l.file}`);
        if (r.ok) effects[l.file.slice(8)] = await r.text();
      }
    }
    if (Object.keys(effects).length) style.effects = effects;
    await api.put(`/api/styles/${id}`, style);
    ed.style = { ...style, id, builtin: false };
    await api.put(`/api/projects/${ed.id}/files/style.json`, ed.style);
    await api.patch(`/api/projects/${ed.id}`, { styleId: id, styleName: name });
    toast(`Saved "${name}". It's now available for every video.`, 'ok');
    this.show();
  }

  async apply(s) {
    const ed = this.ed;
    if (s.effects) for (const [file, code] of Object.entries(s.effects)) await api.put(`/api/projects/${ed.id}/files/effects/${file}`, code, 'text/javascript');
    ed.style = clone(s);
    await api.put(`/api/projects/${ed.id}/files/style.json`, ed.style);
    await api.patch(`/api/projects/${ed.id}`, { styleId: s.id, styleName: s.name });
    await ed.setSpec(applyLook(ed.spec || {}, s.look || {}), { reason: `style: ${s.name}` });
    if (s.effects) ed.assets.bust();
    this.draw();
  }

  // Render each style onto the current frame of this video.
  async renderThumbs() {
    const ed = this.ed;
    const src = ed.mainSource();
    if (!src?.main || !ed.engine?.timeline) {
      // Video not decoded yet: try again once the first frame is ready.
      if (!this.waiting) {
        this.waiting = true;
        const go = () => { this.waiting = false; if (this.el.isConnected) this.renderThumbs(); };
        ed.video.addEventListener('seeked', go, { once: true });
        ed.video.addEventListener('loadeddata', go, { once: true });
      }
      return;
    }
    const key = `${ed.currentSrc().toFixed(2)}|${this.styles.map((s) => s.id).join(',')}|${JSON.stringify(ed.spec?.cuts || {})}`;
    if (key === this.thumbKey) return;
    this.thumbKey = key;
    const eng = new Engine(ed.assets);
    const c = document.createElement('canvas');
    for (const s of this.styles) {
      try {
        eng.configure({ spec: applyLook(ed.spec || {}, s.look || {}), transcript: ed.transcript, analysis: ed.analysis, meta: ed.project.meta, resolution: 270 });
        await eng.prepare({ resolveGif: ed.resolveGif });
        c.width = eng.W; c.height = eng.H;
        eng.draw(c.getContext('2d'), ed.currentSrc(), ed.mainSource());
        this.thumbs.set(s.id, c.toDataURL('image/jpeg', 0.8));
        const tile = [...this.el.querySelectorAll('.style-tile')][this.styles.indexOf(s)];
        const shot = tile?.querySelector('.shot');
        if (shot) { shot.textContent = ''; shot.style.backgroundImage = `url(${this.thumbs.get(s.id)})`; }
      } catch (e) { console.warn('thumb', s.id, e); }
    }
  }
}

function toHex(c) {
  if (!c) return '#ffffff';
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('');
  const x = document.createElement('canvas').getContext('2d');
  x.fillStyle = c;
  return /^#/.test(x.fillStyle) ? x.fillStyle : '#ffffff';
}
