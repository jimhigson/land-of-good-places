// node pix.mjs <base> <path> <outPrefix>
// At a frozen ?clock= moment, in one page (dev server: window.game):
//   batched      the game's own frame, batches drawing
//   repeat       the same again (control: the frame is deterministic)
//   sources      the same frame with every batch handed back to its sources
//   jitter       sources again with the camera moved 10 micrometres (noise floor)
//   restore      batches again after the toggle (control: the toggle restores)
// Writes <outPrefix>-batched.png / -sources.png / -diff.png and
// <outPrefix>-batched.rgba (raw, for comparing builds with cmp.mjs).
// HAS_BATCHES=0 skips the A/B (for a build with no static batching: main).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import zlib from 'node:zlib';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const [base, urlPath, outPrefix] = process.argv.slice(2);
const HAS_BATCHES = process.env.HAS_BATCHES !== '0';
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.goto(`${base}${urlPath}${urlPath.includes('?') ? '&' : '?'}perf=1`, { waitUntil: 'domcontentloaded', timeout: 600000 });
const riding = /^\/(rail-race|sky-cruiser|slide|ferris)/.test(urlPath);
for (const t0 = Date.now(); ; ) {
  const ok = await page
    .evaluate((riding) => {
      const p = window.__perf;
      if (!p || p.frameCount < 10 || !window.game) return false;
      const c = p.context();
      return (!riding || c.riding === true) && (!c.clock || c.clock.stopped);
    }, riding)
    .catch(() => false);
  if (ok) break;
  if (Date.now() - t0 > 1800000) throw new Error('never settled');
  await sleep(500);
}
await sleep(1500);
if (process.env.NIGHT) { await page.evaluate((t) => { window.game.world.dayNight.time = Number(t); }, process.env.NIGHT); await sleep(4000); await page.evaluate(() => { window.game.timeScale = 0; }); await sleep(1000); }
const r = await page.evaluate(async (hasBatches) => {
  const mod = hasBatches ? await import('/src/world/staticBatch.ts') : null;
  const game = window.game;
  const renderer = game.engine.renderer;
  const scene = game.engine.scene;
  const camera = game.cameraOverride ?? game.camera.camera;
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const frozenNow = performance.now();
  const realNow = performance.now.bind(performance);
  const realDateNow = Date.now;
  performance.now = () => frozenNow;
  Date.now = () => 1.8e12;
  const grab = () => {
    game.render();
    game.render();
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const compare = (a, b) => {
    let differ = 0, maxDelta = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (d > 0) { differ++; if (d > maxDelta) maxDelta = d; }
    }
    return { differ, maxDelta };
  };
  for (let i = 0; i < 4; i++) game.render();
  const batched = grab();
  const out = { size: [w, h], drawsInfo: renderer.info.render.calls };
  if (mod) {
    const repeat = grab();
    const toggled = mod.setStaticBatchesDrawn(scene, false);
    const sources = grab();
    const saved = camera.position.clone();
    camera.position.x += 1e-5;
    camera.updateMatrixWorld(true);
    const jitter = grab();
    camera.position.copy(saved);
    camera.updateMatrixWorld(true);
    mod.setStaticBatchesDrawn(scene, true);
    const restore = grab();
    const audit = mod.auditBatched(scene);
    Object.assign(out, {
      toggled,
      control_repeat: compare(batched, repeat),
      control_restore: compare(batched, restore),
      batched_vs_sources: compare(batched, sources),
      noise_floor_camera_10um: compare(sources, jitter),
      audit: { batches: audit.batches, sources: audit.sources, detached: audit.detached, drifted: audit.drifted.length, firstDrift: audit.drifted.slice(0, 4) },
    });
    out.sourcesB64 = btoa(String.fromCharCode.apply(null, Array.from(sources.subarray(0, 0))));
    window.__pixSources = sources;
    window.__pixJitter = jitter;
  }
  window.__pixBatched = batched;
  performance.now = realNow;
  Date.now = realDateNow;
  return out;
}, HAS_BATCHES);
// Pull the raw frames out in chunks (a large typed array does not serialise in one go).
const pull = async (name) => {
  const len = await page.evaluate((n) => window[n].length, name);
  const chunks = [];
  for (let at = 0; at < len; at += 4_000_000) {
    const b64 = await page.evaluate(([n, a]) => {
      const part = window[n].subarray(a, a + 4_000_000);
      let s = '';
      for (let i = 0; i < part.length; i += 8192) s += String.fromCharCode.apply(null, part.subarray(i, i + 8192));
      return btoa(s);
    }, [name, at]);
    chunks.push(Buffer.from(b64, 'base64'));
  }
  return Buffer.concat(chunks);
};
const [w, h] = r.size;
const batched = await pull('__pixBatched');
const sources = HAS_BATCHES ? await pull('__pixSources') : null;
const jitter = HAS_BATCHES ? await pull('__pixJitter') : null;
await browser.close();
delete r.sourcesB64;
// PNG writer (flip rows: GL reads bottom-up).
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const png = (rgba, f) => {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4;
      const v = f ? f(s) : [rgba[s], rgba[s + 1], rgba[s + 2]];
      const d = y * (w * 3 + 1) + 1 + x * 3;
      raw[d] = v[0]; raw[d + 1] = v[1]; raw[d + 2] = v[2];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
fs.writeFileSync(`${outPrefix}-batched.rgba`, batched);
if (sources) fs.writeFileSync(`${outPrefix}-sources.rgba`, sources);
if (jitter) fs.writeFileSync(`${outPrefix}-jitter.rgba`, jitter);
fs.writeFileSync(`${outPrefix}-batched.png`, png(batched));
if (sources) {
  fs.writeFileSync(`${outPrefix}-sources.png`, png(sources));
  fs.writeFileSync(`${outPrefix}-diff.png`, png(batched, (s) => {
    const d = Math.max(Math.abs(batched[s] - sources[s]), Math.abs(batched[s + 1] - sources[s + 1]), Math.abs(batched[s + 2] - sources[s + 2]));
    return d > 0 ? [255, Math.min(255, d * 16), 0] : [batched[s] >> 2, batched[s + 1] >> 2, batched[s + 2] >> 2];
  }));
}
console.log(JSON.stringify({ path: urlPath, base, ...r, errors: errors.slice(0, 3) }));
