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
  serve.mjs          zero-dep static file server

backend/             API proxy on :3000
  server.mjs         POST /api/translate with provider fallback chain
  validate.mjs       request validation (shared with tests)
  test.mjs           smoke tests (node --test)

scripts/dev.mjs                 runs both servers together
scripts/setup_libretranslate.ps1  self-hosts LibreTranslate in .venv (optional)
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
{ "translatedText": "hola", "provider": "mymemory" }
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
- Live interim transcript (words appear as you speak), finalized text preserved.
- **Live streaming translation**: the Translation panel updates while you speak
  (interim text, throttled), not just on pauses. Falls back to translate-on-pause
  automatically if the service is unreliable.
- Auto-translation of the accumulated final text on pause or stop.
- Text-to-speech: 🔊 button reads the translation aloud (browser-native
  `speechSynthesis`, voice auto-matched to the target language; stops on new
  translation, clear, or when recording starts).
- Clear, copy transcript, and copy translation controls.
- **Installable PWA**: service worker caches the app shell (works offline), web
  manifest + icons let you install it as an app on desktop and mobile.
- Clear error/status banner for unsupported browsers, mic denial, and network drops.

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

1. Allow mic permission when prompted; speak → words appear live in Transcript.
2. Speak continuously → Translation panel updates live while talking (dimmed,
   trailing "…"); pause → clean final translation replaces it.
3. Swap languages → previous translation replaced.
4. Copy transcript / translation → clipboard contains the text.
5. Clear → both panels empty.
6. Deny mic → friendly banner, app stays usable.
7. Stop the backend (`npm run start:backend`) → translating shows a network notice.
8. DevTools → Application → Manifest + Service Worker registered; reload with
   Network set to Offline → shell still loads, offline banner appears.
9. Install the app from the address bar → opens standalone with the icon.
10. Room panel: start listening with 2+ people talking → the badge counts them and
    the current speaker's chip pulses (first run downloads the ~33 MB model;
    DevTools → Network will show huggingface.co + cdn.jsdelivr.net fetches).
    Tap a chip to rename it; say more → transcript lines get the speaker tag.
