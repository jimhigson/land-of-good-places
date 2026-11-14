// Frame timing with the shadow cache on or off, production build, NO ?perf=1.
// usage: node perf2.mjs <label> '<path>' <secs> '<opts JSON>'
// opts: { cache: 0|1, walk: 'none'|'square'|'race', phone: bool, throttle: n, time: 0..1, gpu: bool, warm: s }
import fs from 'node:fs';
import { chromium, BASE, OUT, sleep } from './lib.mjs';

const [label, urlPath, secsS, optsS] = process.argv.slice(2);
const secs = Number(secsS ?? 20);
const o = optsS ? JSON.parse(optsS) : {};
const HERE = new URL('.', import.meta.url).pathname;
const url = `${BASE}${urlPath}${urlPath.includes('?') ? '&' : '?'}seed=5&shadowCache=${o.cache ?? 1}`;

const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
try {
  const ctxOpts = o.phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
  const context = await browser.newContext({ ...ctxOpts, serviceWorkers: 'block' });
  if (o.gpu) await context.addInitScript(() => { window.__probeGpu = true; });
  await context.addInitScript({ path: `${HERE}shadowprobe.js` });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Ready: 120 consecutive frames of a drawn park (draws > 150).
  const ready = () => page.waitForFunction(() => {
    const f = window.__shadowProbe?.frames ?? [];
    if (f.length < 200) return false;
    return f.slice(-120).every((x) => x.draws > 150);
  }, null, { timeout: 240_000, polling: 500 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready();
  if (o.time !== undefined) {
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
  if (o.throttle) { await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.throttle }); await sleep(2000); }
  const t0 = await page.evaluate(() => performance.now());
  const until = Date.now() + secs * 1000;
  const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
  let k = 0;
  while (Date.now() < until) {
    if (o.walk === 'square') {
      await page.keyboard.down(keys[k % 4]); await sleep(2500); await page.keyboard.up(keys[k % 4]); k++;
    } else if (o.walk === 'race') {
      await page.keyboard.down('Space'); await sleep(60); await page.keyboard.up('Space'); await sleep(240);
    } else await sleep(500);
  }
  const t1 = await page.evaluate(() => performance.now());
  const frames = await page.evaluate(({ t0, t1 }) => window.__shadowProbe.frames.filter((f) => f.t >= t0 && f.t <= t1), { t0, t1 });
  const q = (values, p) => { const s = values.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
  const mean = (values) => { const v = values.filter(Number.isFinite); return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length); };
  const iv = frames.filter((f) => f.iv > 0).map((f) => f.iv);
  const cpu = frames.map((f) => f.cpu);
  const sd = frames.map((f) => f.shadowDraws);
  const sms = frames.map((f) => f.shadowMs);
  const gpu = frames.map((f) => f.gpuMs ?? NaN);
  const s = {
    label, url, secs, o, frames: frames.length,
    fps: frames.length / ((t1 - t0) / 1000),
    cpuP50: q(cpu, 50), cpuP99: q(cpu, 99), cpuMean: mean(cpu),
    frameP50: q(iv, 50), frameP99: q(iv, 99),
    missed120: iv.filter((i) => i > 12.5).length / Math.max(1, iv.length),
    drawsP50: q(frames.map((f) => f.draws), 50), drawsMax: Math.max(...frames.map((f) => f.draws)),
    shadowDrawsP50: q(sd, 50), shadowDrawsMean: mean(sd), shadowDrawsMax: Math.max(...sd),
    shadowMsP50: q(sms, 50), shadowMsP99: q(sms, 99), shadowMsMean: mean(sms),
    heavy: sd.filter((d) => d > 250).length / Math.max(1, sd.length),
    trisP50: q(frames.map((f) => f.tris), 50), shadowTrisP50: q(frames.map((f) => f.shadowTris), 50), shadowTrisMean: mean(frames.map((f) => f.shadowTris)),
    gpuP50: q(gpu, 50), gpuP99: q(gpu, 99), gpuMean: mean(gpu),
    errors: errors.slice(0, 3),
  };
  fs.writeFileSync(`${OUT}/perf2-${label}.json`, JSON.stringify({ summary: s, frames }));
  const f = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '-');
  console.log(`${label.padEnd(24)} cpu p50 ${f(s.cpuP50)} p99 ${f(s.cpuP99)} mean ${f(s.cpuMean)} | frame p50 ${f(s.frameP50)} p99 ${f(s.frameP99)} missed ${f(100 * s.missed120, 1)}% | draws p50 ${s.drawsP50} | shadow draws p50 ${s.shadowDrawsP50} mean ${f(s.shadowDrawsMean, 0)} heavy ${f(100 * s.heavy, 1)}% | shadow tris p50 ${(s.shadowTrisP50 / 1e6).toFixed(2)}M mean ${(s.shadowTrisMean / 1e6).toFixed(2)}M of ${(s.trisP50 / 1e6).toFixed(2)}M | shadow ms p50 ${f(s.shadowMsP50, 3)} p99 ${f(s.shadowMsP99, 3)} mean ${f(s.shadowMsMean, 3)}${o.gpu ? ` | gpu p50 ${f(s.gpuP50)} p99 ${f(s.gpuP99)}` : ''} | ${s.frames} fr ${f(s.fps, 1)} fps${errors.length ? ' ERR ' + errors[0] : ''}`);
} finally {
  await browser.close();
}
