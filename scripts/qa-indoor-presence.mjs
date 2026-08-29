/**
 * Browser QA for #362 — not part of the build.
 *
 *   node scripts/qa-indoor-presence.mjs <port> <outDir>
 *
 * The acceptance test is the one thing no headless assertion can settle: **the
 * player must never see the difference.** A child who was marked present inside
 * the castle has not been simulated for however long she was in there, so the
 * question is whether walking in on her shows her standing somewhere sensible,
 * exactly where she was, with no teleport and no wall-pop.
 *
 * So this waits in the garden until somebody is genuinely frozen indoors,
 * records every frozen child's position, moves the player into the castle, and
 * compares. A pop would show up as a non-zero delta across the crossing.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const port = process.argv[2] ?? '5362';
const outDir = process.argv[3] ?? '/tmp/qa-362';
mkdirSync(outDir, { recursive: true });

const CHROME =
  process.env.QA_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/` +
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://localhost:${port}/spawn?pos=0,0&facing=45`, { waitUntil: 'load' });
await page.evaluate(async () => {
  const rs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
  await Promise.all(rs.map((r) => r.unregister()));
  const ks = await caches.keys();
  await Promise.all(ks.map((k) => caches.delete(k)));
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.game?.world?.npcs), null, { timeout: 180000 });

/** Everything the page can tell us about who is where and who is frozen. */
const snapshot = () =>
  page.evaluate(() => {
    const game = window.game;
    const npcs = game.world.npcs;
    const marked = new Set(npcs.markedElsewhere.map((c) => c.name));
    return {
      player: { x: game.player.position.x, z: game.player.position.z },
      marked: [...marked],
      npcs: npcs.all.map((c) => ({
        name: c.name,
        x: c.position.x,
        y: c.position.y,
        z: c.position.z,
        indoors: Math.abs(c.position.x) > 300,
        driver: c.driver?.name,
      })),
    };
  });

// --- wait in the garden until somebody is frozen inside the castle ---------
let before = null;
for (let i = 0; i < 90; i += 1) {
  await page.waitForTimeout(2000);
  const s = await snapshot();
  const insideCastle = s.npcs.filter((n) => n.indoors && n.driver === 'wander');
  if (i % 10 === 0) {
    console.log(
      `t=${i * 2}s marked=${s.marked.length} castle-children=${insideCastle.length} ` +
        `names=${JSON.stringify(insideCastle.map((n) => n.name))}`,
    );
  }
  if (insideCastle.length > 0) {
    before = s;
    break;
  }
}

if (!before) {
  console.error('FAIL: nobody entered the castle, so there was nothing to test.');
  await browser.close();
  process.exit(1);
}

const frozenIndoors = before.npcs.filter(
  (n) => n.indoors && n.driver === 'wander' && before.marked.includes(n.name),
);
console.log(`\nfrozen inside the castle: ${JSON.stringify(frozenIndoors.map((n) => n.name))}`);
for (const n of frozenIndoors) {
  console.log(`  ${n.name} at (${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)})`);
}
await page.screenshot({ path: `${outDir}/01-player-outside.png` });

// Confirm they really are standing still while the player is outside.
await page.waitForTimeout(6000);
const still = await snapshot();
let worstDrift = 0;
for (const n of frozenIndoors) {
  const now = still.npcs.find((m) => m.name === n.name);
  if (!now) continue;
  worstDrift = Math.max(worstDrift, Math.hypot(now.x - n.x, now.z - n.z));
}
console.log(`worst drift over 6s while frozen: ${worstDrift.toFixed(4)} m`);

// --- walk the player in ----------------------------------------------------
await page.evaluate((target) => {
  const game = window.game;
  // Stand the player beside one of the frozen children, which is what makes
  // `spaceAt(player)` the castle — the single fact `NpcSystem` keys the mark
  // on. Deliberately does not add a QA-only hook to the building: production
  // code should not grow methods that only a test calls.
  game.player.teleportTo(target.x + 2, target.y, target.z + 2, Math.PI);
}, { x: frozenIndoors[0].x, y: frozenIndoors[0].y, z: frozenIndoors[0].z });

// **Wait for frames, not for wall-clock.** Headless Chromium renders this park
// at well under a frame a second, so a fixed 500 ms sleep can easily be *less
// than one frame* — an earlier run of this script measured "0.0000 m jump" that
// way and the number was worthless, because nothing had been stepped between
// the two snapshots. Poll until the mark actually changes, which is proof a
// frame ran and saw the player's new space.
const markBefore = before.marked.length;
let framesRan = false;
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(1000);
  const s = await snapshot();
  if (s.marked.length !== markBefore || !s.marked.includes(frozenIndoors[0].name)) {
    framesRan = true;
    break;
  }
}
console.log(`\nthe mark responded to the player moving in: ${framesRan}`);
const justAfter = await snapshot();

let worstPop = 0;
let worstPopWho = '';
for (const n of frozenIndoors) {
  const now = justAfter.npcs.find((m) => m.name === n.name);
  if (!now) continue;
  const pop = Math.hypot(now.x - n.x, now.z - n.z);
  if (pop > worstPop) {
    worstPop = pop;
    worstPopWho = n.name;
  }
}
console.log(`\nplayer now at (${justAfter.player.x.toFixed(1)}, ${justAfter.player.z.toFixed(1)})`);
console.log(`marked after entering: ${justAfter.marked.length}`);
console.log(`worst position jump across the crossing: ${worstPop.toFixed(4)} m (${worstPopWho})`);
await page.screenshot({ path: `${outDir}/02-player-inside.png` });

// …and that they are moving again now the player is in there with them.
await page.waitForTimeout(6000);
const later = await snapshot();
let moved = 0;
for (const n of frozenIndoors) {
  const now = later.npcs.find((m) => m.name === n.name);
  const then = justAfter.npcs.find((m) => m.name === n.name);
  if (!now || !then) continue;
  moved = Math.max(moved, Math.hypot(now.x - then.x, now.z - then.z));
}
console.log(`most any of them moved in the 6s after the player arrived: ${moved.toFixed(3)} m`);
await page.screenshot({ path: `${outDir}/03-inside-after-6s.png` });

writeFileSync(
  `${outDir}/samples.json`,
  JSON.stringify({ before, still, justAfter, later }, null, 2),
);
console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log(`  ${e}`);

await browser.close();
