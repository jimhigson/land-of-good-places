/**
 * Scratch browser QA for #417's wall placement — not part of the build.
 *
 *   node scripts/qa-walls-417.mjs <port> <outDir> <label>
 *
 * Stands the real player at a set of fixed points **on the paved network** and
 * photographs what lines the path, on the canonical seed and two sweeps.
 *
 * The spots come from `qa-wall-spots-417.mts`, which chooses them from the path
 * geometry and nothing else. That is deliberate: the walls are what moved, so a
 * viewpoint chosen by looking at the walls would move with them and the pair
 * would compare two different places. Paths are untouched by this branch, so
 * the same coordinates frame the same view in the `before` and `after` runs and
 * the only thing that differs between the two images is the thing under review.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '5420';
const outDir = process.argv[3] ?? 'qa-out';
const label = process.argv[4] ?? 'after';
mkdirSync(outDir, { recursive: true });

const CHROME =
  process.env.QA_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/` +
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

/**
 * Seed -> the fixed path spots, as `x,z,facingDegrees`.
 *
 * A `Map`, not a plain object: integer-like object keys iterate in ascending
 * *numeric* order whatever order they were written in, so a plain object ran
 * seed 5 and seed 18 first and left the canonical seed — the one that matters
 * most — until last, where a timeout further up could and did lose it.
 */
const SEEDS = new Map(Object.entries({
  20260728: ['2.9,-1.5,72', '-9.1,23.4,16', '-2.1,-52.6,28', '-45.1,9.1,-98', '-32.0,-33.7,127'],
  5: ['16.0,-13.0,68', '-40.0,3.6,174', '43.4,-18.0,-100', '32.5,-2.5,23', '-81.7,43.0,75'],
  18: ['12.8,-21.6,65', '-20.9,26.0,-116', '63.3,0.9,-11', '-20.9,38.1,6', '-27.3,-30.4,-116'],
}));

/** Straight into the park, past character creation and the cat bus. */
const save = {
  v: 1,
  at: Date.now(),
  purchases: 0,
  game: {
    parkName: 'QA Park',
    mode: 'sandbox',
    money: 500,
    player: { name: 'Eleri' },
    world: { timeOfDay: 660, dayCount: 0, lightsOn: false },
    inventory: [],
    carriedUid: null,
  },
  flags: { createdCharacter: true, arrivedByBus: true, hotelKey: true, dexPrizeSeen: true },
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const errors = [];
for (const [seed, spots] of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`seed ${seed}: ${String(e)}`));
  // The bundle ships no `process`, so `parkManifest.seedOverride()` reaches for
  // it through `globalThis` and finds nothing in a browser. Planting one before
  // any module evaluates is what lets a sweep seed be photographed at all.
  await page.addInitScript(
    ([file, s]) => {
      window.localStorage.setItem('lgp:save', JSON.stringify(file));
      globalThis.process = { env: { LGP_SEED: String(s) } };
    },
    [save, seed],
  );

  for (const [i, spot] of spots.entries()) {
    const [x, z, facing] = spot.split(',');
    await page.goto(`http://localhost:${port}/spawn?pos=${x},${z}&facing=${facing}`, {
      waitUntil: 'load',
    });
    if (i === 0) {
      // A service worker precached from another agent's dev server will serve
      // old JS to this one — CLAUDE.md has a section on the hour that costs.
      await page.evaluate(async () => {
        const rs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
        await Promise.all(rs.map((r) => r.unregister()));
        const ks = await caches.keys();
        await Promise.all(ks.map((k) => caches.delete(k)));
      });
      await page.reload({ waitUntil: 'load' });
    }
    // The park is solved on the way in (the cruiser and the slide legitimately
    // burn seconds), so wait for the canvas to be drawing rather than a timer.
    await page.waitForFunction(
      () => document.querySelector('canvas') !== null && !document.body.textContent.includes('%'),
      { timeout: 180_000 },
    );
    await page.waitForTimeout(4000);
    // Generous, and caught rather than fatal: swiftshader legitimately takes
    // its time on some frames, and losing one viewpoint must not throw away
    // the seeds still queued behind it — which is exactly what happened on the
    // first run, and it cost the canonical seed.
    try {
      await page.screenshot({
        path: `${outDir}/${label}-seed${seed}-spot${i + 1}.png`,
        timeout: 120_000,
      });
      process.stdout.write(`${label} seed ${seed} spot ${i + 1} (${spot}) captured\n`);
    } catch (e) {
      process.stdout.write(
        `${label} seed ${seed} spot ${i + 1} FAILED: ${String(e).split('\n')[0]}\n`,
      );
    }
  }
  await page.close();
}

await browser.close();
if (errors.length > 0) process.stdout.write(`page errors:\n${errors.slice(0, 10).join('\n')}\n`);
process.stdout.write(`done: ${label}\n`);
