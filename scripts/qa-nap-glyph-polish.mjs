/**
 * Scratch browser QA for the nap Z-glyph *visual* polish round (PR #279,
 * follow-up to follow-up): scale, rise height, lifetime, burst spawn
 * pattern, forehead anchor, and ~0.5 m starting clearance.
 *
 * Not part of the build — a one-off, modelled on `qa-nap-wake.mjs`.
 *
 *   npx vite --port <yours> --strictPort
 *   node scripts/qa-nap-glyph-polish.mjs <port> <outDir>
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const port = process.argv[2] ?? '6143';
const outDir = process.argv[3] ?? 'qa-out-nap-glyph-polish';
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

console.log('--- starting nap, zooming in on the bed ---');
const started = await startNap(0);
console.log('started nap:', JSON.stringify(started));

await page.evaluate(() => {
  window.__zoom = setInterval(() => window.game.camera.setZoomTarget(2.4), 50);
});
await page.waitForTimeout(400);

// Read the player's own head + feet once, close to nap start — these barely
// move again for the rest of the nap (she is lying still).
const bodyRef = await page.evaluate(() => {
  const game = window.game;
  const hotel = game.world.hotel;
  hotel.hotelRoot.updateMatrixWorld(true);
  game.player.group.updateMatrixWorld(true);
  const worldPos = (object) => {
    const e = object.matrixWorld.elements;
    return { x: e[12], y: e[13], z: e[14] };
  };
  return { head: worldPos(game.player.model.head), feet: { ...game.player.position } };
});
console.log('body reference (head, feet):', JSON.stringify(bodyRef));

// Sample every glyph on every animation frame, collected **inside the
// page** on its own requestAnimationFrame loop rather than via one
// `page.evaluate` round trip per sample: a CDP round trip every ~150ms was
// itself starving the page's own rAF loop (each synchronous call-and-wait
// blocks the single JS thread the game loop also runs on), so real elapsed
// seconds and simulated elapsed seconds badly diverged — measured directly,
// an early version of this script saw barely 0.7s of simulated time pass
// across 11 real seconds of wall clock.
//
// This sandbox's software-rendered (swiftshader, no GPU) Chromium turns out
// to run the whole page at only ~2 real fps regardless, and `Loop.ts` clamps
// every frame's own `dt` to `MAX_FRAME_DELTA` (1/12 s) — so *even with* the
// round-trip fixed, simulated time still runs several times slower than
// real time here. Rather than fight that with more precise real-time
// scheduling, this collects several batches back to back over a couple of
// real minutes (cheap — it's just `waitForTimeout`) so at least one full
// NAP_Z_BURST_PERIOD_SECONDS (8 simulated s) repeat is very likely to fall
// inside the window somewhere, and takes a real screenshot after every
// batch so there is a real frame to point at for whichever phase (burst or
// pause) that batch ended on.
const BATCH_MS = 12000;
const BATCH_COUNT = 6;
const allSamples = [];
const shotFiles = [];
let headSample = null;
for (let batch = 0; batch < BATCH_COUNT; batch += 1) {
  const result = await page.evaluate(async (durationMs) => {
    const game = window.game;
    const hotel = game.world.hotel;
    const worldPos = (object) => {
      const e = object.matrixWorld.elements;
      return { x: e[12], y: e[13], z: e[14] };
    };
    hotel.hotelRoot.updateMatrixWorld(true);
    game.player.group.updateMatrixWorld(true);
    const headSample = { head: worldPos(game.player.model.head), feet: { ...game.player.position } };

    const out = [];
    const start = performance.now();
    await new Promise((resolve) => {
      function tick() {
        hotel.hotelRoot.updateMatrixWorld(true);
        const glyphs = [];
        hotel.hotelRoot.traverse((o) => {
          if (o.name === 'hotel.napGlyph.player') glyphs.push(o);
        });
        out.push({
          t: performance.now(),
          napping: hotel.isNapping,
          glyphs: glyphs.map((g) => {
            const p = worldPos(g);
            return {
              opacity: Number(g.material.opacity.toFixed(3)),
              scale: Number(g.scale.x.toFixed(3)),
              x: Number(p.x.toFixed(3)),
              y: Number(p.y.toFixed(3)),
              z: Number(p.z.toFixed(3)),
            };
          }),
        });
        if (performance.now() - start < durationMs) requestAnimationFrame(tick);
        else resolve(undefined);
      }
      requestAnimationFrame(tick);
    });
    return { samples: out, headSample };
  }, BATCH_MS);
  allSamples.push(...result.samples);
  headSample ??= result.headSample;
  const last = result.samples.at(-1);
  const visibleCount = last ? last.glyphs.filter((g) => g.opacity > 0.03).length : -1;
  const file = `${outDir}/batch-${batch}-visible${visibleCount}.png`;
  await page.screenshot({ path: file });
  shotFiles.push({ batch, visibleCount, file });
  console.log(`batch ${batch}: ${result.samples.length} samples, ended with visibleCount=${visibleCount} -> ${file}`);
}
const samples = allSamples;
Object.assign(bodyRef, headSample);

writeFileSync(`${outDir}/samples.json`, JSON.stringify({ bodyRef, samples, shotFiles }, null, 2));
console.log(`collected ${samples.length} samples over ${BATCH_COUNT * BATCH_MS}ms of real time`);

// ---- analysis -------------------------------------------------------

const t0Sample = samples[0].t;
const rows = samples.map((s) => ({
  t: (s.t - t0Sample) / 1000,
  visibleCount: s.glyphs.filter((g) => g.opacity > 0.03).length,
  maxOpacity: Math.max(...s.glyphs.map((g) => g.opacity)),
  ys: s.glyphs.map((g) => g.y),
  maxY: Math.max(...s.glyphs.map((g) => g.y)),
}));

// Burst detection: count contiguous windows where visibleCount >= 2 (a
// cluster genuinely airborne together) vs windows where visibleCount === 0
// (a real pause, nothing rising at all).
let burstWindows = 0;
let pauseWindows = 0;
let inBurst = false;
let inPause = false;
const bursts = [];
const pauses = [];
let burstStart = 0;
let pauseStart = 0;
for (const row of rows) {
  if (row.visibleCount >= 2) {
    if (!inBurst) {
      burstWindows += 1;
      burstStart = row.t;
      inBurst = true;
    }
  } else if (inBurst) {
    bursts.push([burstStart, row.t]);
    inBurst = false;
  }
  if (row.visibleCount === 0) {
    if (!inPause) {
      pauseWindows += 1;
      pauseStart = row.t;
      inPause = true;
    }
  } else if (inPause) {
    pauses.push([pauseStart, row.t]);
    inPause = false;
  }
}
if (inBurst) bursts.push([burstStart, rows.at(-1).t]);
if (inPause) pauses.push([pauseStart, rows.at(-1).t]);

console.log('\n--- burst / pause windows (>=2 glyphs visible at once = burst; 0 visible = pause) ---');
console.log('bursts (s):', bursts.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)} (${(b - a).toFixed(2)}s)`));
console.log('pauses (s):', pauses.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)} (${(b - a).toFixed(2)}s)`));
if (bursts.length >= 1 && pauses.length >= 1) {
  console.log('PASS: at least one multi-glyph burst and one true zero-visible pause both occurred');
} else {
  console.log('FAIL: did not see both a clustered burst and a genuine pause in this window');
}

const overallMaxY = Math.max(...rows.map((r) => r.maxY));
const baselineY = bodyRef.head.y;
console.log(`\nhighest glyph Y reached: ${overallMaxY.toFixed(2)} (head Y: ${baselineY.toFixed(2)}, rise above head: ${(overallMaxY - baselineY).toFixed(2)} m)`);

// Starting height: lowest Y any glyph is ever seen at *while opacity > 0* —
// approximates the spawn point since a glyph starts at t=0 of its own cycle.
let lowestVisibleY = Infinity;
for (const s of samples) {
  for (const g of s.glyphs) {
    if (g.opacity > 0.03 && g.y < lowestVisibleY) lowestVisibleY = g.y;
  }
}
console.log(`lowest Y seen on a visible (opacity>0) glyph: ${lowestVisibleY.toFixed(2)}`);
console.log(`that spawn point is ${(lowestVisibleY - bodyRef.head.y).toFixed(2)} m above the head bone's own Y`);
console.log(`that spawn point is ${(lowestVisibleY - bodyRef.feet.y).toFixed(2)} m above the feet-anchored root Y`);

// Forehead anchor: plan (x/z) distance from the head bone.
const nearStart = samples.find((s) => s.glyphs.some((g) => g.opacity > 0.03 && g.opacity < 0.3));
if (nearStart) {
  const g = nearStart.glyphs.find((g) => g.opacity > 0.03 && g.opacity < 0.3);
  const dx = g.x - bodyRef.head.x;
  const dz = g.z - bodyRef.head.z;
  console.log(`\nnear-spawn glyph plan position vs head bone: dx=${dx.toFixed(3)} dz=${dz.toFixed(3)} (dist ${Math.hypot(dx, dz).toFixed(3)} m)`);
}

// Lifetime: for one glyph index across consecutive samples, measure how long
// one continuous opacity>0.03 stretch lasts.
let bestLifetime = 0;
for (let gi = 0; gi < 3; gi += 1) {
  let start = null;
  for (let i = 0; i < samples.length; i += 1) {
    const g = samples[i].glyphs[gi];
    const on = g && g.opacity > 0.03;
    const t = (samples[i].t - t0Sample) / 1000;
    if (on && start === null) start = t;
    if (!on && start !== null) {
      bestLifetime = Math.max(bestLifetime, t - start);
      start = null;
    }
  }
  if (start !== null) bestLifetime = Math.max(bestLifetime, (samples.at(-1).t - t0Sample) / 1000 - start);
}
console.log(`\nlongest single continuous "visible" stretch measured on any one glyph slot: ${bestLifetime.toFixed(2)}s`);

// ---- screenshots already taken: one real frame at the end of each of the
// BATCH_COUNT batches above, each file name carrying its own visibleCount
// (`batch-N-visibleV.png`) so a burst frame (V>=2) and a pause frame (V=0)
// can be picked straight off the file listing without more real-time
// waiting.
console.log('\n--- per-batch screenshots ---');
console.log(shotFiles.map((s) => `${s.file} (visibleCount=${s.visibleCount})`).join('\n'));
const haveBurstShot = shotFiles.some((s) => s.visibleCount >= 2);
const havePauseShot = shotFiles.some((s) => s.visibleCount === 0);
console.log(
  haveBurstShot && havePauseShot
    ? 'PASS: at least one batch screenshot caught a burst (>=2 visible) and one caught a pause (0 visible)'
    : `NOTE: batches caught burst=${haveBurstShot} pause=${havePauseShot} — see samples.json for the full timeline if either is missing`,
);

await page.screenshot({ path: `${outDir}/final-state.png` });

console.log('\nconsole errors:', errors.length === 0 ? 'none' : JSON.stringify(errors.slice(0, 8)));
await page.evaluate(() => clearInterval(window.__zoom));
await browser.close();
