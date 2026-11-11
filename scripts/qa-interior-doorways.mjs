/**
 * Scratch browser QA for the interior doorway frames — not part of the build.
 *
 *   node scripts/qa-interior-doorways.mjs <baseUrl> <outDir> [tag]
 *
 * Opens every interior that has a way out to the park, from its own deep link,
 * at a desktop and a phone size, and photographs it from the inside, so the
 * way out can be judged by eye. `tag` prefixes the file names ("before",
 * "after") for the frame sheet.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://localhost:5791').replace(/\/$/, '');
const outDir = process.argv[3] ?? 'qa-out';
const tag = process.argv[4] ?? 'shot';
mkdirSync(outDir, { recursive: true });

const CHROME =
  process.env.QA_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/` +
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

/** Straight into the park, past character creation and the cat bus. */
const save = {
  v: 1,
  at: Date.now(),
  purchases: 0,
  game: {
    parkName: 'QA Park',
    mode: 'sandbox',
    money: 500,
    player: { name: 'Eleri' },
    world: { timeOfDay: 600, dayCount: 0, lightsOn: false },
    inventory: [],
    carriedUid: null,
  },
  flags: { createdCharacter: true, arrivedByBus: true, hotelKey: true, dexPrizeSeen: true },
};

const rooms = (process.env.QA_ROOMS ?? 'hotel,castle,reptile,library').split(',');
const ALL = [
  { name: 'hotel', path: '/hotel', note: 'the lobby, just inside the front door' },
  { name: 'castle', path: '/castle?deck=0', note: 'the castle mall, just in from the front door' },
  { name: 'reptile', path: '/reptile-house', note: 'the Reptile House, just in from its door' },
  { name: 'library', path: '/library', note: 'the library, just in from its door' },
];
const shots = ALL.filter((s) => rooms.includes(s.name));
const sizes = [
  { name: 'desktop', width: 1400, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
for (const size of sizes) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, serviceWorkers: 'block' });
  await context.addInitScript((file) => {
    window.localStorage.setItem('lgp:save', JSON.stringify(file));
  }, save);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const shot of shots) {
    const url = `${base}${shot.path}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(Number(process.env.QA_WAIT ?? 14000));
    const file = `${outDir}/${tag}-${shot.name}-${size.name}.png`;
    await page.screenshot({ path: file });
    console.log(`${file}  ${shot.note}  ${url}`);
  }
  await context.close();
}
if (errors.length) {
  console.log(`\n${errors.length} page error(s):`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
}
await browser.close();
