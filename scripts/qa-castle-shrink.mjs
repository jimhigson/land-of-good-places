/**
 * Scratch browser QA for #403 (halve the castle's floor area) — not part of
 * the build.
 *
 *   node scripts/qa-castle-shrink.mjs <port> <outDir>
 *
 * Photographs the same fixed camera on every storey so a "before" run on
 * `origin/main` and an "after" run on this branch can be laid side by side.
 * The whole question Jim is asking — does the room read *denser* — is one a
 * pair of pictures answers and a table of metres does not.
 *
 * Standing points are given in **fractions of the plate's half-extent**, not
 * in metres, precisely because the plate is what changes: `0.5, 0.5` is the
 * same *place in the room* before and after, which is what makes the two runs
 * comparable. A fixed metre offset would photograph the middle of the old
 * room and the edge of the new one.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '5404';
const outDir = process.argv[3] ?? 'qa-out';
const halfX = Number(process.argv[4] ?? 30);
const halfZ = Number(process.argv[5] ?? 22);
mkdirSync(outDir, { recursive: true });

const CHROME =
  process.env.QA_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/` +
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

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

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript((file) => {
  window.localStorage.setItem('lgp:save', JSON.stringify(file));
}, save);

/** Fractions of the half-extent — the same place in the room at any size. */
const shots = [];
for (let deck = 0; deck < 5; deck += 1) {
  shots.push({ name: `deck${deck}-middle`, deck, fx: 0, fz: 0.15 });
  shots.push({ name: `deck${deck}-west`, deck, fx: -0.45, fz: 0.2 });
}

for (const shot of shots) {
  const x = (shot.fx * halfX).toFixed(2);
  const z = (shot.fz * halfZ).toFixed(2);
  const url = `http://localhost:${port}/castle?deck=${shot.deck}&at=${x},${z}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(6500);
  await page.screenshot({ path: `${outDir}/${shot.name}.png` });
  console.log(`${shot.name.padEnd(18)} deck ${shot.deck}  at ${x},${z}`);
}

if (errors.length) {
  console.error(`\n${errors.length} console error(s):`);
  for (const e of errors.slice(0, 12)) console.error('  ' + e);
}
await browser.close();
console.log(`\nWrote ${shots.length} shots to ${outDir}`);
