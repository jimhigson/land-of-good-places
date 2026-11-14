// A save made indoors still restores: into the hotel lobby through its door
// code, let the autosave run, reload the plain root with the same profile,
// press "keep playing", and see where she is — then walk her out and see the
// park drawn again.
//
//   node docs/perf/undrawn-indoors/save-indoors.mjs <base> <outDir>
//   READ_MS=0     press "keep playing" the moment it appears (default 6000)
//   ARRIVED=1     mark the save as having arrived by bus before the reload
//
// **Why ARRIVED exists.** The profile is made by `/spawn`, which skips the cat
// bus — so its save says `arrivedByBus: false`, which no real player's save
// ever says once she has walked anywhere (the arrival is the only thing that
// sets it, and it plays before she can reach a door). A continue on such a
// save plays the arrival (`main.ts`: `arrivalIsDue()`), and the arrival puts
// her in the bus at the gate whatever her saved place says. Without ARRIVED
// this probe measures that, not the indoor restore; with it, it measures what
// a real player's save does. Both are printed, so either can be compared
// between builds.
//
// Needs `window.game` (a dev server). One persistent profile, thrown away after.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const [base, outDir] = process.argv.slice(2);
const READ_MS = Number(process.env.READ_MS ?? 6000);
const ARRIVED = process.env.ARRIVED === '1';
fs.mkdirSync(outDir, { recursive: true });
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lgp-save-indoors-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME, headless: true, args: ['--mute-audio'], viewport: { width: 1280, height: 800 }, serviceWorkers: 'block',
  timeout: 600_000, // a Mac loaded by other work can take minutes to start a browser
});
const ready = async (page) => {
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    if (await page.evaluate(() => Boolean(window.game?.world)).catch(() => false)) return;
  }
  throw new Error('the game never came up');
};
const where = (page) => page.evaluate(() => {
  const g = window.game; const w = g.world; const p = g.player.position;
  return {
    x: Number(p.x.toFixed(1)), y: Number(p.y.toFixed(1)), z: Number(p.z.toFixed(1)),
    parkAttached: w.parkRoot ? w.parkRoot.parent !== null : null, parkDrawn: w.parkDrawn ?? null,
    hotelInside: w.hotel.playerIsInside, hotelFurnished: w.hotel.furnished, arrival: w.entrance.arrival !== null,
  };
});
// A screenshot is evidence, not the measurement: on a loaded Mac one can take
// minutes, so it gets a long timeout and a failure is recorded, not thrown.
const shots = [];
const shot = (page, file) =>
  page.screenshot({ path: `${outDir}/${file}`, timeout: 180_000 }).then(
    () => shots.push(file),
    (e) => shots.push(`${file}: ${String(e.message).split('\n')[0]}`),
  );
const savedFile = (page) => page.evaluate(() => {
  const raw = localStorage.getItem('lgp:save');
  if (!raw) return null;
  const f = JSON.parse(raw);
  return { place: f.place ?? null, arrivedByBus: f.flags?.arrivedByBus ?? null };
});
try {
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await page.goto(`${base}/spawn`, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await sleep(4000);
  await page.evaluate(() => { const g = window.game; const h = g.world.hotel; g.player.teleportTo(h.entranceX, g.player.position.y, h.entranceZ, 0); });
  await sleep(1000);
  const entered = await page.evaluate(() => window.game.world.hotel.requestEnterLobby());
  await sleep(12000); // two autosaves
  const savedFrom = await where(page);
  await shot(page, '1-lobby-before-reload.png');
  // Leave the page (its `pagehide` flush writes the last word), then read the
  // save from a same-origin page that runs nothing: a source file the dev
  // server sends as text (any page path would boot the game again).
  await page.goto('about:blank');
  await page.goto(`${base}/src/bootstrap.ts`);
  if (ARRIVED) {
    await page.evaluate(() => {
      const f = JSON.parse(localStorage.getItem('lgp:save'));
      f.flags.arrivedByBus = true;
      localStorage.setItem('lgp:save', JSON.stringify(f));
    });
  }
  const save = await savedFile(page);
  // The plain root, same profile: the welcome-back prompt, then "keep playing".
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  const keep = page.locator('button.welcome-keep');
  await keep.waitFor({ state: 'visible', timeout: 60000 });
  await sleep(READ_MS);
  await keep.click();
  await ready(page);
  await sleep(6000);
  const restored = await where(page);
  await shot(page, '2-restored.png');
  // Out through the lobby's own way out.
  const left = await page.evaluate(() => { const i = window.game.world.hotel.interior; if (!i || !window.game.world.hotel.playerIsInside) return false; i.spaces.changeTo(() => i.leaveToPark()); return true; });
  await sleep(3000);
  const outside = await where(page);
  await shot(page, '3-out-in-the-park.png');
  console.log(JSON.stringify({ base, READ_MS, ARRIVED, entered, savedFrom, save, restored, left, outside, errors, shots }));
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
