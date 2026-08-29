/**
 * Scratch browser QA for the castle interior (#363) — not part of the build.
 *
 *   node scripts/qa-castle-interior.mjs <port> <outDir>
 *
 * Runs the **production build** in a real headless browser, stands the player
 * on the castle's ground floor, and photographs the room from a few angles so
 * Jim can see the fabric arriving rather than read a description of it.
 *
 * The interior lives at `INTERIOR_ORIGIN_X/Z` = (600, 600) with deck 0's
 * walking surface at `BUILDING_BASE_Y`. `/spawn` is given the **three-number**
 * `pos=x,y,z` form on purpose: the two-number form samples the terrain under
 * the coordinate, and the terrain under the interior is the plaza disc a metre
 * *below* the deck, so a two-number spawn would drop the player through her
 * own floor. CLAUDE.md names this case exactly — "for a deck, a bridge, a
 * castle floor".
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '5463';
const outDir = process.argv[3] ?? 'qa-out';
mkdirSync(outDir, { recursive: true });

const CHROME =
  process.env.QA_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/` +
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

/** Deck 0's walking surface — `layout.ts`'s `BUILDING_BASE_Y`. */
const DECK0_Y = 0.7284378351569356;
const OX = 600;
const OZ = 600;

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

/** Where to stand, and what each shot is meant to show. */
const shots = [
  { name: 'great-hall', x: OX, z: OZ + 14, facing: 0, note: 'in from the front door' },
  { name: 'floor-and-wall', x: OX - 20, z: OZ - 14, facing: 135, note: 'north-west corner' },
  { name: 'ceiling-beams', x: OX + 16, z: OZ + 4, facing: 250, note: 'east side, up the hall' },
  { name: 'deck-1', x: OX, z: OZ, facing: 0, note: 'first floor', deck: 1 },
];

for (const shot of shots) {
  const y = DECK0_Y + (shot.deck ?? 0) * 3.6;
  const url =
    `http://localhost:${port}/spawn` +
    `?pos=${shot.x},${y.toFixed(3)},${shot.z}&facing=${shot.facing}`;
  await page.goto(url, { waitUntil: 'load' });
  // The park generates through a dozen lazy imports; give it time to settle
  // rather than photographing a half-built room and reporting it as the room.
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${outDir}/castle-${shot.name}.png` });
  console.log(`${shot.name.padEnd(16)} ${shot.note.padEnd(24)} ${url}`);
}

if (errors.length) {
  console.log(`\n${errors.length} console error(s):`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
}

await browser.close();
console.log(`\nwrote ${shots.length} shots to ${outDir}/`);
