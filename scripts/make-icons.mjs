// Generates the app icons with no image dependencies: a raw PNG encoder plus a
// little geometry. Run `npm run icons` to regenerate.
//
// The mark is an S monogram — Seli's initial — built from two elliptical arcs
// that meet on a diagonal spine, rather than a typed letter. Being constructed
// rather than set means it stays even at any size and needs no font at build
// time. Both icons are full-bleed so they work as `maskable`, and the S sits
// inside the centre 80% safe zone that Android may crop to a circle.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');

// Design space is 192x192; every size below is scaled from it.
const D = 192;
const BG_TOP = [0x6c, 0x79, 0xda];
const BG_BOTTOM = [0x39, 0x40, 0x8f];
const INK = [0xff, 0xff, 0xff];
const STROKE = 16;            // stroke width in design units
const RADIUS = STROKE / 2;

// The two bowls of the S. Each is an elliptical arc given by its centre, its
// radii, and the angles it sweeps between (degrees, y pointing down). They
// share the point (96, 96), which is the middle of the letter.
const ARCS = [
  { cx: 96, cy: 68,  rx: 33, ry: 28, from: -20, to: -270 },  // upper bowl
  { cx: 96, cy: 124, rx: 33, ry: 28, from: -90, to: 160 },   // lower bowl
];

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

const mix = (a, b, t) => a + (b - a) * t;

/** Points along the letter, densely enough that consecutive discs overlap. */
function samplePath(scale) {
  const points = [];
  for (const arc of ARCS) {
    const steps = Math.max(240, Math.ceil(Math.abs(arc.to - arc.from) * 4));
    for (let i = 0; i <= steps; i++) {
      const deg = mix(arc.from, arc.to, i / steps);
      const rad = (deg * Math.PI) / 180;
      points.push([
        (arc.cx + arc.rx * Math.cos(rad)) * scale,
        (arc.cy + arc.ry * Math.sin(rad)) * scale,
      ]);
    }
  }
  return points;
}

function drawIcon(size) {
  const scale = size / D;
  const radius = RADIUS * scale;
  const rgba = Buffer.alloc(size * size * 4);

  // Distance to the nearest point on the letter. Splatting a local box around
  // each sample keeps this linear in the stroke's area rather than quadratic
  // in the canvas.
  const dist = new Float32Array(size * size).fill(Infinity);
  const reach = Math.ceil(radius + 2);
  for (const [px, py] of samplePath(scale)) {
    const x0 = Math.max(0, Math.floor(px - reach));
    const x1 = Math.min(size - 1, Math.ceil(px + reach));
    const y0 = Math.max(0, Math.floor(py - reach));
    const y1 = Math.min(size - 1, Math.ceil(py + reach));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
        const i = y * size + x;
        if (d < dist[i]) dist[i] = d;
      }
    }
  }

  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let r = mix(BG_TOP[0], BG_BOTTOM[0], t);
      let g = mix(BG_TOP[1], BG_BOTTOM[1], t);
      let b = mix(BG_TOP[2], BG_BOTTOM[2], t);

      // One pixel of coverage falloff at the stroke edge, so the curve reads
      // as smooth rather than stepped.
      const alpha = Math.max(0, Math.min(1, radius + 0.5 - dist[y * size + x]));
      if (alpha > 0) {
        r = mix(r, INK[0], alpha);
        g = mix(g, INK[1], alpha);
        b = mix(b, INK[2], alpha);
      }

      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = 255;
    }
  }
  return encodePNG(size, size, rgba);
}

mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]) {
  const file = resolve(OUT, `icon-${size}.png`);
  writeFileSync(file, drawIcon(size));
  console.log(`wrote ${file}`);
}
writeFileSync(resolve(OUT, 'apple-touch-icon.png'), drawIcon(180));
console.log('wrote apple-touch-icon.png');
