/**
 * Scratch browser QA for PR #279's pet beds, **on a save nobody seeded** — not
 * part of the build.
 *
 *   npx vite --port <yours> --strictPort
 *   node scripts/qa-petbed-fresh-save.mjs <port> <outDir> [bedIndex] [camDx,camDy,camDz]
 *
 * `scripts/qa-petbed.mjs`, its sibling, writes two pets into `localStorage`
 * before the page loads. That is what let this whole feature ship broken seven
 * rounds running: it proved that a *hand-seeded* inventory gets beds, and the
 * bug was that the **default** one does not. `Hotel.ownedPets` filtered on
 * `kind === 'pet'`, and the companion every fresh character is granted —
 * RiPika, by `defaultCharacterChoice()` — is a `kind: 'toy'`.
 *
 * So this one seeds **nothing**. It opens a page with empty storage, which is
 * the state a child's first-ever visit is in, and lets `main.ts`'s own
 * `startFresh` → `completeCharacterCreation(defaultCharacterChoice())` grant
 * whatever it grants. Then it finds out who is actually following her, and
 * measures whether *that* companion gets a bed and sleeps in it.
 *
 * It samples until the nap actually ends rather than for a fixed wall-clock
 * window: `MAX_FRAME_DELTA` (1/12 s) clamps every frame, so a 2.6 s nap is
 * always at least 32 rendered frames however slowly this box paints.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '6141';
const outDir = process.argv[3] ?? 'qa-out';
const bedIndex = process.argv[4] ?? '0';
const cam = (process.argv[5] ?? '2.1,1.9,2.4').split(',').map(Number);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1234/chrome-linux64/chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
// A brand-new context: empty storage, no service worker, nothing carried over
// from another run on this port — the private-window rule CLAUDE.md gives for
// handing a URL to a person, applied to a robot.
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(String(error)));
await page.addInitScript(() => {
  // Belt and braces: prove to the run itself that nothing was inherited.
  window.localStorage.clear();
});
await page.addInitScript((o) => {
  window.__camOffset = o;
}, { dx: cam[0], dy: cam[1], dz: cam[2] });

await page.goto(`http://localhost:${port}/hotel-suite`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.game?.world?.hotel), null, { timeout: 120000 });
await page.waitForTimeout(6000);

// Who did character creation actually hand her? Read it off the live parade,
// not off an assumption.
const companions = await page.evaluate(() => {
  const beds = window.game.world.hotel.petBeds;
  const uids = [...new Set(beds.map((b) => b.uid).filter((uid) => uid !== null))];
  return uids.map((uid) => {
    const state = window.game.parade.petState(uid);
    return { uid, itemId: state?.itemId ?? null, drawn: state?.visible ?? null };
  });
});
console.log('companions with a bed of their own, on a save nobody seeded:');
for (const companion of companions) console.log(' ', JSON.stringify(companion));
if (companions.length === 0) {
  console.log('FAIL: every pet bed was built with uid null — this is the shipped bug.');
}

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

const stood = await page.evaluate((which) => {
  const game = window.game;
  const zone = game.world.hotel.interactZones().find((z) => z.id === `hotel-bed-bed-${which}`);
  if (!zone) return { ok: false, why: `no zone hotel-bed-bed-${which}` };
  game.player.teleportTo(zone.standX, 0, zone.standZ, Math.PI);
  return { ok: true, zone: zone.id, x: zone.standX, z: zone.standZ };
}, bedIndex);
console.log('standing at:', JSON.stringify(stood));
await page.evaluate(() => {
  window.__zoom = setInterval(() => window.game.camera.setZoomTarget(2.6), 50);
});
await page.waitForTimeout(8000);
await page.screenshot({ path: `${outDir}/01-before-nap-companion-in-the-parade.png` });

await page.evaluate(
  ({ which, uids }) => {
    const game = window.game;
    const hotel = game.world.hotel;
    const parade = game.parade;
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
      if ((rows.length > 4 && !napping) || rows.length > 900) {
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
  },
  { which: bedIndex, uids: companions.map((c) => c.uid) },
);

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
    await page.screenshot({ path: `${outDir}/02-companion-on-its-way-to-bed.png` });
    console.log(`screenshot of the companion still on its way taken at frame ${state.frames}`);
  }
  if (!shot && state.asleep >= 1) {
    shot = true;
    await page.screenshot({ path: `${outDir}/03-companion-asleep-in-its-bed.png` });
    console.log(`screenshot of the companion asleep taken at frame ${state.frames}`);
    // Freeze the park here and put a free camera on the bed — the game's own
    // `/view` mechanism (`Game.enterDebugView` with a `timeOfDay`, which is
    // what pauses), so the fit can be judged by eye and not only off numbers.
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
    await page.screenshot({ path: `${outDir}/04-close-up-companion-in-its-bed.png` });
  }
  if (state.done) break;
  await page.waitForTimeout(120);
}
if (!shot) console.log('WARNING: never caught a frame with the companion asleep');
await page.evaluate(() => clearInterval(window.__zoom));
await page.screenshot({ path: `${outDir}/05-after-nap-back-in-the-line.png` });

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
  for (const [index, companion] of companions.entries()) {
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
      `  ${companion.uid}: visibility toggles=${toggles} | frames not drawn=${hidden}/${rows.length} | ` +
        `models seen=${[...ids].join(',')} | worst walk step=${worstStep.toFixed(2)} m | ` +
        `phases=${phases.map((f) => `${f.p ?? 'none'}@${f.at}`).join(' -> ')}`,
    );
  }
  console.log('  first frame with a companion asleep:', JSON.stringify(rows.find((r) => r.asleep >= 1) ?? null));
}

// And the fit, measured in the live browser rather than inferred: the body's
// own box against the bed it is lying in.
const fit = await page.evaluate(() => {
  const THREE_BOX = (root) => {
    let min = null;
    let max = null;
    root.updateMatrixWorld(true);
    root.traverse((node) => {
      const geometry = node.geometry;
      if (!geometry || !node.visible) return;
      geometry.computeBoundingBox();
      const box = geometry.boundingBox.clone().applyMatrix4(node.matrixWorld);
      min = min ? min.map((v, i) => Math.min(v, box.min.toArray()[i])) : box.min.toArray();
      max = max ? max.map((v, i) => Math.max(v, box.max.toArray()[i])) : box.max.toArray();
    });
    return { min, max };
  };
  const hotel = window.game.world.hotel;
  const bed = hotel.petBeds.find((b) => b.uid !== null);
  const state = bed ? window.game.parade.petState(bed.uid) : null;
  if (!bed || !state) return null;
  const body = THREE_BOX(state.root);
  return {
    uid: bed.uid,
    cushionTop: Number(bed.spot.cushionTop.toFixed(3)),
    bodyMinY: Number(body.min[1].toFixed(3)),
    bodySpanX: Number((body.max[0] - body.min[0]).toFixed(3)),
    bodySpanZ: Number((body.max[2] - body.min[2]).toFixed(3)),
  };
});
console.log('fit, measured live:', JSON.stringify(fit));

console.log('console errors:', errors.length === 0 ? 'none' : JSON.stringify(errors.slice(0, 5)));
await browser.close();
