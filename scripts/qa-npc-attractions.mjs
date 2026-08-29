/**
 * Scratch browser QA for #350's attraction destinations — not part of the build.
 *
 *   node scripts/qa-npc-attractions.mjs <port> <outDir>
 *
 * Runs a **production build** in a real (headless) browser and watches the park's
 * children for four minutes, which is the one thing the headless Node check
 * cannot do: prove it in the thing the family actually plays.
 *
 * Deliberately covers what the earlier sandbox investigation missed — its
 * numbers were taken with the player parked at the origin, so nothing ever
 * triggered `activities/chatToPlayer.ts`. Here the player is **stood on the
 * plaza and left standing**, which is what makes children come over to talk,
 * so the chat path and the announcement path are exercised in the same run and
 * their speech bubbles compete for the one bubble slot exactly as they do in
 * the game.
 *
 * Samples every two seconds: where each park child is, what they are walking
 * to, whether an activity holds them, and any speech bubble text on screen.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const port = process.argv[2] ?? '5350';
const outDir = process.argv[3] ?? 'qa-out';
mkdirSync(outDir, { recursive: true });

const CHROME =
  process.env.QA_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/` +
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

/** Straight into the park, past character creation. */
const save = {
  v: 1,
  at: Date.now(),
  purchases: 0,
  game: {
    parkName: 'QA Park',
    mode: 'sandbox',
    money: 500,
    player: { name: 'Eleri' },
    world: { timeOfDay: 600, dayCount: 0, lightsOn: false },
    inventory: [],
    carriedUid: null,
  },
  flags: { createdCharacter: true, arrivedByBus: true, hotelKey: true, dexPrizeSeen: true },
};

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
await page.addInitScript((file) => {
  window.localStorage.setItem('lgp:save', JSON.stringify(file));
}, save);

// `/spawn` (CLAUDE.md, issue #320) skips character creation AND the cat bus and
// stands the real player on a coordinate with collision, controls and the HUD
// all live. Standing her on the plaza and leaving her there is the point: a
// stationary player is what makes children come over to chat, which is exactly
// what the earlier sandbox investigation — player parked at the origin, in
// Node, with no chat path — could not exercise.
await page.goto(`http://localhost:${port}/spawn?pos=0,0&facing=45`, { waitUntil: 'load' });
// A service worker from another agent's dev server will happily serve old JS —
// CLAUDE.md has a whole section on the hour that costs. Clear and reload.
await page.evaluate(async () => {
  const rs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
  await Promise.all(rs.map((r) => r.unregister()));
  const ks = await caches.keys();
  await Promise.all(ks.map((k) => caches.delete(k)));
});
await page.reload({ waitUntil: 'load' });

await page.waitForFunction(() => Boolean(window.game?.world?.npcs), null, { timeout: 180000 });
// Ride out the cat-bus arrival before the clock starts.
await page.waitForTimeout(8000);

console.log('build:', await page.evaluate(() => document.title));

const rows = [];
const SAMPLES = Number(process.env.QA_SAMPLES ?? 120);
const EVERY_MS = 2000;
const announcements = new Set();
const shopsSeen = new Set();
const everIndoors = new Set();
let sawChat = false;

for (let i = 0; i < SAMPLES; i += 1) {
  const sample = await page.evaluate(() => {
    const game = window.game;
    const npcs = game.world.npcs;
    const kids = npcs.all.filter((c) => c.driver?.name === 'wander');
    const bubbles = kids
      .map((k) => k.driver.chatBubbleText)
      .filter((t) => typeof t === 'string' && t.length > 0);
    const free = kids.filter((k) => !k.driver.occupied);
    // Issue #350's castle requirement, watched in the browser rather than only
    // in Node: children ~600 m away are indoors.
    const indoors = kids.filter((k) => Math.abs(k.position.x) > 300);
    const dests = new Set(free.map((k) => k.driver.destinationId).filter(Boolean));
    // Densest disc of 8 m, the same shape the Node check measures.
    let clump = 0;
    for (const a of free) {
      let here = 0;
      for (const b of free) {
        if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) <= 8.2) here += 1;
      }
      if (here > clump) clump = here;
    }
    let cx = 0;
    let cz = 0;
    for (const k of free) {
      cx += k.position.x;
      cz += k.position.z;
    }
    cx /= free.length || 1;
    cz /= free.length || 1;
    let sum = 0;
    for (const k of free) sum += (k.position.x - cx) ** 2 + (k.position.z - cz) ** 2;
    return {
      kids: kids.length,
      free: free.length,
      dests: dests.size,
      clump,
      rms: Math.sqrt(sum / (free.length || 1)),
      bubbles,
      indoors: indoors.length,
      indoorNames: indoors.map((k) => k.name),
      shopDests: [
        ...new Set(
          kids.map((k) => k.driver.destinationId).filter((d) => d && d.startsWith('shop:')),
        ),
      ],
      names: free.slice(0, 4).map((k) => `${k.name}->${k.driver.destinationName ?? '-'}`),
    };
  });
  for (const b of sample.bubbles) {
    // "I'm going to ..." — NOT "...to the", which was the original filter and
    // could only ever see the articled branch of `announcementFor`. The
    // un-articled half ("I'm going to Dodgems", "I'm going to The Castle") was
    // structurally invisible to this script, so the very bug it was meant to
    // catch — an attraction taking the wrong article — could not have been seen
    // by it. A QA script that can only observe the case that works is worse
    // than none, because it reports success.
    if (b.startsWith("I'm going to ")) announcements.add(b);
    else sawChat = true;
  }
  for (const d of sample.shopDests) shopsSeen.add(d);
  for (const n of sample.indoorNames) everIndoors.add(n);
  rows.push({ t: (i * EVERY_MS) / 1000, ...sample });
  if (i % 10 === 0) {
    console.log(
      `t=${String(rows.at(-1).t).padStart(3)}s kids=${sample.kids} free=${sample.free} ` +
        `dests=${sample.dests} indoors=${sample.indoors} clump=${sample.clump} rms=${sample.rms.toFixed(1)} ` +
        `bubbles=${JSON.stringify(sample.bubbles)}`,
    );
  }
  if (i === 30) await page.screenshot({ path: `${outDir}/01-park-at-60s.png` });
  if (i === 90) await page.screenshot({ path: `${outDir}/02-park-at-180s.png` });
  await page.waitForTimeout(EVERY_MS);
}

await page.screenshot({ path: `${outDir}/03-park-at-240s.png` });
writeFileSync(`${outDir}/samples.json`, JSON.stringify(rows, null, 2));

const settled = rows.filter((r) => r.t >= 60);
const worstClump = Math.max(...settled.map((r) => r.clump));
const worstRms = Math.min(...settled.map((r) => r.rms));
const fewestDests = Math.min(...settled.map((r) => r.dests));

console.log('\n--- summary (after t=60s) ---');
console.log(`worst clump (8.2 m disc): ${worstClump} of ${rows.at(-1).kids} children`);
console.log(`worst RMS spread: ${worstRms.toFixed(1)} m`);
console.log(`fewest distinct destinations: ${fewestDests}`);
console.log(`children seen inside the castle: ${everIndoors.size} ${JSON.stringify([...everIndoors])}`);
console.log(`castle shops chosen: ${shopsSeen.size} ${JSON.stringify([...shopsSeen])}`);
console.log(`distinct announcements seen: ${announcements.size}`);
for (const a of announcements) console.log(`   "${a}"`);
console.log(`a chat bubble (not an announcement) was seen: ${sawChat}`);
console.log(`console errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log(`   ${e}`);

await browser.close();
