// Generates the PWA icons with no image dependencies: a raw PNG encoder plus a
// little vector maths. Run `npm run icons` to regenerate.
//
// Both icons are full-bleed so they work as `maskable` — the check mark stays
// well inside the centre 80% safe zone that Android may crop to a circle.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Shortest distance from a point to a line segment. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  // Background: the app's indigo, deepening towards the bottom.
  const top = [0x5B, 0x6A, 0xCD];
  const bottom = [0x36, 0x3F, 0x9C];

  // The check mark, in units of the canvas.
  const s = size;
  const stroke = s * 0.085;
  const p1 = [s * 0.28, s * 0.52];
  const p2 = [s * 0.44, s * 0.68];
  const p3 = [s * 0.73, s * 0.34];

  for (let y = 0; y < s; y++) {
    const t = y / (s - 1);
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      let r = mix(top[0], bottom[0], t);
      let g = mix(top[1], bottom[1], t);
      let b = mix(top[2], bottom[2], t);

      const d = Math.min(
        distanceToSegment(x + 0.5, y + 0.5, p1[0], p1[1], p2[0], p2[1]),
        distanceToSegment(x + 0.5, y + 0.5, p2[0], p2[1], p3[0], p3[1]),
      );
      // Anti-alias across one pixel at the stroke edge.
      const alpha = Math.max(0, Math.min(1, (stroke / 2 + 0.5 - d)));
      if (alpha > 0) {
        r = mix(r, 255, alpha);
        g = mix(g, 255, alpha);
        b = mix(b, 255, alpha);
      }

      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = 255;
    }
  }
  return encodePNG(s, s, rgba);
}

mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]) {
  const file = resolve(OUT, `icon-${size}.png`);
  writeFileSync(file, drawIcon(size));
  console.log(`wrote ${file}`);
}
// Apple touch icon reuses the 192px art.
writeFileSync(resolve(OUT, 'apple-touch-icon.png'), drawIcon(180));
console.log('wrote apple-touch-icon.png');
