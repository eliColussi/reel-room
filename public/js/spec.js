// The edit spec (edit.json): defaults, normalization, and how styles map onto it.

export const DEFAULTS = {
  format: { aspect: '9:16', fps: 30 },
  trim: { start: 0, end: null },
  cuts: { silence: { enabled: true, minGap: 0.4, padding: 0.1, words: true }, ranges: [], words: [], punchZoom: 1 },
  frame: { fit: 'fill', track: 'face', scale: 1, offsetX: 0, offsetY: 0 },
  background: { remove: false, type: 'blur', color: '#111111', colors: ['#1d1d1f', '#3a3a3c'], angle: 160, src: null, blur: 40, dim: 0.35 },
  grade: { brightness: 1, contrast: 1, saturation: 1, warmth: 0, vignette: 0, grain: 0, blackAndWhite: false },
  captions: {
    enabled: true, mode: 'phrase', maxWords: 4, maxChars: 22, lines: 2,
    font: 'Montserrat', weight: 800, size: 74, uppercase: false, letterSpacing: 0, lineHeight: 1.15,
    color: '#FFFFFF', highlight: '#FFE14D', highlightStyle: 'color', boxColor: null, boxTextColor: null,
    stroke: 8, strokeColor: '#000000', shadow: 12, shadowColor: 'rgba(0,0,0,0.55)', background: null,
    x: 0.5, y: 0.7, maxWidth: 0.84, animation: 'pop', punctuation: true,
    emphasis: {}, replacements: {}, hidden: [], z: 100,
  },
  zooms: [],
  layers: [],
  audio: { volume: 1, enhance: true, music: null, sfx: [] },
};

export const ASPECTS = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080], '16:9': [1920, 1080] };

export const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? clone(base) : clone(over);
  const out = clone(base);
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : clone(v);
  }
  return out;
}

const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);

export function outputSize(spec, resolution = 1080) {
  const [w, h] = ASPECTS[spec.format?.aspect] || ASPECTS['9:16'];
  const k = resolution / Math.min(w, h);
  const even = (n) => Math.round((n * k) / 2) * 2;
  return [even(w), even(h)];
}

// Fill defaults and coerce types so the renderer never trips on a missing or odd value.
export function normalize(input) {
  const warnings = [];
  const spec = deepMerge(DEFAULTS, isObj(input) ? input : {});
  if (!ASPECTS[spec.format.aspect]) { warnings.push(`Unknown aspect "${spec.format.aspect}", using 9:16.`); spec.format.aspect = '9:16'; }
  spec.format.fps = Math.min(60, Math.max(12, num(spec.format.fps, 30)));
  spec.trim.start = Math.max(0, num(spec.trim.start, 0));
  spec.trim.end = spec.trim.end == null ? null : num(spec.trim.end, null);
  spec.cuts.ranges = (Array.isArray(spec.cuts.ranges) ? spec.cuts.ranges : []).filter((r) => r && num(r.end, 0) > num(r.start, 0));
  spec.cuts.words = (Array.isArray(spec.cuts.words) ? spec.cuts.words : []).map(Number).filter(Number.isInteger);
  spec.cuts.punchZoom = num(spec.cuts.punchZoom, 1);
  spec.zooms = (Array.isArray(spec.zooms) ? spec.zooms : []).filter((z) => z && num(z.end, 0) > num(z.start, 0));
  if (!Array.isArray(spec.layers)) { warnings.push('"layers" must be a list.'); spec.layers = []; }
  spec.layers = spec.layers.filter((l, i) => {
    if (!isObj(l) || !l.type) { warnings.push(`Layer ${i} has no type and was skipped.`); return false; }
    return true;
  });
  if (!isObj(spec.captions.emphasis)) spec.captions.emphasis = {};
  if (!isObj(spec.captions.replacements)) spec.captions.replacements = {};
  if (!Array.isArray(spec.captions.hidden)) spec.captions.hidden = [];
  if (!Array.isArray(spec.audio.sfx)) spec.audio.sfx = [];
  return { spec, warnings };
}

// ---- styles ----
// A style's "look" is the part of edit.json that is about how things look, not about this
// particular video's content. Switching style swaps the look and keeps the content.
const CAPTION_CONTENT = ['emphasis', 'replacements', 'hidden'];

export function extractLook(spec) {
  const s = clone(spec || {});
  const captions = { ...(s.captions || {}) };
  for (const k of CAPTION_CONTENT) delete captions[k];
  const look = {
    format: s.format, frame: s.frame, background: s.background, grade: s.grade, captions,
    cuts: { silence: s.cuts?.silence, punchZoom: s.cuts?.punchZoom },
    audio: { enhance: s.audio?.enhance, music: s.audio?.music ?? null },
    layers: (s.layers || []).filter((l) => l.fromStyle),
  };
  return JSON.parse(JSON.stringify(look));
}

export function applyLook(spec, look = {}) {
  const out = clone(spec || {});
  for (const k of ['format', 'frame', 'background', 'grade']) {
    if (look[k]) out[k] = deepMerge(DEFAULTS[k], look[k]);
  }
  if (look.captions) {
    const keep = {};
    for (const k of CAPTION_CONTENT) if (out.captions?.[k] !== undefined) keep[k] = out.captions[k];
    out.captions = { ...deepMerge(DEFAULTS.captions, look.captions), ...keep };
  }
  if (look.cuts) {
    out.cuts ||= {};
    if (look.cuts.silence) out.cuts.silence = clone(look.cuts.silence);
    if (look.cuts.punchZoom != null) out.cuts.punchZoom = look.cuts.punchZoom;
  }
  if (look.audio) {
    out.audio ||= {};
    if (look.audio.enhance != null) out.audio.enhance = look.audio.enhance;
    if ('music' in look.audio) out.audio.music = clone(look.audio.music);
  }
  out.layers = [...(out.layers || []).filter((l) => !l.fromStyle), ...(look.layers || []).map((l) => ({ ...clone(l), fromStyle: true }))];
  return out;
}
