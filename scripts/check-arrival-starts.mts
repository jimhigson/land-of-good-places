/**
 * **The test Jim asked for: on a slow device, does the game actually START?**
 *
 * Jim, on the deployed game (9 August 2026): *"The cat bus still doesn't work. It
 * gets to the same point and just stops forever. We need a test that the game
 * actually starts. This is a serious failure because the game is not possible to
 * start any more."*
 *
 * So this drives the **real** cold boot a new player hits — a fresh browser
 * profile, character creation, "Let's go" — under a heavy CPU throttle that
 * models a low-end tablet, and asserts two things the hollow checks never could:
 *
 * 1. **Control is handed to the player within a bounded wall-clock time.** Not "a
 *    flag was set", not "the director's booleans are wired" — the park's own HUD
 *    is on screen and `#ui-root` is visible again, which only happens in
 *    `finishLaunch` after `readyToHandOver`. If it does not happen inside the
 *    ceiling, the test fails — which is exactly what today's `main` does under
 *    throttle (it idles at the gate far past any ceiling).
 * 2. **The player can move.** After hand-over the throttle is lifted and a
 *    movement key is held; the player's world position must change. A game that
 *    "starts" but cannot be walked has not started.
 *
 * A **real park is generated** the whole time — this boots the actual `main.ts`
 * ride loop, which slices `ParkGeneration` behind the bus. Nothing here feeds the
 * director a `noteParkReady()`; the park is built because the generation finished.
 *
 * ## Run it
 *
 *   node --experimental-transform-types --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/check-arrival-starts.mts
 *
 *   ARRIVAL_URL       dev server to drive (default http://127.0.0.1:5173). A dev
 *                     build is used so `window.game` is exposed for the movement
 *                     read; the boot path and budget policy are identical to
 *                     production (only debug hooks differ), and the bug is not
 *                     production-only. Production coverage is the screenshots in
 *                     the PR.
 *   ARRIVAL_THROTTLE  CPU slowdown multiplier (default 6 — a low-end tablet).
 *   ARRIVAL_CEILING_S wall-clock seconds to reach playable (default 75).
 *
 * Needs a Chromium install (`channel: 'chromium'`, real GPU — the default headless
 * SwiftShader makes every timing meaningless). `npx playwright install chromium`.
 *
 * **Proven red on today's `main`**: run it against a `main` dev server and it
 * times out at the ceiling with the bus still parked. Green on this branch. The
 * ceiling is generous on purpose — the fix makes the wait *bounded*, not *short*,
 * on a genuinely slow device (see the PR's measured numbers); this guards that
 * the game becomes startable at all, which is the failure that shipped.
 */
import { chromium } from 'playwright-core';

const URL = process.env.ARRIVAL_URL ?? 'http://127.0.0.1:5173/';
const THROTTLE = Number(process.env.ARRIVAL_THROTTLE ?? 6);
const CEILING_S = Number(process.env.ARRIVAL_CEILING_S ?? 75);
const SHOT_DIR = process.env.ARRIVAL_SHOTS ?? '/tmp/arrival-starts';

const fouls: string[] = [];
const said: string[] = [];

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const context = await browser.newContext({ viewport: { width: 900, height: 650 } });
const page = await context.newPage();
const pageErrors: string[] = [];
page.on('pageerror', (e) => pageErrors.push(String((e as Error)?.stack ?? e)));

await page.goto(URL, { waitUntil: 'domcontentloaded' });

const cdp = await context.newCDPSession(page);
// Wait for the app to settle on character creation before touching the page —
// the boot does its own work first, and evaluating mid-settle races a navigation.
await page.waitForSelector('.charcreate-go', { timeout: 30000 });

// **Real GPU or nothing.** Default headless Chromium is SwiftShader, on which the
// park runs at 1-2 fps and every wall-clock number below is a lie.
const renderer = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
});
said.push(`GPU: ${renderer}`);
if (/SwiftShader|llvmpipe|software/i.test(renderer)) {
  fouls.push(`headless is on ${renderer} — a software rasteriser. Timings are meaningless; needs channel:'chromium'.`);
}

