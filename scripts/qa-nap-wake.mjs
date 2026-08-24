/**
 * Scratch browser QA for the nap-wake refinement (PR #279, follow-up round):
 *
 *   1. the Z glyph rises from her head, not her middle;
 *   2. a nap has no timer any more — it must still be running well past the
 *      old fixed 2.6 s duration with no input at all;
 *   3. a tap/click wakes her;
 *   4. the jump key wakes her (checked in a second, separate nap).
 *
 * Not part of the build — a one-off, like its `qa-petbed-*` siblings.
 *
 *   npx vite --port <yours> --strictPort
 *   node scripts/qa-nap-wake.mjs <port> <outDir>
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '6142';
const outDir = process.argv[3] ?? 'qa-out-nap-wake';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(String(error)));
await page.addInitScript(() => {
  window.localStorage.clear();
});

await page.goto(`http://localhost:${port}/hotel-suite`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.game?.world?.hotel), null, { timeout: 120000 });
await page.waitForTimeout(6000);

const startNap = async (bedIndex) =>
  page.evaluate((which) => {
    const game = window.game;
    const hotel = game.world.hotel;
    const zone = hotel.interactZones().find((z) => z.id === `hotel-bed-bed-${which}`);
    if (!zone) return { ok: false, why: `no zone hotel-bed-bed-${which}` };
    game.player.teleportTo(zone.standX, 0, zone.standZ, Math.PI);
    const sleep = zone.actions?.()[0];
    if (!sleep) return { ok: false, why: 'no Sleep action offered' };
    sleep.run();
    return { ok: true, napping: hotel.isNapping };
  }, bedIndex);

// ---------------------------------------------------------------- nap one
console.log('--- nap one: Z-glyph position, no-timer, then a tap/click wake ---');
const started = await startNap(0);
console.log('started nap:', JSON.stringify(started));

await page.evaluate(() => {
  window.__zoom = setInterval(() => window.game.camera.setZoomTarget(2.4), 50);
});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/01-napping-z-glyph.png` });

// Measure the player's own Z glyph against her head, live.
const zGlyph = await page.evaluate(() => {
  const game = window.game;
  const hotel = game.world.hotel;
  hotel.hotelRoot.updateMatrixWorld(true);
  game.player.group.updateMatrixWorld(true);
  // No `THREE` global in this build — read the world position straight off
  // each object's own `matrixWorld` (translation is elements[12..14])
  // rather than constructing a `Vector3` to hand to `getWorldPosition`.
  const worldPos = (object) => {
    const element = object.matrixWorld.elements;
    return { x: element[12], y: element[13], z: element[14] };
  };
  const glyph = hotel.hotelRoot.getObjectByName('hotel.napGlyph.player');
  if (!glyph) return { ok: false, why: 'no hotel.napGlyph.player mesh found' };
  const glyphPos = worldPos(glyph);
  const headPos = worldPos(game.player.model.head);
  const feetPos = game.player.position;
  const distHead = Math.hypot(glyphPos.x - headPos.x, glyphPos.z - headPos.z);
  const distFeet = Math.hypot(glyphPos.x - feetPos.x, glyphPos.z - feetPos.z);
  return {
    ok: true,
    glyph: glyphPos,
    head: headPos,
    feet: { x: feetPos.x, y: feetPos.y, z: feetPos.z },
    distHead: Number(distHead.toFixed(3)),
    distFeet: Number(distFeet.toFixed(3)),
  };
});
console.log('Z-glyph vs head/feet:', JSON.stringify(zGlyph));
if (!zGlyph.ok) {
  console.log('FAIL:', zGlyph.why);
} else if (zGlyph.distHead > 0.3) {
  console.log(`FAIL: glyph is ${zGlyph.distHead} m from her head in plan — should be near it`);
} else {
  console.log(`PASS: glyph is only ${zGlyph.distHead} m from her head (${zGlyph.distFeet} m from her feet)`);
}

// No timer: wait well past the old fixed 2.6 s nap, with nothing touched.
console.log('waiting 6s (past the old 2.6s auto-wake) with no input at all...');
await page.waitForTimeout(6000);
const stillNapping = await page.evaluate(() => window.game.world.hotel.isNapping);
console.log('still napping after 6s of no input:', stillNapping);
if (!stillNapping) console.log('FAIL: nap ended on its own — a timer is still running somewhere');
else console.log('PASS: nap is still running with no input');
await page.screenshot({ path: `${outDir}/02-still-napping-past-old-timer.png` });

// A tap/click anywhere wakes her.
await page.mouse.click(450, 310);
await page.waitForTimeout(300);
const afterClick = await page.evaluate(() => window.game.world.hotel.isNapping);
console.log('napping after a click:', afterClick);
if (afterClick) console.log('FAIL: a click did not wake her');
else console.log('PASS: a click woke her');
await page.evaluate(() => clearInterval(window.__zoom));
await page.screenshot({ path: `${outDir}/03-awake-after-click.png` });

// ---------------------------------------------------------------- nap two
console.log('\n--- nap two: the jump key wakes her ---');
// A synthetic key press dispatched shortly after a synthetic mouse click
// (nap one's wake, above) can sit queued in Chromium/CDP's own focus
// hand-off for several hundred ms before the page ever sees it — measured
// directly (a fixed keydown, `isDown('jump')` polled every 200 ms) at
// 400-600 ms on this box. That is a test-harness artifact of stacking two
// synthetic devices back to back, not anything a real finger and a real key
// share, so this waits it out generously rather than reading `isDown` too
// early and calling a real pass a failure.
await page.waitForTimeout(2000);
const started2 = await startNap(0);
console.log('started nap 2:', JSON.stringify(started2));
await page.waitForTimeout(2000);
const nappingBeforeJump = await page.evaluate(() => window.game.world.hotel.isNapping);
console.log('napping before jump press:', nappingBeforeJump);
await page.screenshot({ path: `${outDir}/04-napping-before-jump.png` });

await page.keyboard.down('Space');
await page.waitForTimeout(1500);
const afterJump = await page.evaluate(() => window.game.world.hotel.isNapping);
console.log('napping after jump (Space):', afterJump);
if (afterJump) console.log('FAIL: jump did not wake her');
else console.log('PASS: jump woke her');
await page.keyboard.up('Space');
await page.screenshot({ path: `${outDir}/05-awake-after-jump.png` });

console.log('\nconsole errors:', errors.length === 0 ? 'none' : JSON.stringify(errors.slice(0, 8)));
await browser.close();
