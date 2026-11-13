/**
 * **check:static-freeze — a frozen or merged prop that somebody animates must
 * be caught.**
 *
 * Two browser-only passes take the park's furniture out of the per-frame work,
 * and both fail the same silent way:
 *
 * - `src/world/staticFreeze.ts` turns `matrixAutoUpdate` off on props placed
 *   once (120 fps plan, step 13). A later change animates a frozen object, its
 *   position updates, and the picture does not.
 * - `src/world/staticBatch.ts` merges static props into one mesh per material
 *   per tile and stops drawing the originals (step 14). A later change moves,
 *   hides or restyles an original, and the batch keeps drawing it as it was.
 *
 * Nothing throws, and no node check can see either, because only the browser's
 * scene is frozen and merged (`world/parkStatics.ts` says why). So this loads
 * the real park, lets it play — by day, then into the night, then on the Rail
 * Race, the scene the batching is for — and asks `auditFrozen` to recompose
 * every frozen node and `auditBatched` to hold every merged original to what
 * its batch baked (transform, `visible`, where it hangs, material, geometry,
 * shadow flags, layer). It fails on any drift, and if **either pass covered
 * too little** — a refactor that stops freezing or merging would otherwise
 * pass by measuring an empty set.
 *
 * It needs a dev server (the page imports the audits as source modules, and
 * sets the clock through `window.game`): `pnpm run check:served-static-freeze`,
 * or set `CHECK_STATIC_FREEZE_URL`.
 *
 * ## Proved red (13 November 2026, `perf/rides-static-merge` b7836c20, seed 5, 1000×700 DPR 1)
 *
 * Each broken on purpose and watched fail; each restored and green after. The
 * geometry they failed on: seed 5's park, 852 merged originals in 120 batches
 * (528 out of the graph), 375 frozen nodes, 2,256 scene objects.
 *
 * - **A driven prop merged as furniture** — the real failure this guards.
 *   The dodgems' bulbs are scaled every frame and say so with
 *   `userData.twinkles` (`minigames/dodgems/plot.ts`); with that one line
 *   commented out they were merged (875 originals, 121 batches), and:
 *   ```
 *   park seed 5, after 6 s by day and 3 s by night: FAIL: 22 merged original(s) changed since their batch baked them — the batch still draws them as they were:
 *     moved by up to 0.09661 since it was baked  Scene > anchor-plots > anchor:dodgems > dodgems:ride > Mesh
 *     moved by up to 0.47953 since it was baked  Scene > anchor-plots > anchor:dodgems > dodgems:ride > Mesh
 *     …
 *   rail race seed 5, after 6 s riding: FAIL: 22 merged original(s) changed since their batch baked them — …
 *   ```
 * - **`MUTATE=hide`** (one original hidden in the page before the audit):
 *   ```
 *   park seed 5, after 6 s by day and 3 s by night: MUTATE=hide hid "(unnamed mesh)" before the audit
 *   park seed 5, after 6 s by day and 3 s by night: FAIL: 1 merged original(s) changed since their batch baked them — the batch still draws them as they were:
 *     hidden (itself or a parent below the area root), but its batch still draws it  Scene > scenery > wooden-walls > Mesh
 *   ```
 * - **No `userData` rule at all** (the line in `staticFreeze.isLeftLive`
 *   commented out): the stall flags are frozen *and* merged, and the dodgems'
 *   bulbs merged — both audits red, in both scenes:
 *   ```
 *   park seed 5, after 6 s by day and 3 s by night: 429 frozen nodes recomposed (429 of them world-frozen) of 2236 scene objects; … 933 merged originals held to their 124 batches (552 of them out of the graph).
 *   park seed 5, after 6 s by day and 3 s by night: FAIL: 54 frozen node(s) no longer match their stored matrix — …
 *     local drift 0.21193  Scene > stalls > stall:skyCruiser > Group > Mesh
 *   park seed 5, after 6 s by day and 3 s by night: FAIL: 76 merged original(s) changed since their batch baked them — …
 *   rail race seed 5, after 6 s riding: FAIL: 54 frozen node(s) … / FAIL: 76 merged original(s) …
 *   ```
 *   54 = 9 flags × 6 stalls; 76 = those flags and the 22 bulbs.
 */
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';