// The slow device switches on the moment she presses "Let's go" — the boot she
// actually experiences.
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
await page.click('.charcreate-go');
const t0 = Date.now();

const state = () =>
  page.evaluate(() => {
    const root = document.querySelector('#ui-root');
    const uiVisible = root ? getComputedStyle(root).visibility !== 'hidden' : null;
    const hud = !!document.querySelector('.hud-bar');
    const parked = !!document.querySelector('.journey-wait--busy');
    const g = (window as unknown as { game?: { player?: { position?: { x: number; z: number } } } }).game;
    const pos = g?.player?.position ? { x: g.player.position.x, z: g.player.position.z } : null;
    return { uiVisible, hud, parked, hasGame: !!g, pos };
  });

let sawHidden = false; // park build hides #ui-root
let everParked = false; // the loading caption appeared
let shot = 0;
let handedOverAt: number | null = null;
const ceilingMs = CEILING_S * 1000;

await page.screenshot({ path: `${SHOT_DIR}/00-charcreate.png` }).catch(() => {});

while (Date.now() - t0 < ceilingMs) {
  await page.waitForTimeout(1000);
  let s;
  try {
    s = await state();
  } catch {
    continue;
  }
  const secs = (Date.now() - t0) / 1000;
  if (s.uiVisible === false) sawHidden = true;
  if (s.parked && !everParked) {
    everParked = true;
    await page.screenshot({ path: `${SHOT_DIR}/10-loading-parked.png` }).catch(() => {});
  }
  // Hand-over: park HUD present and `#ui-root` visible again after the build hid
  // it — the real `finishLaunch` result, reachable only through readyToHandOver.
  if (sawHidden && s.uiVisible === true && s.hud) {
    handedOverAt = secs;
    break;
  }
  if (secs % 10 < 1.1) said.push(`  t+${secs.toFixed(0)}s parked=${s.parked} uiVisible=${s.uiVisible} hud=${s.hud}`);
}

if (handedOverAt === null) {
  fouls.push(
    `the game never became playable within ${CEILING_S}s at ${THROTTLE}x CPU throttle — the bus is ` +
      'still parked at the gate. This is the "gets to the same point and stops forever" Jim reported.',
  );
} else {
  said.push(`HANDED OVER: playable at ${handedOverAt.toFixed(1)}s (ceiling ${CEILING_S}s, ${THROTTLE}x throttle)`);

  // ---- and she can actually walk. Lift the throttle so movement is quick. ----
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.waitForTimeout(1500); // let any settle-in camera finish
  const before = await state();
  await page.screenshot({ path: `${SHOT_DIR}/20-playable.png` }).catch(() => {});
  if (!before.hasGame || !before.pos) {
    said.push('  (no window.game — skipping the movement read; run against a dev build for it)');
  } else {
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(1600);
    await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(300);
    const after = await state();
    await page.screenshot({ path: `${SHOT_DIR}/30-after-walk.png` }).catch(() => {});
    const moved =
      after.pos && before.pos
        ? Math.hypot(after.pos.x - before.pos.x, after.pos.z - before.pos.z)
        : 0;
    said.push(
      `player moved ${moved.toFixed(2)} m on ArrowUp (from ${before.pos.x.toFixed(1)},${before.pos.z.toFixed(1)} ` +
        `to ${after.pos?.x.toFixed(1)},${after.pos?.z.toFixed(1)})`,
    );
    if (moved < 0.3) {
      fouls.push(`the player barely moved (${moved.toFixed(2)} m) when a movement key was held — the game started but cannot be played`);
    }
  }
}

if (pageErrors.length > 0) {
  said.push(`page errors: ${pageErrors.length}`);
  for (const e of pageErrors.slice(0, 3)) said.push(`  ${e.split('\n').slice(0, 2).join(' | ')}`);
}

await browser.close();

for (const line of said) console.log(line.startsWith('  ') ? line : `  ${line}`);
if (fouls.length > 0) {
  console.error('\ncheck:arrival-starts FAILED');
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('\ncheck:arrival-starts passed');
