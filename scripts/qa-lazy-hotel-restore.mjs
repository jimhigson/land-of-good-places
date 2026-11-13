/**
 * Scratch browser QA for the lazy hotel's two boot roads in — not part of the build.
 *
 *   node scripts/qa-lazy-hotel-restore.mjs <port> <outDir> [desktop|phone]
 *
 * Against a **dev** server (it reads `window.game`), seed 5 (QA_SEED to change):
 *
 *   1. `/hotel` — the deep link loads the interior before the game is built:
 *      she opens in the furnished lobby.
 *   2. A save written there, reloaded at the bare root, restores her into the
 *      furnished lobby (`interiorsToPreload`), not into an empty room.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '5791';
const outDir = process.argv[3] ?? 'qa-out';
const size = process.argv[4] ?? 'desktop';
const seed = process.env.QA_SEED ?? '5';
mkdirSync(outDir, { recursive: true });

const CHROME =
  process.env.QA_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/` +
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context =
  size === 'phone'
    ? await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
    : await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

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
  flags: { createdCharacter: true, arrivedByBus: true, hotelKey: false, dexPrizeSeen: true },
};
await page.goto(`http://localhost:${port}/?seed=${seed}`, { waitUntil: 'load', timeout: 120000 });
await page.evaluate((file) => window.localStorage.setItem('lgp:save', JSON.stringify(file)), save);

const results = [];
const verdict = (ok, what) => {
  results.push({ ok, what });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${what}`);
};
async function shot(path) {
  try {
    await page.screenshot({ path, timeout: 120000 });
  } catch (error) {
    console.log(`  (no screenshot ${path}: ${String(error).split('\n')[0]})`);
  }
}
const ready = () => page.waitForFunction(() => !!window.game?.player && !!window.game?.world?.hotel, null, { timeout: 600000 });
const state = () =>
  page.evaluate(() => {
    const g = window.game;
    const h = g.world.hotel;
    const p = g.player.position;
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), furnished: h.furnished, inside: h.playerIsInside, keepOuts: h.propKeepOuts.length };
  });

console.log(`--- ${size}: 1. /hotel ---`);
await page.goto(`http://localhost:${port}/hotel?seed=${seed}`, { waitUntil: 'load', timeout: 120000 });
await ready();
// Furnished at the very first frame the game exists: the link loaded it first.
const first = await state();
console.log(`  first frame: ${JSON.stringify(first)}`);
verdict(first.furnished, 'the interior was built before the game was (furnished on the first frame)');
let inside = false;
for (let i = 0; i < 120 && !inside; i += 1) {
  await page.waitForTimeout(500);
  inside = (await state()).inside;
}
await page.waitForTimeout(2000);
const lobby = await state();
verdict(inside && lobby.keepOuts > 20, `/hotel opened her in the furnished lobby (${JSON.stringify(lobby)})`);
await shot(`${outDir}/${size}-r1-hotel-link.png`);

console.log(`--- ${size}: 2. a save in the lobby, restored at the root ---`);
// Let the game save where she stands, then read it back.
let place = null;
for (let i = 0; i < 90 && !place; i += 1) {
  await page.waitForTimeout(1000);
  place = await page.evaluate(() => {
    try {
      const file = JSON.parse(window.localStorage.getItem('lgp:save') ?? 'null');
      const p = file?.place ?? file?.game?.place ?? null;
      return p && String(p.space).startsWith('hotel.') ? p : null;
    } catch {
      return null;
    }
  });
}
console.log(`  saved place: ${JSON.stringify(place)}`);
verdict(place !== null, 'the game saved her place inside the hotel');
if (place) {
  await page.goto(`http://localhost:${port}/?seed=${seed}`, { waitUntil: 'load', timeout: 120000 });
  await ready();
  const restored0 = await state();
  console.log(`  first frame after reload: ${JSON.stringify(restored0)}`);
  verdict(restored0.furnished, 'the interior was built before the game was, for a save inside it');
  await page.waitForTimeout(4000);
  const restored = await state();
  verdict(
    restored.inside && Math.hypot(restored.x - place.x, restored.z - place.z) < 1.5,
    `she is back where she was saved, inside (${JSON.stringify(restored)})`,
  );
  await shot(`${outDir}/${size}-r2-restored.png`);
}

verdict(errors.length === 0, `no page or console errors (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${size}: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
