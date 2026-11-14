// Frame timing with the shadow cache on or off, on a production build.
// usage: node perf.mjs <label> '<path>' <secs> '<opts JSON>'
// opts: { cache: 0|1, walk: 'none'|'square'|'race', phone: bool, throttle: n, time: 0..1 }
import fs from 'node:fs';
import { chromium, BASE, OUT, sleep } from './lib.mjs';

const [label, urlPath, secsS, optsS] = process.argv.slice(2);
const secs = Number(secsS ?? 20);
const o = optsS ? JSON.parse(optsS) : {};
const HERE = new URL('.', import.meta.url).pathname;
const url = `${BASE}${urlPath}${urlPath.includes('?') ? '&' : '?'}seed=5&perf=1&shadowCache=${o.cache ?? 1}`;

const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--mute-audio', '--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
try {
  const ctxOpts = o.phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
  const context = await browser.newContext({ ...ctxOpts, serviceWorkers: 'block' });
  await context.addInitScript({ path: `${HERE}shadowprobe.js` });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ready = async () => {
    await page.waitForFunction(() => {
      const p = window.__perf;
      return !!p && p.frameCount > 60 && (p.context().space === 'garden' || p.context().riding === true);
    }, null, { timeout: 240_000, polling: 250 });
  };
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready();
  if (o.time !== undefined) {
    // A save at the time asked for, written before the game's scripts on the next load.
    await page.waitForFunction(() => !!localStorage.getItem('lgp:save'), null, { timeout: 60_000, polling: 250 });
    const save = JSON.parse(await page.evaluate(() => localStorage.getItem('lgp:save')));
    save.game = { ...(save.game ?? {}), world: { ...(save.game?.world ?? {}), timeOfDay: o.time } };
    await context.addInitScript((text) => { try { localStorage.setItem('lgp:save', text); } catch {} }, JSON.stringify(save));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await ready();
  }
  if (o.walk === 'race') {
    const level = page.locator('.racehud-level').first();
    await level.waitFor({ state: 'visible', timeout: 60_000 });
    await level.click();
    await sleep(3500);
  }
  await sleep((o.warm ?? 6) * 1000);
  const cdp = await context.newCDPSession(page);
  if (o.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.throttle });
  if (o.throttle) await sleep(2000);
  const t0 = await page.evaluate(() => { window.__perf.reset(); return performance.now(); });
  const perfFrames = [];
  let lastT = t0;
  const pull = async () => {
    const fresh = await page.evaluate((after) => window.__perf.frames().filter((f) => f.t > after), lastT);
    if (fresh.length) { perfFrames.push(...fresh); lastT = fresh.at(-1).t; }
  };
  const until = Date.now() + secs * 1000;
  const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
  let k = 0;
  let nextPull = Date.now() + 3000;
  while (Date.now() < until) {
    if (o.walk === 'square') {
      await page.keyboard.down(keys[k % 4]);
      await sleep(2500);
      await page.keyboard.up(keys[k % 4]);
      k++;
    } else if (o.walk === 'race') {
      await page.keyboard.down('Space'); await sleep(60); await page.keyboard.up('Space'); await sleep(240);
    } else {
      await sleep(500);
    }
    if (Date.now() > nextPull) { await pull(); nextPull = Date.now() + 3000; }
  }
  await pull();
  const t1 = await page.evaluate(() => performance.now());
  const shadow = await page.evaluate(({ t0, t1 }) => window.__shadowProbe.frames.filter((f) => f.t >= t0 && f.t <= t1), { t0, t1 });
  const context2 = await page.evaluate(() => window.__perf.context());
  const q = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
  const mean = (values) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const cpu = perfFrames.map((f) => f.cpu);
  const iv = perfFrames.filter((f) => f.interval > 0).map((f) => f.interval);
  const draws = perfFrames.map((f) => f.draws);
  const sd = shadow.map((f) => f.shadowDraws);
  const sms = shadow.map((f) => f.shadowMs);
  const summary = {
    label, url, secs, o,
    frames: perfFrames.length,
    fps: perfFrames.length / ((perfFrames.at(-1)?.t - perfFrames[0]?.t) / 1000),
    cpuP50: q(cpu, 50), cpuP99: q(cpu, 99), cpuMean: mean(cpu),
    frameP50: q(iv, 50), frameP99: q(iv, 99),
    missed120: iv.filter((i) => i > 12.5).length / Math.max(1, iv.length),
    over16: iv.filter((i) => i > 17.2).length / Math.max(1, iv.length),
    drawsP50: q(draws, 50), drawsMean: mean(draws), drawsMax: Math.max(...draws),
    shadowDrawsP50: q(sd, 50), shadowDrawsMean: mean(sd), shadowDrawsMax: Math.max(...sd),
    shadowMsP50: q(sms, 50), shadowMsP99: q(sms, 99), shadowMsMean: mean(sms),
    heavyShadowFrames: sd.filter((d) => d > 250).length / Math.max(1, sd.length),
    gpu: context2.gpu, canvas: context2.canvas, space: context2.space, riding: context2.riding,
    errors: errors.slice(0, 3),
  };
  fs.writeFileSync(`${OUT}/perf-${label}.json`, JSON.stringify({ summary, perfFrames, shadow }));
  const f = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : String(n));
  console.log(`${label.padEnd(28)} cpu p50 ${f(summary.cpuP50)} p99 ${f(summary.cpuP99)} mean ${f(summary.cpuMean)} | frame p50 ${f(summary.frameP50)} p99 ${f(summary.frameP99)} missed120 ${f(100 * summary.missed120, 1)}% | draws p50 ${summary.drawsP50} max ${summary.drawsMax} | shadow draws p50 ${summary.shadowDrawsP50} mean ${f(summary.shadowDrawsMean, 0)} max ${summary.shadowDrawsMax} heavy ${f(100 * summary.heavyShadowFrames, 1)}% | shadow ms p50 ${f(summary.shadowMsP50, 3)} p99 ${f(summary.shadowMsP99, 3)} mean ${f(summary.shadowMsMean, 3)} | ${summary.frames} frames ${summary.space}${summary.riding ? ' riding' : ''} ${errors.length ? 'ERR ' + errors[0] : ''}`);
} finally {
  await browser.close();
}
