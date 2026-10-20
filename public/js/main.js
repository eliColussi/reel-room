import { api, h, $ } from './lib.js';
import { renderHome } from './home.js';
import { openEditor } from './editor.js';

const app = $('#app');
export const state = { info: null };
let current = null;

export async function refreshInfo() {
  state.info = await api.get('/api/state');
  return state.info;
}

function browserProblem() {
  if (!window.isSecureContext) return 'Open Reel Room at http://localhost (not an IP address) so the browser allows video encoding.';
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') return 'This browser can\'t encode video. Open Reel Room in Google Chrome, Microsoft Edge or Brave.';
  return null;
}

async function route() {
  try { current?.destroy?.(); } catch {}
  current = null;
  app.innerHTML = '';
  const problem = browserProblem();
  if (problem) app.append(h('div', { class: 'banner' }, problem));
  const m = location.hash.match(/^#\/p\/([\w-]+)/);
  try {
    current = m ? await openEditor(app, m[1], state) : await renderHome(app, state);
  } catch (e) {
    console.error(e);
    app.append(h('div', { class: 'home' }, h('h2', {}, 'Something went wrong'), h('p', { class: 'muted' }, e.message), h('a', { href: '#/' }, 'Back to projects')));
  }
}

window.addEventListener('hashchange', route);
refreshInfo().then(route).catch((e) => {
  app.append(h('div', { class: 'home' }, h('h2', {}, 'Can\'t reach the Reel Room server'), h('p', { class: 'muted' }, `${e.message}. Is the terminal window still open?`)));
});
