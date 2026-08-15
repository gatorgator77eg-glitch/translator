import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_PORT = process.env.BACKEND_PORT || 3000;
const FRONTEND_PORT = process.env.FRONTEND_PORT || 8080;
const LT_PORT = Number(process.env.LT_PORT || 5000);
const LT_LANGS = process.env.LT_LANGS || "en,es,id";
const LT_EXE = path.join(ROOT, ".venv", "Scripts", "libretranslate.exe");

const children = [];

function start(name, cmd, args, env) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on("exit", (code) => {
    console.log(`[dev] ${name} exited with code ${code}`);
    shutdown();
  });
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const hasLocalLt = existsSync(LT_EXE);
let libreUrl = "";

async function waitForLibreTranslate() {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${LT_PORT}/languages`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const langs = await res.json();
        return langs.map((l) => l.code);
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`LibreTranslate on :${LT_PORT} did not become ready in time`);
}

async function main() {
  let backendEnv = {};
  if (hasLocalLt) {
    console.log(`[dev] starting local LibreTranslate (:${LT_PORT}, languages: ${LT_LANGS})...`);
    const lt = spawn(LT_EXE, ["--host", "0.0.0.0", "--port", String(LT_PORT), "--load-only", LT_LANGS], {
      stdio: "inherit",
      env: { ...process.env, PYTHONUTF8: "1" },
    });
    children.push(lt);
    lt.on("exit", (code) => {
      console.log(`[dev] libretranslate exited with code ${code}`);
      shutdown();
    });

    try {
      const langs = await waitForLibreTranslate();
      console.log(`[dev] LibreTranslate ready (${langs.join(", ")})`);
      libreUrl = `http://localhost:${LT_PORT}`;
      backendEnv = { LIBRETRANSLATE_URL: libreUrl };
    } catch (err) {
      console.warn(`[dev] ${err.message}`);
      console.warn("[dev] falling back to MyMemory for translation");
    }
  } else {
    console.log("[dev] no .venv LibreTranslate found — using MyMemory for translation");
    console.log("[dev]   (run scripts\\setup_libretranslate.ps1 to self-host LibreTranslate)");
  }

  start("backend", process.execPath, ["backend/server.mjs"], { PORT: String(BACKEND_PORT), ...backendEnv });
  start("frontend", process.execPath, ["frontend/serve.mjs"], { PORT: String(FRONTEND_PORT) });

  console.log(`[dev] backend  -> http://localhost:${BACKEND_PORT}`);
  console.log(`[dev] frontend -> http://localhost:${FRONTEND_PORT}`);
}

main();
