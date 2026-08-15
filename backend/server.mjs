import http from "node:http";
import https from "node:https";
import { validate } from "./validate.mjs";

const PORT = Number(process.env.PORT || 3000);
const LIBRETRANSLATE_URL = process.env.LIBRETRANSLATE_URL || "";
const LT_API_KEY = process.env.LT_API_KEY || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:8080";

const MYMEMORY_URL = "https://api.mymemory.translated.net/get";
const MYMEMORY_CHUNK = 450;
const MYMEMORY_CONCURRENCY = 4;

function send(res, status, payload, contentType = "application/json") {
  const body = contentType === "application/json" ? JSON.stringify(payload) : payload;
  res.writeHead(status, {
    "Content-Type": `${contentType}; charset=utf-8`,
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function requestJson(method, url, { body, timeout = 15000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === "https:";
    const client = isHttps ? https : http;
    const json = body ? JSON.stringify(body) : null;
    const req = client.request(
      u,
      {
        method,
        headers: {
          Accept: "application/json",
          "User-Agent": "voice-translator/1.0",
          ...(json ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) } : {}),
          ...headers,
        },
        timeout,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            /* non-JSON upstream */
          }
          resolve({ status: res.statusCode, parsed, raw });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    if (json) req.write(json);
    req.end();
  });
}

function splitIntoChunks(text, maxLen) {
  const chunks = [];
  let current = "";
  for (let word of text.split(/\s+/)) {
    if (word.length > maxLen) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      while (word.length > maxLen) {
        chunks.push(word.slice(0, maxLen));
        word = word.slice(maxLen);
      }
      current = word;
      continue;
    }
    if ((current + " " + word).trim().length > maxLen) {
      chunks.push(current.trim());
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function translateLibre({ q, source, target, format }) {
  const body = { q, source, target, format };
  if (LT_API_KEY) body.api_key = LT_API_KEY;
  const result = await requestJson("POST", `${LIBRETRANSLATE_URL}/translate`, { body });
  if (result.status >= 200 && result.status < 300 && result.parsed?.translatedText) {
    return { provider: "libretranslate", text: result.parsed.translatedText };
  }
  throw new Error(result.parsed?.error || result.raw.slice(0, 300) || `upstream ${result.status}`);
}

async function translateMyMemory({ q, source, target }) {
  const chunks = splitIntoChunks(q, MYMEMORY_CHUNK);
  const translations = await mapConcurrent(chunks, MYMEMORY_CONCURRENCY, async (chunk) => {
    const params = new URLSearchParams({ q: chunk, langpair: `${source}|${target}` });
    const result = await requestJson("GET", `${MYMEMORY_URL}?${params.toString()}`);
    if (result.status !== 200 || result.parsed?.responseStatus !== 200) {
      throw new Error(result.parsed?.responseDetails || `mymemory ${result.status}`);
    }
    return result.parsed.responseData.translatedText;
  });
  return { provider: "mymemory", text: translations.join(" ") };
}

async function translate({ q, source, target, format }) {
  if (LIBRETRANSLATE_URL) {
    try {
      return await translateLibre({ q, source, target, format });
    } catch (libreErr) {
      try {
        const result = await translateMyMemory({ q, source, target });
        result.fallback = libreErr.message;
        return result;
      } catch (mmErr) {
        throw new Error(`libretranslate: ${libreErr.message}; mymemory: ${mmErr.message}`);
      }
    }
  }
  return translateMyMemory({ q, source, target });
}

async function checkHealth() {
  const providers = [];
  if (LIBRETRANSLATE_URL) {
    try {
      const result = await requestJson("GET", `${LIBRETRANSLATE_URL}/languages`, { timeout: 8000 });
      providers.push({ name: "libretranslate", ok: result.status >= 200 && result.status < 300, status: result.status });
    } catch {
      providers.push({ name: "libretranslate", ok: false, status: 0 });
    }
  }
  try {
    const result = await requestJson("GET", `${MYMEMORY_URL}?q=hello&langpair=en%7Ces`, { timeout: 8000 });
    providers.push({ name: "mymemory", ok: result.status === 200 && result.parsed?.responseStatus === 200, status: result.status });
  } catch {
    providers.push({ name: "mymemory", ok: false, status: 0 });
  }
  return { ok: providers.some((p) => p.ok), providers };
}

const server = http.createServer(async (req, res) => {
  const method = req.method;
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  if (method === "GET" && url.pathname === "/api/health") {
    const health = await checkHealth();
    send(res, 200, health);
    return;
  }

  if (method === "POST" && url.pathname === "/api/translate") {
    let payload;
    try {
      payload = await parseBody(req);
    } catch (err) {
      send(res, 400, { error: err.message });
      return;
    }

    const errors = validate(payload);
    if (errors.length > 0) {
      send(res, 400, { error: "Validation failed", details: errors });
      return;
    }

    try {
      const startedAt = Date.now();
      const result = await translate(payload);
      send(res, 200, {
        translatedText: result.text,
        provider: result.provider,
        ms: Date.now() - startedAt,
      });
    } catch (err) {
      send(res, 502, { error: "Unable to translate", detail: err.message });
    }
    return;
  }

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`[backend] API listening on http://localhost:${PORT}`);
  console.log(
    LIBRETRANSLATE_URL
      ? `[backend] translation: libretranslate (${LIBRETRANSLATE_URL}) with mymemory fallback`
      : "[backend] translation: mymemory (free, no key). Set LIBRETRANSLATE_URL to use LibreTranslate first."
  );
});
