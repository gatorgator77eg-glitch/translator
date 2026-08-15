import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8080);
const ROOT = fileURLToPath(new URL(".", import.meta.url));

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".gz": "application/gzip",
};

function cacheControl(filePath) {
  return extname(filePath) === ".gz" ? "public, max-age=3600" : "no-cache";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = normalize(join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      res.writeHead(302, { Location: "/index.html" });
      res.end();
      return;
    }
    const headers = {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      "Cache-Control": cacheControl(filePath),
      "Last-Modified": info.mtime.toUTCString(),
    };
    const ims = req.headers["if-modified-since"];
    if (ims && new Date(ims).getTime() >= info.mtime.getTime() - 1000) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`[frontend] serving http://localhost:${PORT}`);
});
