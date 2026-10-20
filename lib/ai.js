// The AI bridge. Reel Room never handles API keys or logins: it runs the official
// Claude Code CLI (`claude`) or OpenAI Codex CLI (`codex`) that the user already has
// installed and signed into, so every edit runs on the plan they already pay for.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';

const IS_WIN = process.platform === 'win32';

function extraBinDirs() {
  const home = os.homedir();
  const dirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ];
  if (IS_WIN) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    dirs.push(path.join(appData, 'npm'), path.join(local, 'Programs', 'claude'), path.join(home, '.local', 'bin'));
  }
  // nvm installs keep each Node version's global bin in its own folder.
  const nvm = path.join(home, '.nvm', 'versions', 'node');
  try { for (const v of fs.readdirSync(nvm)) dirs.push(path.join(nvm, v, 'bin')); } catch {}
  return dirs;
}

export function which(cmd) {
  const dirs = [...(process.env.PATH || '').split(path.delimiter), ...extraBinDirs()].filter(Boolean);
  const names = IS_WIN ? [`${cmd}.exe`, `${cmd}.cmd`, `${cmd}.bat`, cmd] : [cmd];
  for (const dir of dirs) {
    for (const name of names) {
      const p = path.join(dir, name);
      try { if (fs.statSync(p).isFile()) return p; } catch {}
    }
  }
  return null;
}

