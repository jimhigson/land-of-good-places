/**
 * Screenshots the park map for PR review — issues #334 and #234. Not part of
 * the build.
 *
 *   node scripts/qa-park-map.mjs <port> <outDir> <tag> [seed] [--insets]
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

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const port = args[0] ?? '5334';
const outDir = args[1] ?? 'qa-out';
const tag = args[2] ?? 'after';
const seed = args[3] ?? '';

/**
 * **`--insets` simulates a notched phone's safe-area insets.**
 *
 * Headless Chromium reports every `env(safe-area-inset-*)` as **0**. That is a
 * blind spot no screenshot can see past: a layout that overflows only once the
 * insets are non-zero looks perfect in every capture and is broken on the
 * device. It is the same species as capturing `.parkmap-card` instead of the
 * viewport — the measurement cannot express the bug — and it cost PR #353 a
 * round: `.parkmap-card` at `100dvh` inside a container padded by the insets
 * overflowed by their sum, putting the map's close hint 59 px off the bottom
 * of an iPhone while headless measured 0 px overflow.
 *
 * `env()` cannot be assigned from script, so this substitutes the same values
 * into the one declaration that consumes them. That makes it a **simulation of
 * the inset arithmetic, not a device test** — it proves the layout maths, and
 * says nothing about how a real iPhone rounds `dvh`. Stated plainly because
 * the distinction is the whole reason to be careful here.
 *
 * iPhone 14 Pro portrait: 59 px top, 34 px bottom.
 */
const simulateInsets = process.argv.includes('--insets');
const INSET_TOP = 59;
const INSET_BOTTOM = 34;

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

  if (simulateInsets) {
    // Substituted into `.parkmap`'s own declaration, the single place the
    // insets are consumed. `!important` because it stands in for the media
    // query's own value. After navigation, because a style tag needs a
    // document. See the note on `simulateInsets` for what this does and does
    // not prove.
    await page.addStyleTag({
      content:
        `.parkmap { padding-top: ${INSET_TOP}px !important;` +
        ` padding-bottom: ${INSET_BOTTOM}px !important; }`,
    });
  }

  await page.waitForTimeout(3000);

  await page.keyboard.press('m');
  await page.waitForSelector('.parkmap[data-open="true"]', { timeout: 30000 });
  // One extra frame so the canvas has painted.
  await page.waitForTimeout(1200);

  // **The viewport, not `.parkmap-card`.** Both earlier review rounds
  // screenshotted the card element, which renders in the card's own coordinate
  // space — so a card that overflows the screen looks perfect in the capture
  // and is sliced in half on the phone. That is exactly what happened: the
  // map's close hint ran off the bottom of a 390px display for two rounds
  // without a single screenshot being able to show it. A viewport capture is
  // what a child actually sees, including anything hanging off the edge.
  const file = `${outDir}/${tag}-${size.name}${seed ? `-seed${seed}` : ''}.png`;
  await page.screenshot({ path: file });

  // Both numbers come off `dataset`, written by the renderer from the lists it
  // actually drew. Counting painted text runs from outside double-counts a
  // wrapped name and once produced a "9 of 14" that was really 8.
  const measured = await page.evaluate(() => {
    const canvas = document.querySelector('.parkmap-canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    // How far anything that matters hangs off the screen. Measured here, every
    // run, rather than in a throwaway script — the two bugs this PR shipped
    // and fixed were both "something is off the edge and the capture cannot
    // show it", so the number belongs in the standing output.
    const offScreen = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      // A hidden element (landscape hides the hint) reports an empty rect.
      if (r.width === 0 && r.height === 0) return 'hidden';
      return Math.round(
        Math.max(0, -r.left, -r.top, r.right - innerWidth, r.bottom - innerHeight) * 10,
      ) / 10;
    };
    return {
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      labels: Number(canvas.dataset.labelCount ?? -1),
      features: Number(canvas.dataset.featureCount ?? -1),
      off: {
        card: offScreen('.parkmap-card'),
        canvas: offScreen('.parkmap-canvas'),
        // The close hint is a `.shop-hint` inside the map card (ParkMap.ts
        // reuses the shop's class). Scoped to the card, or this would find the
        // shop's own hint if a shop overlay happened to exist.
        hint: offScreen('.parkmap-card .shop-hint'),
      },
    };
  });

  results.push({ size: size.name, file, canvas: measured, errors: errors.length });
  if (errors.length) console.error(`  page errors on ${size.name}:`, errors.slice(0, 3));
  await context.close();
}

await browser.close();
for (const r of results) {
  const c = r.canvas;
  const off = c ? `card ${c.off.card} canvas ${c.off.canvas} hint ${c.off.hint}` : 'n/a';
  console.log(
    `${r.size.padEnd(10)} canvas ${c ? `${c.w}x${c.h}`.padEnd(9) : 'n/a'}` +
      `  labels ${c ? `${c.labels}/${c.features}`.padEnd(6) : 'n/a'}` +
      `  off-screen px: ${off.padEnd(40)}  errors ${r.errors}`,
  );
}
console.log(
  simulateInsets
    ? `\nsafe-area insets SIMULATED at ${INSET_TOP}px top / ${INSET_BOTTOM}px bottom.`
    : '\nsafe-area insets are 0 in headless Chromium — re-run with --insets for a notched phone.',
);
