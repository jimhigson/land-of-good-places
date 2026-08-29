/**
 * Scratch browser QA for #364's cat bus — not part of the build.
 *
 *   node scripts/qa-cat-bus-364.mjs <port> <outDir>
 *
 * Seeds a save that has a character but has **not yet arrived by bus**, so the
 * arrival sequence plays on load: the cat bus drives in, stops at the kerb,
 * lets twelve children off and drives away again. That is the only place a
 * player ever sees this vehicle, so it is where the doubled wheels, the tiger
 * stripes and the suspension bob have to be judged.
 *
 * Captures the **viewport**, not an element — a 3D scene has no element to
 * frame, and framing what the player sees is the whole point.
 *
 * Two kinds of capture:
 *
 *  - stills across the whole arrival, for the wheels and the stripes;
 *  - a dense burst while the bus is driving, because **a still cannot show a
 *    bob.** Consecutive frames 120 ms apart are the closest thing to a video
 *    this harness can hand over.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '5364';
const outDir = process.argv[3] ?? 'qa-out';
mkdirSync(outDir, { recursive: true });

const save = {
  v: 1,
  at: Date.now(),
  purchases: 0,
  game: {
    parkName: 'Land of Good Places',
    mode: 'sandbox',
    money: 100,
    player: { name: 'Eleri' },
    world: { timeOfDay: 660, dayCount: 0, lightsOn: false },
    inventory: [],
    carriedUid: null,
  },
  // The character exists, so there is no creator to click through; the bus has
  // not been ridden, so `ArrivalSequence` owns the spawn and plays.
  flags: { createdCharacter: true, arrivedByBus: false },
};

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (message) => {
  if (message.type() === 'error') console.log(`  page error: ${message.text()}`);
});

await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate((seeded) => {
  localStorage.setItem('lgp:save', JSON.stringify(seeded));
}, save);
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });

// A save with a character in it gets the welcome-back prompt, so press it —
// this is a returning player who has not yet ridden the bus, which is exactly
// the state the arrival plays in.
const keepPlaying = page.getByText('Keep playing!');
await keepPlaying.waitFor({ timeout: 120_000 });
await keepPlaying.click();

// Wait for the park to finish generating and the first real frame to land.
await page.waitForFunction(
  () => {
    const canvas = document.getElementById('game-canvas');
    return canvas instanceof HTMLCanvasElement && canvas.clientWidth > 0
      && document.querySelector('.boot-splash:not(.hidden)') === null;
  },
  { timeout: 240_000 },
);
// The park generates for a few seconds behind a backdrop; wait for the HUD,
// which only exists once the World does and the arrival is running.
await page.waitForTimeout(3000);
console.log('park booted');

const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`  ${name}.png`);
};

// Stills across the arrival. The bus drives in over the first several seconds,
// stops, unloads for about twelve, then pulls away.
const started = Date.now();
const stills = [1.2, 2.2, 3.2, 4.4, 6.0, 8.0, 10.0, 13.0, 16.0, 19.0, 21.0, 23.0, 25.0];
let index = 0;
for (const at of stills) {
  const wait = started + at * 1000 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  await shot(`arrival-${String(index).padStart(2, '0')}-t${at.toFixed(1)}s`);
  index += 1;
}

// The burst. Fired while the bus is pulling away, which is the longest
// uninterrupted stretch of it moving on screen.
for (let frame = 0; frame < 10; frame += 1) {
  await shot(`bob-${String(frame).padStart(2, '0')}`);
  await page.waitForTimeout(120);
}

await browser.close();
console.log(`\nwrote to ${outDir}/`);
