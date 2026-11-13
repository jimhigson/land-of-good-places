// Coming back out: does the park carry on from where she left it, with nothing
// teleporting, piling up or popping? Real door code, real frames.
//
//   node docs/perf/undrawn-indoors/come-back.mjs <base> <outDir> [indoorSeconds=20]
//
// Needs `window.game` (a dev server). Stands her in the park, walks her into
// the hotel through its own door code (`requestEnterLobby`), waits, then out
// through the lobby's own way out (`leaveToPark`, behind the iris), and
// records, for every child of the crowd, where she was the frame before the
// hotel and every frame for two seconds after: the largest single-frame step
// says whether anybody jumped, the closest pair whether anybody piled up.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const [base, outDir, indoorS = '20'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await page.goto(`${base}/spawn?seed=5`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    if (await page.evaluate(() => Boolean(window.game?.world)).catch(() => false)) break;
  }
  await sleep(8000);
  // A recorder that runs every frame from now on.
  await page.evaluate(() => {
    const w = window.game.world;
    const rec = { frames: [], on: false };
    window.__rec = rec;
    const kids = () => w.npcs.all.filter((c) => c.driver?.constructor?.name !== 'WaypointDriver');
    const sample = () => {
      if (rec.on) rec.frames.push({ t: performance.now(), parkAttached: w.parkRoot ? w.parkRoot.parent !== null : w.player === undefined || true, train: w.train.distance, kids: kids().map((c) => [c.position.x, c.position.z]) });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const hotelAt = await page.evaluate(() => { const h = window.game.world.hotel; return [h.entranceX, h.entranceZ]; });
  // In through the door code, from the doormat.
  await page.evaluate(() => { const g = window.game; const h = g.world.hotel; g.player.teleportTo(h.entranceX, g.player.position.y, h.entranceZ, 0); });
  await sleep(1500);
  await page.screenshot({ path: `${outDir}/1-park-before.png` });
  const before = await page.evaluate(() => ({ train: window.game.world.train.distance, kids: window.game.world.npcs.all.map((c) => [c.position.x, c.position.z]) }));
  const entered = await page.evaluate(() => window.game.world.hotel.requestEnterLobby());
  await sleep(3000);
  await page.screenshot({ path: `${outDir}/2-lobby.png` });
  const inside = await page.evaluate(() => ({ attached: window.game.world.parkRoot ? window.game.world.parkRoot.parent !== null : true, train: window.game.world.train.distance, kids: window.game.world.npcs.all.map((c) => [c.position.x, c.position.z]) }));
  await sleep(Number(indoorS) * 1000);
  const stillInside = await page.evaluate(() => ({ train: window.game.world.train.distance, kids: window.game.world.npcs.all.map((c) => [c.position.x, c.position.z]) }));
  // Out through the lobby's own way out, behind its iris.
  await page.evaluate(() => { window.__rec.on = true; const i = window.game.world.hotel.interior; i.spaces.changeTo(() => i.leaveToPark()); });
  await sleep(2500);
  await page.screenshot({ path: `${outDir}/3-park-after.png` });
  const rec = await page.evaluate(() => { window.__rec.on = false; return window.__rec.frames; });
  // Analysis.
  const back = rec.filter((f) => f.parkAttached);
  let worstStep = 0;
  for (let i = 1; i < back.length; i++) {
    const a = back[i - 1].kids, b = back[i].kids;
    for (let k = 0; k < Math.min(a.length, b.length); k++) worstStep = Math.max(worstStep, Math.hypot(b[k][0] - a[k][0], b[k][1] - a[k][1]));
  }
  const closest = (kids) => { let m = Infinity; for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) m = Math.min(m, Math.hypot(kids[i][0] - kids[j][0], kids[i][1] - kids[j][1])); return m; };
  const movedIndoors = inside.kids.reduce((n, k, i) => n + (Math.hypot(k[0] - stillInside.kids[i][0], k[1] - stillInside.kids[i][1]) > 0.01 ? 1 : 0), 0);
  const firstBack = back[0];
  const resumed = back.length > 1 ? back.at(-1).kids.reduce((n, k, i) => n + (Math.hypot(k[0] - firstBack.kids[i][0], k[1] - firstBack.kids[i][1]) > 0.05 ? 1 : 0), 0) : 0;
  console.log(JSON.stringify({
    hotelAt, entered, parkAttachedInLobby: inside.attached,
    trainBefore: before.train, trainInLobby: inside.train, trainAfterStay: stillInside.train, trainAtEnd: back.at(-1)?.train,
    kids: before.kids.length, kidsThatMovedWhileSheWasIn: movedIndoors,
    framesBack: back.length, worstSingleFrameStepBack: Number(worstStep.toFixed(3)),
    kidsMovingWithin2sBack: resumed, closestPairBefore: Number(closest(before.kids).toFixed(2)), closestPairBack: Number(closest(back.at(-1)?.kids ?? []).toFixed(2)),
    errors,
  }));
} finally {
  await browser.close();
}
