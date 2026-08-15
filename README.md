# Voice Translator

Zero-cost, browser-accessible voice translation: speak in one language and get
live transcript + instant translation. Uses the browser-native Web Speech API
for speech-to-text and free keyless translation providers (via a local proxy).

## Quick start

```sh
npm run dev
```

or double-click `start.cmd` (also opens the browser).

- Frontend: http://localhost:8080
- Backend API: http://localhost:3000
- LibreTranslate (self-hosted): http://localhost:5000 — auto-starts if `.venv` exists

Use Chrome, Edge, or Safari. Desktop Firefox is not supported (no Web Speech API).

## Architecture

Separated frontend and backend, both zero-dependency (Node built-ins only —
no `npm install` needed).

```
frontend/            Vanilla HTML/CSS/JS SPA (static server on :8080)
  index.html         UI layout
  styles.css         responsive styling + visual states
  app.js             Web Speech API + translation + controls
  speakers.js        Room speaker diarization (UI side)
  speakers.worker.js on-device speaker detection worker (diarization-js + ONNX)
  asr.js             on-device STT (vosk-browser/WASM) for screen-audio mode
  serve.mjs          zero-dep static file server

backend/             API proxy on :3000
  server.mjs         POST /api/translate with provider fallback chain
  validate.mjs       request validation (shared with tests)
  test.mjs           smoke tests (node --test)

scripts/dev.mjs                 runs both servers together
scripts/setup_libretranslate.ps1  self-hosts LibreTranslate in .venv (optional)
scripts/setup-vosk-models.ps1     fetches the Indonesian STT model (optional)
```

The browser cannot call translation providers directly (CORS + rate limits), so
the backend proxies them. All dependencies stay project-local — nothing is
installed globally, and any Python tooling lives in a dedicated `.venv/`.

## Translation providers

Backend uses a fallback chain so translation keeps working:

1. **LibreTranslate** — used when `LIBRETRANSLATE_URL` is set (public mirror or
   self-hosted). Optional `LT_API_KEY` for mirrors that require one.
2. **MyMemory** — free, keyless, always-on fallback (long text is auto-chunked).

By default only MyMemory is active; `npm run dev` auto-starts a self-hosted
LibreTranslate from `.venv` (languages: `LT_LANGS`, default `en,es,id`) and sets
`LIBRETRANSLATE_URL` for the backend automatically. All other language pairs
fall back to MyMemory. To add more local languages, run the launcher first:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup_libretranslate.ps1   # one-time install
scripts\start-libretranslate.cmd en,es,fr,ja                                 # downloads those models
```

Set `LT_LANGS=en,es,fr,ja npm run dev` to auto-load a custom set on each start.

## API

`POST /api/translate`

```json
{ "q": "hello", "source": "en", "target": "es" }
```

```json
{ "translatedText": "hola", "provider": "mymemory", "ms": 243 }
```

`GET /api/health` — reports whether each provider is reachable.

## Configuration (backend env vars)

| Variable               | Default                    | Purpose                          |
| ---------------------- | -------------------------- | -------------------------------- |
| `PORT`                 | `3000`                     | Backend port                     |
| `LIBRETRANSLATE_URL`   | `http://localhost:5000` (set by dev runner) | LibreTranslate mirror to prefer |
| `LT_API_KEY`           | *(empty)*                  | API key if the mirror requires one |
| `LT_LANGS`             | `en,es,id`                 | Languages loaded by self-hosted LibreTranslate |
| `CORS_ORIGIN`          | `http://localhost:8080`    | Allowed frontend origin          |

## Features

- Microphone permission requested on user click; denials handled gracefully.
- Source and target language dropdowns (BCP-47 codes) + one-click swap.
- **Bilingual conversation view**: every spoken line appears in the Conversation
  panel with its own translation underneath, per-line timestamp, and speaker tag;
  a separate **Live translation** panel shows the current utterance as it streams.
