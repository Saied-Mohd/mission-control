#!/usr/bin/env node
// Renders the Mission Control mark (radar/orbit glyph) to PNGs with a tiny hand-written PNG encoder.
// Pure Node: zlib for deflate, manual CRC32. Output → app/icons/.
//   icon-192.png, icon-512.png       rounded tile ("any")
//   icon-maskable-512.png            full-bleed, glyph inside the 80% safe zone
//   apple-touch-icon.png (180)       full-bleed (iOS rounds it)
//   badge-96.png                     white monochrome glyph on transparent (Android notification badge)
//   icon.svg                         vector version

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'app', 'icons');
fs.mkdirSync(OUT, { recursive: true });

// ---------------- PNG encoder ----------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------- drawing ----------------

const hex = (s) => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];
const CYAN = hex('#5ee7ff');
const AMBER = hex('#ffb547');
const BG_IN = hex('#12234a');
const BG_OUT = hex('#050a17');
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

const SWEEP_FROM = (-150 * Math.PI) / 180; // sweep wedge trailing edge
const SWEEP_TO = (-40 * Math.PI) / 180; // leading edge, where the amber blip sits
const RING = 0.3;

/** Sample the mark at (x, y) in unit space. opts: { bg: 'rounded'|'full'|'none', scale, mono } → [r,g,b,a] straight alpha */
function sample(x, y, opts) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  const over = (cr, cg, cb, ca) => {
    // source-over with straight colors
    const na = ca + a * (1 - ca);
    if (na <= 0) return;
    r = (cr * ca + r * a * (1 - ca)) / na;
    g = (cg * ca + g * a * (1 - ca)) / na;
    b = (cb * ca + b * a * (1 - ca)) / na;
    a = na;
  };

  // background tile
  if (opts.bg !== 'none') {
    let inside = 1;
    if (opts.bg === 'rounded') {
      const rad = 0.22;
      const qx = Math.max(Math.abs(x - 0.5) - (0.5 - rad), 0);
      const qy = Math.max(Math.abs(y - 0.5) - (0.5 - rad), 0);
      inside = Math.hypot(qx, qy) <= rad ? 1 : 0;
    }
    if (inside) {
      const d = Math.hypot(x - 0.5, y - 0.38) / 0.75;
      const t = clamp01(d);
      over(BG_IN[0] * (1 - t) + BG_OUT[0] * t, BG_IN[1] * (1 - t) + BG_OUT[1] * t, BG_IN[2] * (1 - t) + BG_OUT[2] * t, 1);
    }
  }

  // glyph space
  const s = opts.scale;
  const gx = (x - 0.5) / s;
  const gy = (y - 0.5) / s;
  const dist = Math.hypot(gx, gy);
  const ang = Math.atan2(gy, gx);
  const col = opts.mono ? [1, 1, 1] : CYAN;
  const amb = opts.mono ? [1, 1, 1] : AMBER;
  const px = 1 / (opts.size * s); // one pixel in glyph units (for AA width)

  if (!opts.mono) {
    // crosshair
    if (dist < RING - 0.01) {
      const line = Math.min(Math.abs(gx), Math.abs(gy));
      const al = (1 - smooth(0.004, 0.004 + px * 1.2, line)) * 0.16;
      if (al > 0) over(...col, al);
    }
    // radar sweep wedge
    if (dist < RING) {
      let da = ang - SWEEP_FROM;
      while (da < 0) da += Math.PI * 2;
      const span = SWEEP_TO - SWEEP_FROM;
      if (da <= span) {
        const t = da / span; // 0 trailing → 1 leading
        const al = 0.42 * t * t * (1 - smooth(RING - 0.03, RING, dist));
        over(...col, al);
      }
    }
    // inner ring
    const inner = Math.abs(dist - 0.17);
    over(...col, (1 - smooth(0.009, 0.009 + px * 1.2, inner)) * 0.5);
  }

  // outer ring
  const ringW = opts.mono ? 0.03 : 0.022;
  over(...col, 1 - smooth(ringW, ringW + px * 1.2, Math.abs(dist - RING)));

  // center dot
  over(...col, 1 - smooth(0.032, 0.032 + px * 1.2, dist));

  // amber blip on the ring at the sweep's leading edge, with glow
  const bx = Math.cos(SWEEP_TO) * RING;
  const by = Math.sin(SWEEP_TO) * RING;
  const bd = Math.hypot(gx - bx, gy - by);
  if (!opts.mono) over(...amb, 0.55 * Math.pow(1 - smooth(0, 0.16, bd), 2));
  over(...amb, 1 - smooth(0.06, 0.06 + px * 1.2, bd));

  return [r, g, b, a];
}

