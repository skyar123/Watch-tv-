/* make-icons.js — generate calm app icons with zero dependencies.
 * Draws a navy rounded square with a soft amber crescent moon + a star.
 * Run: node tools/make-icons.js  */
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function makePNG(size) {
  const cx = size / 2, cy = size / 2;
  const r = size * 0.20; // corner radius
  // colors
  const navyTop = [0x23, 0x2e, 0x52];
  const navyBot = [0x1b, 0x24, 0x40];
  const amber = [0xe8, 0xb7, 0x65];

  const moonCx = size * 0.56, moonCy = size * 0.46, moonR = size * 0.26;
  const biteCx = size * 0.66, biteCy = size * 0.38, biteR = size * 0.23;
  const starCx = size * 0.34, starCy = size * 0.34, starR = size * 0.035;

  const raw = Buffer.alloc((size * 3 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      // rounded-rect mask -> transparent-ish handled by flat navy (no alpha)
      let col;
      const t = y / size;
      const bg = [
        Math.round(navyTop[0] + (navyBot[0] - navyTop[0]) * t),
        Math.round(navyTop[1] + (navyBot[1] - navyTop[1]) * t),
        Math.round(navyTop[2] + (navyBot[2] - navyTop[2]) * t),
      ];
      col = bg;

      // crescent: inside moon circle AND outside the "bite" circle
      const dMoon = Math.hypot(x - moonCx, y - moonCy);
      const dBite = Math.hypot(x - biteCx, y - biteCy);
      if (dMoon <= moonR && dBite > biteR) {
        // soft edge
        const edge = Math.min(moonR - dMoon, dBite - biteR);
        const a = Math.max(0, Math.min(1, edge / 3));
        col = [
          Math.round(bg[0] + (amber[0] - bg[0]) * a),
          Math.round(bg[1] + (amber[1] - bg[1]) * a),
          Math.round(bg[2] + (amber[2] - bg[2]) * a),
        ];
      }

      // little star
      const dStar = Math.hypot(x - starCx, y - starCy);
      if (dStar <= starR) {
        col = amber;
      }

      // corner rounding -> fill corners with darkest navy (keeps it a square card look)
      const inCornerX = Math.min(x, size - 1 - x);
      const inCornerY = Math.min(y, size - 1 - y);
      if (inCornerX < r && inCornerY < r) {
        const dd = Math.hypot(r - inCornerX, r - inCornerY);
        if (dd > r) col = [0x12, 0x18, 0x2c];
      }

      raw[p++] = col[0];
      raw[p++] = col[1];
      raw[p++] = col[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
[192, 512].forEach(function (s) {
  fs.writeFileSync(path.join(outDir, "icon-" + s + ".png"), makePNG(s));
  console.log("wrote icons/icon-" + s + ".png");
});
