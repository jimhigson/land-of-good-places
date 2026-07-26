#!/usr/bin/env node
/**
 * Draws the Land of Good Places app icon and writes the PWA icon set.
 *
 *     node scripts/make-icons.mjs
 *
 * There is no image file anywhere in this project and there isn't one here
 * either: the icon is a pink ferris wheel on a pastel sky, painted with a tiny
 * rasteriser onto a supersampled RGBA buffer and encoded to PNG with node's own
 * `zlib`. Nothing is fetched, nothing is installed, and re-running it produces
 * byte-identical files — which is what makes it safe to keep in the repo next to
 * the generated park.
 *
 * Colours come from `src/core/palette.ts` so the icon is the same pink as the
 * game. Keep them in step by hand; this script deliberately has no imports from
 * `src/` because it must run without a bundler.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Supersampling factor. Every shape is drawn hard-edged and averaged down. */
const SS = 3;

// --------------------------------------------------------------- palette
// Mirrors src/core/palette.ts.
const SKY_TOP = [0xc6, 0xec, 0xff];
const SKY_BOTTOM = [0x8f, 0xd3, 0xff];
const GRASS = [0x86, 0xd3, 0x6a];
const GRASS_LIGHT = [0xa8, 0xe5, 0x7f];
const PINK = [0xff, 0x8f, 0xc0];
const PINK_DEEP = [0xef, 0x7f, 0xae];
const CREAM = [0xff, 0xf6, 0xea];
const LEMON = [0xff, 0xdf, 0x7a];
const MINT = [0x7f, 0xe3, 0xc0];
const SKY_BLUE = [0x87, 0xc9, 0xff];
const LILAC = [0xc9, 0xa9, 0xff];
const INK = [0x6b, 0x4f, 0x6f];

// ------------------------------------------------------------- rasteriser

class Canvas {
  constructor(size) {
    this.size = size;
    this.data = new Uint8Array(size * size * 3);
  }

  fill(colour) {
    for (let i = 0; i < this.data.length; i += 3) {
      this.data[i] = colour[0];
      this.data[i + 1] = colour[1];
      this.data[i + 2] = colour[2];
    }
  }

  /** Vertical two-stop gradient across the whole canvas. */
  gradient(top, bottom) {
    for (let y = 0; y < this.size; y += 1) {
      const t = y / (this.size - 1);
      const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
      const g = Math.round(top[1] + (bottom[1] - top[1]) * t);
      const b = Math.round(top[2] + (bottom[2] - top[2]) * t);
      for (let x = 0; x < this.size; x += 1) {
        const i = (y * this.size + x) * 3;
        this.data[i] = r;
        this.data[i + 1] = g;
        this.data[i + 2] = b;
      }
    }
  }

  set(x, y, colour) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 3;
    this.data[i] = colour[0];
    this.data[i + 1] = colour[1];
    this.data[i + 2] = colour[2];
  }

  /** Fills every pixel where `inside(x, y)` is true, over a bounding box. */
  shape(minX, minY, maxX, maxY, inside, colour) {
    const x0 = Math.max(0, Math.floor(minX));
    const y0 = Math.max(0, Math.floor(minY));
    const x1 = Math.min(this.size - 1, Math.ceil(maxX));
    const y1 = Math.min(this.size - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (inside(x + 0.5, y + 0.5)) this.set(x, y, colour);
      }
    }
  }

  circle(cx, cy, r, colour) {
    const rr = r * r;
    this.shape(cx - r, cy - r, cx + r, cy + r, (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      return dx * dx + dy * dy <= rr;
    }, colour);
  }

  ring(cx, cy, outer, inner, colour) {
    const o = outer * outer;
    const i = inner * inner;
    this.shape(cx - outer, cy - outer, cx + outer, cy + outer, (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const d = dx * dx + dy * dy;
      return d <= o && d >= i;
    }, colour);
  }

  /** A thick line with round ends — spokes and legs. */
  capsule(x1, y1, x2, y2, r, colour) {
    const ax = x2 - x1;
    const ay = y2 - y1;
    const lengthSquared = ax * ax + ay * ay || 1;
    this.shape(
      Math.min(x1, x2) - r,
      Math.min(y1, y2) - r,
      Math.max(x1, x2) + r,
      Math.max(y1, y2) + r,
      (x, y) => {
        let t = ((x - x1) * ax + (y - y1) * ay) / lengthSquared;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - (x1 + ax * t);
        const dy = y - (y1 + ay * t);
        return dx * dx + dy * dy <= r * r;
      },
      colour,
    );
  }

  roundedRect(cx, cy, halfWidth, halfHeight, radius, colour) {
    const r = Math.min(radius, halfWidth, halfHeight);
    this.shape(cx - halfWidth, cy - halfHeight, cx + halfWidth, cy + halfHeight, (x, y) => {
      const dx = Math.abs(x - cx) - (halfWidth - r);
      const dy = Math.abs(y - cy) - (halfHeight - r);
      if (dx <= 0 || dy <= 0) return true;
      return dx * dx + dy * dy <= r * r;
    }, colour);
  }

  /** Box-filters the supersampled buffer down to `size` and returns RGB bytes. */
  downsample(size) {
    const factor = this.size / size;
    const out = new Uint8Array(size * size * 3);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let sy = 0; sy < factor; sy += 1) {
          for (let sx = 0; sx < factor; sx += 1) {
            const i = ((y * factor + sy) * this.size + (x * factor + sx)) * 3;
            r += this.data[i];
            g += this.data[i + 1];
            b += this.data[i + 2];
            n += 1;
          }
        }
        const o = (y * size + x) * 3;
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
      }
    }
    return out;
  }
}

