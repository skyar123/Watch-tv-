#!/usr/bin/env node
/** Generate the PWA icon set as PNGs with no image library, by hand-encoding. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c; }
  return t;
})();
const crc32 = buf => { let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0; };

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const i = row + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A play triangle inside a rounded dark tile, in the app's pink. */
const draw = (inset) => (x, y, size) => {
  const u = x / size, v = y / size;
  const pad = inset;
  // Rounded-rect mask (skipped for maskable, which must bleed to the edge).
  if (pad > 0) {
    const r = 0.22, lo = pad, hi = 1 - pad;
    if (u < lo || u > hi || v < lo || v > hi) return [0, 0, 0, 0];
    const cx = Math.min(Math.max(u, lo + r), hi - r);
    const cy = Math.min(Math.max(v, lo + r), hi - r);
    if (Math.hypot(u - cx, v - cy) > r) return [0, 0, 0, 0];
  }
  // Background: a vertical wash from ink to a warmer plum.
  const bg = [
    Math.round(13 + 26 * v), Math.round(12 + 8 * v), Math.round(19 + 34 * v), 255,
  ];
  // Play triangle, centred.
  const tx = (u - 0.40) / 0.30, ty = (v - 0.5) / 0.26;
  if (tx >= 0 && tx <= 1 && Math.abs(ty) <= 1 - tx) {
    const glow = 1 - tx * 0.25;
    return [Math.round(255 * glow), Math.round(77 * glow), Math.round(109 * glow), 255];
  }
  return bg;
};

mkdirSync('public/icons', { recursive: true });
const out = [
  ['public/icons/icon-192.png', 192, 0.04],
  ['public/icons/icon-512.png', 512, 0.04],
  ['public/icons/apple-touch-icon.png', 180, 0],   // iOS applies its own mask
  ['public/icons/icon-maskable-512.png', 512, 0],  // must fill the safe zone
];
for (const [path, size, inset] of out) {
  writeFileSync(path, png(size, draw(inset)));
  console.log(`wrote ${path} (${size}×${size})`);
}
