// Diff two of this harness's PNGs outside an excluded box. usage: node maskdiff.mjs a.png b.png x0 y0 x1 y1
import fs from 'node:fs';
import zlib from 'node:zlib';
function read(file) {
  const buf = fs.readFileSync(file); let pos = 8, width = 0, height = 0; const idat = [];
  while (pos < buf.length) { const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8); const data = buf.subarray(pos + 8, pos + 8 + len); if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); } if (type === 'IDAT') idat.push(data); pos += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)); const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) raw.copy(Buffer.from(rgba.buffer, y * width * 4, width * 4), 0, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
  return { width, height, rgba };
}
const [a, b, x0, y0, x1, y1] = process.argv.slice(2);
const A = read(a), B = read(b);
let n8 = 0, n24 = 0, max = 0, sum = 0, n = 0;
for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
  if (x >= +x0 && x <= +x1 && y >= +y0 && y <= +y1) continue;
  const i = (y * A.width + x) * 4; n++;
  const d = Math.max(Math.abs(A.rgba[i] - B.rgba[i]), Math.abs(A.rgba[i + 1] - B.rgba[i + 1]), Math.abs(A.rgba[i + 2] - B.rgba[i + 2]));
  if (d > 8) n8++; if (d > 24) n24++; if (d > max) max = d; sum += d;
}
console.log(`${b.split('/').pop()}: outside her box, ${n} px: changed >8 ${n8}, >24 ${n24}, max ${max}, mean ${(sum / n).toFixed(3)}`);
