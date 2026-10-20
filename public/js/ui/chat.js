// The chat: the main way to edit. Type or talk, attach files, paste a reel to copy its feel.
// Numbered ideas and questions in a reply become buttons, which keeps "pitch me ideas" and
// "interview me" flows quick. The conversation is saved in the video's folder on this computer.
import { api, h, toast, modal } from '../lib.js';
import { PROMPTS, QUICK } from '../prompts.js';
import { Dictation } from '../dictation.js';
import { studyReference } from '../reference.js';
import { saveEffectToLibrary, effectName } from './my-effects.js';
import { openTrials } from './trials.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
const REEL_URL = /https?:\/\/(?:www\.|m\.|vm\.|vt\.)?(?:instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|x\.com|twitter\.com|vimeo\.com|threads\.net)\/[^\s<>"]+/i;
const VIDEO_URL = /https?:\/\/[^\s<>"]+\.(?:mp4|mov|m4v|webm)(?:\?[^\s<>"]*)?/i;

const STARTERS = [
  { icon: '✨', label: 'Full edit in my style', prompt: 'Full edit in my style' },
  { icon: '🎤', label: 'Interview me first', prompt: 'Interview me first' },
  { icon: '🔗', label: 'Copy a reel\'s style', action: 'reference' },
  { icon: '🧪', label: 'Make trial reels', action: 'trials' },
  { icon: '💡', label: 'Pitch me effect ideas', prompt: 'Pitch me effect ideas' },
  { icon: '🧹', label: 'Slop check', prompt: 'Slop check' },
];

const closenessLabel = (p) => (p <= 30 ? 'a hint of it' : p <= 60 ? 'same pacing and captions, your look' : p <= 80 ? 'close, but not a copy' : 'as close as allowed');

