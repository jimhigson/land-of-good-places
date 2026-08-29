/**
 * S1 evidence: photograph and ASSERT the three transitions SpaceManager now
 * owns — door in, door out, giant-slide launch.
 *
 *   node shoot-transitions.mjs <port> <outDir> <label>
 *
 * Needs a **dev** server: `window.game` is only exposed under `import.meta.env.DEV`.
 * Run once against origin/main and once against the branch; the screenshots are
 * the "before/after", and the asserted flips are what actually proves the
 * transitions still fire.
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';

const port = process.argv[2] ?? '5383';
const outDir = process.argv[3] ?? 'shots';
const label = process.argv[4] ?? 'after';
mkdirSync(outDir, { recursive: true });

/**
 * Playwright's cache holds one directory per browser build (`chromium-1234`),
 * and the number changes whenever the pinned version does — so it is found
 * rather than typed. `QA_CHROME` overrides for anything unusual.
 */
function findChrome() {
  if (process.env.QA_CHROME) return process.env.QA_CHROME;
  const cache = `${process.env.HOME}/Library/Caches/ms-playwright`;
  const builds = readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    // Highest build number wins — the most recently pinned one.
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const build of builds) {
    const exe =
      `${cache}/${build}/chrome-mac-arm64/` +
      'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
    if (existsSync(exe)) return exe;
  }
  throw new Error(
    `no playwright chromium found under ${cache} — set QA_CHROME to a browser binary`,
  );
}

const CHROME = findChrome();

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
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript((file) => {
  window.localStorage.setItem('lgp:save', JSON.stringify(file));
}, save);

const results = [];
const shot = async (name) => page.screenshot({ path: `${outDir}/${label}-${name}.png` });

/** Wait until `probe()` is true, or give up. Frames are slow under swiftshader. */
async function until(probe, ms = 40000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await page.evaluate(probe)) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

const ready = () =>
  until(() => {
    const g = window.game;
    return !!g?.world?.building && !!g?.player;
  });

// ---------------------------------------------------------------------------
// 1. Door in — /castle?deck=0 goes through the door's own transition.
// ---------------------------------------------------------------------------
await page.goto(`http://localhost:${port}/spawn?pos=0,0,40`, { waitUntil: 'load' });
await ready();
await page.waitForTimeout(6000);
await shot('1-garden-before-door-in');
const outsideAtStart = await page.evaluate(() => window.game.world.building.playerIsInside);

await page.goto(`http://localhost:${port}/castle?deck=0`, { waitUntil: 'load' });
await ready();
const wentIn = await until(() => window.game.world.building.playerIsInside === true);
await page.waitForTimeout(4000);
await shot('2-door-in-arrived');
results.push(['door in (enterInterior via changeTo)', !outsideAtStart && wentIn]);

// ---------------------------------------------------------------------------
// 2. Door out — walk south across the exit band from inside.
// ---------------------------------------------------------------------------
const walkedOut = await page.evaluate(async () => {
  const g = window.game;
  const b = g.world.building;
  const band = b.doorBands()[1]; // castleExitBand
  const p = g.player;
  // A `PortalBand` is a centre, a yaw and two half-extents — not a min/max box.
  // Stand `halfAcross + 1.5` short of it on the inside and step across.
  //
  // The castle's `checkDoorways` uses `bandContains`, so it only needs the
  // player to be *inside* the band on some frame it happens to sample — but
  // the walk is stepped anyway, in small increments, because that is the
  // stricter of the two: it satisfies `bandContains` and would also satisfy
  // `bandCrossed`, which S2 is expected to convert these triggers to (see
  // ARCHITECTURE-DECISIONS Decision 3's 29 Aug addendum, item 4). One jump
  // over the band would pass today and start failing the day it converts.
  const step = 0.3;
  p.teleportTo(band.centreX, band.y, band.centreZ - band.halfAcross - 1.5, 0);
  await new Promise((r) => setTimeout(r, 1500));
  for (let i = 0; i < 60 && b.playerIsInside; i += 1) {
    p.position.z += step;
    await new Promise((r) => setTimeout(r, 150));
  }
  return !b.playerIsInside;
});
await page.waitForTimeout(4000);
await shot('3-door-out-arrived');
results.push(['door out (leaveInterior via changeTo)', walkedOut]);

// ---------------------------------------------------------------------------
// 3. Giant-slide launch — from the roof, into the ride, out over the park.
// ---------------------------------------------------------------------------
await page.goto(`http://localhost:${port}/castle?deck=4`, { waitUntil: 'load' });
await ready();
await until(() => window.game.world.building.playerIsInside === true);
await page.waitForTimeout(4000);
await shot('4-roof-before-slide');
const boarded = await page.evaluate(() => {
  const b = window.game.world.building;
  return b.requestBoardSlide(false);
});
const leftForGarden = await until(
  () => window.game.world.building.playerIsInside === false,
);
await page.waitForTimeout(3000);
await shot('5-slide-launched');
results.push(['giant-slide launch (startGiantSlide via changeTo)', boarded && leftForGarden]);

console.log(`\n--- ${label} ---`);
for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
if (errors.length) {
  console.log(`console errors (${errors.length}):`);
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
}
await browser.close();
process.exit(results.every(([, ok]) => ok) && errors.length === 0 ? 0 : 1);
