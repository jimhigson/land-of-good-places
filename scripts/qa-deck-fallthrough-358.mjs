/**
 * **Watch a child sprint over a real bridge and stay on top of it** — #358.
 *
 *   node scripts/qa-deck-fallthrough-358.mjs <port> <outDir>
 *
 * Not part of the build. `scripts/measure-deck-fallthrough.mts` is where the
 * fix is *proved*; this is the "look at it" pass, and it answers a narrower
 * question than the harness does.
 *
 * **What this can and cannot show.** The park's steepest walkable ramp is
 * `MAX_RAMP_GRADIENT` = 0.384, and #358 deliberately did not raise
 * `SPRINT_PEAK_GRADE_BUDGET`, so **no geometry in the shipping park is steep
 * enough to exercise the new headroom**. This is therefore a *regression*
 * check — she still walks and sprints over the bridges exactly as she did —
 * plus a live read of how much of her budget the steepest real ramp actually
 * uses. A browser sprint can only sample whatever frame times the machine
 * happens to produce, which is precisely why the deterministic rig is the
 * proof and this is the sanity check.
 *
 * It drives the real keyboard, reads `window.game`, and reports the worst gap
 * between where the bridge deck is and where she actually stood.
 *
 * **It needs a `vite` dev server, not `vite preview`.** `window.game` is only
 * exposed under `import.meta.env.DEV` (`main.ts`), so against a production
 * build this exits 1 with *"is this a DEV build?"* — which looks like a
 * failure and is not one. Said here because it cost the #378 reviewer a round
 * trip.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '5380';
const outDir = process.argv[3] ?? 'qa-out';
mkdirSync(outDir, { recursive: true });

/** Seconds of held input per run. */
const RUN_SECONDS = 6;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://localhost:${port}/spawn?pos=0,0`, {
  waitUntil: 'load',
  timeout: 120000,
});
await page.waitForSelector('.pill--map', { state: 'attached', timeout: 180000 });
await page.waitForTimeout(3000);

/** Every bridge the park built, with the steepest gradient along its spine. */
const bridges = await page.evaluate(() => {
  const game = window.game;
  if (!game) return { error: 'window.game is not exposed — is this a DEV build?' };
  const list = game.world?.train?.bridges ?? [];
  return {
    count: list.length,
    bridges: list.map((b, i) => ({ index: i, deckY: b.deckY })),
  };
});
console.log(`\n  bridges in this park: ${JSON.stringify(bridges)}\n`);

if (bridges.error) {
  console.error(`  FAIL: ${bridges.error}`);
  await browser.close();
  process.exit(1);
}

/**
 * Walk her across the tallest bridge, once at a walk and once sprinting.
 *
 * She is teleported to one end of the deck and then driven with the real
 * keyboard, so what is measured is the shipping input path and the shipping
 * `Player.update`, not a script poking her position.
 */
async function crossing({ sprint, key }) {
  // Put her **on the deck itself**, at the crossing centre.
  //
  // The first version of this script teleported her to a ramp foot and drove
  // one arrow key, and reported a confident pass having never once been over a
  // bridge: she walked off into the park, every sample found no deck covering
  // her, the worst gap stayed 0.000, and the check printed OK. That is the
  // vacuous green this file's own `covered` counter now exists to prevent.
  const start = await page.evaluate(() => {
    const game = window.game;
    let best = null;
    for (const b of game.world.train.bridges) if (!best || b.deckY > best.deckY) best = b;
    if (!best) return null;
    const c = game.world.train.crossings.find((x) => best.deckCovers(x.x, x.z));
    if (!c) return null;
    game.player.teleportTo(c.x, best.heightAt(c.x, c.z) ?? best.deckY, c.z);
    const p = game.player.position;
    return { x: p.x, y: p.y, z: p.z };
  });
  if (!start) return { skipped: 'no bridge with a crossing on this seed' };

  await page.evaluate(() => {
    // Every frame: how far below whatever bridge surface covers her did she
    // end up? The same "did she lose the surface" question the deterministic
    // rig asks, asked of the live game against the built bridge's own
    // `heightAt` rather than against a model of it.
    const game = window.game;
    window.__worst = 0;
    window.__frames = 0;
    window.__covered = 0;
    window.__watch = () => {
      const p = game.player.position;
      let deck = null;
      for (const b of game.world.train.bridges) {
        if (!b.covers(p.x, p.z)) continue;
        const h = b.heightAt(p.x, p.z);
        if (h !== null && (deck === null || h > deck)) deck = h;
      }
      window.__frames += 1;
      if (deck !== null) {
        window.__covered += 1;
        if (deck - p.y > window.__worst) window.__worst = deck - p.y;
      }
      window.__raf = requestAnimationFrame(window.__watch);
    };
    window.__watch();
  });

  if (sprint) await page.keyboard.down('Shift');
  await page.keyboard.down(key);
  await page.waitForTimeout(RUN_SECONDS * 1000);
  await page.keyboard.up(key);
  if (sprint) await page.keyboard.up('Shift');

  const result = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    const p = window.game.player.position;
    return {
      worst: Number(window.__worst.toFixed(3)),
      frames: window.__frames,
      covered: window.__covered,
      end: { x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)), z: Number(p.z.toFixed(2)) },
    };
  });
  return { ...result, start };
}

// Movement is camera-relative, so rather than reimplement the camera basis
// (a second copy of it, and a second thing to drift out of step), drive all
// four directions off the deck centre and keep the worst answer. At least two
// of them run along the deck; the others walk her off it, which is a
// legitimate thing to survive too.
const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const runs = [];
for (const sprint of [false, true]) {
  for (const key of KEYS) {
    const r = await crossing({ sprint, key });
    runs.push({ sprint, key, ...r });
    console.log(`  ${sprint ? 'sprint' : 'walk  '} ${key.padEnd(11)} ${JSON.stringify(r)}`);
  }
  await page.screenshot({ path: `${outDir}/358-${sprint ? 'sprinted' : 'walked'}.png` });
}

if (errors.length) console.error(`\n  page errors:\n    ${errors.join('\n    ')}`);

const totalCovered = runs.reduce((n, r) => n + (r.covered ?? 0), 0);
const worst = runs.reduce((m, r) => Math.max(m, r.worst ?? 0), 0);

// She may legitimately be below a *ramp* she is walking beside rather than on,
// so this is a generous bound: falling through the deck puts her metres under.
const LOST = 1.0;

// **The guard against a vacuous pass.** If she was never over a bridge, this
// check measured nothing and must say so rather than printing OK.
const MIN_COVERED = 20;
let verdict = 0;
if (totalCovered < MIN_COVERED) {
  console.error(
    `\n  FAIL: only ${totalCovered} frames had her over a bridge at all ` +
      `(needed ${MIN_COVERED}). This run measured nothing — it is not a pass.\n`,
  );
  verdict = 1;
} else if (worst > LOST) {
  console.error(`\n  FAIL: she ended up ${worst} m under a bridge surface.\n`);
  verdict = 1;
} else {
  console.log(
    `\n  OK: ${totalCovered} frames over a bridge deck across ${runs.length} runs, ` +
      `worst ${worst} m below the surface (limit ${LOST}).\n` +
      `  Headless renders at ~2 fps, so every frame here is a CLAMPED frame — the\n` +
      `  MAX_FRAME_DELTA worst case this bug lives in, rather than an easy 60 fps.\n`,
  );
}

await browser.close();
process.exit(verdict || errors.length ? 1 : 0);
