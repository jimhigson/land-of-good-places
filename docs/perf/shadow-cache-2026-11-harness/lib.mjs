// Shared harness bits for the shadow-cache work. Run with node from anywhere.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = new URL('../../../', import.meta.url).pathname;
const require = createRequire(path.join(ROOT, 'package.json'));
export const { chromium } = require('playwright-core');
export const BASE = process.env.BASE ?? 'http://127.0.0.1:6041';
export const OUT = process.env.OUT ?? path.join((await import('node:os')).tmpdir(), 'lgp-shadow-cache');
fs.mkdirSync(OUT, { recursive: true });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1280, height = 720, dpr = 1, args = [] } = {}) {
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', ...args],
  });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`.slice(0, 400));
  });
  return { browser, context, page, errors };
}

/** Waits for window.game and for `frames` frames drawn after it exists. */
export async function waitForGame(page, frames = 60, timeout = 240_000) {
  await page.waitForFunction(() => {
    const g = window.game;
    return !!g && !!g.world && !!g.player;
  }, null, { timeout, polling: 250 });
  await page.evaluate(() => {
    if (window.__frameCounter) return;
    window.__frameCounter = { n: 0 };
    const tick = () => { window.__frameCounter.n++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const from = await page.evaluate(() => window.__frameCounter.n);
  await page.waitForFunction((until) => window.__frameCounter.n >= until, from + frames, { timeout, polling: 100 });
}

export async function frames(page, n) {
  const from = await page.evaluate(() => window.__frameCounter.n);
  await page.waitForFunction((until) => window.__frameCounter.n >= until, from + n, { timeout: 120_000, polling: 16 });
}

// ---------------------------------------------------------------- PNG out
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
/** RGBA bytes, top row first. */
export function writePng(file, width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}
