# Project rules

## Never start anything by yourself

- NEVER launch, spawn, or start any server, process, dev environment, or background
  task on your own (e.g. `npm run dev`, `node backend/server.mjs`, `libretranslate`,
  `start.cmd`, Docker, etc.), even for testing or verification.
- ALWAYS ask the user first and get explicit approval before starting anything.
- When the user says "start", start only what they asked for, and tell them how to
  stop it. Do not leave processes running in the background.
- If you need to test something, ask the user to run it, or propose a command and
  wait for approval.