function run(bin, args, { cwd, timeout = 20000, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env: childEnv(), shell: needsShell(bin), windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String(e) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

const needsShell = (bin) => IS_WIN && /\.(cmd|bat)$/i.test(bin);

// Strip API keys so the CLIs fall back to the user's subscription login instead of
// silently billing an API account. Also drop the markers a parent Claude Code session
// sets, so a nested run behaves like a fresh one.
export function childEnv() {
  const env = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']) delete env[k];
  env.NO_COLOR = '1';
  return env;
}

let cache = null;
export async function detectAgents(force = false) {
  if (cache && !force) return cache;
  const result = { claude: null, codex: null };
  const claude = which('claude');
  if (claude) {
    const v = await run(claude, ['--version'], { timeout: 15000 });
    const help = await run(claude, ['--help'], { timeout: 15000 });
    const h = help.out + help.err;
    result.claude = {
      path: claude,
      version: (v.out.match(/\d+\.\d+\.\d+/) || [''])[0],
      caps: {
        tools: h.includes('--tools'),
        strictMcp: h.includes('--strict-mcp-config'),
        settingSources: h.includes('--setting-sources'),
      },
    };
  }
  const codex = which('codex');
  if (codex) {
    const v = await run(codex, ['--version'], { timeout: 15000 });
    const status = await run(codex, ['login', 'status'], { timeout: 15000 });
    const s = (status.out + status.err).trim();
    result.codex = {
      path: codex,
      version: (v.out.match(/\d+\.\d+\.\d+/) || [''])[0],
      loggedIn: status.code === 0 && !/not logged in/i.test(s),
      status: s.split('\n').pop(),
    };
  }
  cache = result;
  return result;
}

export function pickProvider(agents, preferred) {
  if (preferred === 'claude' && agents.claude) return 'claude';
  if (preferred === 'codex' && agents.codex) return 'codex';
  if (agents.claude) return 'claude';
  if (agents.codex) return 'codex';
  return null;
}

// Cheap end-to-end check that the CLI is signed in and answering.
export async function testProvider(provider, cwd) {
  const agents = await detectAgents();
  if (provider === 'codex') {
    if (!agents.codex) return { ok: false, message: 'Codex CLI not found.' };
    const r = await run(agents.codex.path, ['login', 'status'], { timeout: 15000 });
    const s = (r.out + r.err).trim();
    const ok = r.code === 0 && !/not logged in/i.test(s);
    return { ok, message: ok ? s.split('\n').pop() : 'Codex is installed but not signed in. Run `codex login` in a terminal.' };
  }
  if (!agents.claude) return { ok: false, message: 'Claude Code CLI not found.' };
  const args = ['-p', '--output-format', 'json'];
  if (agents.claude.caps.strictMcp) args.push('--strict-mcp-config');
  const r = await run(agents.claude.path, args, { cwd, timeout: 90000, input: 'Reply with just the word OK.' });
  try {
    const j = JSON.parse(r.out.trim().split('\n').pop());
    if (j.is_error) return { ok: false, message: friendlyError(j.result || r.err) };
    return { ok: true, message: `Claude Code ${agents.claude.version} is signed in and answering.` };
  } catch {
    return { ok: false, message: friendlyError(r.out + r.err) };
  }
}

export function friendlyError(text = '') {
  const t = String(text);
  if (/usage limit|rate limit|limit reached/i.test(t)) return 'Your plan\'s usage limit is reached for now. It resets on its own. Try again later or switch AI in Settings.';
  if (/invalid api key|please run \/login|not logged in|authentication|401|unauthorized|OAuth/i.test(t)) return 'The AI CLI isn\'t signed in. Open a terminal, run `claude` (or `codex login`), sign in with your account, then try again.';
  if (/ENOENT|not found/i.test(t)) return 'Couldn\'t start the AI CLI. Check it is installed (Settings → AI).';
  return t.trim().slice(0, 600) || 'The AI stopped without saying why.';
}

const shortPath = (p = '') => String(p).split(/[\\/]/).slice(-2).join('/');

function describeClaudeTool(name, input = {}) {
  switch (name) {
    case 'Read': return `Reading ${shortPath(input.file_path)}`;
    case 'Edit': case 'MultiEdit': return `Editing ${shortPath(input.file_path)}`;
    case 'Write': return `Writing ${shortPath(input.file_path)}`;
    case 'Glob': return `Looking for ${input.pattern || 'files'}`;
    case 'Grep': return `Searching for "${input.pattern || ''}"`;
    default: return `Using ${name}`;
  }
}

// Runs one chat turn. Returns { done: Promise<{ok, text, sessionId, error}>, cancel() }.
// The user's message travels over stdin, never through a shell, so no quoting issues.
export function runTurn({ provider, agents, cwd, prompt, sessionId, model, images = [], onEvent }) {
  let child;
  let cancelled = false;
  const emit = (e) => { try { onEvent?.(e); } catch {} };

  const done = new Promise((resolve) => {
    let args, bin;
    if (provider === 'claude') {
      bin = agents.claude.path;
      const caps = agents.claude.caps;
      args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'];
      if (caps.tools) args.push('--tools', 'Read,Edit,Write,Glob,Grep');
      else args.push('--allowedTools', 'Read,Edit,Write,Glob,Grep', '--disallowedTools', 'Bash,WebFetch,WebSearch,Task');
      if (caps.strictMcp) args.push('--strict-mcp-config');
      if (caps.settingSources) args.push('--setting-sources', 'project,local');
      if (model) args.push('--model', model);
      if (sessionId) args.push('--resume', sessionId);
    } else {
      bin = agents.codex.path;
      args = ['exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-c', 'tools.view_image=true'];
      if (model) args.push('-m', model);
      if (sessionId) args.push('resume', sessionId);
      else for (const img of images.slice(0, 3)) args.push('-i', img);
      args.push('-');
    }

    child = spawn(bin, args, { cwd, env: childEnv(), shell: needsShell(bin), windowsHide: true });
    let buf = '', errText = '', finalText = '', lastMessage = '', newSession = sessionId || null, isError = false, gotResult = false;
    const timer = setTimeout(() => { emit({ type: 'status', text: 'Taking too long, stopping.' }); child.kill(); }, 15 * 60 * 1000);

    const handle = (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (provider === 'claude') {
        if (ev.type === 'system' && ev.subtype === 'init') {
          newSession = ev.session_id || newSession;
          emit({ type: 'status', text: `Claude is on it${ev.model ? ` (${ev.model})` : ''}` });
        } else if (ev.type === 'assistant' && ev.message?.content) {
          for (const c of ev.message.content) {
            if (c.type === 'text' && c.text?.trim()) { lastMessage = c.text.trim(); emit({ type: 'text', text: lastMessage }); }
            if (c.type === 'tool_use') emit({ type: 'status', text: describeClaudeTool(c.name, c.input) });
          }
        } else if (ev.type === 'result') {
          gotResult = true;
          newSession = ev.session_id || newSession;
          isError = !!ev.is_error || (ev.subtype && ev.subtype !== 'success');
          finalText = (ev.result || '').trim();
        }
      } else {
        if (ev.type === 'thread.started') { newSession = ev.thread_id; emit({ type: 'status', text: 'Codex is on it' }); }
        else if (ev.type === 'item.started' || ev.type === 'item.completed') {
          const it = ev.item || {};
          if (it.type === 'agent_message' && ev.type === 'item.completed' && it.text?.trim()) { lastMessage = it.text.trim(); emit({ type: 'text', text: lastMessage }); }
          else if (it.type === 'reasoning' && ev.type === 'item.started') emit({ type: 'status', text: 'Thinking' });
          else if (it.type === 'command_execution' && ev.type === 'item.started') emit({ type: 'status', text: `Running ${String(it.command || '').slice(0, 80)}` });
          else if (it.type === 'file_change') emit({ type: 'status', text: `Editing ${(it.changes || []).map((c) => shortPath(c.path)).join(', ')}` });
        } else if (ev.type === 'turn.completed') { gotResult = true; finalText = lastMessage; }
        else if (ev.type === 'turn.failed') { gotResult = true; isError = true; finalText = ev.error?.message || 'Codex turn failed.'; }
        else if (ev.type === 'error' && ev.message && !/Reconnecting/i.test(ev.message)) errText += ev.message + '\n';
      }
    };

    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); }
    });
    child.stderr.on('data', (d) => { errText += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: friendlyError(String(e)), sessionId: newSession }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim()) handle(buf.trim());
      if (cancelled) return resolve({ ok: false, cancelled: true, error: 'Stopped.', sessionId: newSession });
      if (!gotResult || isError || (code !== 0 && !finalText)) {
        return resolve({ ok: false, error: friendlyError(finalText || errText || `exit code ${code}`), raw: (finalText || errText).slice(0, 2000), sessionId: newSession });
      }
      resolve({ ok: true, text: finalText || lastMessage || 'Done.', sessionId: newSession });
    });
    child.stdin.end(prompt);
  });

  return { done, cancel: () => { cancelled = true; child?.kill(); } };
}

export function execFileP(bin, args, opts = {}) {
  return new Promise((resolve) => execFile(bin, args, { windowsHide: true, ...opts }, (err, stdout, stderr) => resolve({ err, stdout, stderr })));
}
