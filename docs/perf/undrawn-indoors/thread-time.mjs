// Main-thread CPU per frame, in THREAD time, before vs after, scene by scene.
//
//   node docs/perf/undrawn-indoors/thread-time.mjs <beforeBase> <afterBase> [rounds=3] [scenes=all] [secs=8] [warm=8]
//   CONTROL_MS=2 node … (adds a busy loop of that many ms to every frame of BOTH builds — the instrument's control)
//
// Why thread time: `?perf=1`'s cpu p50 is wall-clock (performance.now() round
// the frame), and on a Mac shared with other agents' work a thread that is
// descheduled mid-frame reads as a slow frame. This reads Chrome's trace
// instead, where every task carries `tdur` — the CPU time the renderer's main
// thread actually ran for — and sums it over a window of frames:
//
//   raf   = Σ tdur of `FireAnimationFrame` (the game's tick and draw) / frames
//   main  = Σ tdur of top-level `ThreadControllerImpl::RunTask` on the main thread (everything) / frames
//
// Builds alternate per scene and the order flips every round (before, after;
// after, before; …), so slow drift in the machine's load falls on both sides.
// One fresh browser context per measurement, service worker blocked, desktop
// 1440x900 @ DPR 2 (the plan's harness), standing still. Prints one JSON line
// per measurement, with the machine's load average when it ran.
import { createRequire } from 'node:module';
import os from 'node:os';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const { SCENES } = await import('./scenes.mjs');

const [beforeBase, afterBase, roundsS = '3', only = '', secsS = '8', warmS = '8'] = process.argv.slice(2);
const rounds = Number(roundsS);
const secs = Number(secsS);
const warm = Number(warmS);
const CONTROL_MS = Number(process.env.CONTROL_MS ?? 0);
const names = only ? only.split(',') : Object.keys(SCENES);
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (v) => Math.round(v * 100) / 100;

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});

async function measure(label, base, name) {
  const path = SCENES[name];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  try {
    const sep = path.includes('?') ? '&' : '?';
    await page.goto(`${base}${path}${sep}perf=1&seed=5`, { waitUntil: 'domcontentloaded' });
    let ready = false;
    for (let i = 0; i < 240 && !ready; i++) {
      await sleep(500);
      ready = await page.evaluate(() => (window.__perf?.frameCount ?? 0) > 60).catch(() => false);
    }
    if (!ready) return { label, name, error: 'never drew 60 frames', errors };
    await sleep(warm * 1000);
    if (CONTROL_MS > 0) {
      // The control: a fixed busy loop in every animation frame, on both builds.
      await page.evaluate((ms) => {
        const spin = () => { const t = performance.now(); while (performance.now() - t < ms) { /* spin */ } requestAnimationFrame(spin); };
        requestAnimationFrame(spin);
      }, CONTROL_MS);
      await sleep(1000);
    }
    await browser.startTracing(page, { categories: ['toplevel', 'devtools.timeline'] });
    await page.evaluate(() => window.__perf.reset());
    await sleep(secs * 1000);
    const out = await page.evaluate(() => ({ s: window.__perf.summary(), c: window.__perf.context() }));
    const trace = JSON.parse((await browser.stopTracing()).toString('utf8'));
    const events = trace.traceEvents ?? trace;
    // The page's main thread: the CrRendererMain with the most animation frames.
    const mains = new Set(events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map((e) => `${e.pid}:${e.tid}`));
    const rafCount = new Map();
    for (const e of events) if (e.name === 'FireAnimationFrame' && mains.has(`${e.pid}:${e.tid}`)) rafCount.set(`${e.pid}:${e.tid}`, (rafCount.get(`${e.pid}:${e.tid}`) ?? 0) + 1);
    const main = [...rafCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    let rafT = 0, rafW = 0, runT = 0, runW = 0, from = Infinity, to = -Infinity;
    for (const e of events) {
      if (`${e.pid}:${e.tid}` !== main || e.ph !== 'X') continue;
      if (e.name === 'FireAnimationFrame') { rafT += e.tdur ?? 0; rafW += e.dur ?? 0; }
      if (e.name === 'ThreadControllerImpl::RunTask') { runT += e.tdur ?? 0; runW += e.dur ?? 0; from = Math.min(from, e.ts); to = Math.max(to, e.ts + (e.dur ?? 0)); }
    }
    const frames = out.s.frames;
    return {
      label, base, name, space: out.c.space, frames, fps: r2(out.s.fps),
      rafThreadMs: r2(rafT / 1000 / frames), rafWallMs: r2(rafW / 1000 / frames),
      mainThreadMs: r2(runT / 1000 / frames), mainWallMs: r2(runW / 1000 / frames),
      cpuP50: r2(out.s.cpuP50), cpuP99: r2(out.s.cpuP99),
      draws: out.s.drawsP50, tris: out.s.trisP50, dpr: out.c.pixelRatio,
      traceSecs: r2((to - from) / 1e6), load: os.loadavg().map((v) => r2(v)), control: CONTROL_MS, errors,
    };
  } finally {
    await context.close();
  }
}

try {
  for (let round = 0; round < rounds; round++) {
    for (const name of names) {
      const order = round % 2 === 0 ? [['before', beforeBase], ['after', afterBase]] : [['after', afterBase], ['before', beforeBase]];
      for (const [build, base] of order) {
        console.log(JSON.stringify({ round, ...(await measure(build, base, name)) }));
      }
    }
  }
} finally {
  await browser.close();
}
