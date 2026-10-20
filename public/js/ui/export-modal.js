// Export dialog: renders the final MP4 in the browser and saves it into the project's exports folder.
import { api, h, modal, toast } from '../lib.js';
import { Engine } from '../render/engine.js';
import { exportVideo } from '../export.js';

export function openExport(ed) {
  const res = h('select', { class: 'input' }, h('option', { value: 720 }, '720p (smaller file)'), h('option', { value: 1080 }, '1080p (recommended)'), h('option', { value: 1440 }, '1440p'), h('option', { value: 2160 }, '4K (slow)'));
  res.value = '1080';
  const safeName = (ed.project.name || 'reel').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'reel';
  const name = h('input', { class: 'input', value: `${safeName}-${new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-')}` });
  const bar = h('div', { class: 'progress' }, h('div'));
  const status = h('div', { class: 'hint' }, `${ed.engine.W}×${ed.engine.H} · ${ed.engine.timeline.outDuration.toFixed(1)}s · ${ed.engine.fps} fps`);
  const result = h('div');
  let controller = null;

  const m = modal({
    title: 'Export video',
    body: h('div', {},
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

  async function run() {
    if (controller) return;
    controller = new AbortController();
    exportBtn.disabled = true;
    ed.pause();
    result.innerHTML = '';
    const eng = new Engine(ed.assets);
    try {
      eng.configure({ spec: ed.spec, transcript: ed.transcript, analysis: ed.analysis, meta: ed.project.meta, resolution: +res.value });
      status.textContent = 'Loading fonts, stickers and effects…';
      await eng.prepare({ resolveGif: ed.resolveGif });
      const started = performance.now();
      const blob = await exportVideo({
        engine: eng, project: ed.project, analysis: ed.analysis, signal: controller.signal,
        onProgress: (p, label, eta) => {
          bar.firstChild.style.width = `${Math.round(p * 100)}%`;
          status.textContent = `${label}${eta != null ? ` · about ${Math.ceil(eta)}s left` : ''}`;
        },
      });
      const file = `exports/${name.value.replace(/[^\w\-]+/g, '-') || 'reel'}.mp4`;
      status.textContent = 'Saving…';
      await api.put(`/api/projects/${ed.id}/files/${file}`, blob, 'video/mp4');
      const url = URL.createObjectURL(blob);
      const secs = ((performance.now() - started) / 1000).toFixed(0);
      status.textContent = `Done in ${secs}s · ${(blob.size / 1e6).toFixed(1)} MB${eng.errors.size ? ` · ${eng.errors.size} effect error(s), see chat` : ''}`;
      result.append(h('div', { class: 'row', style: { margin: '8px 0' } },
        h('a', { class: 'btn primary', href: url, download: file.split('/').pop() }, 'Download'),
        h('button', { class: 'btn', onclick: () => api.post(`/api/projects/${ed.id}/reveal`, { sub: 'exports' }) }, 'Show in folder')),
        h('video', { src: url, controls: true, style: { width: '100%', maxHeight: '320px', borderRadius: '10px', background: '#000' } }));
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
