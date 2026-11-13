/**
 * Scratch browser QA — not part of the build. Does the hotel look the same from
 * the park on two builds (the live site and a preview), and does `/hotel` open
 * in the furnished lobby on the preview?
 *
 *   node scripts/qa-lazy-hotel-compare.mjs <baseA> <baseB> <outDir>
 *
 * Production builds (no `window.game`), so this is pixels: one frozen `/view`
 * of the tower on seed 5 from each build, and their mean per-channel difference
 * measured in the page; then `/hotel` on build B, screenshotted.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';

const [baseA, baseB, outDir = 'qa-out'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const CHROME =
  process.env.QA_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/` +
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const VIEW = '/view?camPos=5.5,10,-28.8&camDir=-18.4,-8,-18.2&timeOfDay=12:00&seed=5';

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function capture(base, path, file, settle) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const chunks = [];
  page.on('request', (r) => {
    const m = /assets\/([\w-]+)\.js/.exec(r.url());
    if (m) chunks.push(m[1]);
  });
  await page.goto(base + path, { waitUntil: 'load', timeout: 180000 });
  await page.waitForTimeout(settle);
  await page.screenshot({ path: file, timeout: 180000 });
  await context.close();
  return { errors, interiorFetched: chunks.some((c) => c.startsWith('interior-')) };
}

const a = await capture(baseA, VIEW, `${outDir}/view-A.png`, 45000);
const b = await capture(baseB, VIEW, `${outDir}/view-B.png`, 45000);
console.log(`A ${baseA}: errors ${a.errors.length}; B ${baseB}: errors ${b.errors.length}, interior chunk fetched for a park view: ${b.interiorFetched}`);

const page = await browser.newPage();
const diff = await page.evaluate(
  async ([one, two]) => {
    const load = (src) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = src;
      });
    const [x, y] = await Promise.all([load(one), load(two)]);
    const read = (img) => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const p = read(x);
    const q = read(y);
    let sum = 0;
    let changed = 0;
    for (let i = 0; i < p.length; i += 4) {
      const d = Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
      sum += d / 3;
      if (d > 30) changed += 1;
    }
    return { mean: sum / (p.length / 4), changedFraction: changed / (p.length / 4) };
  },
  [
    `data:image/png;base64,${readFileSync(`${outDir}/view-A.png`).toString('base64')}`,
    `data:image/png;base64,${readFileSync(`${outDir}/view-B.png`).toString('base64')}`,
  ],
);
console.log(`tower view: mean difference ${diff.mean.toFixed(2)} / 255, ${(diff.changedFraction * 100).toFixed(2)}% of pixels differ by more than 30`);

const hotel = await capture(baseB, '/hotel?seed=5', `${outDir}/hotel-B.png`, 45000);
console.log(`B /hotel: errors ${hotel.errors.length}${hotel.errors.length ? ': ' + hotel.errors.slice(0, 2).join(' | ') : ''}; interior chunk fetched: ${hotel.interiorFetched}`);
await browser.close();
