// Home: drop a video, reopen projects, manage styles and the shared asset library.
import { api, h, add, toast, confirmBox, prompt, modal, fmtTime } from './lib.js';
import { aiPill, setupCard, openSettings } from './ui/settings.js';

const VIDEO_TYPES = '.mp4,.mov,.m4v,.webm,.mkv,video/*';

export async function createProject(file, onProgress) {
  const { id } = await api.post('/api/projects', { filename: file.name });
  await api.upload(`/api/projects/${id}/source`, file, onProgress);
  return id;
}

export async function renderHome(root, state) {
  const page = h('div');
  root.append(page);

  async function draw() {
    const [projects, styles, library] = await Promise.all([api.get('/api/projects'), api.get('/api/styles'), api.get('/api/library')]);
    page.innerHTML = '';

    const fileInput = h('input', { type: 'file', accept: VIDEO_TYPES, style: { display: 'none' }, onchange: () => fileInput.files[0] && upload(fileInput.files[0]) });
    const bar = h('div', { class: 'progress', style: { display: 'none', marginTop: '16px' } }, h('div'));
    const dropText = h('p', {}, 'MP4 or MOV straight from your phone or camera. It never leaves your computer.');
    const drop = h('div', { class: 'drop', onclick: () => fileInput.click() },
      h('h1', {}, 'Drop a video to start editing'),
      dropText, bar, fileInput);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) upload(f); });

    async function upload(file) {
      bar.style.display = '';
      dropText.textContent = `Copying ${file.name} into Reel Room…`;
      try {
        const id = await createProject(file, (p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; });
        location.hash = `#/p/${id}`;
      } catch (e) { toast(e.message, 'error', 6000); dropText.textContent = 'Something went wrong. Try again.'; }
    }

    add(page,
      h('div', { class: 'topbar' },
        h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, '▶'), 'Reel Room'),
        h('div', { class: 'spacer' }),
        aiPill(state, draw),
        h('button', { class: 'btn ghost', onclick: () => openSettings(state, draw) }, 'Settings')),
      h('div', { class: 'home' },
        drop,
        !state.info?.provider ? setupCard(state, draw) : null,
        projects.length ? h('div', { class: 'section-head' }, h('h2', {}, 'Your videos'), h('span', { class: 'muted' }, projects.length)) : null,
        projects.length ? h('div', { class: 'grid' }, projects.map((p) => projectCard(p, draw))) : null,
        stylesSection(styles, draw),
        librarySection(library, draw)));
  }

  await draw();
  return { destroy() {} };
}

function projectCard(p, refresh) {
  const thumb = h('div', { class: 'thumb', style: p.hasThumb ? { backgroundImage: `url("/files/projects/${p.id}/thumb.jpg?v=${p.updated}")` } : {} }, p.hasThumb ? '' : '🎬');
  const menu = h('button', { class: 'icon-btn menu', title: 'More', onclick: (e) => {
    e.stopPropagation();
    modal({ title: p.name, body: h('div', { style: { display: 'grid', gap: '8px' } },
      h('button', { class: 'btn', onclick: async () => { const n = await prompt('Rename video', p.name); if (n) { await api.patch(`/api/projects/${p.id}`, { name: n }); document.querySelector('.modal-wrap')?.remove(); refresh(); } } }, 'Rename'),
      h('button', { class: 'btn', onclick: () => api.post(`/api/projects/${p.id}/reveal`) }, 'Show in folder'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (await confirmBox('Delete this video?', `"${p.name}" and its exports will be removed from Reel Room. Your original file elsewhere is not touched.`, 'Delete')) {
          await api.del(`/api/projects/${p.id}`);
          document.querySelector('.modal-wrap')?.remove();
          refresh();
        }
      } }, 'Delete')) });
  } }, '⋯');
  return h('div', { class: 'card', onclick: () => { location.hash = `#/p/${p.id}`; } },
    thumb, menu,
    h('div', { class: 'meta' },
      h('div', { class: 'name' }, p.name),
      h('div', { class: 'sub' }, [p.meta?.duration ? fmtTime(p.meta.duration).replace(/\.\d$/, '') : null, p.styleName, new Date(p.updated).toLocaleDateString()].filter(Boolean).join(' · '))));
}

function stylesSection(styles, refresh) {
  const importInput = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onchange: async () => {
    const f = importInput.files[0];
    if (!f) return;
    try {
      const s = JSON.parse(await f.text());
      if (!s.name || !s.look) throw new Error('That file isn\'t a Reel Room style.');
      const hasCode = s.effects && Object.keys(s.effects).length;
      if (hasCode && !(await confirmBox('This style contains code', 'It includes custom effects (JavaScript) that run when you preview and export. Only import styles from people you trust.', 'Import anyway'))) return;
      const id = `${(s.name || 'style').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
      await api.put(`/api/styles/${id}`, s);
      toast(`Imported "${s.name}".`, 'ok');
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  } });
  return h('div', {},
    h('div', { class: 'section-head' }, h('h2', {}, 'Styles'), h('span', { class: 'muted' }, 'Starting points. Every one can be changed, and you can save your own from the editor.'),
      h('div', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => importInput.click() }, 'Import style'), importInput),
    h('div', { class: 'grid' }, styles.map((s) => h('div', { class: 'card style-card' },
      h('div', { class: 'em' }, s.emoji || '🎨'),
      h('div', { class: 'name' }, s.name, s.builtin ? '' : h('span', { class: 'faint' }, ' · yours')),
      h('div', { class: 'sub' }, s.description || ''),
      h('div', { class: 'row', style: { marginTop: '6px' } },
        h('button', { class: 'btn small', onclick: () => downloadStyle(s) }, 'Export'),
        !s.builtin ? h('button', { class: 'btn small danger', onclick: async () => {
          if (await confirmBox('Delete style?', `"${s.name}" will be removed.`, 'Delete')) { await api.del(`/api/styles/${s.id}`); refresh(); }
        } }, 'Delete') : null)))));
}

export function downloadStyle(s) {
  const { id, builtin, updated, ...clean } = s;
  const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${(s.name || 'style').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.reelroom-style.json` });
  document.body.append(a); a.click(); a.remove();
}

function librarySection(files, refresh) {
  const input = h('input', { type: 'file', multiple: true, style: { display: 'none' }, onchange: async () => {
    for (const f of input.files) {
      const folder = /^audio\//.test(f.type) ? 'music' : /^video\//.test(f.type) ? 'clips' : 'images';
      await api.upload(`/api/library/${folder}/${encodeURIComponent(f.name)}`, f).catch((e) => toast(e.message, 'error'));
    }
    toast('Added to your library.', 'ok');
    refresh();
  } });
  return h('div', {},
    h('div', { class: 'section-head' }, h('h2', {}, 'Library'),
      h('span', { class: 'muted' }, 'Logos, music, sounds and clips every video can use. The AI sees what\'s here.'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => input.click() }, 'Add files'), input,
      h('button', { class: 'btn small ghost', onclick: () => api.post('/api/library/reveal') }, 'Open folder')),
    files.length ? h('div', { class: 'hint' }, files.map((f) => f.path).join(' · ')) : h('div', { class: 'hint' }, 'Empty for now.'));
}
