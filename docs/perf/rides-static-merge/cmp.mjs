// node cmp.mjs <a.rgba> <b.rgba> <width> <height> [diff.png]
// Pixels that differ between two raw frames (GL order), the largest channel
// difference, and a histogram of differences; optionally a diff image.
import fs from 'node:fs';
import zlib from 'node:zlib';
const [aPath, bPath, wS, hS, out] = process.argv.slice(2);
const a = fs.readFileSync(aPath), b = fs.readFileSync(bPath);
const w = Number(wS), h = Number(hS);
if (a.length !== b.length || a.length !== w * h * 4) throw new Error(`sizes differ: ${a.length} ${b.length} ${w * h * 4}`);
let differ = 0, maxDelta = 0;
const hist = {};
for (let i = 0; i < a.length; i += 4) {
  const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
  if (d > 0) {
    differ++;
    maxDelta = Math.max(maxDelta, d);
    const k = d <= 1 ? '1' : d <= 4 ? '2-4' : d <= 16 ? '5-16' : d <= 64 ? '17-64' : '65+';
    hist[k] = (hist[k] ?? 0) + 1;
  }
}
if (out) {
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4;
      const d = Math.max(Math.abs(a[s] - b[s]), Math.abs(a[s + 1] - b[s + 1]), Math.abs(a[s + 2] - b[s + 2]));
      const v = d > 0 ? [255, Math.min(255, d * 16), 0] : [a[s] >> 2, a[s + 1] >> 2, a[s + 2] >> 2];
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = v[0]; raw[o + 1] = v[1]; raw[o + 2] = v[2];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
console.log(JSON.stringify({ a: aPath.split('/').pop(), b: bPath.split('/').pop(), pixels: w * h, differ, pct: +((100 * differ) / (w * h)).toFixed(4), maxDelta, hist }));
