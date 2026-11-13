// CPU per frame in the park and in every interior, read off the game's own
// `?perf=1` probe (`window.__perf`, the numbers the overlay shows).
//
//   node docs/perf/undrawn-indoors/measure.mjs <base> <label> [throttle=1] [secs=12] [warm=10] [scenes=all]
//
// One fresh browser context per scene, service worker blocked, desktop
// 1440x900 @ DPR 2 (the plan's harness), standing still: the scene does the
// work, nothing the harness does. `throttle` is CDP's CPU throttle (4 = the
// plan's phone stand-in). Prints one JSON line per scene.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');

const [base, label, throttleS = '1', secsS = '12', warmS = '10', only = ''] = process.argv.slice(2);
const throttle = Number(throttleS);
const secs = Number(secsS);
const warm = Number(warmS);
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { SCENES } = await import('./scenes.mjs');
const names = only ? only.split(',') : Object.keys(SCENES);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--mute-audio', '--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
try {
  for (const name of names) {
    const path = SCENES[name];
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
    const cdp = await context.newCDPSession(page);
    const sep = path.includes('?') ? '&' : '?';
    await page.goto(`${base}${path}${sep}perf=1&seed=5`, { waitUntil: 'domcontentloaded' });
    let ready = false;
    for (let i = 0; i < 240 && !ready; i++) {
      await sleep(500);
      ready = await page.evaluate(() => (window.__perf?.frameCount ?? 0) > 60).catch(() => false);
    }
    if (!ready) {
      console.log(JSON.stringify({ label, name, error: 'never drew 60 frames', errors }));
      await context.close();
      continue;
    }
    await sleep(warm * 1000);
    if (throttle !== 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      await sleep(3000);
    }
    await page.evaluate(() => window.__perf.reset());
    await sleep(secs * 1000);
    const out = await page.evaluate(() => ({ s: window.__perf.summary(), c: window.__perf.context() }));
    const r = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
    console.log(JSON.stringify({
      label, name, throttle, space: out.c.space,
      frames: out.s.frames, fps: r(out.s.fps),
      cpuP50: r(out.s.cpuP50), cpuP99: r(out.s.cpuP99),
      intervalP99: r(out.s.intervalP99), missed120: r(out.s.missedVsync * 100),
      draws: out.s.drawsP50, tris: out.s.trisP50,
      dpr: out.c.pixelRatio, errors,
    }));
    await context.close();
  }
} finally {
  await browser.close();
}
