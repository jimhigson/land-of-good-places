/**
 * Scratch browser QA for the castle interior (#363) — not part of the build.
 *
 *   node scripts/qa-castle-interior.mjs <port> <outDir>
 *
 * Runs the **production build** in a real headless browser, stands the player
 * inside the castle, and photographs the room storey by storey so Jim can see
 * the work arriving rather than read a description of it.
 *
 * `/castle?deck=N` (added on this branch) is the only way in. `/spawn?pos=`
 * cannot do it: the interior's coordinates are fixed and perfectly typeable,
 * but being inside the castle is a *space*, not a position — `interiorRoot` is
 * hidden and the play bounds are the garden's — so a spawn at (600, 0.73, 600)
 * photographs an empty sky. See `Building.enterCastleSpawn`.
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

/**
 * Which storey each shot is of, and what it is meant to show.
 *
 * `at` is `/castle?at=x,z` — where to stand on that storey, added with batch
 * 1's furniture (#368) because the great hall is 20 m from the door and a shot
 * of the door is not a shot of the throne.
 */
const shots = [
  { name: 'great-hall', deck: 0, note: 'ground floor, in from the door' },
  { name: 'hall-approach', deck: 0, at: '10,-2', note: 'looking up the hall at the throne' },
  { name: 'hall-feast', deck: 0, at: '10,-5.5', note: 'at the feast table' },
  { name: 'hall-table-reach', deck: 0, at: '12.5,-9', note: 'beside the table, child eye height' },
  { name: 'hall-throne', deck: 0, at: '10,-15', note: 'at the foot of the dais' },
  { name: 'hall-armour', deck: 0, at: '5,-14', note: 'the knight on his plinth' },
  { name: 'hall-fireside', deck: 0, at: '-14,-16', note: 'the bench by the hearth' },
  { name: 'deck-1', deck: 1, note: 'first floor' },
  { name: 'deck-2', deck: 2, note: 'second floor' },
];

for (const shot of shots) {
  const url =
    `http://localhost:${port}/castle?deck=${shot.deck}` + (shot.at ? `&at=${shot.at}` : '');
  await page.goto(url, { waitUntil: 'load' });
  // The park generates through a dozen lazy imports, and the door transition
  // irises; give it time rather than photographing a half-built room and
  // reporting it as the room.
  await page.waitForTimeout(11000);
  await page.screenshot({ path: `${outDir}/castle-${shot.name}.png` });
  console.log(`${shot.name.padEnd(14)} ${shot.note.padEnd(28)} ${url}`);
}

if (errors.length) {
  console.log(`\n${errors.length} console error(s):`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
}

await browser.close();
console.log(`\nwrote ${shots.length} shots to ${outDir}/`);
