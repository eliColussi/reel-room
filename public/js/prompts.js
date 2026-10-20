// One-click prompt ideas. Clicking one drops it in the chat box so it can be tweaked before sending.
// Wording is deliberately specific: vague prompts get generic, AI-looking edits.

export const PROMPTS = [
  {
    group: 'Start here',
    items: [
      { icon: '✨', label: 'Full edit in my style', text: 'Do a complete first edit of this video in the active style.' },
      { icon: '🎤', label: 'Interview me first', text: 'Before you edit anything, interview me. Ask 3 to 5 short questions in one message, numbered, each with 2 to 4 example answers: who this is for, the feeling I want, how busy the screen should be, and any effects I already have in mind. Wait for my answers, then do the edit.' },
      { icon: '💡', label: 'Pitch me effect ideas', text: 'Read the transcript and look at the frames, then pitch me 6 specific effect ideas for this exact video. Each one tied to a moment (timestamp and the words), what it looks like, and why it helps. Mix subtle and bold. Number them and don\'t edit yet, I\'ll pick.' },
      { icon: '🧹', label: 'Slop check', text: 'Review the current edit like a picky human editor. Find everything that makes it look like generic AI-edited content: random emoji, constant zooms, overused caption tricks, effects with no reason, clashing fonts or colours, cluttered frames, anything covering my face. Fix them. Keep only what earns its place, then tell me what you removed.' },
    ],
  },
  {
    group: 'Hook & pacing',
    items: [
      { icon: '🪝', label: 'Hook title', text: 'Write a hook title for the first 2.5 seconds: the promise of this video in 3 to 7 words, in my style, placed so it never covers my face.' },
      { icon: '✂️', label: 'Tighten it', text: 'Make it tighter: remove silences, false starts, repeated takes and anything that doesn\'t move the story forward. Tell me the new length.' },
      { icon: '⏱️', label: 'Under 30 seconds', text: 'Cut this down to under 30 seconds. Keep the hook and the payoff and drop the weakest sentences.' },
      { icon: '🔁', label: 'Pattern interrupts', text: 'Add a pattern interrupt every 6 to 8 seconds (a zoom, b-roll, a graphic or a cut) so attention never drops. Vary them so it never feels formulaic.' },
    ],
  },
  {
    group: 'Captions',
    items: [
      { icon: '🔤', label: 'Premium captions', text: 'Restyle the captions to look premium: sentence case, a modern grotesk font, no outline, soft shadow, two lines max, calm fade.' },
      { icon: '📣', label: 'Punchy captions', text: 'Make the captions punchy: heavy font, uppercase, 2 to 3 words at a time, and highlight the spoken word in one colour pulled from my video.' },
      { icon: '🩹', label: 'Fix misheard words', text: 'Read the transcript and fix misheard words, names and brand names with caption replacements.' },
      { icon: '🖍️', label: 'Emphasise key words', text: 'Highlight only the 1 or 2 words per sentence that carry the point (numbers, results, contrast words) with a colour and a slight scale. Nothing else.' },
    ],
  },
  {
    group: 'Motion & graphics',
    items: [
      { icon: '🔍', label: 'Smart zooms', text: 'Add zooms on the strongest moments: punchlines, numbers and emotional beats. Snap zooms for energy, slow pushes for serious lines, at most one every 5 seconds.' },
      { icon: '🅰️', label: 'Big text behind me', text: 'Put one big bold word behind me (I stay in front of it) at the moment that matters most.' },
      { icon: '💥', label: 'Kinetic type moment', text: 'Turn the most quotable line into a kinetic typography moment, and hide the normal captions while it plays.' },
      { icon: '📊', label: 'Explain with graphics', text: 'Wherever I mention numbers, steps or comparisons, add a clean explainer graphic at that moment (counter, checklist, bar chart or stat card). One at a time, 2 to 4 seconds each.' },
      { icon: '🏷️', label: 'Label that follows me', text: 'When I introduce myself, add a small label that follows my head with my name and what I do. Ask me for the text if you don\'t know it.' },
      { icon: '⚡', label: 'Cut transitions', text: 'Add subtle transitions on a few of the jump cuts (a quick flash or punch-in). Tasteful, not on every cut.' },
    ],
  },
  {
    group: 'Cut-outs & green screen',
    items: [
      { icon: '🟩', label: 'Replace my background', text: 'Remove my background and put me in front of a clean gradient that complements what I\'m wearing.' },
      { icon: '🌗', label: 'Half cut-out', text: 'Cut out only half my body: the right side gets a new background, the left side stays as filmed, with a thin line between them.' },
      { icon: '🎨', label: 'Colour pop', text: 'During the most important line, turn the background black and white and keep me in full colour.' },
      { icon: '🩵', label: 'Sticker outline', text: 'Give me a white sticker-style outline during the hook.' },
      { icon: '👯', label: 'Clones', text: 'Add two clones of me in the background for one funny moment.' },
    ],
  },
  {
    group: 'Fun',
    items: [
      { icon: '🤪', label: 'Make it sillier', text: 'Make this sillier: reaction emoji or GIFs only where something is actually funny, a few snap zooms with a shake on the punchline, and a playful caption font. Keep it readable.' },
      { icon: '😂', label: 'Emoji reactions', text: 'Add 3 or 4 animated emoji reactions at moments that genuinely match what I\'m saying, placed beside my head, never on my face.' },
      { icon: '🎉', label: 'Confetti on the reveal', text: 'Add a confetti burst at the big reveal.' },
    ],
  },
  {
    group: 'Look',
    items: [
      { icon: '🍎', label: 'Apple-clean', text: 'Make it look like an Apple film: lots of restraint, clean type, subtle slow pushes, no stickers, gentle contrast.' },
      { icon: '🎞️', label: 'Cinematic', text: 'Give it a cinematic documentary look: warm grade, light grain, a vignette, letterbox bars for the opening and a serif title.' },
      { icon: '📼', label: 'Retro intro', text: 'Give the first 3 seconds a retro VHS look, then cut to clean.' },
      { icon: '🎯', label: 'My brand colours', text: 'Use my brand colours everywhere (captions, highlights, graphics): ' },
    ],
  },
  {
    group: 'Sound',
    items: [
      { icon: '🎵', label: 'Music bed', text: 'Add background music from my library, ducked under my voice and faded in and out.' },
      { icon: '🔊', label: 'Sound design', text: 'Add subtle sound effects from my assets on the key visual moments only.' },
    ],
  },
  {
    group: 'Finish',
    items: [
      { icon: '👋', label: 'End card', text: 'Add an end card in the last 2.5 seconds with my handle and a follow prompt. Ask me for my handle if you don\'t know it.' },
      { icon: '📱', label: 'Safe-zone check', text: 'Check that nothing important sits under the TikTok or Instagram buttons and fix anything that does.' },
      { icon: '➖', label: 'Progress bar', text: 'Add a thin progress bar at the top in my accent colour.' },
    ],
  },
];

export const QUICK = ['Full edit in my style', 'Interview me first', 'Pitch me effect ideas', 'Slop check'];