export class ChatPanel {
  constructor(ed) {
    this.ed = ed;
    this.busy = false;
    this.attachments = []; // { kind: 'asset', path, name } | { kind: 'reference', file, name }
    this.closeness = 80;
    this.dictation = null;

    this.messagesEl = h('div', { class: 'messages' });
    this.library = this.buildLibrary();
    this.el = h('div', { class: 'panel chat' }, this.messagesEl);

    this.input = h('textarea', { class: 'chat-input', rows: 1, placeholder: 'Say what to change, or paste a reel link…', onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (this.dictation?.state === 'recording') this.stopDictation(true); else this.submit(); }
      if (e.key === 'Escape' && this.dictation?.state === 'recording') { e.preventDefault(); this.cancelDictation(); }
    }, oninput: () => this.onInput() });
    this.input.addEventListener('paste', () => setTimeout(() => this.onInput(), 0));
    this.micBtn = h('button', { class: 'icon-btn mic', title: 'Talk instead of typing (runs on this computer)', onclick: () => this.toggleDictation() }, micIcon());
    this.sendBtn = h('button', { class: 'icon-btn send', title: 'Send (Enter)', onclick: () => this.submit() }, '↑');
    this.stopBtn = h('button', { class: 'btn small', style: { display: 'none' }, onclick: () => api.post(`/api/projects/${ed.id}/chat/cancel`) }, '■ Stop');
    this.level = h('div', { class: 'mic-level' }, h('div'));
    this.micHint = h('div', { class: 'mic-hint' });

    this.fileInput = h('input', { type: 'file', multiple: true, style: { display: 'none' }, onchange: () => { this.attachFiles([...this.fileInput.files]); this.fileInput.value = ''; } });
    this.attachRow = h('div', { class: 'attach-row' });
    this.refBar = h('div', { class: 'ref-bar', style: { display: 'none' } });
    this.chips = h('div', { class: 'chips' }, QUICK.map((label) => {
      const item = PROMPTS.flatMap((g) => g.items).find((i) => i.label === label);
      return h('button', { class: 'chip', title: item.text, onclick: () => this.useItem(item) }, `${item.icon} ${item.label}`);
    }));
    this.libBtn = h('button', { class: 'btn ghost small', onclick: () => this.toggleLibrary() }, '💡 Ideas');

    this.composer = h('div', { class: 'composer' },
      this.chips, this.refBar, this.attachRow,
      h('div', { class: 'input-wrap' }, this.input, this.level, this.micBtn, this.sendBtn),
      this.micHint,
      h('div', { class: 'row composer-tools' },
        this.libBtn,
        h('button', { class: 'btn ghost small', title: 'Attach images, logos, clips or music (or drop them here)', onclick: () => this.fileInput.click() }, '📎 Attach'),
        h('button', { class: 'btn ghost small', title: 'Make several versions to post as Instagram trial reels', onclick: () => openTrials(ed) }, '🧪 Trial reels'),
        h('div', { class: 'spacer' }), this.stopBtn,
        h('button', { class: 'btn ghost small', title: 'Start a fresh conversation (your edit and this history stay)', onclick: () => this.reset() }, 'New chat'),
        this.fileInput));

    // Drop files anywhere on the side panel.
    for (const target of [this.el, this.composer]) {
      target.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); this.composer.classList.add('over'); } });
      target.addEventListener('dragleave', () => this.composer.classList.remove('over'));
      target.addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); this.composer.classList.remove('over'); this.attachFiles([...e.dataTransfer.files]); });
    }
    this.render(ed.chat || []);
  }

  // ---------- library of prompt ideas ----------
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
    if (show !== showing) this.el.replaceChild(show ? this.library : this.messagesEl, this.el.firstChild);
    this.libBtn.textContent = show ? '💬 Back to chat' : '💡 Ideas';
    if (show && this.ed.tab !== 'ai') this.ed.showTab('ai');
  }

  useItem(item) {
    this.toggleLibrary(false);
    if (this.ed.tab !== 'ai') this.ed.showTab('ai');
    this.input.value = item.text;
    this.onInput();
    this.input.focus();
    this.input.setSelectionRange(item.text.length, item.text.length);
  }

  starter(s) {
    if (s.action === 'trials') return openTrials(this.ed);
    if (s.action === 'reference') {
      this.input.value = '';
      this.input.placeholder = 'Paste an Instagram, TikTok or YouTube link here (or attach the video file)…';
      this.input.focus();
      return;
    }
    const item = PROMPTS.flatMap((g) => g.items).find((i) => i.label === s.prompt);
    if (item) this.useItem(item);
  }

  // ---------- typing, attachments, reference link ----------
  onInput() {
    const el = this.input;
    el.style.height = 'auto';
    el.style.height = `${Math.min(220, Math.max(44, el.scrollHeight))}px`;
    this.chips.style.display = el.value.trim() || this.attachments.length || this.messagesEl.querySelector('.empty-chat') ? 'none' : '';
    this.drawRefBar();
  }

  referenceSource() {
    const att = this.attachments.find((a) => a.kind === 'reference');
    if (att) return { file: att.file, label: att.name };
    const url = (this.input.value.match(REEL_URL) || this.input.value.match(VIDEO_URL))?.[0]?.replace(/[).,]+$/, '');
    if (!url) return null;
    try { return { url, label: new URL(url).hostname.replace(/^www\./, '') }; } catch { return null; }
  }

  drawRefBar() {
    const src = this.referenceSource();
    if (!src) { this.refBar.style.display = 'none'; return; }
    const typed = /(\d{2,3})\s*%/.exec(this.input.value);
    if (typed && !this.closenessTouched) this.closeness = Math.max(10, Math.min(90, +typed[1]));
    const val = h('b', {}, `${this.closeness}%`);
    const lbl = h('span', { class: 'muted' }, closenessLabel(this.closeness));
    const slider = h('input', { type: 'range', min: 10, max: 90, step: 10, value: this.closeness, oninput: (e) => {
      this.closeness = +e.target.value; this.closenessTouched = true;
      val.textContent = `${this.closeness}%`; lbl.textContent = closenessLabel(this.closeness);
    } });
    this.refBar.innerHTML = '';
    this.refBar.style.display = '';
    this.refBar.append(
      h('div', { class: 'row' }, h('span', {}, '🔗'), h('span', { class: 'ref-src' }, `Reference reel · ${src.label}`)),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'How close'), slider, val),
      h('div', { class: 'hint' }, `${closenessLabel(this.closeness)}. It borrows the editing, never their words, logo or footage.`));
  }

  async attachFiles(files) {
    for (const f of files) {
      if (/^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name)) {
        const choice = await chooseVideoUse(f.name);
        if (choice === 'reference') { this.attachments = this.attachments.filter((a) => a.kind !== 'reference'); this.attachments.push({ kind: 'reference', file: f, name: f.name }); }
        else if (choice === 'asset') await this.uploadAsset(f);
      } else await this.uploadAsset(f);
    }
    this.drawAttachments();
    this.onInput();
    this.input.focus();
  }

  async uploadAsset(f) {
    const name = f.name.replace(/[^\w.\- ]+/g, '_');
    const chip = { kind: 'asset', path: `assets/${name}`, name, uploading: true };
    this.attachments.push(chip);
    this.drawAttachments();
    try {
      await api.upload(`/api/projects/${this.ed.id}/files/assets/${encodeURIComponent(name)}`, f);
      chip.uploading = false;
      await this.ed.reloadFiles();
    } catch (e) { toast(e.message, 'error'); this.attachments = this.attachments.filter((a) => a !== chip); }
    this.drawAttachments();
  }

  drawAttachments() {
    this.attachRow.innerHTML = '';
    for (const a of this.attachments) {
      this.attachRow.append(h('span', { class: `attach ${a.kind}` },
        a.kind === 'reference' ? '🔗 ' : '📎 ', a.name, a.uploading ? ' …' : '',
        h('button', { title: 'Remove', onclick: () => { this.attachments = this.attachments.filter((x) => x !== a); this.drawAttachments(); this.onInput(); } }, '✕')));
    }
  }

  // ---------- dictation ----------
  async toggleDictation() {
    if (this.dictation?.state === 'recording') return this.stopDictation(false);
    if (this.dictation?.state === 'writing') return;
    this.dictation = new Dictation(this.ed.state.info?.settings || {});
    try {
      await this.dictation.start((lv) => { this.level.firstChild.style.transform = `scaleX(${Math.max(0.04, lv)})`; });
    } catch (e) {
      this.dictation = null;
      toast(/denied|NotAllowed/i.test(e.name + e.message) ? 'Microphone access was blocked. Allow it in Chrome\'s address bar, then try again.' : `Couldn't open the microphone: ${e.message}`, 'error', 7000);
      return;
    }
    this.composer.classList.add('recording');
    this.micBtn.classList.add('on');
    this.micHint.textContent = 'Listening… click the mic when you\'re done. Enter sends it, Esc cancels.';
    this.input.focus();
    this.micTimer = setInterval(() => { if (this.dictation?.seconds > 120) this.stopDictation(false); }, 500);
  }

  async stopDictation(sendAfter) {
    const d = this.dictation;
    if (!d || d.state !== 'recording') return;
    clearInterval(this.micTimer);
    this.composer.classList.remove('recording');
    this.micBtn.classList.remove('on');
    this.micHint.textContent = 'Writing it down…';
    this.micBtn.disabled = true;
    try {
      const text = await d.stop();
      if (!text) { toast('Didn\'t catch anything. Try again a bit closer to the mic.'); return; }
      const cur = this.input.value;
      this.input.value = cur && !/\s$/.test(cur) ? `${cur} ${text}` : cur + text;
      this.onInput();
      if (sendAfter) this.submit();
      else this.input.focus();
    } catch (e) { toast(`Dictation failed: ${e.message}`, 'error'); }
    finally { this.micHint.textContent = ''; this.micBtn.disabled = false; this.dictation = null; }
  }

  cancelDictation() {
    clearInterval(this.micTimer);
    this.dictation?.cancel();
    this.dictation = null;
    this.composer.classList.remove('recording');
    this.micBtn.classList.remove('on');
    this.micHint.textContent = '';
  }

  // ---------- messages ----------
  renderMessage(m, prev) {
    if (m.role === 'assistant') {
      const box = h('div', { class: 'msg assistant' });
      for (const line of String(m.text).split('\n')) {
        const opt = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
        if (opt) {
          const [, n, body] = opt;
          const isQ = /\?\s*(\(|$)|\?["”]?\s*[-–—(]/.test(body) || /\?$/.test(body.trim());
          box.append(h('div', { class: 'opt' },
            h('span', { html: `<b>${n}.</b> ${inline(body)}` }),
            isQ
              ? h('button', { class: 'btn small', onclick: () => { this.input.value += `${this.input.value && !this.input.value.endsWith('\n') ? '\n' : ''}${n}. `; this.onInput(); this.input.focus(); } }, 'Answer')
              : h('button', { class: 'btn small', onclick: () => this.send(`Go with idea ${n}: ${body.replace(/\*\*/g, '')}`) }, 'Do it')));
        } else if (line.trim()) box.append(h('div', { html: inline(line) }));
        else box.append(h('div', { style: { height: '6px' } }));
      }
      for (const file of m.effects || []) box.append(this.effectRow(file));
      if (m.variants) box.append(h('div', { class: 'msg-extra' }, h('span', {}, '🧪 The versions are above the preview. Click one to watch it.')));
      if (prev?.kind === 'reference') {
        box.append(h('div', { class: 'msg-extra' },
          h('span', { class: 'muted' }, 'Like this look?'),
          h('button', { class: 'btn small', onclick: () => this.ed.panels.style.save(true) }, 'Save as a style')));
      }
      return box;
    }
    const el = h('div', { class: `msg ${m.role}${m.kind === 'clean' ? ' note' : ''}` }, m.text);
    if (m.ref) {
      const sheet = `/files/projects/${this.ed.id}/references/${m.ref}/sheet-1.jpg`;
      el.append(h('a', { class: 'ref-thumb', href: sheet, target: '_blank', title: 'What the AI looked at' }, h('img', { src: sheet, alt: '', onerror: (e) => e.target.parentElement.remove() })));
    }
    return el;
  }

  effectRow(file) {
    const label = h('span', {}, `New effect: ${file.split('/').pop().replace(/\.js$/, '')}`);
    effectName(this.ed, file).then((n) => { if (n) label.textContent = `New effect: ${n}`; });
    return h('div', { class: 'msg-extra' }, '✨', label, h('div', { class: 'spacer' }),
      h('button', { class: 'btn small', title: 'Keep it in your library for every future video', onclick: () => saveEffectToLibrary(this.ed, file) }, 'Save to my effects'));
  }

  render(messages) {
    this.messagesEl.innerHTML = '';
    const empty = !messages.filter((m) => m.role !== 'system').length;
    messages.forEach((m, i) => this.messagesEl.append(this.renderMessage(m, messages[i - 1])));
    if (empty) {
      this.messagesEl.append(h('div', { class: 'empty-chat' },
        h('h3', {}, 'What should we do with this video?'),
        h('p', { class: 'muted' }, 'Type or press the mic and say it. Your AI reads the transcript, looks at your frames and edits the timeline. Undo is always one click.'),
        h('div', { class: 'starters' }, STARTERS.map((s) => h('button', { class: 'starter', onclick: () => this.starter(s) }, h('span', { class: 'ic' }, s.icon), s.label))),
        h('p', { class: 'hint' }, 'This conversation is saved in the video\'s folder on your computer.')));
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    this.onInput();
  }

  setBusy(b) {
    this.busy = b;
    this.sendBtn.disabled = b;
    this.stopBtn.style.display = b ? '' : 'none';
    this.ed.setAiBusy?.(b);
  }

  submit() {
    const text = this.input.value.trim();
    if (this.busy) { toast('The AI is still working on the last request.'); return; }
    if (this.attachments.some((a) => a.uploading)) { toast('Still copying your file in…'); return; }
    const ref = this.referenceSource();
    if (!text && !this.attachments.length) return;
    const assets = this.attachments.filter((a) => a.kind === 'asset');
    this.input.value = '';
    this.attachments = [];
    this.drawAttachments();
    this.onInput();
    this.input.placeholder = 'Say what to change, or paste a reel link…';
    if (ref) return this.sendReference({ text, ...ref, assets });
    const files = assets.map((a) => `\`${a.path}\``).join(', ');
    const message = files ? `${text || 'Use these in my video where they fit best.'}\n\n(Files I attached: ${files})` : text;
    this.send(message, { display: files ? `${text}${text ? '\n' : ''}📎 ${assets.map((a) => a.name).join(', ')}` : undefined });
  }

  sendReference({ text, url, file, label, assets = [], cookies }) {
    const id = this.ed.id;
    const pct = this.closeness;
    const userText = text.replace(url || '\u0000', '').trim();
    const files = assets.map((a) => `\`${a.path}\``).join(', ');
    this.closenessTouched = false;
    return this.send('', {
      display: `${userText || 'Give my video the same feel as this reel.'}\n🔗 ${url || label} · ${pct}% close`,
      kind: 'reference',
      prepare: async (status) => {
        let rid, name, site;
        if (file) {
          rid = `ref-${Date.now().toString(36)}`;
          name = `video${(/\.\w+$/.exec(file.name) || ['.mp4'])[0].toLowerCase()}`;
          status('Copying the reference reel in');
          await api.upload(`/api/projects/${id}/files/references/${rid}/${name}`, file);
        } else {
          status(`Downloading the reel from ${label}`);
          const res = await api.raw(`/api/projects/${id}/reference`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, cookies }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw Object.assign(new Error(data.error || 'Download failed'), { code: data.code, detail: data.detail, retry: { text, url, label, assets } });
          ({ rid, site } = data);
          name = data.path.split('/').pop();
        }
        await studyReference({ projectId: id, rid, file: name, site, settings: this.ed.state.info?.settings, onStatus: status });
        return {
          ref: rid,
          message: `${userText || 'Give my video the same feel as this reel.'}${files ? `\n\n(Files I attached: ${files})` : ''}

---
(Reel Room) Reference reel: references/${rid}/ (${site ? `downloaded from ${site}` : 'a video file the user attached'}). Closeness the user chose: ${pct}%. Read references/${rid}/notes.md and look at every sheet-*.jpg and detail-*.jpg in that folder, then follow the "Reference reels" section of your guide: write references/${rid}/breakdown.md, apply it to edit.json at ${pct}%, put the look into style.json, and reply in two or three sentences.`,
        };
      },
    });
  }

  referenceProblem(err) {
    const r = err.retry || {};
    const pick = h('input', { type: 'file', accept: 'video/*,.mp4,.mov,.m4v,.webm', style: { display: 'none' }, onchange: () => {
      const f = pick.files[0];
      if (f) this.sendReference({ text: r.text || '', file: f, label: f.name, assets: r.assets });
    } });
    const box = h('div', { class: 'msg error' }, h('div', {}, err.message));
    if (err.code === 'login') {
      box.append(h('div', { class: 'hint', style: { margin: '6px 0' } }, 'Instagram usually only shares reels with signed-in people. If you\'re logged in to Instagram in Chrome, Reel Room can use that login (macOS will ask you to allow it). Or save the reel to your computer and attach the file.'));
      box.append(h('div', { class: 'row' },
        h('button', { class: 'btn small primary', onclick: () => { box.remove(); this.sendReference({ ...r, cookies: 'chrome' }); } }, 'Use my Chrome login'),
        h('button', { class: 'btn small', onclick: () => pick.click() }, 'Attach the video file'), pick));
    } else if (err.code === 'no-ytdlp') {
      box.append(h('div', { class: 'hint', style: { margin: '6px 0' } }, 'To paste links, install the free downloader once (Terminal), then restart Reel Room:'),
        h('div', { class: 'code-block' }, this.ed.state.info?.platform === 'win32' ? 'winget install yt-dlp' : 'brew install yt-dlp'),
        h('div', { class: 'hint', style: { margin: '6px 0' } }, 'Or save the reel and attach the file. That always works.'),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => pick.click() }, 'Attach the video file'), pick));
    } else {
      if (err.detail) box.append(h('div', { class: 'hint' }, err.detail));
      if (err.retry) box.append(h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn small', onclick: () => pick.click() }, 'Attach the video file instead'), pick));
    }
    return box;
  }

  async reset() {
    await api.post(`/api/projects/${this.ed.id}/chat/reset`);
    const data = await api.get(`/api/projects/${this.ed.id}`);
    this.render(data.chat);
  }

  // Shows a "working" box that tracks progress while the turn runs. `prepare` runs first
  // (e.g. downloading and studying a reference reel) and can replace the message.
  async send(text, { display, auto = false, kind, ref, prepare } = {}) {
    if (this.busy) { toast('The AI is still working on the last request.'); return; }
    if (!this.ed.state.info?.provider) { toast('Connect Claude or ChatGPT first (Settings).', 'error'); return; }
    if (this.ed.tab !== 'ai') this.ed.showTab('ai');
    this.toggleLibrary(false);
    this.messagesEl.querySelector('.empty-chat')?.remove();
    this.onInput();
    const userEl = this.renderMessage({ role: auto ? 'system' : 'user', text: display || text });
    this.messagesEl.append(userEl);
    const { el: working, now, log, stop: stopTimer } = workingCard();
    this.messagesEl.append(working);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    this.setBusy(true);
    const status = (t) => {
      if (now.textContent && now.textContent !== 'Starting…') log.prepend(h('div', {}, `✓ ${now.textContent}`));
      while (log.childNodes.length > 4) log.lastChild.remove();
      now.textContent = t;
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    };
    let result = null;
    const timer = 0;
    try {
      if (prepare) {
        const p = await prepare(status);
        text = p.message;
        ref = p.ref;
        if (ref) userEl.replaceWith(this.renderMessage({ role: 'user', text: display || text, ref }));
      }
      await this.ed.flushSave?.();
      await this.ed.uploadPreview?.().catch(() => {});
      await api.stream(`/api/projects/${this.ed.id}/chat`, { message: text, display, kind, ref }, (ev) => {
        if (ev.type === 'status') status(ev.text);
        else if (ev.type === 'text') { now.textContent = ev.text.length > 160 ? `${ev.text.slice(0, 160)}…` : ev.text; }
        else if (ev.type === 'done') result = ev;
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      });
    } catch (e) {
      if (prepare && !result) {
        stopTimer();
        working.remove();
        this.setBusy(false);
        this.messagesEl.append(this.referenceProblem(e));
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        return;
      }
      result = { ok: false, text: e.message };
    } finally {
      clearInterval(timer);
      stopTimer();
      working.remove();
      this.setBusy(false);
    }
    if (!result) result = { ok: false, text: 'The connection to the AI dropped. Check the Reel Room terminal window.' };
    this.messagesEl.append(this.renderMessage({ role: result.ok ? 'assistant' : 'error', text: result.text, effects: result.effects, variants: result.variantsChanged }, { kind }));
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    await this.ed.afterAI?.(result, { auto });
  }

  // Called when the editor opens while an AI turn (started earlier) is still running.
  async waitForRunning() {
    const { el: working, now, stop } = workingCard();
    now.textContent = 'Still working on your last request';
    this.messagesEl.append(working);
    this.setBusy(true);
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const data = await api.get(`/api/projects/${this.ed.id}`).catch(() => null);
      if (data && !data.aiBusy) { stop(); working.remove(); this.setBusy(false); this.render(data.chat); await this.ed.afterAI?.({ ok: true, changed: true, variants: data.variants }, { auto: true }); return; }
    }
  }
}

