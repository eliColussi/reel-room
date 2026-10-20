// Trial reels: turn one edit into several genuinely different versions to post as Instagram
// trial reels (shown to non-followers first), then share the one that wins.
import { h, modal, toast } from '../lib.js';

export function openTrials(ed) {
  if (ed.chatPanel.busy) { toast('Wait for the AI to finish first.'); return; }
  let count = 5;
  let mix = 'mix';
  const counts = h('div', { class: 'seg' }, [3, 4, 5, 6, 8, 10].map((n) => h('button', { class: n === count ? 'on' : '', onclick: (e) => { count = n; for (const b of counts.children) b.classList.toggle('on', b === e.currentTarget); } }, String(n))));
  const modes = h('div', { class: 'seg' }, [['hooks', 'Same look, new openings'], ['mix', 'Mix it up']].map(([k, label]) => h('button', { class: k === mix ? 'on' : '', onclick: (e) => { mix = k; for (const b of modes.children) b.classList.toggle('on', b === e.currentTarget); } }, label)));
  const keep = h('input', { class: 'input', placeholder: 'e.g. keep my end card, keep it under 40 seconds' });
  const current = (ed.variants || []).find((v) => v.active);

  const m = modal({
    title: '🧪 Trial reels',
    body: h('div', {},
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'Instagram shows trial reels to people who don\'t follow you, then tells you how each one did. Post your main reel, post these as trials, and share the winner with your followers.'),
      h('p', { class: 'hint' }, `The AI makes each version a real test: a different opening line, hook or first shot, plus one or two other changes. They're made from ${current && current.id !== 'main' ? `"${current.name}"` : 'your current edit'}.`),
      h('div', { class: 'field' }, h('label', {}, 'How many'), counts),
      h('div', { class: 'field' }, h('label', {}, 'How different'), modes),
      h('div', { class: 'field' }, h('label', {}, 'Anything that must stay the same? (optional)'), keep)),
    actions: [
      { label: 'Cancel', onClick: (close) => close() },
      { label: 'Make them', primary: true, onClick: (close) => { close(); make(); } },
    ],
  });
  setTimeout(() => keep.focus(), 30);

  function make() {
    const taken = (ed.variants || []).map((v) => parseInt((/^trial-(\d+)$/.exec(v.id) || [])[1] || '0', 10));
    const first = Math.max(0, ...taken) + 1;
    const ids = Array.from({ length: count }, (_, i) => `trial-${first + i}`);
    const how = mix === 'hooks'
      ? 'Keep the look the same in all of them (captions, colours, style). Vary the opening: start line, hook title and first shot, plus length or pacing.'
      : 'Vary the opening in every one (start line, hook title, first shot), and also mix length, pacing, caption style and look across them.';
    const message = `Make ${count} trial reels from this edit for Instagram's trial reels feature. Follow the "Trial reels and versions" section of your guide.
Write them to ${ids.map((id) => `variants/${id}.json`).join(', ')} and add their entries to variants/index.json. Leave edit.json as it is.
${how}${keep.value.trim() ? `\nKeep this the same in all of them: ${keep.value.trim()}` : ''}`;
    ed.chatPanel.send(message, { display: `🧪 Make ${count} trial reels${mix === 'hooks' ? ' (same look, new openings)' : ''}${keep.value.trim() ? `. Keep: ${keep.value.trim()}` : ''}`, kind: 'trials' });
  }
  return m;
}
