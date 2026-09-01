/**
 * Tap-to-walk, A/B against `origin/main` (#419).
 *
 * The regression to fear is that "drag to look around" moved the line between a
 * tap and a not-a-tap. So: fire the **same** grid of taps at the **same** spawn
 * on both builds and compare how far she walked for each. Identical numbers
 * mean tap-to-walk is untouched; the drag row is the control that proves the
 * harness can tell the difference.
 *
 *   node qa-ab-tap.mjs <before-port> <after-port> <w> <h> <touch:0|1>
 */
import { chromium } from 'playwright-core';

const beforePort = process.argv[2] ?? '5423';
const afterPort = process.argv[3] ?? '5422';
const width = Number(process.argv[4] ?? 390);
const height = Number(process.argv[5] ?? 844);
const touch = (process.argv[6] ?? '1') === '1';

/**
 * Fractions of the viewport, so the same targets land at both sizes.
 *
 * **Read off a screenshot of this exact spawn, and they matter.** The first set
 * tried here was a symmetrical grid around the character, and every one of them
 * landed on grass across the castle wall — so she correctly walked nowhere, on
 * *both* builds, and the run looked like a clean pass while measuring nothing
 * at all. The 1.4 m and 1.1 m it reported were NPC push-apart during the settle
 * window, which is why they came out byte-identical at two different viewport
 * sizes. These four are on the sandy path she is actually standing on.
 */
const TARGETS = [
  ['path, down-left', 0.42, 0.62],
  ['path, further down-left', 0.32, 0.76],
  ['path, up-right', 0.57, 0.33],
  ['path, back to the start', 0.5, 0.47],
];

const browser = await chromium.launch();

async function run(port) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: touch,
    isMobile: touch,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[${port}] PAGE ERROR`, e.message));
  await page.goto(`http://127.0.0.1:${port}/spawn?pos=0,-18&facing=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.game, null, { timeout: 60000 });
  await page.waitForTimeout(3000);

  const client = await context.newCDPSession(page);
  /**
   * `null` when the game is not on screen — a tap can legitimately open a
   * mini-game or a panel and take `window.game` away, and on a 1440x900 desktop
   * viewport one of these targets lands on a stall. The caller treats that as
   * "she did not walk", which is the truth, rather than crashing the whole A/B
   * run half way through (which is what it did the first time).
   */
  const pos = () =>
    page.evaluate(() => {
      const g = window.game;
      if (!g?.player) return null;
      const p = g.player.position;
      return [Number(p.x.toFixed(3)), Number(p.z.toFixed(3))];
    });
  /**
   * Follows her until she has walked and then stopped, or 45 s of wall-clock
   * runs out. Not a stopwatch: the park runs at a fraction of real time under
   * load, so "six seconds" is not a number this harness can wait for.
   */
  const settle = async () => {
    const start = Date.now();
    let still = 0;
    let moving = false;
    let last = await pos();
    while (Date.now() - start < 45000) {
      await page.waitForTimeout(700);
      const now = await pos();
      if (!now || !last) return last ?? now;
      const moved = Math.hypot(now[0] - last[0], now[1] - last[1]);
      last = now;
      if (moved >= 0.02) moving = true;
      still = moved < 0.02 ? still + 1 : 0;
      if (moving && still >= 6) break;
    }
    return last;
  };

  const tap = async (x, y) => {
    if (touch) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      await page.waitForTimeout(80);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.click(x, y, { delay: 80 });
    }
  };

  const results = {};
  for (const [name, fx, fy] of TARGETS) {
    const from = await pos();
    const x = Math.round(width * fx);
    const y = Math.round(height * fy);
    // **Twice, 1.5 s apart.** GAME_DESIGN.md's SELECTION RULE: a tap that lands
    // on a thing *selects* it and goes no further, and this park is dense
    // enough that a single tap anywhere interesting hits a lamp, a rail or a
    // stall. A one-tap harness therefore measures nothing and reports zero,
    // which is exactly what the first three runs of this file did. 1.5 s is
    // well outside `DOUBLE_TAP_MAX_MILLISECONDS`, so this is select-then-walk,
    // not the double-tap "run there" gesture.
    await tap(x, y);
    await page.waitForTimeout(1500);
    await tap(x, y);
    const to = await settle();
    results[name] = to && from ? Math.hypot(to[0] - from[0], to[1] - from[1]) : NaN;
  }

  // The control: the same screen distance travelled as a drag rather than a tap.
  const dragFrom = await pos();
  const cx = Math.round(width * 0.5);
  const cy = Math.round(height * 0.45);
  const dx = Math.round(width * 0.3);
  if (touch) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: cx, y: cy }],
    });
    for (let i = 1; i <= 20; i += 1) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: cx + (dx * i) / 20, y: cy }],
      });
      await page.waitForTimeout(15);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 20; i += 1) {
      await page.mouse.move(cx + (dx * i) / 20, cy);
      await page.waitForTimeout(15);
    }
    await page.mouse.up();
  }
  const dragTo = await settle();
  results["DRAG (control)"] =
    dragTo && dragFrom ? Math.hypot(dragTo[0] - dragFrom[0], dragTo[1] - dragFrom[1]) : NaN;

  await page.close();
  await context.close();
  return results;
}

const before = await run(beforePort);
const after = await run(afterPort);
await browser.close();

const rows = Object.keys(before).map((k) => ({
  gesture: k,
  'origin/main (m)': before[k].toFixed(2),
  'this branch (m)': after[k].toFixed(2),
  same: Math.abs(before[k] - after[k]) < 0.6 ? 'yes' : 'NO',
}));
console.table(rows);
