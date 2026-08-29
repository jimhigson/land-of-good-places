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

/**
 * Where to stand, and what each shot is meant to show.
 *
 * `/castle?deck=N` (added by this branch) is the only way in: `/spawn?pos=`
 * lands on the interior's coordinates with the interior still switched off —
 * see `Building.enterCastleSpawn`.
 */
const shots = [
  { name: 'great-hall', deck: 0, note: 'ground floor, in from the door' },
  { name: 'deck-1', deck: 1, note: 'first floor' },
  { name: 'deck-2', deck: 2, note: 'second floor' },
];

for (const shot of shots) {
  const url = `http://localhost:${port}/castle?deck=${shot.deck}`;
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
