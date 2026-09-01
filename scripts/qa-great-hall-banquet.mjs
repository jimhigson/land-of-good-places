/**
 * Scratch browser QA for the great hall's banquet (#413) — not part of the build.
 *
 *   node scripts/qa-great-hall-banquet.mjs <port> <outDir>
 *
 * Walks in through the door the way a child does — out of the lift, which since
 * #377 is the only way onto this storey — and photographs the hall at player
 * height. `/castle?deck=1&at=x,z` is the only way in; see qa-castle-interior.mjs.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '5416';
const outDir = process.argv[3] ?? 'qa-out';
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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript((file) => {
  window.localStorage.setItem('lgp:save', JSON.stringify(file));
}, save);

// The hall's axis is x = 10.64; the table runs z -9.83..+8.17; the fireplace is
// at x = -9.9 on the north wall; the lift door is on the east wall at z = 5.
const shots = [
  { name: '1-lift-arrival', at: '18,5', note: 'stepping out of the lift — first sight of the hall' },
  { name: '2-walking-in', at: '14,2', note: 'walking in, the table ahead' },
  { name: '3-table-south-end', at: '10.6,10', note: 'at the foot of the table, looking up it' },
  { name: '4-among-diners', at: '13.6,-3', note: 'right beside the children eating' },
  { name: '5-table-middle', at: '10.6,0', note: 'the middle of the banquet' },
  { name: '6-throne-end', at: '10.6,-10.5', note: 'the head of the table, under the throne' },
  { name: '7-fireplace', at: '-9.9,-10', note: 'in front of the fireplace' },
  { name: '8-hall-wide', at: '0,8', note: 'the hall as a whole' },
];

for (const shot of shots) {
  await page.goto(`http://localhost:${port}/castle?deck=1&at=${shot.at}`, { waitUntil: 'load' });
  await page.waitForTimeout(11000);
  await page.screenshot({ path: `${outDir}/${shot.name}.png` });
  const stats = await page.evaluate(() => {
    const g = window.game;
    const r = g?.renderer?.info?.render;
    return {
      href: document.location.href,
      pos: g?.player ? [ +g.player.position.x.toFixed(1), +g.player.position.y.toFixed(1), +g.player.position.z.toFixed(1) ] : null,
      calls: r?.calls ?? null,
      tris: r?.triangles ?? null,
    };
  }).catch(() => ({}));
  console.log(`${shot.name.padEnd(18)} ${shot.note.padEnd(42)} ${JSON.stringify(stats)}`);
}

if (errors.length) {
  console.log(`\n${errors.length} console error(s):`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
} else {
  console.log('\nconsole clean');
}
await browser.close();
console.log(`wrote ${shots.length} shots to ${outDir}/`);
