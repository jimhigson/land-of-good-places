// A save made indoors still restores: into the hotel lobby through its door
// code, let the autosave run, reload the plain root with the same profile,
// press "keep playing", and see where she is — then walk her out and see the
// park drawn again.
//
//   node docs/perf/undrawn-indoors/save-indoors.mjs <base> <outDir>
//
// Needs `window.game` (a dev server). One persistent profile, thrown away after.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lgp-save-indoors-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME, headless: true, args: ['--mute-audio'], viewport: { width: 1280, height: 800 }, serviceWorkers: 'block',
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
  return { x: Number(p.x.toFixed(1)), z: Number(p.z.toFixed(1)), parkAttached: w.parkRoot ? w.parkRoot.parent !== null : null, parkDrawn: w.parkDrawn ?? null, hotelInside: w.hotel.playerIsInside, hotelFurnished: w.hotel.furnished, saved: localStorage.length };
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
  await page.screenshot({ path: `${outDir}/1-lobby-before-reload.png` });
  // The plain root, same profile: the welcome-back prompt, then "keep playing".
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  const keep = page.locator('button.welcome-keep');
  await keep.waitFor({ state: 'visible', timeout: 60000 });
  // A child reads the panel before she presses it; the park file arrives meanwhile.
  await sleep(Number(process.env.READ_MS ?? 6000));
  await keep.click();
  await ready(page);
  await sleep(6000);
  const restored = await where(page);
  await page.screenshot({ path: `${outDir}/2-restored.png` });
  // Out through the lobby's own way out.
  const left = await page.evaluate(() => { const i = window.game.world.hotel.interior; if (!i) return false; i.spaces.changeTo(() => i.leaveToPark()); return true; });
  await sleep(3000);
  const outside = await where(page);
  await page.screenshot({ path: `${outDir}/3-out-in-the-park.png` });
  console.log(JSON.stringify({ entered, savedFrom, restored, left, outside, errors }));
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