function render(size, opts) {
  const o = { ...opts, size };
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [r, g, b, a] = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, o);
          pr += r * a;
          pg += g * a;
          pb += b * a;
          pa += a;
        }
      }
      const n = SS * SS;
      const A = pa / n;
      const i = (y * size + x) * 4;
      buf[i] = A ? Math.round(clamp01(pr / pa) * 255) : 0;
      buf[i + 1] = A ? Math.round(clamp01(pg / pa) * 255) : 0;
      buf[i + 2] = A ? Math.round(clamp01(pb / pa) * 255) : 0;
      buf[i + 3] = Math.round(clamp01(A) * 255);
    }
  }
  return encodePNG(size, size, buf);
}

const jobs = [
  ['icon-192.png', 192, { bg: 'rounded', scale: 1 }],
  ['icon-512.png', 512, { bg: 'rounded', scale: 1 }],
  ['icon-maskable-512.png', 512, { bg: 'full', scale: 0.82 }],
  ['apple-touch-icon.png', 180, { bg: 'full', scale: 0.9 }],
  ['badge-96.png', 96, { bg: 'none', scale: 1.25, mono: true }],
];

for (const [name, size, opts] of jobs) {
  const png = render(size, opts);
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(`wrote app/icons/${name} (${size}×${size}, ${png.length} bytes)`);
}

// ---------------- SVG ----------------

const deg = (a) => (a * 180) / Math.PI;
const pt = (a, r) => [(50 + Math.cos(a) * r * 100).toFixed(2), (50 + Math.sin(a) * r * 100).toFixed(2)];
const [sx0, sy0] = pt(SWEEP_FROM, RING);
const [sx1, sy1] = pt(SWEEP_TO, RING);
const [bx, by] = pt(SWEEP_TO, RING);
const large = SWEEP_TO - SWEEP_FROM > Math.PI ? 1 : 0;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Mission Control">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0" stop-color="#12234a"/>
      <stop offset="1" stop-color="#050a17"/>
    </radialGradient>
    <linearGradient id="sweep" gradientUnits="userSpaceOnUse" x1="${sx0}" y1="${sy0}" x2="${sx1}" y2="${sy1}">
      <stop offset="0" stop-color="#5ee7ff" stop-opacity="0"/>
      <stop offset="1" stop-color="#5ee7ff" stop-opacity="0.42"/>
    </linearGradient>
    <radialGradient id="glow">
      <stop offset="0" stop-color="#ffb547" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ffb547" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" rx="22" fill="url(#bg)"/>
  <g stroke="#5ee7ff" fill="none">
    <path d="M50 21v58M21 50h58" stroke-opacity="0.16" stroke-width="0.8"/>
    <circle cx="50" cy="50" r="17" stroke-opacity="0.5" stroke-width="1.8"/>
    <circle cx="50" cy="50" r="30" stroke-width="4.4"/>
  </g>
  <path d="M50 50L${sx0} ${sy0}A30 30 0 ${large} 1 ${sx1} ${sy1}Z" fill="url(#sweep)"/>
  <circle cx="50" cy="50" r="3.2" fill="#5ee7ff"/>
  <circle cx="${bx}" cy="${by}" r="16" fill="url(#glow)"/>
  <circle cx="${bx}" cy="${by}" r="6" fill="#ffb547"/>
  <!-- sweep ${deg(SWEEP_FROM).toFixed(0)}° → ${deg(SWEEP_TO).toFixed(0)}° -->
</svg>
`;
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg);
console.log('wrote app/icons/icon.svg');
