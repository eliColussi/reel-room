// AI chat: talk to Claude Code / Codex about the edit. Numbered ideas and questions in a reply
// become buttons, which keeps "pitch me ideas" and "interview me" flows quick.
import { api, h, toast } from '../lib.js';
import { PROMPTS, QUICK } from '../prompts.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');

export class ChatPanel {
  constructor(ed) {
    this.ed = ed;
    this.busy = false;
    this.messagesEl = h('div', { class: 'messages' });
    this.input = h('textarea', { class: 'input', placeholder: 'Tell the AI what to change… e.g. "make the hook pop more" or "cut the part where I stumble"', onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submit(); }
    } });
    this.sendBtn = h('button', { class: 'btn primary', onclick: () => this.submit() }, 'Send');
    this.stopBtn = h('button', { class: 'btn', style: { display: 'none' }, onclick: () => api.post(`/api/projects/${ed.id}/chat/cancel`) }, 'Stop');
    this.libBtn = h('button', { class: 'btn ghost small', onclick: () => this.toggleLibrary() }, '💡 Prompt ideas');
    this.chips = h('div', { class: 'chips' }, QUICK.map((label) => {
      const item = PROMPTS.flatMap((g) => g.items).find((i) => i.label === label);
      return h('button', { class: 'chip', title: item.text, onclick: () => this.useItem(item) }, `${item.icon} ${item.label}`);
    }));
    this.composer = h('div', { class: 'composer' },
      this.chips, this.input,
      h('div', { class: 'row' }, this.libBtn,
        h('button', { class: 'btn ghost small', title: 'Start a fresh conversation (your edit stays)', onclick: () => this.reset() }, 'New chat'),
        h('div', { class: 'spacer' }), this.stopBtn, this.sendBtn));
    this.library = this.buildLibrary();
    this.el = h('div', { class: 'panel chat' }, this.messagesEl, this.composer);
    this.render(ed.chat || []);
  }

  buildLibrary() {
    return h('div', { class: 'messages' },
      h('div', { class: 'row' }, h('b', {}, 'Prompt ideas'), h('div', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => this.toggleLibrary(false) }, 'Back to chat')),
      h('div', { class: 'hint' }, 'Pick one to load it into the box. Edit it before sending. The more specific, the less generic the result.'),
      h('div', { class: 'prompt-lib' }, PROMPTS.map((g) => h('div', {},
        h('h4', {}, g.group),
        g.items.map((it) => h('button', { class: 'prompt-item', title: it.text, onclick: () => this.useItem(it) }, h('span', { class: 'ic' }, it.icon), h('span', {}, it.label)))))));
  }

  toggleLibrary(force) {
    const showing = this.el.firstChild === this.library;
    const show = force ?? !showing;
    this.el.replaceChild(show ? this.library : this.messagesEl, this.el.firstChild);
    this.libBtn.textContent = show ? '💬 Back to chat' : '💡 Prompt ideas';
  }

  useItem(item) {
    this.toggleLibrary(false);
    this.input.value = item.text;
    this.input.focus();
    this.input.setSelectionRange(item.text.length, item.text.length);
  }

  renderMessage(m) {
    if (m.role === 'assistant') {
      const box = h('div', { class: 'msg assistant' });
      const lines = String(m.text).split('\n');
      for (const line of lines) {
        const opt = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
        if (opt) {
          const [, n, body] = opt;
          const isQ = /\?\s*(\(|$)|\?["”]?\s*[-–—(]/.test(body) || /\?$/.test(body.trim());
          box.append(h('div', { class: 'opt' },
            h('span', { html: `<b>${n}.</b> ${inline(body)}` }),
            isQ
              ? h('button', { class: 'btn small', onclick: () => { this.input.value += `${this.input.value && !this.input.value.endsWith('\n') ? '\n' : ''}${n}. `; this.input.focus(); } }, 'Answer')
              : h('button', { class: 'btn small', onclick: () => this.send(`Go with idea ${n}: ${body.replace(/\*\*/g, '')}`) }, 'Do it')));
        } else if (line.trim()) box.append(h('div', { html: inline(line) }));
        else box.append(h('div', { style: { height: '6px' } }));
      }
      return box;
    }
    return h('div', { class: `msg ${m.role}` }, m.text);
  }

  render(messages) {
    this.messagesEl.innerHTML = '';
    if (!messages.length) {
      this.messagesEl.append(h('div', { class: 'msg system' },
        'Ask for anything: a full edit, one tweak, or ideas. Your AI reads the transcript, looks at your frames and edits the timeline. Press Undo anytime.'));
    }
    for (const m of messages) this.messagesEl.append(this.renderMessage(m));
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  setBusy(b) {
    this.busy = b;
    this.sendBtn.disabled = b;
    this.stopBtn.style.display = b ? '' : 'none';
    this.ed.setAiBusy?.(b);
  }

  submit() {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    this.input.value = '';
    this.send(text);
  }

  async reset() {
    await api.post(`/api/projects/${this.ed.id}/chat/reset`);
    const data = await api.get(`/api/projects/${this.ed.id}`);
    this.render(data.chat);
  }

  // Shows a "working" box that tracks the AI's progress while the turn runs.
  async send(text, { display, auto = false } = {}) {
    if (this.busy) { toast('The AI is still working on the last request.'); return; }
    if (!this.ed.state.info?.provider) { toast('Connect Claude or ChatGPT first (Settings).', 'error'); return; }
    this.toggleLibrary(false);
    this.messagesEl.append(this.renderMessage({ role: auto ? 'system' : 'user', text: display || text }));
    const now = h('div', { class: 'now' }, 'Starting…');
    const log = h('div');
    const working = h('div', { class: 'working' }, now, log);
    this.messagesEl.append(working);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    this.setBusy(true);
    await this.ed.flushSave?.();
    await this.ed.uploadPreview?.().catch(() => {});
    let result = null;
    const started = Date.now();
    const timer = setInterval(() => { now.dataset.secs = Math.round((Date.now() - started) / 1000); }, 1000);
    try {
      await api.stream(`/api/projects/${this.ed.id}/chat`, { message: text, display }, (ev) => {
        if (ev.type === 'status') {
          if (now.textContent && now.textContent !== 'Starting…') log.prepend(h('div', {}, `✓ ${now.textContent}`));
          while (log.childNodes.length > 4) log.lastChild.remove();
          now.textContent = ev.text;
        } else if (ev.type === 'text') {
          now.textContent = ev.text.length > 160 ? `${ev.text.slice(0, 160)}…` : ev.text;
        } else if (ev.type === 'done') result = ev;
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      });
    } catch (e) {
      result = { ok: false, text: e.message };
    } finally {
      clearInterval(timer);
      working.remove();
      this.setBusy(false);
    }
    if (!result) result = { ok: false, text: 'The connection to the AI dropped. Check the Reel Room terminal window.' };
    this.messagesEl.append(this.renderMessage({ role: result.ok ? 'assistant' : 'error', text: result.text }));
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    await this.ed.afterAI?.(result, { auto });
  }

  // Called when the editor opens while an AI turn (started earlier) is still running.
  async waitForRunning() {
    const working = h('div', { class: 'working' }, h('div', { class: 'now' }, 'The AI is still working on your last request…'));
    this.messagesEl.append(working);
    this.setBusy(true);
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const data = await api.get(`/api/projects/${this.ed.id}`).catch(() => null);
      if (data && !data.aiBusy) { working.remove(); this.setBusy(false); this.render(data.chat); await this.ed.afterAI?.({ ok: true, changed: true }, { auto: true }); return; }
    }
  }
}
