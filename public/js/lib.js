// Small shared helpers: API calls, DOM building, toasts, modals, formatting.

const TOKEN = document.querySelector('meta[name="rr-token"]')?.content || '';
const headers = (extra = {}) => ({ 'x-rr-token': TOKEN, ...extra });

async function asJson(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  raw: (url, opts = {}) => fetch(url, { ...opts, headers: headers(opts.headers) }),
  get: (url) => fetch(url, { headers: headers() }).then(asJson),
  post: (url, body = {}) => fetch(url, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }).then(asJson),
  patch: (url, body = {}) => fetch(url, { method: 'PATCH', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }).then(asJson),
  put: (url, body, type = 'application/json') => fetch(url, { method: 'PUT', headers: headers({ 'Content-Type': type }), body: type === 'application/json' && typeof body !== 'string' ? JSON.stringify(body) : body }).then(asJson),
  del: (url) => fetch(url, { method: 'DELETE', headers: headers() }).then(asJson),

  // PUT a File/Blob with upload progress (fetch can't report upload progress).
  upload(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('x-rr-token', TOKEN);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => (xhr.status < 300 ? resolve(JSON.parse(xhr.responseText || '{}')) : reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`)));
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(file);
    });
  },

  // POST and read a newline-delimited JSON stream.
  async stream(url, body, onEvent) {
    const res = await fetch(url, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    if (!res.ok) { await asJson(res); return; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) { try { onEvent(JSON.parse(line)); } catch {} }
      }
    }
  },
};

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Like el.append, but flattens arrays and skips null/false (the same rules as h()).
export function add(el, ...children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function toast(message, kind = 'info', ms = 3500) {
  let box = $('#toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const el = h('div', { class: `toast ${kind}` }, message);
  box.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const wrap = h('div', { class: 'modal-wrap', onmousedown: (e) => { if (e.target === wrap) close(); } },
    h('div', { class: `modal ${wide ? 'wide' : ''}` },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', onclick: close, title: 'Close' }, '✕')),
      h('div', { class: 'modal-body' }, body),
      actions.length ? h('div', { class: 'modal-actions' }, actions.map((a) => h('button', { class: a.primary ? 'btn primary' : 'btn', onclick: () => a.onClick?.(close) }, a.label))) : null,
    ));
  document.body.append(wrap);
  document.addEventListener('keydown', onKey);
  return { close, el: wrap };
}

export function confirmBox(title, message, okLabel = 'OK') {
  return new Promise((resolve) => {
    modal({ title, body: h('p', {}, message), onClose: () => resolve(false), actions: [
      { label: 'Cancel', onClick: (c) => { resolve(false); c(); } },
      { label: okLabel, primary: true, onClick: (c) => { resolve(true); c(); } },
    ] });
  });
}

export function prompt(title, value = '', placeholder = '') {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value, placeholder });
    const m = modal({ title, body: input, onClose: () => resolve(null), actions: [
      { label: 'Cancel', onClick: (c) => { resolve(null); c(); } },
      { label: 'OK', primary: true, onClick: (c) => { const v = input.value; resolve(v); c(); } },
    ] });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { resolve(input.value); m.close(); } });
    setTimeout(() => input.focus(), 30);
  });
}

export const fmtTime = (s) => {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(1)}`;
};

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const canvasBlob = (canvas, type = 'image/jpeg', q = 0.82) => new Promise((r) => canvas.toBlob(r, type, q));
