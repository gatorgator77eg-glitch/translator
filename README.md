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
- Auto-translation of the accumulated final text on pause or stop.
- Clear, copy transcript, and copy translation controls.
- Clear error/status banner for unsupported browsers, mic denial, and network drops.

## Verification

Backend smoke tests:

```sh
npm run test:backend
```

Manual browser checklist (Chrome/Edge):

1. Allow mic permission when prompted; speak → words appear live in Transcript.
2. Pause → the finalized text translates into Translation panel.
3. Swap languages → previous translation replaced.
4. Copy transcript / translation → clipboard contains the text.
5. Clear → both panels empty.
6. Deny mic → friendly banner, app stays usable.
7. Stop the backend (`npm run start:backend`) → translating shows a network notice.
