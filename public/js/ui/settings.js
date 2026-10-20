// AI connection status, setup help and the settings dialog.
import { api, h, modal, toast } from '../lib.js';

export function aiLabel(info) {
  const p = info?.provider;
  if (p === 'claude') return { ok: true, text: `Claude Code ${info.agents.claude.version || ''}`.trim() };
  if (p === 'codex') return { ok: true, text: `Codex ${info.agents.codex.version || ''}`.trim() };
  return { ok: false, text: 'Connect your AI' };
}

export function aiPill(state, onChange) {
  const l = aiLabel(state.info);
  return h('button', { class: 'pill', title: 'AI settings', onclick: () => openSettings(state, onChange) },
    h('span', { class: `dot ${l.ok ? 'ok' : 'bad'}` }), l.text);
}

export function setupCard(state, onChange) {
  const recheck = async (btn) => {
    btn.disabled = true;
    await api.post('/api/ai/recheck');
    state.info = await api.get('/api/state');
    btn.disabled = false;
    if (state.info.provider) toast('AI connected.', 'ok'); else toast('Still not found. Did the install finish? Try restarting Reel Room.', 'error');
    onChange?.();
  };
  return h('div', { class: 'setup' },
    h('h3', {}, 'Connect the AI you already pay for'),
    h('p', { class: 'muted', style: { margin: 0 } }, 'Reel Room runs the official command-line app from Claude or ChatGPT on your computer, so edits use your existing plan. Nothing extra to buy, no API keys. Pick one:'),
    h('div', { class: 'setup-cols' },
      h('div', {},
        h('b', {}, 'Claude (Pro or Max plan)'),
        h('p', { class: 'hint' }, '1. Install Claude Code (paste into Terminal):'),
        h('div', { class: 'code-block' }, state.info?.platform === 'win32' ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash'),
        h('p', { class: 'hint' }, '2. Run it once and sign in with your Claude account:'),
        h('div', { class: 'code-block' }, 'claude')),
      h('div', {},
        h('b', {}, 'ChatGPT (Plus or Pro plan)'),
        h('p', { class: 'hint' }, '1. Install Codex (needs Node.js):'),
        h('div', { class: 'code-block' }, 'npm install -g @openai/codex'),
        h('p', { class: 'hint' }, '2. Sign in with your ChatGPT account:'),
        h('div', { class: 'code-block' }, 'codex login'))),
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: (e) => recheck(e.currentTarget) }, 'I\'ve done it, check again')));
}

export async function openSettings(state, onChange) {
  const info = (state.info = await api.get('/api/state'));
  const s = info.settings;
  const provider = h('select', { class: 'input' },
    h('option', { value: 'auto' }, 'Automatic (Claude Code first)'),
    h('option', { value: 'claude', disabled: !info.agents.claude }, `Claude Code ${info.agents.claude ? `(${info.agents.claude.version})` : '(not installed)'}`),
    h('option', { value: 'codex', disabled: !info.agents.codex }, `Codex / ChatGPT ${info.agents.codex ? `(${info.agents.codex.version}${info.agents.codex.loggedIn ? '' : ', not signed in'})` : '(not installed)'}`));
  provider.value = s.provider || 'auto';
  const model = h('input', { class: 'input', value: s.model || '', placeholder: 'Leave empty for your CLI\'s default' });
  const giphy = h('input', { class: 'input', value: s.giphyKey || '', placeholder: 'Optional' });
  const whisper = h('select', { class: 'input' }, h('option', { value: 'base' }, 'Fast (good for clear speech)'), h('option', { value: 'small' }, 'Accurate (slower, bigger download)'));
  whisper.value = s.whisper || 'base';
  const LANGS = ['auto', 'english', 'spanish', 'french', 'german', 'portuguese', 'italian', 'dutch', 'japanese', 'korean', 'chinese', 'hindi', 'arabic', 'russian', 'turkish', 'polish', 'swedish', 'indonesian', 'vietnamese', 'filipino'];
  const language = h('select', { class: 'input' }, LANGS.map((l) => h('option', { value: l }, l === 'auto' ? 'Detect automatically' : l[0].toUpperCase() + l.slice(1))));
  language.value = s.language || 'english';
  const testOut = h('div', { class: 'hint' });

  const test = async (btn) => {
    btn.disabled = true;
    testOut.textContent = 'Asking the AI to say OK… (takes a few seconds)';
    await api.post('/api/settings', { provider: provider.value, model: model.value });
    const r = await api.post('/api/ai/test', { provider: provider.value === 'auto' ? undefined : provider.value }).catch((e) => ({ ok: false, message: e.message }));
    testOut.textContent = `${r.ok ? '✅' : '⚠️'} ${r.message}`;
    btn.disabled = false;
  };

  modal({
    title: 'Settings',
    body: h('div', {},
      h('div', { class: 'field' }, h('label', {}, 'AI that edits your videos'), provider,
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: (e) => test(e.currentTarget) }, 'Test connection'), testOut)),
      h('div', { class: 'field' }, h('label', {}, 'Model (optional)'), model, h('div', { class: 'hint' }, 'Claude: sonnet, opus or haiku. Codex: any model your ChatGPT plan includes.')),
      h('div', { class: 'field' }, h('label', {}, 'GIPHY key for real GIFs (optional, free)'), giphy,
        h('div', { class: 'hint' }, 'Without one, the AI uses animated emoji stickers instead. Get a free key at ', h('a', { href: 'https://developers.giphy.com/dashboard/', target: '_blank' }, 'developers.giphy.com'), '.')),
      h('div', { class: 'field' }, h('label', {}, 'Transcription'), whisper),
      h('div', { class: 'field' }, h('label', {}, 'Spoken language'), language),
      h('div', { class: 'field' }, h('label', {}, 'Your videos, styles and library live in'), h('div', { class: 'code-block' }, info.dataDir)),
      !info.provider ? setupCard(state, onChange) : null),
    actions: [{ label: 'Save', primary: true, onClick: async (close) => {
      await api.post('/api/settings', { provider: provider.value, model: model.value, giphyKey: giphy.value, whisper: whisper.value, language: language.value });
      state.info = await api.get('/api/state');
      toast('Settings saved.', 'ok');
      close();
      onChange?.();
    } }],
  });
}
