// node ridetime.mjs <mainBase> <branchBase> [rounds=3] [scenes=all] [secs=8] [warm=6]
// Main-thread CPU per frame in THREAD time (Chrome trace `tdur`, which a
// descheduled thread does not accrue), plus the ?perf=1 probe's wall-clock
// cpuP50 and draws. Adapted from docs/perf/undrawn-indoors/thread-time.mjs:
// builds alternate per scene, the order flips every round, a fresh browser per
// measurement, 1440x900 @ DPR 2, service worker blocked; plus the GPU flags.
// CONTROL_MS=n adds an n ms busy loop to every frame of both builds.
import { createRequire } from 'node:module';
import os from 'node:os';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const SCENES = {
  'rail-race': '/rail-race',
  'sky-cruiser': '/sky-cruiser',
  slide: '/slide',
  ferris: '/ferris',
  park: '/spawn?pos=0,0&facing=0',
};
const [mainBase, branchBase, roundsS = '3', only = '', secsS = '8', warmS = '6'] = process.argv.slice(2);
const rounds = Number(roundsS), secs = Number(secsS), warm = Number(warmS);
const CONTROL_MS = Number(process.env.CONTROL_MS ?? 0);
const names = only ? only.split(',') : Object.keys(SCENES);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (v) => Math.round(v * 100) / 100;
const launch = () =>
  chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });

async function measure(label, base, name) {
  const browser = await launch();
  const path = SCENES[name];
  const riding = name !== 'park';
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
    const sep = path.includes('?') ? '&' : '?';
    await page.goto(`${base}${path}${sep}perf=1&seed=5`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    let ready = false;
    for (let i = 0; i < 600 && !ready; i++) {
      await sleep(500);
      ready = await page
        .evaluate((riding) => {
          const p = window.__perf;
          return !!p && p.frameCount > 60 && (!riding || p.context().riding === true);
        }, riding)
        .catch(() => false);
    }
    if (!ready) return { label, name, error: 'never ready', errors };
    let driving = name === 'rail-race';
    const driver = (async () => {
      if (!driving) return;
      await page.keyboard.down('KeyW');
      while (driving) {
        await page.keyboard.down('Space');
        await sleep(80);
        await page.keyboard.up('Space');
        await sleep(300);
      }
      await page.keyboard.up('KeyW');
    })();
    await sleep(warm * 1000);
    if (CONTROL_MS > 0) {
      await page.evaluate((ms) => {
        const spin = () => {
          const t = performance.now();
          while (performance.now() - t < ms) {
            /* spin */
          }
          requestAnimationFrame(spin);
        };
        requestAnimationFrame(spin);
      }, CONTROL_MS);
      await sleep(1000);
    }
    await browser.startTracing(page, { categories: ['toplevel', 'devtools.timeline'] });
    await page.evaluate(() => window.__perf.reset());
    await sleep(secs * 1000);
    const out = await page.evaluate(() => ({ s: window.__perf.summary(), c: window.__perf.context() }));
    const trace = JSON.parse((await browser.stopTracing()).toString('utf8'));
    driving = false;
    await driver;
    const events = trace.traceEvents ?? trace;
    const mains = new Set(events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map((e) => `${e.pid}:${e.tid}`));
    const rafCount = new Map();
    for (const e of events) if (e.name === 'FireAnimationFrame' && mains.has(`${e.pid}:${e.tid}`)) rafCount.set(`${e.pid}:${e.tid}`, (rafCount.get(`${e.pid}:${e.tid}`) ?? 0) + 1);
    const main = [...rafCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const rafT = [];
    let runT = 0;
    for (const e of events) {
      if (`${e.pid}:${e.tid}` !== main || e.ph !== 'X') continue;
      if (e.name === 'FireAnimationFrame') rafT.push((e.tdur ?? 0) / 1000);
      if (e.name === 'ThreadControllerImpl::RunTask') runT += e.tdur ?? 0;
    }
    rafT.sort((a, b) => a - b);
    const q = (p) => (rafT.length ? rafT[Math.min(rafT.length - 1, Math.floor(p * rafT.length))] : NaN);
    const frames = out.s.frames;
    return {
      label, name, space: out.c.space, riding: out.c.riding, frames, fps: r2(out.s.fps),
      rafThreadP50: r2(q(0.5)), rafThreadMean: r2(rafT.reduce((a, b) => a + b, 0) / Math.max(1, rafT.length)), rafThreadP90: r2(q(0.9)),
      mainThreadMsPerFrame: r2(runT / 1000 / Math.max(1, frames)),
      cpuP50: r2(out.s.cpuP50), cpuP99: r2(out.s.cpuP99), draws: out.s.drawsP50, drawsMax: out.s.drawsMax, tris: out.s.trisP50,
      load: os.loadavg().map((v) => r2(v)), control: CONTROL_MS, errors,
    };
  } finally {
    await browser.close();
  }
}

for (let round = 0; round < rounds; round++) {
  for (const name of names) {
    const order = round % 2 === 0 ? [['main', mainBase], ['branch', branchBase]] : [['branch', branchBase], ['main', mainBase]];
    for (const [build, base] of order) {
      let result;
      try {
        result = await measure(build, base, name);
      } catch (error) {
        result = { label: build, name, error: String(error).slice(0, 200) };
      }
      console.log(JSON.stringify({ round, ...result }));
    }
  }
}
