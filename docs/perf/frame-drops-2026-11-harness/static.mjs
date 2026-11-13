import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const throttle = Number(process.argv[2] || 1);
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await context.newPage();
await page.addInitScript({ path: path.join(HERE, 'probe.js') });
const cdp = await context.newCDPSession(page);
await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5741}/spawn`, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 120; i++) { await sleep(500); if (await page.evaluate(() => { const f = window.__perf.frames; const l = f[f.length - 2]; return !!l && l.draws > 20; })) break; }
await sleep(6000);
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
async function measure(tag) {
  const from = await page.evaluate(() => performance.now()); await sleep(4000);
  return page.evaluate(({ from, tag }) => { const fr = window.__perf.frames.filter((f) => f.ts > from && f.iv > 0); const s = fr.map((f) => f.cpu).sort((a, b) => a - b); return { tag, frames: fr.length, cpuP50: Math.round(s[s.length >> 1] * 100) / 100 }; }, { from, tag });
}
const res = [];
res.push(await measure('baseline'));
const frozen = await page.evaluate(() => {
  const P = window.__perf; let best = null, n0 = -1; for (const s of P.scenes) { let n = 0; s.traverse(() => n++); if (n > n0) { n0 = n; best = s; } }
  const STATIC = /^(the-land-hotel-inside|the-big-building-inside|the-reptile-house-inside|the-library-inside|the-library-children)$/;
  let objs = 0; const names = [];
  for (const c of [...best.children]) if (STATIC.test(c.name)) { let n = 0; c.traverse(() => n++); objs += n; names.push(c.name); best.remove(c); }
  let total = 0; best.traverse(() => total++);
  return { objs, total, names };
});
res.push({ frozen });
res.push(await measure('hidden interiors detached from the scene'));
await page.evaluate(() => { for (const r of window.__perf.renderers) r.shadowMap.autoUpdate = false; });
res.push(await measure('+ shadow map not re-rendered'));
await browser.close();
console.log(JSON.stringify({ throttle, res }));
