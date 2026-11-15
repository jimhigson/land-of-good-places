// node walk.mjs <base> <outPrefix>
// Walks the park (W, D, S, A, three seconds each, twice round), a screenshot
// at each turn, then holds every batch to what it baked (auditBatched).
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const [base, outPrefix] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chromium', headless: true, timeout: 900000, args: ['--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: 'block' })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.goto(`${base}/spawn?seed=5&perf=1`, { waitUntil: 'domcontentloaded', timeout: 600000 });
for (const t0 = Date.now(); ; ) {
  if (await page.evaluate(() => !!window.game && (window.__perf?.frameCount ?? 0) > 60).catch(() => false)) break;
  if (Date.now() - t0 > 1800000) throw new Error('never settled');
  await sleep(500);
}
await sleep(2000);
const start = await page.evaluate(() => window.game.player.position.toArray());
let shot = 0;
for (let lap = 0; lap < 2; lap += 1) {
  for (const key of ['KeyW', 'KeyD', 'KeyS', 'KeyA']) {
    await page.keyboard.down(key);
    await sleep(3000);
    await page.keyboard.up(key);
    await page.screenshot({ path: `${outPrefix}-${shot++}.png` });
  }
}
const r = await page.evaluate(async () => {
  const mod = await import('/src/world/staticBatch.ts');
  const audit = mod.auditBatched(window.game.engine.scene);
  return { end: window.game.player.position.toArray(), batches: audit.batches, sources: audit.sources, drifted: audit.drifted.length, first: audit.drifted.slice(0, 3), draws: window.__perf.summary().drawsP50 };
});
await browser.close();
console.log(JSON.stringify({ start, ...r, errors: errors.slice(0, 3) }));
