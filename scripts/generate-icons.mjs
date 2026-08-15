import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "frontend", "icons");

const BLUE = [37, 99, 235];
const WHITE = [255, 255, 255];

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const capsuleCy = size * 0.4;
  const capsuleLen = size * 0.55;
  const capsuleR = size * 0.17;
  const stemTop = capsuleCy + capsuleLen / 2;
  const stemLen = size * 0.2;
  const stemHalf = size * 0.06;
  const baseY = stemTop + stemLen;
  const baseR = size * 0.13;

  function coverageAt(x, y) {
    const dx = Math.abs(x - cx);
    const dyClamped = Math.max(capsuleCy - capsuleLen / 2 - y, 0, y - (capsuleCy + capsuleLen / 2));
    const capsuleDist = Math.sqrt(dx * dx + dyClamped * dyClamped);
    let cov = capsuleR + 0.75 - capsuleDist;

    if (x >= cx - stemHalf && x <= cx + stemHalf && y >= stemTop && y <= stemTop + stemLen) {
      cov = Math.max(cov, 1.5);
    }

    const baseDist = Math.sqrt((x - cx) * (x - cx) + (y - baseY) * (y - baseY));
    if (baseDist <= baseR && y >= baseY) {
      cov = Math.max(cov, baseR + 0.75 - baseDist);
    }

    return Math.max(0, Math.min(1, cov));
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = coverageAt(x, y);
      const idx = (y * size + x) * 4;
      const r = Math.round(BLUE[0] + (WHITE[0] - BLUE[0]) * a);
      const g = Math.round(BLUE[1] + (WHITE[1] - BLUE[1]) * a);
      const b = Math.round(BLUE[2] + (WHITE[2] - BLUE[2]) * a);
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = 255;
    }
  }
  return encodePng(buf, size);
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const chunks = [
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ];
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, ...chunks]);
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(type + data.toString("binary")), 8 + data.length);
  return out;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(str) {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc = crcTable[(crc ^ str.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, drawIcon(size));
  console.log(`generated ${file} (${size}x${size})`);
}
