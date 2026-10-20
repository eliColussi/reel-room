// Export dialog: renders the final MP4 in the browser and saves it into the project's exports
// folder. With several versions (trial reels) it can render all of them in one go.
import { api, h, modal, toast } from '../lib.js';
import { Engine } from '../render/engine.js';
import { exportVideo } from '../export.js';

const fileSafe = (s) => String(s || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase();

export function openExport(ed) {
  const res = h('select', { class: 'input' }, h('option', { value: 720 }, '720p (smaller file)'), h('option', { value: 1080 }, '1080p (recommended)'), h('option', { value: 1440 }, '1440p'), h('option', { value: 2160 }, '4K (slow)'));
  res.value = '1080';
  const safeName = fileSafe(ed.project.name) || 'reel';
  const name = h('input', { class: 'input', value: `${safeName}-${new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-')}` });
  const bar = h('div', { class: 'progress' }, h('div'));
  const status = h('div', { class: 'hint' }, `${ed.engine.W}×${ed.engine.H} · ${ed.engine.timeline.outDuration.toFixed(1)}s · ${ed.engine.fps} fps`);
  const result = h('div');
  const versions = ed.variants || [];
  const current = versions.find((v) => v.active) || { id: 'main', name: 'Main' };
  let scope = 'this';
  const scopeSeg = versions.length > 1 ? h('div', { class: 'seg' }, [['this', `Only "${current.name}"`], ['all', `All ${versions.length} versions`]].map(([k, label]) => h('button', { class: k === scope ? 'on' : '', onclick: (e) => { scope = k; for (const b of scopeSeg.children) b.classList.toggle('on', b === e.currentTarget); } }, label))) : null;
  let controller = null;

  const m = modal({
    title: 'Export video',
    body: h('div', {},
      scopeSeg ? h('div', { class: 'field' }, h('label', {}, 'Which'), scopeSeg) : null,
      h('div', { class: 'field' }, h('label', {}, 'Quality'), res),
      h('div', { class: 'field' }, h('label', {}, 'File name'), name),
      h('div', { class: 'field' }, bar, status),
      result,
      h('p', { class: 'hint' }, 'Rendering happens on your computer. Keep this tab open until it finishes.')),
    onClose: () => controller?.abort(),
    actions: [
      { label: 'Cancel', onClick: (close) => { controller?.abort(); close(); } },
      { label: 'Export', primary: true, onClick: () => run() },
    ],
  });
  const exportBtn = m.el.querySelector('.modal-actions .btn.primary');

  async function renderOne(spec, file, label) {
    const eng = new Engine(ed.assets);
    eng.configure({ spec, transcript: ed.transcript, analysis: ed.analysis, meta: ed.project.meta, resolution: +res.value });
    status.textContent = `${label}Loading fonts, stickers and effects…`;
    await eng.prepare({ resolveGif: ed.resolveGif });
    const blob = await exportVideo({
      engine: eng, project: ed.project, analysis: ed.analysis, signal: controller.signal,
      onProgress: (p, step, eta) => {
        bar.firstChild.style.width = `${Math.round(p * 100)}%`;
        status.textContent = `${label}${step}${eta != null ? ` · about ${Math.ceil(eta)}s left` : ''}`;
      },
    });
    status.textContent = `${label}Saving…`;
    await api.put(`/api/projects/${ed.id}/files/${file}`, blob, 'video/mp4');
    return { blob, errors: eng.errors.size };
  }

  async function run() {
    if (controller) return;
    controller = new AbortController();
    exportBtn.disabled = true;
    ed.pause();
    result.innerHTML = '';
    const base = name.value.replace(/[^\w\-]+/g, '-') || 'reel';
    const started = performance.now();
    try {
      await ed.flushSave();
      if (scope === 'all') {
        const done = [];
        for (const [i, v] of versions.entries()) {
          const spec = v.active ? ed.spec : await fetch(`/files/projects/${ed.id}/variants/${v.id}.json`, { cache: 'no-store' }).then((r) => r.json());
          const file = `exports/${base}-${v.id === 'main' ? 'main' : fileSafe(v.name) || v.id}.mp4`;
          await renderOne(spec, file, `${i + 1} of ${versions.length} · ${v.name} · `);
          done.push({ v, file });
        }
        // A notes file next to the videos: what each version tests and its post caption.
        const notes = [`# ${ed.project.name}: ${versions.length} versions`, '', 'Post the main one, then the others as Instagram trial reels. Share the winner with your followers.', ''];
        for (const { v, file } of done) notes.push(`## ${v.name}`, '', `File: ${file.slice(8)}`, v.test ? `Tests: ${v.test}` : '', v.caption ? `\nCaption:\n\n${v.caption}` : '', '');
        await api.put(`/api/projects/${ed.id}/files/exports/${base}-versions.md`, notes.filter((l) => l !== null).join('\n'), 'text/markdown');
        const secs = ((performance.now() - started) / 1000).toFixed(0);
        status.textContent = `Done: ${done.length} videos in ${secs}s, plus a notes file with each one's caption.`;
        result.append(h('div', { class: 'row', style: { margin: '8px 0' } },
          h('button', { class: 'btn primary', onclick: () => api.post(`/api/projects/${ed.id}/reveal`, { sub: 'exports' }) }, 'Show them in the folder')));
      } else {
        const file = `exports/${base}${versions.length > 1 && current.id !== 'main' ? `-${fileSafe(current.name) || current.id}` : ''}.mp4`;
        const { blob, errors } = await renderOne(ed.spec, file, '');
        const url = URL.createObjectURL(blob);
        const secs = ((performance.now() - started) / 1000).toFixed(0);
        status.textContent = `Done in ${secs}s · ${(blob.size / 1e6).toFixed(1)} MB${errors ? ` · ${errors} effect error(s), see chat` : ''}`;
        result.append(h('div', { class: 'row', style: { margin: '8px 0' } },
          h('a', { class: 'btn primary', href: url, download: file.split('/').pop() }, 'Download'),
          h('button', { class: 'btn', onclick: () => api.post(`/api/projects/${ed.id}/reveal`, { sub: 'exports' }) }, 'Show in folder')),
          h('video', { src: url, controls: true, style: { width: '100%', maxHeight: '320px', borderRadius: '10px', background: '#000' } }));
      }
      toast('Export finished.', 'ok');
      await ed.reloadFiles();
    } catch (e) {
      if (e.name === 'AbortError') status.textContent = 'Cancelled.';
      else { console.error(e); status.textContent = `Export failed: ${e.message}`; toast(`Export failed: ${e.message}`, 'error', 8000); }
    } finally {
      controller = null;
      exportBtn.disabled = false;
    }
  }
}