const BASE = (process.env.CHECK_STATIC_FREEZE_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const SEED = Number(process.env.CHECK_STATIC_FREEZE_SEED ?? CANONICAL_PARK_SEED);
/** Seconds of daytime play before the night: long enough for every per-frame animator to have run. */
const PLAY_SECONDS = Number(process.env.CHECK_STATIC_FREEZE_SECONDS ?? 6);
/** Seconds after the clock is moved to night: lamps, glows and the cables' dusk all switch on that frame. */
const NIGHT_SECONDS = 3;
/** Seconds riding the Rail Race, the first-person scene the batching was built for. */
const RIDE_SECONDS = 6;
/** `DayNight.time` for "night": its own fraction of a day, past the evening's fade. */
const NIGHT_TIME = 0.92;
/**
 * Fewest frozen nodes the park may have. Measured 13 Nov 2026 on seed 5:
 * see the run's own printed count. A floor, so that a refactor which stops
 * calling `freezeParkStatics` fails here instead of auditing nothing.
 */
const MIN_FROZEN = 300;
/**
 * Fewest merged originals the park may have, for the same reason. Measured on
 * seed 5 at 852 (`perf/rides-static-merge`); the floor sits well under it so a
 * small prop added or taken away does not trip it, and far above zero.
 */
const MIN_MERGED = 600;
/**
 * **`MUTATE=hide`** — proves the batch audit can go red. In the page, before
 * the audit, one merged original is hidden the way its owner would hide it,
 * with `visible = false` — which the batch, drawing a copy, never sees.
 */
const MUTATE_HIDE = process.env.MUTATE === 'hide';

const say = (line: string): void => void process.stderr.write(`check:static-freeze: ${line}\n`);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Drift {
  path: string;
  what: string;
}

interface PageAudit {
  sceneObjects: number;
  autoUpdateOn: number;
  frozenChecked: number;
  worldChecked: number;
  frozenDrifted: { path: string; kind: string; delta: number }[];
  batches: number;
  merged: number;
  mergedOutOfGraph: number;
  batchDrifted: Drift[];
  mutated: string | null;
}

/** Runs both audits in the page, on the scene with the most objects (the park). */
function auditPage(page: Page, hide: boolean): Promise<PageAudit> {
  return page.evaluate(async (hide) => {
    type Node = { traverse(visit: (node: { matrixAutoUpdate: boolean }) => void): void };
    const scenes = (window as unknown as { __checkScenes: Node[] }).__checkScenes;
    let park: Node | undefined;
    let most = -1;
    for (const scene of scenes) {
      let n = 0;
      scene.traverse(() => n++);
      if (n > most) {
        most = n;
        park = scene;
      }
    }
    if (!park) throw new Error('no scene was observed');
    let autoUpdateOn = 0;
    park.traverse((node) => {
      if (node.matrixAutoUpdate) autoUpdateOn++;
    });
    // The same module instances the game froze and merged with, so the same markers.
    const freezeSource = '/src/world/staticFreeze.ts';
    const batchSource = '/src/world/staticBatch.ts';
    const { auditFrozen } = (await import(/* @vite-ignore */ freezeSource)) as {
      auditFrozen(scene: unknown): { checked: number; worldChecked: number; drifted: { path: string; kind: string; delta: number }[] };
    };
    const batching = (await import(/* @vite-ignore */ batchSource)) as {
      auditBatched(scene: unknown): { batches: number; sources: number; detached: number; drifted: { path: string; what: string }[] };
      batchRecordOf(object: unknown): { sources: readonly { mesh: { visible: boolean; name: string } }[] } | undefined;
    };
    let mutated: string | null = null;
    if (hide) {
      park.traverse((node) => {
        if (mutated !== null) return;
        const record = batching.batchRecordOf(node);
        const victim = record?.sources[0]?.mesh;
        if (!victim) return;
        victim.visible = false;
        mutated = victim.name || '(unnamed mesh)';
      });
    }
    const frozen = auditFrozen(park);
    const merged = batching.auditBatched(park);
    return {
      sceneObjects: most,
      autoUpdateOn,
      frozenChecked: frozen.checked,
      worldChecked: frozen.worldChecked,
      frozenDrifted: frozen.drifted,
      batches: merged.batches,
      merged: merged.sources,
      mergedOutOfGraph: merged.detached,
      batchDrifted: merged.drifted,
      mutated,
    };
  }, hide);
}

/** Opens `path` in a fresh page with the devtools hook installed, and waits for the park. */
async function openPark(context: BrowserContext, path: string, seeds: number[]): Promise<Page> {
  const page = await context.newPage();
  countNavigations(page);
  page.on('console', (message) => {
    const said = /park seed (\d+)/.exec(message.text());
    if (said) seeds.push(Number(said[1]));
  });
  // three.js announces every Scene it constructs on this hook; it is the
  // official devtools channel, so no game code has to expose its scene.
  await page.addInitScript(() => {
    const scenes: unknown[] = [];
    const hook = new EventTarget();
    hook.addEventListener('observe', (event) => {
      const detail = (event as CustomEvent<{ isScene?: boolean }>).detail;
      if (detail?.isScene) scenes.push(detail);
    });
    Object.assign(window, { __THREE_DEVTOOLS__: hook, __checkScenes: scenes });
  });
  await page.goto(`${BASE}${path}${path.includes('?') ? '&' : '?'}seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  // The park is up once its scene holds thousands of objects. A reload while
  // it boots is harmless — vite reloads the first page to connect after a
  // source edit — so a navigation here is waited out; one *after* the park is
  // up is fatal (`assertSameBoot`), since the audit would see a fresh boot.
  const deadline = Date.now() + 180_000;
  for (;;) {
    const size = await page.evaluate(() => {
      const scenes = (window as unknown as { __checkScenes: { traverse(visit: () => void): void }[] }).__checkScenes;
      let most = 0;
      for (const scene of scenes) {
        let n = 0;
        scene.traverse(() => n++);
        most = Math.max(most, n);
      }
      return most;
    }).catch((error: unknown) => {
      if (/context was destroyed|navigation/i.test(String(error))) return 0;
      throw error;
    });
    if (size > 2000) break;
    if (Date.now() > deadline) throw new Error(`the park never appeared at ${BASE}${path} (largest scene: ${size} objects)`);
    await sleep(500);
  }
  boots.set(page, navigations(page));
  return page;
}

/** Main-frame navigations per page, counted from its first load. */
const navigationCounts = new WeakMap<Page, number>();
const boots = new WeakMap<Page, number>();
function navigations(page: Page): number {
  return navigationCounts.get(page) ?? 0;
}
function countNavigations(page: Page): void {
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigationCounts.set(page, navigations(page) + 1);
  });
}
function assertSameBoot(page: Page, where: string): void {
  if (navigations(page) !== boots.get(page)) {
    throw new Error(`${where}: the page loaded again after the park was up — the audit would have measured a fresh boot, not the one that played`);
  }
}

function report(where: string, audit: PageAudit): boolean {
  let failed = false;
  say(
    `${where}: ${audit.frozenChecked} frozen nodes recomposed (${audit.worldChecked} of them world-frozen) of ${audit.sceneObjects} scene objects; ` +
      `${audit.autoUpdateOn} still have matrixAutoUpdate on. ${audit.merged} merged originals held to their ${audit.batches} batches ` +
      `(${audit.mergedOutOfGraph} of them out of the graph).`,
  );
  if (audit.mutated !== null) say(`${where}: MUTATE=hide hid "${audit.mutated}" before the audit`);
  if (!(audit.frozenChecked >= MIN_FROZEN)) {
    say(`${where}: FAIL: only ${audit.frozenChecked} frozen nodes were found, fewer than the floor of ${MIN_FROZEN} — nothing is being frozen, so nothing was audited`);
    failed = true;
  }
  if (!(audit.merged >= MIN_MERGED)) {
    say(`${where}: FAIL: only ${audit.merged} merged originals were found, fewer than the floor of ${MIN_MERGED} — nothing is being batched, so nothing was audited`);
    failed = true;
  }
  if (audit.frozenDrifted.length > 0) {
    say(`${where}: FAIL: ${audit.frozenDrifted.length} frozen node(s) no longer match their stored matrix — something moves them, and they are not being redrawn where it puts them:`);
    for (const drift of audit.frozenDrifted.slice(0, 12)) say(`  ${drift.kind} drift ${drift.delta.toFixed(5)}  ${drift.path}`);
    if (audit.frozenDrifted.length > 12) say(`  …and ${audit.frozenDrifted.length - 12} more`);
    failed = true;
  }
  if (audit.batchDrifted.length > 0) {
    say(`${where}: FAIL: ${audit.batchDrifted.length} merged original(s) changed since their batch baked them — the batch still draws them as they were:`);
    for (const drift of audit.batchDrifted.slice(0, 12)) say(`  ${drift.what}  ${drift.path}`);
    if (audit.batchDrifted.length > 12) say(`  …and ${audit.batchDrifted.length - 12} more`);
    failed = true;
  }
  return failed;
}

const args = ['--mute-audio', ...(process.env.SWIFTSHADER === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])];
const browser = await chromium.launch({ channel: 'chromium', headless: true, args });
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const seeds: number[] = [];

  // The park, by day and then by night.
  const park = await openPark(context, '/spawn', seeds);
  await sleep(PLAY_SECONDS * 1000);
  const night = await park.evaluate((time) => {
    const game = (window as unknown as { game?: { world: { dayNight: { time: number } } } }).game;
    if (!game) return false;
    game.world.dayNight.time = time;
    return true;
  }, NIGHT_TIME);
  if (!night) throw new Error('no window.game to set the clock — run against the dev server (`check:served-static-freeze`), not a production build');
  await sleep(NIGHT_SECONDS * 1000);
  assertSameBoot(park, 'park');
  failed = report(`park seed ${SEED}, after ${PLAY_SECONDS} s by day and ${NIGHT_SECONDS} s by night`, await auditPage(park, MUTATE_HIDE)) || failed;
  await park.close();

  // The Rail Race: the camera that sees the most of the park, while the park plays on behind it.
  const ride = await openPark(context, '/rail-race', seeds);
  const riding = await ride
    .waitForFunction(() => (window as unknown as { game?: { player: { riding: boolean } } }).game?.player.riding === true, undefined, { timeout: 120_000, polling: 200 })
    .then(() => true)
    .catch(() => false);
  if (!riding) {
    say('FAIL: /rail-race never put her on the ride, so the ride was not audited');
    failed = true;
  } else {
    await ride.keyboard.down('KeyW');
    const until = Date.now() + RIDE_SECONDS * 1000;
    while (Date.now() < until) {
      await ride.keyboard.press('Space');
      await sleep(300);
    }
    await ride.keyboard.up('KeyW');
    assertSameBoot(ride, 'rail race');
    failed = report(`rail race seed ${SEED}, after ${RIDE_SECONDS} s riding`, await auditPage(ride, false)) || failed;
  }
  await ride.close();

  if (seeds.length === 0 || seeds.some((seed) => seed !== SEED)) {
    say(`FAIL: asked for park seed ${SEED}, the pages reported [${seeds.join(', ')}]`);
    failed = true;
  }
  say('Covers the park (day and night) and the Rail Race — no other ride, no interior: nothing indoors is frozen or merged.');
} finally {
  await browser.close();
}
if (failed) process.exitCode = 1;
else say('ok');
