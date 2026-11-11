import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await context.newPage();
await page.addInitScript({ path: path.join(HERE, 'probe.js') });
await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5741}/spawn`, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 120; i++) { await sleep(500); if (await page.evaluate(() => { const f = window.__perf.frames; const l = f[f.length - 2]; return !!l && l.draws > 20; })) break; }
await sleep(6000);
console.log(JSON.stringify(await page.evaluate(() => {
  const P = window.__perf; let best = null, n0 = -1; for (const s of P.scenes) { let n = 0; s.traverse(() => n++); if (n > n0) { n0 = n; best = s; } }
  const vis = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const rows = best.children.map((c) => { let n = 0, hidden = 0; c.traverse((o) => { n++; if (!vis(o)) hidden++; }); return [c.name || c.type, n, hidden]; }).sort((a, b) => b[1] - a[1]);
  // second level of the biggest
  const big = best.children.slice().sort((a, b) => { let x = 0, y = 0; a.traverse(() => x++); b.traverse(() => y++); return y - x; })[0];
  const sub = big.children.map((c) => { let n = 0; c.traverse(() => n++); return [c.name || c.type, n, c.visible]; }).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return { total: n0, rows: rows.slice(0, 15), big: big.name, sub };
})));
await browser.close();