- **Live streaming translation**: the Live panel updates while you speak (interim
  text, throttled, dimmed with trailing "…"), not just on pauses. Falls back to
  translate-on-pause automatically if the service is unreliable.
- **Engine indicator**: Live translation shows which provider produced the text
  (LibreTranslate or MyMemory) and the latency in ms.
- **Speaker color-coding**: each detected speaker gets a stable color used across
  the Room chips and the Conversation speaker tags.
- Text-to-speech: 🔊 button reads the translation aloud (browser-native
  `speechSynthesis`, voice auto-matched to the target language; stops on new
  translation, clear, or when recording starts).
- Clear, copy conversation, and copy translation controls.
- **Installable PWA**: service worker caches the app shell (works offline), web
  manifest + icons let you install it as an app on desktop and mobile.
- **Toasts** for transient events (mic errors, copy confirmations, theme changes)
  instead of shifting the layout; the banner is reserved for persistent states
  (offline, unsupported browser).
- **Ergonomics**: sticky bottom controls, keyboard shortcuts
  (`Space` = mic, `Ctrl+Enter` = clear, `Esc` = stop audio), a Light/Dark/System
  theme toggle (persisted), and `prefers-reduced-motion` support.
- **Screen / meeting audio mode**: capture audio from another app (e.g. a Zoom
  meeting) with a **Mic / Screen audio** toggle and translate it with fully
  on-device speech recognition (see below).

## Room: detect who is talking (one mic)

The **Room** panel counts how many distinct people are in the room **by voice only**
(no camera) and highlights **who is talking right now**, entirely on-device:

- Live mic audio is run every ~5 s through a browser port of the pyannote speaker
  diarization pipeline (`diarization-js` + `onnxruntime-web`, WASM) in a Web Worker.
- The badge shows the number of distinct voices detected; each voice gets a chip
  ("Speaker 1", "Speaker 2", …) and the currently-talking chip pulses.
- Tap a chip to rename it (e.g. "Ali"); names are saved in `localStorage`.
- Final transcript lines are tagged with the active speaker's chip label.
- Models (~33 MB) are fetched once from the Hugging Face CDN and cached by the
  browser + service worker, so repeat loads and offline use work.

### Limitations (honest)

- Labels are **anonymous** — a single microphone cannot identify *who* a person
  is; rename chips manually.
- Updates are periodic (~every 5 s), not instant; very short remarks may be missed.
- Two people talking at the same time degrade accuracy (true of all diarization).
- Inference is CPU/WASM and runs in a worker so the UI stays smooth, but on slow
  phones updates arrive less often.
- **Privacy note:** the diarization models and your audio never leave your device.

## Screen / meeting audio translation (experimental)

Switch the **Mic / Screen audio** toggle to capture audio from another
application (a Zoom call, a video, a game…) instead of your microphone, and get
the same live transcript + translation + Room speaker detection. Because the
browser's SpeechRecognition only accepts the system microphone, this mode uses
**vosk-browser** — Vosk compiled to WASM — so all speech-to-text runs locally
(no audio leaves your device).

- Click **Screen audio**, then **Capture screen audio**: pick the meeting window
  or your whole screen in the browser picker and tick **"Share audio"** (on
  Windows, sharing the screen captures full system audio).
- The captured audio feeds on-device STT *and* the Room panel, so you get live
  translation and per-call speaker detection at once.
- Models (~40 MB each) download on first use and are cached by the browser +
  service worker. Source languages for this mode are limited to the available
  Vosk models:

| Language  | Model | Size | License |
| --------- | ----- | ---- | ------- |
| English   | `vosk-model-small-en-us-0.15` (ccoreilly GitHub Pages) | 39 MB | Apache-2.0 |
| French    | `vosk-model-small-fr-pguyot-0.3` (ccoreilly GitHub Pages) | 44 MB | CC-BY-NC-SA 4.0 |
| Indonesian| bookbot `model-id-id` → `frontend/models/vosk-model-small-id.tar.gz` | ~42 MB | Apache-2.0 |

