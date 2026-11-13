// usage: node run.mjs label base path secs [opts as JSON]
// opts: { walk: 'square'|'line'|'ride'|'none', phone: bool, throttle: n, trace: bool,
//         cpu: bool, heap: bool, warm: s, inject: {...}, injectAfter: s, traceFromStart: bool }
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.env.PERF_OUT ?? path.join((await import('node:os')).tmpdir(), 'lgp-perf');
fs.mkdirSync(OUT, { recursive: true });
const [label, base, urlPath, secsS, optsS] = process.argv.slice(2);
const secs = Number(secsS);
const o = optsS ? JSON.parse(optsS) : {};
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio', '--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const ctxOpts = o.phone
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const context = await browser.newContext({ ...ctxOpts, serviceWorkers: 'block' });
const page = await context.newPage();
await page.addInitScript({ path: path.join(HERE, 'probe.js') });
const cdp = await context.newCDPSession(page);
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
if (o.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.throttle });

const traceChunks = [];
let traceDone;
const CATS = [
  'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame',
  'v8', 'v8.execute', 'disabled-by-default-v8.gc', 'blink.user_timing', 'gpu', 'loading', 'toplevel',
  ...(o.traceCpu ? ['disabled-by-default-v8.cpu_profiler'] : []),
].join(',');
async function startTrace() {
  cdp.on('Tracing.dataCollected', (e) => traceChunks.push(...e.value));
  traceDone = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', { categories: CATS, transferMode: 'ReportEvents', options: 'sampling-frequency=10000' });
}
if (o.trace && o.traceFromStart) await startTrace();

const t0 = Date.now();
await page.goto(base + urlPath, { waitUntil: 'domcontentloaded' });
if (o.letsGo) { const go = page.locator('button', { hasText: /Let.s go/i }).first(); await go.waitFor({ state: 'visible', timeout: 60000 }); await go.click(); }
// wait until the game draws a real scene
let ready = false;
for (let i = 0; i < 240 && !ready; i++) {
  await sleep(500);
  ready = await page.evaluate(() => { const f = window.__perf.frames; const l = f[f.length - 2]; return !!l && l.draws > 20 && window.__perf.renderers.length > 0; }).catch(() => false);
}
const bootS = (Date.now() - t0) / 1000;
await sleep((o.warm ?? 8) * 1000);
if (o.inject) await page.evaluate((inj) => Object.assign(window.__perf.inject, inj), o.inject);

if (o.trace && !o.traceFromStart) await startTrace();
if (o.cpu) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
if (o.heap) { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
const align = await page.evaluate(() => { performance.mark('__perf_align'); return performance.now(); });
const measureFrom = o.measureAll ? 0 : align;

// --- drive ---
const until = Date.now() + secs * 1000;
const walk = o.walk ?? 'square';
async function tapSpace() { await page.keyboard.down('Space'); await sleep(80); await page.keyboard.up('Space'); }
if (walk === 'square') {
  const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
  let i = 0;
  while (Date.now() < until) { const k = keys[i++ % 4]; await page.keyboard.down(k); await sleep(2500); await page.keyboard.up(k); }
} else if (walk === 'line') {
  // a long run one way then back: maximum new ground per second
  const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
  let i = 0;
  while (Date.now() < until) { const k = keys[i++ % 4]; await page.keyboard.down(k); await sleep(9000); await page.keyboard.up(k); }
} else if (walk === 'ride') {
  await page.keyboard.down('KeyW');
  while (Date.now() < until) { await tapSpace(); await sleep(300); }
  await page.keyboard.up('KeyW');
} else if (walk === 'dash') {
  // tap far points on the ground, alternating sides: 'Tap to go' super-speed journeys
  const vp = page.viewportSize(); let i = 0;
  const pts = [[0.92, 0.88], [0.08, 0.12], [0.9, 0.1], [0.1, 0.9]];
  while (Date.now() < until) { const [fx, fy] = pts[i++ % 4]; await page.mouse.click(vp.width * fx, vp.height * fy); await sleep(4500); }
} else if (walk === 'tap') {
  while (Date.now() < until) { await tapSpace(); await sleep(250); }
} else {
  await sleep(secs * 1000);
}
const measureTo = await page.evaluate(() => performance.now());

let cpuProfile = null, heapProfile = null;
if (o.cpu) cpuProfile = (await cdp.send('Profiler.stop')).profile;
if (o.heap) heapProfile = (await cdp.send('HeapProfiler.stopSampling')).profile;
if (o.trace) { await cdp.send('Tracing.end'); await traceDone; }

const data = await page.evaluate(() => ({ frames: window.__perf.frames, slowGl: window.__perf.slowGl, snap: window.__perf.snapshot() }));
if (o.shot) await page.screenshot({ path: path.join(OUT, `${label}.png`) });
const meta = { label, base, urlPath, secs, o, bootS, align, measureFrom, measureTo, logs: logs.slice(0, 40), snap: data.snap };
fs.writeFileSync(path.join(OUT, `${label}.frames.json`), JSON.stringify({ meta, frames: data.frames, slowGl: data.slowGl }));
if (o.trace) fs.writeFileSync(path.join(OUT, `${label}.trace.json`), JSON.stringify({ traceEvents: traceChunks }));
if (cpuProfile) fs.writeFileSync(path.join(OUT, `${label}.cpuprofile`), JSON.stringify(cpuProfile));
if (heapProfile) fs.writeFileSync(path.join(OUT, `${label}.heapprofile`), JSON.stringify(heapProfile));
await browser.close();
console.log(JSON.stringify({ label, bootS, frames: data.frames.length, snap: data.snap, logs: logs.slice(0, 5) }));
