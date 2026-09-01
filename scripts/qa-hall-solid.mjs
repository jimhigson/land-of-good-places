/**
 * Scratch browser QA for #453 — not part of the build.
 *
 *   node scripts/qa-hall-solid.mjs <port> <outDir>
 *
 * Two questions, both answered by playing rather than by reading:
 *
 *   1. Can she walk through a feast table? (She must not.)
 *   2. Can she still walk to a free place and sit down? (She must.)
 *
 * Follows `qa-great-hall-banquet.mjs`: `/castle?deck=1&at=x,z` is the only way
 * onto this storey, and a fresh `goto` per hop because a save in localStorage
 * overrides a deep link mid-session as well as at load.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '5533';
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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript((file) => {
  window.localStorage.setItem('lgp:save', JSON.stringify(file));
}, save);

/**
 * Where she is, in the **great hall's own local metres**.
 *
 * The floor's origin is x = 900 since the split, and the first draft of this
 * script compared a world x against a floor-local face and reported a perfect
 * block as a FAIL. Convert once, here, so nothing downstream can get it wrong.
 */
const HALL_ORIGIN_X = 900;
const HALL_ORIGIN_Z = 600;
const here = () =>
  page.evaluate(
    ([ox, oz]) => {
      const p = window.game?.player?.position;
      return p
        ? { x: +(p.x - ox).toFixed(3), y: +p.y.toFixed(3), z: +(p.z - oz).toFixed(3) }
        : null;
    },
    [HALL_ORIGIN_X, HALL_ORIGIN_Z],
  );

/** Land on a floor-local spot in the great hall and let the park settle. */
async function goTo(localX, localZ) {
  await page.goto(`http://localhost:${port}/castle?deck=1&at=${localX},${localZ}`, {
    waitUntil: 'load',
  });
  await page.waitForTimeout(11000);
}

/** Hold `key` for `ms`, and say how far she actually moved. */
async function hold(key, ms) {
  const before = await here();
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(400);
  const after = await here();
  return {
    before,
    after,
    dx: +(after.x - before.x).toFixed(3),
    dz: +(after.z - before.z).toFixed(3),
  };
}

// The hall's run 0 is on the axis x = 10.64 and its solid reaches x = 8.49 on
// the west face. The free places are at x = 9.09 with their stand spots at
// x = 7.64, in the 2.6 m aisle. So walking EAST from the aisle is walking at
// the bench, and she must stop at 8.49 + her own 0.62 m radius = 7.87.
const STAND = { x: 7.64, z: 4.37 };
const FACE_X = 8.49;
const MUST_STOP_BY = FACE_X - 0.62;

console.log('--- which arrow key walks her east? (measured, not assumed) ---');
await goTo(2, 4.37); // open floor, west of the banquet, nothing to bump into
const probes = {};
for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
  await goTo(2, 4.37);
  probes[key] = await hold(key, 900);
  console.log(`  ${key.padEnd(11)} dx ${probes[key].dx}  dz ${probes[key].dz}`);
}
const east = Object.entries(probes).sort((a, b) => b[1].dx - a[1].dx)[0][0];
console.log(`  => "${east}" is east.\n`);

console.log('--- 1. walk at the table from the aisle ---');
await goTo(STAND.x, STAND.z);
await page.screenshot({ path: `${outDir}/1-at-a-free-place.png` });
const walk = await hold(east, 4000);
console.log(`  from x=${walk.before.x} she walked east for 4 s and ended at x=${walk.after.x}`);
console.log(`  the bench's west face is x=${FACE_X}; her body may not pass x=${MUST_STOP_BY.toFixed(2)}`);
const blocked = walk.after.x <= MUST_STOP_BY + 0.08;
console.log(`  she covered ${walk.dx} m in 4 s; on open floor she does ~0.99 m/s`);
console.log(`  ${blocked ? 'PASS' : 'FAIL'} — she was ${blocked ? 'stopped by' : 'NOT stopped by'} the table`);
await page.screenshot({ path: `${outDir}/2-stopped-at-the-table.png` });

// And the other way: she must not be able to shove through it from the east
// side either — one approach proving solid is not the wall proving solid.
console.log('\n--- 1b. and from the other side ---');
await goTo(13.5, 4.37);
const back = await hold(
  Object.entries(probes).sort((a, b) => a[1].dx - b[1].dx)[0][0],
  4000,
);
console.log(`  from x=${back.before.x} she walked west for 4 s and ended at x=${back.after.x}`);
const eastFace = 12.79;
const mustStopBy = eastFace + 0.62;
const blockedEast = back.after.x >= mustStopBy - 0.08;
console.log(`  the bench's east face is x=${eastFace}; her body may not pass x=${mustStopBy.toFixed(2)}`);
console.log(`  ${blockedEast ? 'PASS' : 'FAIL'} — she was ${blockedEast ? 'stopped by' : 'NOT stopped by'} the table`);

