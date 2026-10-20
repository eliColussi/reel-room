// Source time (the original recording) vs output time (after trims and cuts).
// Everything in edit.json uses source time; the timeline maps it to the finished video.

// Pauses in the speech, from the loudness envelope measured at import.
export function findSilences(audio, { minGap = 0.45 } = {}) {
  if (!audio?.db?.length) return [];
  const { db, rate } = audio;
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const speech = sorted[Math.floor(sorted.length * 0.9)];
  const threshold = floor + Math.max(6, (speech - floor) * 0.35);
  const quiet = db.map((v) => v < threshold);
  // A click or breath shorter than ~40ms inside a pause doesn't end the pause.
  for (let i = 0; i < quiet.length;) {
    if (quiet[i]) { i++; continue; }
    let j = i;
    while (j < quiet.length && !quiet[j]) j++;
    if (i > 0 && j < quiet.length && j - i <= 2) for (let k = i; k < j; k++) quiet[k] = true;
    i = j;
  }
  const out = [];
  let start = -1;
  for (let i = 0; i <= quiet.length; i++) {
    if (i < quiet.length && quiet[i]) { if (start < 0) start = i; continue; }
    if (start >= 0 && (i - start) / rate >= minGap) out.push([start / rate, i / rate]);
    start = -1;
  }
  return out;
}

export function buildTimeline({ duration, spec, words = [], audio }) {
  const D = Math.max(0.1, duration || 0);
  const cuts = [];
  const { trim, cuts: c } = spec;
  if (trim.start > 0) cuts.push([0, trim.start]);
  if (trim.end != null && trim.end < D) cuts.push([trim.end, D]);
  for (const r of c.ranges) cuts.push([+r.start, +r.end]);

  // Words struck out in the transcript: cut from the first struck word to the next kept word.
  const struck = new Set(c.words);
  for (let i = 0; i < words.length; i++) {
    if (!struck.has(i)) continue;
    let j = i;
    while (struck.has(j + 1) && j + 1 < words.length) j++;
    const prevEnd = i > 0 ? words[i - 1].e : 0;
    const start = Math.max(prevEnd, words[i].s - 0.03);
    const end = j + 1 < words.length ? words[j + 1].s - 0.03 : D;
    if (end > start) cuts.push([start, Math.max(start, end)]);
    i = j;
  }

  if (c.silence?.enabled) {
    const pad = Math.max(0, +c.silence.padding || 0);
    for (const [a, b] of findSilences(audio, { minGap: +c.silence.minGap || 0.45 })) {
      const s = a <= 0.05 ? 0 : a + pad;
      const e = b >= D - 0.05 ? D : b - pad;
      if (e - s > 0.05) cuts.push([s, e]);
    }
  }

  // Union of cut ranges, then the kept segments in between.
  const merged = [];
  for (const [a, b] of cuts.map(([a, b]) => [Math.max(0, a), Math.min(D, b)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + 0.001) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  let segments = [];
  let t = 0;
  for (const [a, b] of merged) { if (a > t) segments.push([t, a]); t = Math.max(t, b); }
  if (t < D) segments.push([t, D]);
  segments = segments.filter(([a, b]) => b - a >= 0.08);
  if (!segments.length) segments = [[0, Math.min(D, 0.5)]];

  let acc = 0;
  const segs = segments.map(([s, e], i) => { const seg = { s, e, out: acc, i }; acc += e - s; return seg; });
  const outDuration = acc;

  const segIndexAt = (src) => {
    let lo = 0, hi = segs.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (segs[mid].s <= src + 1e-6) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  };

  return {
    segments: segs,
    outDuration,
    duration: D,
    removed: D - outDuration,
    // Source → output. Times inside a cut snap to the start of the next kept segment.
    toOut(src) {
      const i = segIndexAt(src);
      if (i < 0) return 0;
      const seg = segs[i];
      if (src <= seg.e) return seg.out + (src - seg.s);
      return i + 1 < segs.length ? segs[i + 1].out : outDuration;
    },
    toSrc(out) {
      if (out <= 0) return segs[0].s;
      let lo = 0, hi = segs.length - 1, ans = 0;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (segs[mid].out <= out) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
      const seg = segs[ans];
      return Math.min(seg.e, seg.s + (out - seg.out));
    },
    segmentAt(src) { const i = segIndexAt(src); return i >= 0 && src <= segs[i].e ? segs[i] : null; },
    isCut(src) { return !this.segmentAt(src); },
    // Where playback should continue from when it reaches src (inside a cut).
    nextKept(src) {
      const i = segIndexAt(src);
      if (i < 0) return segs[0].s;
      if (src < segs[i].e) return src;
      return i + 1 < segs.length ? segs[i + 1].s : D;
    },
  };
}