// ------------------------------------------------------------------ art

/**
 * Paints the icon.
 *
 * `inset` is how much of the canvas the artwork leaves as margin — 0 for the
 * ordinary icons, which are full-bleed, and 0.2 for the maskable one, whose
 * outer fifth may be cropped away to any shape the launcher fancies.
 */
function paintIcon(canvas, inset) {
  const S = canvas.size;
  canvas.gradient(SKY_TOP, SKY_BOTTOM);

  // A grassy hill along the bottom, drawn as a very large shallow circle.
  const hillRadius = S * 1.15;
  canvas.circle(S * 0.5, S * (1.02 + inset * 0.1) + hillRadius * 0.86, hillRadius, GRASS);
  canvas.circle(S * 0.5, S * (1.06 + inset * 0.1) + hillRadius * 0.86, hillRadius, GRASS_LIGHT);

  // The wheel. `span` is the drawable half-size once the mask inset is taken.
  const span = 0.5 - inset;
  const cx = S * 0.5;
  const cy = S * (0.5 - span * 0.06);
  const outer = S * span * 0.82;
  const rimHalf = S * span * 0.062;

  // Legs first, so the rim sits in front of them.
  const footY = S * (0.5 + span * 0.9);
  const legHalf = S * span * 0.05;
  canvas.capsule(cx, cy, cx - outer * 0.62, footY, legHalf + rimHalf * 0.34, INK);
  canvas.capsule(cx, cy, cx + outer * 0.62, footY, legHalf + rimHalf * 0.34, INK);
  canvas.capsule(cx, cy, cx - outer * 0.62, footY, legHalf, CREAM);
  canvas.capsule(cx, cy, cx + outer * 0.62, footY, legHalf, CREAM);
  canvas.roundedRect(cx, footY, outer * 0.78, legHalf * 1.5, legHalf, INK);
  canvas.roundedRect(cx, footY - legHalf * 0.22, outer * 0.74, legHalf * 1.2, legHalf, PINK_DEEP);

  // Spokes, with an ink pass behind them for the hand-painted outline.
  const spokes = 12;
  for (let i = 0; i < spokes; i += 1) {
    const angle = (Math.PI * 2 * i) / spokes;
    const x = cx + Math.cos(angle) * outer;
    const y = cy + Math.sin(angle) * outer;
    canvas.capsule(cx, cy, x, y, rimHalf * 0.46, INK);
  }
  for (let i = 0; i < spokes; i += 1) {
    const angle = (Math.PI * 2 * i) / spokes;
    const x = cx + Math.cos(angle) * outer;
    const y = cy + Math.sin(angle) * outer;
    canvas.capsule(cx, cy, x, y, rimHalf * 0.26, CREAM);
  }

  // The rim: ink outline, then pink, then a lighter inner highlight.
  canvas.ring(cx, cy, outer + rimHalf * 1.34, outer - rimHalf * 1.34, INK);
  canvas.ring(cx, cy, outer + rimHalf, outer - rimHalf, PINK);
  canvas.ring(cx, cy, outer + rimHalf * 0.34, outer - rimHalf * 0.1, [0xff, 0xc2, 0xd8]);

  // Gondolas hanging off the rim, in the ball-pit colours.
  const carColours = [LEMON, MINT, SKY_BLUE, LILAC, CREAM, LEMON, MINT, SKY_BLUE];
  const carHalf = S * span * 0.088;
  for (let i = 0; i < carColours.length; i += 1) {
    const angle = (Math.PI * 2 * i) / carColours.length + Math.PI / carColours.length;
    const x = cx + Math.cos(angle) * outer;
    const y = cy + Math.sin(angle) * outer;
    canvas.roundedRect(x, y + carHalf * 0.2, carHalf * 1.16, carHalf * 1.16, carHalf * 0.66, INK);
    canvas.roundedRect(
      x,
      y + carHalf * 0.2,
      carHalf * 0.92,
      carHalf * 0.92,
      carHalf * 0.52,
      carColours[i],
    );
  }

  // The hub, last, so it caps every spoke.
  const hub = S * span * 0.15;
  canvas.circle(cx, cy, hub + rimHalf * 0.5, INK);
  canvas.circle(cx, cy, hub, LEMON);
  canvas.circle(cx - hub * 0.28, cy - hub * 0.3, hub * 0.34, CREAM);
}

// ------------------------------------------------------------- png writer

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/** Encodes 8-bit RGB pixel data as a PNG. Filter type 0 on every scanline. */
function encodePng(rgb, size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size * 3; x += 1) {
      raw[rowStart + 1 + x] = rgb[y * size * 3 + x];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ main

function writeIcon(name, size, inset) {
  const canvas = new Canvas(size * SS);
  paintIcon(canvas, inset);
  const png = encodePng(canvas.downsample(size), size);
  writeFileSync(join(OUTPUT_DIR, name), png);
  console.log(`${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
writeIcon('pwa-192x192.png', 192, 0);
writeIcon('pwa-512x512.png', 512, 0);
// A maskable icon may be cropped to a circle, a squircle or a teardrop, so the
// wheel is kept inside the middle 60% and only the sky is allowed near the edge.
writeIcon('maskable-icon-512x512.png', 512, 0.2);
writeIcon('apple-touch-icon-180x180.png', 180, 0.06);