// The "it's working" card: spinning logo, a running clock, the current step and the finished ones.
function workingCard() {
  const now = h('div', { class: 'now' }, 'Starting…');
  const log = h('div', { class: 'log' });
  const clock = h('span', { class: 'elapsed' }, '0:00');
  const el = h('div', { class: 'working' },
    h('div', { class: 'working-head' }, h('span', { class: 'spin-logo' }, '▶'), h('b', {}, 'Editing your video'), h('div', { class: 'spacer' }), clock),
    now, log);
  const started = Date.now();
  const t = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
  return { el, now, log, stop: () => clearInterval(t) };
}

function chooseVideoUse(name) {
  return new Promise((resolve) => {
    let picked = null;
    const m = modal({
      title: 'What is this video for?',
      body: h('div', { style: { display: 'grid', gap: '8px' } },
        h('p', { class: 'muted', style: { margin: '0 0 6px' } }, name),
        h('button', { class: 'choice', onclick: () => { picked = 'reference'; m.close(); } }, h('b', {}, '🔗 Copy its editing style'), h('span', { class: 'hint' }, 'Someone else\'s reel you like. The AI studies it and gives your video the same feel.')),
        h('button', { class: 'choice', onclick: () => { picked = 'asset'; m.close(); } }, h('b', {}, '🎬 Use it in my video'), h('span', { class: 'hint' }, 'Your own b-roll or clip. The AI can cut it in where it fits.'))),
      onClose: () => resolve(picked),
    });
  });
}

function micIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', '18'); s.setAttribute('height', '18');
  s.innerHTML = '<path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2z"/>';
  return s;
}
