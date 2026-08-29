/**
 * Screenshots the park map for PR review — issues #334 and #234. Not part of
 * the build.
 *
 *   node scripts/qa-park-map.mjs <port> <outDir> <tag> [seed]
 *
 * Opens `/spawn` (skipping character creation and the cat bus), presses `M`,
 * waits for the map overlay, and captures it at a phone and a desktop size.
 *
 * **The seed trick.** `parkManifest.ts` takes `LGP_SEED` off `process.env`,
 * which the browser does not have — so a sweep seed would normally mean a full
 * rebuild. `addInitScript` runs before any page module evaluates, so defining
 * `globalThis.process` there is read by `seedOverride()` exactly as it is on
 * Node. That gets a second seed's park out of one dev server.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '5334';
const outDir = process.argv[3] ?? 'qa-out';
const tag = process.argv[4] ?? 'after';
const seed = process.argv[5] ?? '';

mkdirSync(outDir, { recursive: true });

/**
 * The four sizes the PR reports label counts at. 320 px is the narrowest phone
 * worth supporting and is where names are scarcest; landscape is the other
 * extreme, a short wide card.
 */
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone320', width: 320, height: 568 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'desktop', width: 1440, height: 900 },
];

const browser = await chromium.launch();
const results = [];

for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  if (seed) {
    await page.addInitScript((s) => {
      // Before any module evaluates — see the note above.
      globalThis.process = { env: { LGP_SEED: s } };
    }, seed);
  }
  // A fresh context every time, so no service worker or save from an earlier
  // run on this port can serve stale content (CLAUDE.md's standing warning).
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      /* first run, nothing to clear */
    }
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://localhost:${port}/spawn?pos=0,0`, {
    waitUntil: 'load',
    timeout: 120000,
  });

  // The park generates through a dozen lazy imports; wait for the map pill to
  // exist rather than for a fixed sleep. `attached`, not `visible` — it lives
  // in the HUD's menu drawer, which is collapsed until it is opened, so
  // waiting for visibility waits forever.
  await page.waitForSelector('.pill--map', { state: 'attached', timeout: 180000 });
  await page.waitForTimeout(3000);

  await page.keyboard.press('m');
  await page.waitForSelector('.parkmap[data-open="true"]', { timeout: 30000 });
  // One extra frame so the canvas has painted.
  await page.waitForTimeout(1200);

  const file = `${outDir}/${tag}-${size.name}${seed ? `-seed${seed}` : ''}.png`;
  const card = await page.$('.parkmap-card');
  if (card) await card.screenshot({ path: file });
  else await page.screenshot({ path: file });

  // Both numbers come off `dataset`, written by the renderer from the lists it
  // actually drew. Counting painted text runs from outside double-counts a
  // wrapped name and once produced a "9 of 14" that was really 8.
  const measured = await page.evaluate(() => {
    const canvas = document.querySelector('.parkmap-canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      labels: Number(canvas.dataset.labelCount ?? -1),
      features: Number(canvas.dataset.featureCount ?? -1),
    };
  });

  results.push({ size: size.name, file, canvas: measured, errors: errors.length });
  if (errors.length) console.error(`  page errors on ${size.name}:`, errors.slice(0, 3));
  await context.close();
}

await browser.close();
for (const r of results) {
  const c = r.canvas;
  console.log(
    `${r.size.padEnd(10)} ${r.file.padEnd(44)} canvas ${c ? `${c.w}x${c.h}` : 'n/a'}` +
      `  labels ${c ? `${c.labels}/${c.features}` : 'n/a'}  errors ${r.errors}`,
  );
}
