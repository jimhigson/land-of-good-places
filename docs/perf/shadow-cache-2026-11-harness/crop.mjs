// Crop + nearest-neighbour upscale of PNGs this harness wrote (filter 0 rows only),
// laid side by side. usage: node crop.mjs out.png x y w h scale in1.png in2.png ...
import fs from 'node:fs';
import zlib from 'node:zlib';
import { writePng } from './lib.mjs';

function readOwnPng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8; let width = 0; let height = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    if (raw[y * (width * 4 + 1)] !== 0) throw new Error(`${file}: row filter ${raw[y * (width * 4 + 1)]} (not written by this harness)`);
    raw.copy(Buffer.from(rgba.buffer, y * width * 4, width * 4), 0, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
  }
  return { width, height, rgba };
}

const [out, xs, ys, ws, hs, ss, ...inputs] = process.argv.slice(2);
const [x0, y0, cw, ch, s] = [xs, ys, ws, hs, ss].map(Number);
const gap = 6;
const W = inputs.length * cw * s + (inputs.length - 1) * gap;
const H = ch * s;
const canvas = new Uint8Array(W * H * 4).fill(255);
inputs.forEach((file, n) => {
  const img = readOwnPng(file);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < cw * s; x++) {
      const sx = x0 + Math.floor(x / s); const sy = y0 + Math.floor(y / s);
      const si = (sy * img.width + sx) * 4; const di = (y * W + n * (cw * s + gap) + x) * 4;
      canvas[di] = img.rgba[si]; canvas[di + 1] = img.rgba[si + 1]; canvas[di + 2] = img.rgba[si + 2]; canvas[di + 3] = 255;
    }
  }
});
writePng(out, W, H, canvas);
console.log(out, W, H);
