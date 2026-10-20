# Reel Room

A free AI video editor for short-form reels. It runs on your computer and does its thinking with the Claude or ChatGPT plan you already pay for. No subscription, no API keys, no upload to someone else's server.

Drop in a talking-head video. You get word-by-word captions, face-tracked vertical framing and a live preview. Then you talk to it, typing or out loud:

> make the hook pop more · cut the part where I stumble · put a big "WRAPPERS" behind my head · pitch me 6 effect ideas · make mine feel like this reel, 80% · make 5 trial reels

The chat is the main way to edit. The AI reads your transcript, looks at your frames, edits the timeline, and you watch it change. Undo is one click. The sliders and panels are still there for when you'd rather nudge something yourself.

## What it does

- **Already cleaned up when it opens.** Pauses, dead air and repeated takes are cut the moment a video comes in. Read your script three times? It keeps the last full take of each line and stitches the rest together. One Undo puts everything back.
- **Real images, not clip art.** Name a company, product, person or news outlet and the AI can pull in the real thing: the official logo, a photo, the site's own share image, or a fresh screenshot of the website (desktop or phone size). Then it crops, places and animates them like an editor would: behind your head, sliding up with motion blur, on a card that pops in on the word.
- **A style guide it actually follows.** Write your rules in the Style tab ("only real images", "no emoji", "white captions, sentence case"). They go with every request as rules, not suggestions.
- **Talk to it.** Press the mic and say what you want. Your voice is written down by the same speech model that makes your captions, on your computer.
- **Copy a reel's feel.** Paste an Instagram, TikTok or YouTube link (or attach the video) and pick how close to go, from "a hint of it" to 90%. The AI studies its captions, pacing, zooms and graphics, writes up what it saw, and gives your video that feel. It never copies their words, logo or footage. Keep the result as a style with one click.
- **Trial reels.** One clip in, 3 to 10 versions out, each opening differently (a different first line, hook or first shot) so every one is a real test. Each comes with what it tests and a post caption. Export them all in one go and post them as Instagram trial reels.
- **Versions.** Try something else without losing what you have. Every version keeps its own undo history.
- **Your own effects library.** Ask for an effect that doesn't exist ("a neon ring that pulses around my head"), and the AI writes it. Like it? Press "Save to my effects" and every future video can use it. The AI reaches for your saved effects first.
- **Captions from your voice.** Whisper runs in your browser. Word-level timing, highlight on the spoken word, emphasis colours, any Google font.
- **Clean cuts.** Cuts play back seamlessly in the preview (two players take turns, so there's no black flash) and the export is frame-accurate. No flashes or dips between clips unless you ask for them.
- **Cuts.** Pauses show up on the timeline. Click one to cut it, or cut them all at once. Drag across the sound wave to select any part and press Delete. The AI cuts false starts and repeated takes (it keeps the last clean one), and you can strike words out in the transcript like a doc.
- **Framing.** Landscape footage becomes vertical and the crop follows your face. Zooms, punch-ins and slow pushes land on the words that matter.
- **No green screen needed.** Background removal, text behind you, half your body cut out and half not, colour pop, sticker outlines, clones.
- **39 built-in effects.** Counters, checklists, bar charts, quote cards, phone and browser mockups, kinetic type, notifications, chat bubbles, VHS, film look, glitch, confetti... Every one is a small file of code, so "make it green" or "change the shape" always works. When nothing fits, the AI writes a new effect from scratch.
- **Styles you can save and share.** Nine starting points (Clean, Bold, Meme, Minimal, Documentary, Tech, Editorial, Studio, Podcast). Click one and your video restyles instantly. Each style also carries a written brief the AI follows, so you can describe a style in plain English and keep it.
- **Taste built in.** The AI is told what makes an edit look machine-made (emoji after every line, a zoom on every sentence, the same yellow highlight everyone uses) and avoids it. The "Slop check" prompt reviews an edit for exactly that.
- **Export.** 720p to 4K MP4, rendered in your browser. A 23-second reel exported in 5 seconds on an M4 Max. Older laptops will take longer.

## What you need

Reel Room is built and tested on macOS. The Windows launcher is included but hasn't been tested yet.

1. **Google Chrome, Microsoft Edge or Brave.** Video encoding uses WebCodecs, which these browsers support best. Safari and Firefox aren't supported yet.
2. **Node.js 18 or newer.** Free from [nodejs.org](https://nodejs.org). It runs the small local server. No `npm install` needed.
3. **One AI command-line app, signed in:**
   - Claude (Pro or Max plan). Install Claude Code, then run `claude` once and log in.
     - Mac/Linux: `curl -fsSL https://claude.ai/install.sh | bash`
     - Windows (PowerShell): `irm https://claude.ai/install.ps1 | iex`
   - ChatGPT (Plus or Pro plan). Run `npm install -g @openai/codex`, then `codex login`. (Supported, but less tested than Claude so far.)

You only need one of the two. If both are installed, Reel Room uses Claude Code first (switch in Settings).

Optional: to paste reel links instead of attaching the file, install [yt-dlp](https://github.com/yt-dlp/yt-dlp) (`brew install yt-dlp` on a Mac). Instagram usually only shares reels with signed-in people, so Reel Room offers to use your Instagram login from Chrome; macOS asks you to allow that. Saving the reel and attaching the file always works.

## Start it

- **Mac:** double-click `Start Reel Room.command`. The first time, macOS may ask you to confirm. Right-click it, choose Open, then Open again.
- **Windows:** double-click `Start Reel Room.bat`.
- **Any system:** `node server.js` in this folder.

Your browser opens at `http://localhost:3737`. Keep the terminal window open while you edit; closing it stops the app.

The first video also downloads the speech model (about 210 MB). That only happens once.

## How to use it

1. Drop a video on the home screen. It's analysed once: audio, transcript, face position, a few stills for the AI. A 30-second clip takes about 10 seconds.
2. Pick a starting style in the Style tab. The thumbnails show each style on your actual frame.
3. In the chat, press **Full edit in my style**, **Interview me first**, or paste a reel you like.
4. Keep talking. "No, smaller." "Put that on the second sentence." "Try it in blue." You can also drag captions and stickers on the preview, drag bars on the timeline, or use the panels above the chat box.
5. Export. With trial reels, export all versions at once.

### Prompts worth trying

The 💡 Ideas button under the chat box holds about 35 of these, grouped by job. A few favourites:

- **Pitch me effect ideas.** You get six ideas tied to exact moments in your video. Each one comes with a "Do it" button.
- **Slop check.** Reviews the edit like a picky human editor and removes anything that screams AI.
- **Half cut-out.** The right side gets a new background, the left stays as filmed.
- **Explain with graphics.** Every number or list you say gets a counter, checklist or chart at that moment.

Specific beats vague. "Add a red stamp that says MYTH right after I say wrappers" gets you exactly that. "Make it better" gets you a guess.

### Your own material

Drop screenshots, logos, clips and music into the Media tab (or into the Library for every video). The AI sees the file list and uses your real stuff instead of stock. Music ducks under your voice automatically.

Real GIFs are optional. Add a free GIPHY key in Settings. Without one, the AI uses animated emoji stickers instead.

## Where your files live

- **Mac:** `~/Movies/Reel Room/`
- **Windows/Linux:** `~/Videos/Reel Room/`

Each video gets its own folder with the original file, the transcript, the edit (`edit.json`), its history, the chat, other versions in `variants/`, reference reels in `references/` and your exports in `exports/`. Styles you save are plain JSON files in `styles/`; effects you save are in `effects/`. Share a style by sending the file, and import it from the home screen.

Set `REELROOM_DATA=/some/folder` to keep everything somewhere else.

## Privacy, honestly

Your video never leaves your computer. Transcription, dictation, face tracking, background removal and rendering all run locally in the browser. Your chat history is a file in the video's folder.

The AI part runs through Claude Code or Codex, which send text to Anthropic or OpenAI the same way they do when you use them for anything else: your instructions, the transcript, the edit file, and a handful of low-res stills (so the AI can see where your face is and what colours you're wearing). That usage counts against your plan.

When you paste a reel link, yt-dlp downloads that reel from the site to the video's folder so it can be studied there. Respect the creator: use references to learn an editing style, not to repost their work. The "Use my Chrome login" button lets yt-dlp read your Instagram login from Chrome on this computer; it isn't sent anywhere else.

When the AI asks for a real image, Reel Room (not the AI) fetches it: from Wikipedia and Wikimedia Commons, from the website you named, or as a screenshot taken by your own Chrome in a throwaway profile with no cookies or logins. It only fetches public websites, never anything on your computer or home network.

Reel Room never touches your Claude or ChatGPT login. It starts the official app you installed and talks to it. It also removes `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` from that app's environment, so a stray API key can't quietly bill you instead of your plan.

## Security

- The app only listens on your own computer (`127.0.0.1`), and every API call needs a key that changes each time it starts.
- The AI runs with file tools only (no terminal, no web) inside the video's folder. Claude Code blocks it from reading anything outside that folder.
- Styles can include effect code, which runs inside the Reel Room page. A content security policy stops page code from contacting any server except the pinned code, model and font CDNs, so a shared style can't send your videos anywhere. Still, only import styles from people you trust.

## Troubleshooting

- **"This video format won't play."** Usually an iPhone HEVC or ProRes file on a machine without hardware support. If ffmpeg is installed, Reel Room offers to convert it. Otherwise set iPhone Settings → Camera → Formats → Most Compatible, or convert to H.264 MP4 with HandBrake (free).
- **"The AI CLI isn't signed in."** Open a terminal, run `claude` (or `codex login`) and sign in, then try again.
- **"Usage limit reached."** Your plan's limit resets on its own. You can still edit by hand in the meantime.
- **Choppy preview with background removal on.** The cut-out runs on every frame. Export isn't affected, it just takes a little longer.
- **The mic does nothing.** Chrome asks for microphone access the first time. If you said no, click the icon at the left of the address bar and allow it.
- **A pasted Instagram link won't download.** Press "Use my Chrome login" (you need to be logged in to Instagram in Chrome), or save the reel and attach the file.
- **Captions misheard a name.** Double-click the word in the Transcript tab, or ask the AI to "fix misheard words". For tough audio, switch Settings → Transcription to Accurate and press Transcribe again.

## For developers

No build step and no dependencies. Plain Node on the server, plain ES modules in the browser.

| Path | What it is |
|---|---|
| `server.js` | Local HTTP server: projects, files with range requests, styles, library, undo history, the AI chat stream. Binds to 127.0.0.1 and needs a per-launch token on every API call. |
| `lib/ai.js` | Finds `claude` / `codex`, runs one chat turn headlessly in the project folder (`claude -p --output-format stream-json` or `codex exec --json`), streams progress back. |
| `lib/agent-guide.md` | The instructions the AI reads in every project (written there as `CLAUDE.md` and `AGENTS.md`): the full `edit.json` reference, editing taste, the anti-slop list, and the effect API. Most of the edit quality comes from this file. |
| `lib/web-images.js` | Fetches real logos, photos, share images and website screenshots for the AI, with public-site checks. |
| `public/js/cleanup.js` | Automatic clean-up on import: finds repeated takes from the transcript. |
| `lib/context.js` | Writes `context.md`, `transcript.txt` and the effect catalogs (built-in and saved) the AI reads before each turn. |
| `public/js/ui/chat.js` | The chat: dictation, attachments, reference links, trial reels, "save this effect" buttons. |
| `public/js/reference.js` | Studies a reference reel: contact sheets with timestamps, cut detection, pacing, transcript. |
| `public/js/dictation.js` | Mic recording written down by the local Whisper model. |
| `public/js/render/` | The compositor. One `draw()` serves the live preview and the exporter, so what you see is what you export. |
| `public/js/analyze.js` | Import pipeline: Mediabunny decode, Whisper (Transformers.js), MediaPipe face detection. |
| `public/js/export.js` | Frame-accurate MP4 export with WebCodecs via Mediabunny. |
| `public/effects/` | Built-in effects. Each file exports `meta` (name, props, presets) and `draw(ctx, fx)`. |
| `styles/` | Built-in styles. |

An edit is a single JSON file (`edit.json`). Times are always source seconds, so cuts never shift layers off the words they belong to. The AI edits that file with its normal file tools, the browser re-renders, and the server keeps every version for undo.

## Credits

Built on [Mediabunny](https://mediabunny.dev) (MPL-2.0), [Transformers.js](https://github.com/huggingface/transformers.js) and Whisper (Apache-2.0 / MIT), [MediaPipe](https://ai.google.dev/edge/mediapipe) (Apache-2.0), [Noto animated emoji](https://googlefonts.github.io/noto-emoji-animation/) (CC BY 4.0) and Google Fonts. GIFs, when enabled, are Powered by GIPHY.