console.log('\n--- 2. walk to a free place and sit ---');
await goTo(STAND.x, STAND.z);
const chips = await page.evaluate(() =>
  [...document.querySelectorAll('button, [role="button"]')]
    .map((b) => b.textContent?.trim())
    .filter(Boolean),
);
console.log(`  chips on offer: ${JSON.stringify(chips)}`);
const sit = page.getByText(/Sit down and eat/i).first();
const sawSit = (await sit.count()) > 0;
console.log(`  ${sawSit ? 'PASS' : 'FAIL'} — the "Sit down and eat" chip is ${sawSit ? '' : 'NOT '}offered`);
if (sawSit) {
  // A real click at the chip's own centre, rather than `locator.click()`:
  // the chip row animates in and Playwright's "element is stable" wait never
  // settles on it, so the click times out on a chip that is perfectly usable.
  // Keyboard 'e' does not reach the game from a fresh page either — the canvas
  // has no focus yet — and a child taps the chip anyway.
  const rect = await page.evaluate(() => {
    const label = [...document.querySelectorAll('*')].find(
      (e) => e.textContent?.trim() === 'Sit down and eat' && e.children.length === 0,
    );
    const chip = label?.closest('button') ?? label;
    const r = chip.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(rect.x, rect.y);
  await page.waitForTimeout(2500);
  const seated = await page.evaluate(
    ([ox, oz]) => ({
      riding: !!window.game?.player?.riding,
      posture: window.game?.player?.ridePosture ?? null,
      pos: window.game?.player
        ? {
            x: +(window.game.player.position.x - ox).toFixed(2),
            z: +(window.game.player.position.z - oz).toFixed(2),
          }
        : null,
    }),
    [HALL_ORIGIN_X, HALL_ORIGIN_Z],
  );
  console.log(`  after pressing it: ${JSON.stringify(seated)}`);
  // The free place is at x = 9.09; the stand spot she pressed from is 7.64. So
  // "she moved onto the seat" is a separate fact from "the posture changed".
  const onTheSeat = Math.abs(seated.pos.x - 9.09) < 0.05 && Math.abs(seated.pos.z - 4.37) < 0.05;
  console.log(
    `  ${seated.riding && seated.posture === 'dining' && onTheSeat ? 'PASS' : 'FAIL'} — ` +
      `she is on the seat (9.09, 4.37) and dining`,
  );
  await page.screenshot({ path: `${outDir}/3-sitting-at-the-feast.png` });
  const foods = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role="button"]')]
      .map((b) => b.textContent?.trim())
      .filter(Boolean),
  );
  console.log(`  chips while seated: ${JSON.stringify(foods)}`);
}

// **This browser runs the game at 0.2 fps** (swiftshader software GL, measured
// below), which is one frame every five seconds. Blocking tests survive that
// — a body stopped at exactly the right face is stopped at exactly the right
// face however few frames it took — but anything that needs a *sequence* of
// frames does not, and a jump-and-walk-off here reads as a character frozen in
// mid-air. The plate that stops the banquet being a trap is therefore proved
// by `check:hall-solid`, deterministically and by mutation, rather than here.
console.log('\n--- how fast is this browser actually running the game? ---');
{
  const fps = await page.evaluate(
    () =>
      new Promise((r) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => {
          n += 1;
          if (performance.now() - t0 < 3000) requestAnimationFrame(f);
          else r(+(n / ((performance.now() - t0) / 1000)).toFixed(1));
        };
        requestAnimationFrame(f);
      }),
  );
  console.log(`  ${fps} fps — treat any multi-frame result from this run with suspicion`);
}

console.log('\n--- 3. the pets\' table, and the hall as a whole ---');
for (const [name, at] of [
  ['4-pets-table', '8.6,10.5'],
  ['5-hall-wide', '0,8'],
  ['6-aisle-down-the-runs', '5.7,0'],
]) {
  await goTo(...at.split(','));
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`  ${name} at ${at} — ${JSON.stringify(await here())}`);
}

console.log(errors.length ? `\nCONSOLE ERRORS: ${JSON.stringify(errors, null, 2)}` : '\nNo console errors.');
await browser.close();
