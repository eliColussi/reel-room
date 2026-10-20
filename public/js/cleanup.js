// Automatic clean-up when a video comes in: cut the dead space and the repeated takes, so the
// first thing you see is already tight. Everything it does is a normal cut you can undo.

const norm = (w) => String(w || '').toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '').replace(/^'+|'+$/g, '');

function lcs(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

// A = an earlier attempt (word tokens), B = what was said right after the restart.
function isRetake(A, B) {
  const n = A.length;
  if (!n) return false;
  let prefix = 0;
  while (prefix < n && A[prefix] === B[prefix]) prefix++;
  // False start or word-for-word repeat: everything in A is said again at the start of B.
  if (prefix === n) return true;
  // Same sentence again with a word or two changed. The last word must come back too, which is
  // what tells a retake apart from deliberate repetition ("It's not about the code. It's not about the model.").
  if (n >= 3 && prefix >= Math.min(3, n) && lcs(A, B.slice(0, n + 3)) / n >= 0.75) {
    const tail = B.slice(Math.max(0, n - 3), n + 3);
    if (tail.includes(A[n - 1])) return true;
  }
  return false;
}

// Close enough to be the same word misheard twice ("wrappers" / "rappers", "GPT" / "GBT").
function sameWord(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 1) return false;
  let d = 0;
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return true;
}

// Longest run of words two phrases share: { len, a (start in A), b (start in B) }.
function sharedRun(A, B) {
  let best = { len: 0, a: 0, b: 0 };
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
    let k = 0;
    while (i + k < A.length && j + k < B.length && sameWord(A[i + k], B[j + k])) k++;
    if (k > best.len) best = { len: k, a: i, b: j };
  }
  return best;
}

// A reworded restart of the same line: a long shared run that reaches the end of the earlier phrase,
// and the earlier phrase's last word comes back where it should. That last check keeps deliberate
// parallel lines ("...the money you make. ...the money you keep.").
function isRewordedTake(A, B) {
  const run = sharedRun(A, B);
  if (run.len < 5 || run.len < 0.45 * A.length || run.a + run.len < A.length - 3) return false;
  const aligned = run.b + (A.length - 1 - run.a);
  return B.slice(Math.max(0, aligned - 3), aligned + 4).some((w) => sameWord(w, A[A.length - 1]));
}

// Phrases: runs of words between pauses or full stops.
function phrases(words) {
  const out = [];
  let cur = null;
  words.forEach((w, i) => {
    if (!cur || w.s - words[i - 1].e >= 0.3 || /[.?!]$/.test(words[i - 1].w)) { cur = { from: i, to: i }; out.push(cur); }
    cur.to = i + 1;
  });
  return out;
}

// Repeated takes, keeping the last one each time: returns [[firstWordIndex, restartIndex), ...].
export function findRetakes(words, { maxWords = 45, maxSeconds = 60 } = {}) {
  const toks = words.map((w) => norm(w.w));
  const cut = new Array(words.length).fill(false);

  // 1. Whole phrases said again (maybe reworded) in one of the next two phrases.
  const ph = phrases(words);
  for (let k = 0; k < ph.length; k++) {
    const A = toks.slice(ph[k].from, ph[k].to);
    for (const m of [k + 1, k + 2]) {
      if (!ph[m] || words[ph[m].from].s - words[ph[k].from].s > 25) break;
      if (!isRewordedTake(A, toks.slice(ph[m].from, ph[m].to))) continue;
      // With a phrase in between, only drop it too if it's a short fragment ("sorry, let me redo that").
      if (m === k + 2 && ph[k + 1].to - ph[k + 1].from > 6) continue;
      for (let i = ph[k].from; i < ph[m].from; i++) cut[i] = true;
      break;
    }
  }

  // 2. Restarts that begin with the same words: false starts and word-for-word repeats.
  let i = 0;
  while (i < words.length) {
    let restart = -1;
    if (toks[i] && !cut[i]) {
      for (let j = i + 1; j < Math.min(words.length, i + maxWords + 1); j++) {
        if (words[j].s - words[i].s > maxSeconds) break;
        if (toks[j] !== toks[i] || cut[j]) continue;
        // People pause, however briefly, before they start a line again.
        if (words[j].s - words[j - 1].e < 0.15) continue;
        const A = toks.slice(i, j).filter((_, n) => !cut[i + n]);
        if (isRetake(A, toks.slice(j, j + (j - i) + 3))) { restart = j; break; }
      }
    }
    if (restart > 0) { for (let n = i; n < restart; n++) cut[n] = true; i = restart; } else i++;
  }

  const out = [];
  for (let n = 0; n < words.length; n++) {
    if (!cut[n]) continue;
    let e = n;
    while (e + 1 < words.length && cut[e + 1]) e++;
    if (e + 1 < words.length) out.push([n, e + 1]);
    n = e;
  }
  return out;
}

// Applies the clean-up to a fresh edit. Returns the new spec and what changed.
export function autoClean(spec, words = []) {
  const next = JSON.parse(JSON.stringify(spec || {}));
  next.cuts ||= {};
  next.cuts.silence = { minGap: 0.4, padding: 0.1, ...(next.cuts.silence || {}), enabled: true, words: true };
  const retakes = findRetakes(words);
  next.cuts.ranges = [...(next.cuts.ranges || []).filter((r) => !r.auto), ...retakes.map(([a, b]) => ({
    start: +Math.max(a > 0 ? words[a - 1].e : 0, words[a].s - 0.04).toFixed(3),
    end: +(words[b].s - 0.04).toFixed(3),
    note: `retake: "${words.slice(a, Math.min(b, a + 8)).map((w) => w.w).join(' ')}${b - a > 8 ? '…' : ''}"`,
    auto: true,
  }))];
  return { spec: next, retakes: retakes.length, retakeWords: retakes.reduce((n, [a, b]) => n + (b - a), 0) };
}
