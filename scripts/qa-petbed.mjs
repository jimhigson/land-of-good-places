/**
 * Scratch browser QA for PR #279's pet beds — not part of the build.
 *
 *   node scripts/qa-petbed.mjs <port> <outDir> [bedIndex]
 *
 * Seeds a save with two real pets (so `Hotel` snapshots them at construction),
 * opens `/hotel-suite`, stands her at a bed, presses "Have a sleep", and samples
 * the live scene **every animation frame** through the whole transition — one
 * row per frame per pet: is it drawn, where is it, which model is it, and how
 * far through its bedtime routine.
 *
 * It samples until the nap actually ends rather than for a fixed wall-clock
 * window. `MAX_FRAME_DELTA` (1/12 s) clamps every frame, so a 2.6 s nap is
 * always **at least 32 rendered frames** however slowly this box happens to be
 * painting — which is what makes "no flicker across the transition" a real
 * measurement here and not a stopwatch race (a previous round's QA lost this
 * on a loaded box and had to give up on it).
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '6137';
const cam = (process.argv[5] ?? '2.1,1.9,2.4').split(',').map(Number);
const outDir = process.argv[3] ?? 'qa-out';
const bedIndex = process.argv[4] ?? '0';
mkdirSync(outDir, { recursive: true });

const now = { day: 0, minutes: 600 };
const pet = (uid, id, displayName, icon) => ({
  uid,
  id,
  kind: 'pet',
  displayName,
  icon,
  category: 'pet',
  shopId: 'stickerPet',
  acquiredAt: now,
  carryable: true,
  paradeable: true,
  stowed: false,
});

const save = {
  v: 1,
  at: Date.now(),
  purchases: 2,
  game: {
    parkName: 'QA Park',
    mode: 'sandbox',
    money: 500,
    player: { name: 'Eleri' },
    world: { timeOfDay: 600, dayCount: 0, lightsOn: false },
    inventory: [
      pet('pet.bunny#1', 'pet.bunny', 'Little Bunny', '🐰'),
      pet('pet.kitten#2', 'pet.kitten', 'Little Kitten', '🐱'),
    ],
    carriedUid: null,
  },
  flags: { createdCharacter: true, arrivedByBus: true, hotelKey: true, dexPrizeSeen: true },
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1234/chrome-linux64/chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(String(error)));
await page.addInitScript((file) => {
  window.localStorage.setItem('lgp:save', JSON.stringify(file));
}, save);
await page.addInitScript((o) => {
  window.__camOffset = o;
}, { dx: cam[0], dy: cam[1], dz: cam[2] });

await page.goto(`http://localhost:${port}/hotel-suite`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.game?.world?.hotel), null, { timeout: 120000 });
await page.waitForTimeout(6000);

console.log('pet beds as built:');
for (const bed of await page.evaluate(() =>
  window.game.world.hotel.petBeds.map((b) => ({
    uid: b.uid,
    bedIndex: b.bedIndex,
    worldX: Number(b.worldX.toFixed(2)),
    worldZ: Number(b.worldZ.toFixed(2)),
    asleep: b.asleep,
  })),
)) {
  console.log(' ', JSON.stringify(bed));
}

// Stand her at the chosen bed and let the parade catch up, so both pets start
// their walk a genuine stride away rather than already on the spot.
const stood = await page.evaluate((which) => {
  const game = window.game;
  const zone = game.world.hotel.interactZones().find((z) => z.id === `hotel-bed-bed-${which}`);
  if (!zone) return { ok: false, why: `no zone hotel-bed-bed-${which}` };
  game.player.teleportTo(zone.standX, 0, zone.standZ, Math.PI);
  return { ok: true, zone: zone.id, x: zone.standX, z: zone.standZ };
}, bedIndex);
console.log('standing at:', JSON.stringify(stood));
// Zoom in before the nap so the pet beds are actually legible in the frame —
// the default framing is built around a child, and this shot is about a bunny.
await page.evaluate(() => {
  window.__zoom = setInterval(() => window.game.camera.setZoomTarget(2.6), 50);
});
await page.waitForTimeout(8000);
await page.screenshot({ path: `${outDir}/01-before-nap-two-pets-in-parade.png` });

// Start a sampler in the page that records EVERY animation frame, then press
// "Have a sleep" — and come back to Node so screenshots can be taken *while*
// the pets are in their beds rather than only after.
await page.evaluate((which) => {
  const game = window.game;
  const hotel = game.world.hotel;
  const parade = game.parade;
  const uids = ['pet.bunny#1', 'pet.kitten#2'];
  const rows = [];
  window.__trace = rows;
  const sample = () => {
    const napping = hotel.isNapping;
    rows.push({
      napping,
      pets: uids.map((uid) => {
        const s = parade.petState(uid);
        if (!s) return null;
        return {
          v: s.visible,
          id: s.itemId,
          p: s.bedPhase,
          x: Number(s.x.toFixed(3)),
          y: Number(s.y.toFixed(3)),
          z: Number(s.z.toFixed(3)),
        };
      }),
      asleep: hotel.petBeds.filter((b) => b.asleep).length,
    });
    if (rows.length > 4 && !napping) {
      window.__traceDone = true;
      return;
    }
    if (rows.length > 900) {
      window.__traceDone = true;
      return;
    }
    requestAnimationFrame(sample);
  };
  const zone = hotel.interactZones().find((z) => z.id === `hotel-bed-bed-${which}`);
  const sleep = zone?.actions?.()[0];
  if (!sleep) {
    window.__traceDone = true;
    window.__traceWhy = 'no sleep action offered';
    return;
  }
  sleep.run();
  requestAnimationFrame(sample);
}, bedIndex);

// Catch the moment both pets are actually in their beds, on a real frame.
let shot = false;
let midShot = false;
const deadline = Date.now() + 240000;
while (Date.now() < deadline) {
  const state = await page.evaluate(() => ({
    done: Boolean(window.__traceDone),
    frames: (window.__trace ?? []).length,
    asleep: (window.__trace ?? []).at(-1)?.asleep ?? 0,
  }));
  if (!midShot && state.frames > 0 && state.asleep === 0) {
    midShot = true;
    await page.screenshot({ path: `${outDir}/02-pet-on-its-way-to-bed.png` });
    console.log(`screenshot of a pet still on its way taken at frame ${state.frames}`);
  }
  if (!shot && state.asleep >= 2) {
    shot = true;
    await page.screenshot({ path: `${outDir}/02-both-pets-asleep-in-bed.png` });
    console.log(`screenshot of both pets asleep taken at frame ${state.frames}`);
    // Freeze the park exactly here and put a free camera on the pet beds — the
    // game's own `/view` mechanism (`Game.enterDebugView` with a `timeOfDay`,
    // which is what pauses), so the fit can be judged by eye and not only off
    // the numbers. A 2.6 s nap is far too short to line a shot up in on a box
    // this slow.
    await page.evaluate(() => {
      const game = window.game;
      const beds = game.world.hotel.petBeds.filter((b) => b.asleep);
      const x = beds.reduce((sum, b) => sum + b.worldX, 0) / beds.length;
      const z = beds.reduce((sum, b) => sum + b.worldZ, 0) / beds.length;
      const at = { x, y: 0.55, z, isVector3: true };
      const o = window.__camOffset ?? { dx: 2.1, dy: 1.9, dz: 2.4 };
      const from = { x: x + o.dx, y: o.dy, z: z + o.dz, isVector3: true };
      game.enterDebugView(from, at, 1320);
    });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${outDir}/03-close-up-pets-in-their-beds.png` });
  }
  if (state.done) break;
  await page.waitForTimeout(120);
}
if (!shot) console.log('WARNING: never caught a frame with both pets asleep');
await page.evaluate(() => clearInterval(window.__zoom));
await page.screenshot({ path: `${outDir}/04-after-nap-pets-back-in-the-line.png` });

const trace = await page.evaluate(() => ({
  ok: !window.__traceWhy,
  why: window.__traceWhy,
  rows: window.__trace ?? [],
}));

if (!trace.ok) {
  console.log('TRACE FAILED:', trace.why);
} else {
  const rows = trace.rows;
  console.log(`\nsampled ${rows.length} real animation frames, "Have a sleep" to waking`);
  for (const [index, uid] of ['pet.bunny#1', 'pet.kitten#2'].entries()) {
    let toggles = 0;
    let hidden = 0;
    let worstStep = 0;
    const ids = new Set();
    const phases = [];
    for (let i = 0; i < rows.length; i += 1) {
      const s = rows[i].pets[index];
      const previous = i > 0 ? rows[i - 1].pets[index] : null;
      if (!s) continue;
      ids.add(s.id);
      if (!s.v) hidden += 1;
      if (previous && previous.v !== s.v) toggles += 1;
      if (previous && previous.p === 'walking' && s.p === 'walking') {
        worstStep = Math.max(worstStep, Math.hypot(s.x - previous.x, s.z - previous.z));
      }
      const last = phases[phases.length - 1];
      if (!last || last.p !== s.p) phases.push({ p: s.p, at: i });
    }
    console.log(
      `  ${uid}: visibility toggles=${toggles} | frames not drawn=${hidden}/${rows.length} | ` +
        `models seen=${[...ids].join(',')} | worst walk step=${worstStep.toFixed(2)} m | ` +
        `phases=${phases.map((f) => `${f.p ?? 'none'}@${f.at}`).join(' -> ')}`,
    );
  }
  const asleepRow = rows.find((row) => row.asleep >= 2);
  console.log('  first frame with both pets asleep:', JSON.stringify(asleepRow ?? null));
}

console.log('console errors:', errors.length === 0 ? 'none' : JSON.stringify(errors.slice(0, 5)));
await browser.close();
