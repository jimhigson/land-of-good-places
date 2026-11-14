// The ferris wheel's climb through the clouds: the park goes away inside the
// cloud band (`World.setParkVisible`) and comes back on the way down — and the
// ride, one of the park's own updaters, keeps going the whole time.
//
//   node docs/perf/undrawn-indoors/ferris-clouds.mjs <base> <outDir>
//
// Needs `window.game` (a dev server). Boards through `/ferris`, samples twice a
// second until the ride lets her go: is she riding, is the park drawn (the
// space, `World.parkDrawn`), and how much of the park is in the graph — on this
// branch the park's roots attached; before it, whether the park's groups are
// visible (they were never taken out of the graph). Screenshots at the bottom,
// above the clouds and back on the ground.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, file) => page.screenshot({ path: `${outDir}/${file}`, timeout: 180_000 }).then(() => file, (e) => `${file}: ${String(e.message).split('\n')[0]}`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await page.goto(`${base}/ferris?seed=5`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 480; i++) {
    await sleep(500);
    if (await page.evaluate(() => Boolean(window.game?.world && window.game.player.riding)).catch(() => false)) break;
  }
  const sample = () => page.evaluate(() => {
    const g = window.game; const w = g.world;
    const roots = w.parkRoots;
    return {
      riding: Boolean(g.player.riding),
      parkDrawn: w.parkDrawn ?? null,
      parkInGraph: roots ? roots.filter((r) => r.parent !== null).length : null,
      parkGroupsVisible: w.garden.group.visible,
    };
  });
  const timeline = [];
  const shots = [];
  const started = Date.now();
  let sawHidden = false;
  let tookTop = false;
  shots.push(await shot(page, '1-boarded.png'));
  while (Date.now() - started < 240_000) {
    const s = await sample();
    timeline.push({ t: Number(((Date.now() - started) / 1000).toFixed(1)), ...s });
    const hidden = s.parkInGraph === 0 || s.parkGroupsVisible === false;
    if (hidden) sawHidden = true;
    if (hidden && !tookTop) { tookTop = true; await sleep(3000); shots.push(await shot(page, '2-above-the-clouds.png')); }
    if (!s.riding) break;
    await sleep(500);
  }
  await sleep(2000);
  shots.push(await shot(page, '3-off-the-ride.png'));
  const after = await sample();
  // The timeline compressed to its changes.
  const changes = timeline.filter((s, i) => i === 0 || JSON.stringify({ ...s, t: 0 }) !== JSON.stringify({ ...timeline[i - 1], t: 0 }));
  console.log(JSON.stringify({ base, rodeFor: timeline.at(-1)?.t, sawParkHidden: sawHidden, rideEnded: !after.riding, after, changes, shots, errors }));
} finally {
  await browser.close();
}