### Indonesian model (one-time setup)

Vosk has **no official Indonesian model**; this app ships the public
bookbot-kids Indonesian Vosk model instead. It must be downloaded and packed
once:

```powershell
npm run setup:vosk-models
```

This fetches the model files from `github.com/bookbot-kids/
speech-recognizer-bahasa-indonesian` and packs them into
`frontend/models/vosk-model-small-id.tar.gz` (using the `tar` bundled with
Windows). Reload the app afterwards. If the file is missing, Screen-audio mode
shows a clear toast pointing at this command.

### Honest limitations

- **Indonesian accuracy**: the model is trained on children's speech with a
  small dictionary, so meeting transcription in Indonesian is noticeably less
  accurate than English/French.
- **Platforms**: display-capture audio needs Chrome or Edge. Windows + ChromeOS
  capture full system audio when sharing the screen; macOS/Linux can only
  capture a browser tab's audio. The screen-audio toggle is hidden/disabled
  where `getDisplayMedia` is unsupported.
- The on-device engine and each model load on first use (a few seconds to
  extract a ~40 MB archive in a worker); the UI reports progress.
- Vosk models run in a Web Worker so the UI stays responsive, but very slow
  devices may lag on translation updates.
- **Privacy note:** screen audio is transcribed locally — nothing is sent to
  any speech service.

## PWA / offline & mobile

- **Installable:** the web manifest + generated icons let you "Install" the app
  (Chrome/Edge: address-bar install icon; iOS Safari: Share → Add to Home Screen).
- **Offline shell:** a service worker (`frontend/sw.js`) precaches the app shell so
  the page loads with no connection; speech recognition and translation still need
  a network. While offline, a banner explains this; it auto-clears when back online.
- **Secure context:** service workers and the microphone require HTTPS. `http://localhost`
  counts as secure for desktop testing; for phone use, serve the `frontend/` folder
  over HTTPS (e.g., deploy or a reverse proxy with a cert) and point the app's API
  base at your backend (set `window.VOICE_TRANSLATOR_API` before `app.js` loads).
- Regenerate icons any time with `npm run icons`.

## Verification

Backend smoke tests:

```sh
npm run test:backend
```

Manual browser checklist (Chrome/Edge):

1. Allow mic permission when prompted; speak → words appear live in Conversation.
2. Speak continuously → Live translation updates while talking (dimmed, trailing
   "…"); pause → clean final translation replaces it and the Conversation entry
   gets its own translation underneath.
3. Check the engine indicator under Live translation shows e.g. "MyMemory · 310 ms".
4. Swap languages → all conversation lines re-translate into the new target.
5. Copy conversation / copy translation → clipboard contains the text.
6. Clear → both panels empty.
7. Deny mic → toast with a friendly message, app stays usable.
8. Theme toggle cycles System/Light/Dark and persists across reloads.
9. Keyboard: `Space` toggles the mic, `Ctrl+Enter` clears, `Esc` stops spoken audio.
10. Stop the backend (`npm run start:backend`) → translating shows an error toast.
11. DevTools → Application → Manifest + Service Worker registered; reload with
    Network set to Offline → shell still loads, offline banner appears.
12. Install the app from the address bar → opens standalone with the icon.
13. Room panel: start listening with 2+ people talking → the badge counts them and
    the current speaker's chip pulses (first run downloads the ~33 MB model;
    DevTools → Network will show huggingface.co + cdn.jsdelivr.net fetches).
    Tap a chip to rename it; say more → conversation lines get the speaker tag.
14. Screen-audio mode: switch to **Screen audio**, capture a tab playing audio,
    tick "Share audio" → transcript + translations appear (first run downloads
    the ~40 MB Vosk model + engine from cdn.jsdelivr.net / ccoreilly.github.io).
15. Indonesian screen audio: run `npm run setup:vosk-models`, reload, capture a
    screen with Indonesian speech → Indonesian transcription appears; the Room
    panel keeps detecting speakers.
