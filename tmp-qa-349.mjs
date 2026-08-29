/**
 * Scratch headless QA for issue #349 — not part of the build.
 *
 *   node tmp-qa-349.mjs <port> <outDir> <label>
 *
 * Looks at the near spandrel of `bridge-172.0` (the first bridge walking in
 * from the gate) from a few stand points beside it — where the sandy wedge of
 * overhanging paving showed in Jim's screenshot on the issue.
 *
 * `window.game` is DEV-only (`main.ts` guards it behind `import.meta.env.DEV`)
 * and this runs against a production `vite preview`, so it waits on the canvas
 * having painted rather than on a global that will never appear.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const port = process.argv[2] ?? '5341';
const outDir = process.argv[3] ?? '/tmp/qa349';
const label = process.argv[4] ?? 'shot';
mkdirSync(outDir, { recursive: true });

const SHOTS = [
  // Beside the bridge at eye height, looking up at the near spandrel — the
  // face the overhanging paving projected out of.
  ['spandrel-close', '-13.69,2.01,40.52', '-6.762,2.341,-1.811'],
  ['spandrel-wide', '-10.79,1.97,41.30', '-9.659,2.376,-2.587'],
  // Lower and closer still, so the parapet's outside face fills the frame.
  ['spandrel-under', '-15.5,1.2,39.8', '-4.95,3.15,-1.09'],
  // The walk-in view, down the deck from the gate side.
  ['deck-along', '-14.5,5.6,45.0', '-7.5,-1.1,-8.5'],
];

const exe = join(
  homedir(),
  'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

for (const [name, camPos, camDir] of SHOTS) {
  const url =
    `http://localhost:${port}/view?camPos=${encodeURIComponent(camPos)}` +
    `&camDir=${encodeURIComponent(camDir)}&timeOfDay=12:00`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 120000 });
  // The park generates through a dozen lazy imports; 25 s is what the debug
  // run needed on this box before the whole scene was up.
  await page.waitForTimeout(25000);
  await page.screenshot({ path: `${outDir}/${label}-${name}.png` });
  console.log(`shot ${label}-${name}`);
}

if (errors.length) console.log('page errors:', errors.slice(0, 5).join(' | '));
await browser.close();
