/**
 * node tmp-qa-shots.mjs <port> <outDir> <label> <shotsJson>
 * Shoots a list of [name, camPos, camDir] triples against a production preview.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const port = process.argv[2] ?? '5341';
const outDir = process.argv[3] ?? '/tmp/qa349b';
const label = process.argv[4] ?? 'shot';
const shots = JSON.parse(readFileSync(process.argv[5] ?? '/tmp/shots-349.json', 'utf8'));
mkdirSync(outDir, { recursive: true });

const exe = join(
  homedir(),
  'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

let first = true;
for (const [name, camPos, camDir] of shots) {
  const url =
    `http://localhost:${port}/view?camPos=${encodeURIComponent(camPos)}` +
    `&camDir=${encodeURIComponent(camDir)}&timeOfDay=12:00`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 120000 });
  // First load generates the whole park; later ones re-use the warm module
  // graph but still rebuild the world, so give each a real settle.
  await page.waitForTimeout(first ? 25000 : 9000);
  first = false;
  await page.screenshot({ path: `${outDir}/${label}-${name}.png` });
  console.log(`shot ${name}`);
}
if (errors.length) console.log('errors:', errors.slice(0, 3).join(' | '));
await browser.close();
