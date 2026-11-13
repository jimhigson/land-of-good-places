/**
 * **`check:render-budget` — draw calls and triangles per space, counted, not
 * timed** (120 fps plan, step 0b; `docs/perf/FRAME-DROPS-2026-11.md` on #746).
 *
 * The target is 120 fps, 8.3 ms a frame (CLAUDE.md). Wall-clock frame time
 * cannot be asserted in CI — a GitHub runner has a software rasteriser, and
 * timings there describe SwiftShader, not a phone (`gpu:frame-time` owns the
 * timed question, on a real GPU). **What CI can assert exactly is how much work
 * each frame asks for**: three.js counts every draw call and every triangle it
 * submits, and that count is the same on SwiftShader as on an iPhone. So each
 * space has a ceiling, and a change that adds a thousand draw calls to the park
 * goes red on its own PR instead of being found by a child as a stutter.
 *
 * ## How it measures
 *
 * Each scene is a deep link opened with `?perf=1`, the developer overlay's flag
 * (`core/perfProbe.ts`), so this reads **the same numbers a person sees on the
 * overlay**, not a second instrument's: `renderer.info.render` summed over every
 * render call in a frame (sky, scene, shadow pass, viewmodel, book reader).
 * It waits until the probe reports her in the expected space and the frame
 * count has settled, then takes the **maximum** over {@link SAMPLE_FRAMES}
 * frames — a ceiling is a question about the worst frame, not the typical one.
 *
 * The park is pinned to {@link CANONICAL_PARK_SEED} (`?seed=`), and the page is
 * held to having reported it: a different park has different stalls and a
 * different count, and a red run must be reproducible from its own transcript.
 *
 * ## The budgets
 *
 * {@link BUDGETS} are the counts measured on the commit that introduced this
 * check, plus {@link HEADROOM}. They are ceilings, ratcheted by hand: when a
 * step of the 120 fps plan lowers a count (crowd culling, chunked instancing,
 * merged props), lower the ceiling in the same PR — this check prints the slack
 * on every run so that is easy to see. **Never raise one to make a PR pass**
 * without saying, in that PR, what the new draws buy and what they cost against
 * 8.3 ms.
 *
 * ## Run it
 *
 * ```
 * pnpm run check:served-render-budget          # starts its own dev server
 * CHECK_RENDER_BUDGET_URL=http://127.0.0.1:5911 pnpm run check:render-budget
 * MEASURE=1 …                                  # print counts, assert nothing
 * ```
 */
import { chromium, type Page } from 'playwright-core';
import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';

const BASE = (process.env.CHECK_RENDER_BUDGET_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const SEED = Number(process.env.CHECK_RENDER_BUDGET_SEED ?? CANONICAL_PARK_SEED);
const MEASURE = process.env.MEASURE === '1';
/** Frames drawn in the expected space before sampling starts: the camera's snap and any iris settle. */
const SETTLE_FRAMES = 20;
/** Frames whose maximum is compared with the ceiling. */
const SAMPLE_FRAMES = 20;
/** A cold dev server builds the park and every lazy chunk on first ask. */
const BOOT_TIMEOUT_MS = 240_000;
/**
 * Measured + 10 % (the plan's own figure). The counts are not perfectly
 * fixed: where she and the NPCs stand when the clock is frozen differs a
 * little between a GPU and CI's software renderer — measured at up to 2.8 %
 * (castle, 399 vs 410 draws). Ten per cent covers that with room, and is
 * still far below any regression worth catching (one unculled crowd is 80
 * draws and 1.7 M triangles).
 */
const HEADROOM = 1.1;

interface Scene {
  /** A deep link from `main.ts`. */
  readonly path: string;
  /** What the probe must report before sampling: a space id, or its prefix. */
  readonly space: string;
  /** For a ride: she must be riding, or the count is of the park she walked into instead. */
  readonly riding?: boolean;
  /** Measured counts on the commit that set them, before {@link HEADROOM}. */
  readonly draws: number;
  readonly tris: number;
}

/**
 * Measured on `perf-step0`, canonical seed 5, 1000×700 at DPR 1, the higher
 * of two runs — Apple M4 Pro (Metal) and SwiftShader, CI's renderer. Counts
 * do not depend on resolution, only on what is drawn.
 */
const BUDGETS: Readonly<Record<string, Scene>> = {
  park: { path: '/spawn', space: 'garden', draws: 610, tris: 3_664_324 },
  library: { path: '/library', space: 'library', draws: 321, tris: 2_109_662 },
  'reptile house': { path: '/reptile-house', space: 'reptileHouse', draws: 435, tris: 2_118_554 },
  castle: { path: '/castle', space: 'castle.', draws: 410, tris: 2_629_482 },
  hotel: { path: '/hotel', space: 'hotel.', draws: 336, tris: 1_799_960 },
  // Riding, so the space is whatever the track passes through; `riding` is the guard.
  'rail race': { path: '/rail-race', space: '', riding: true, draws: 2174, tris: 4_247_652 },
};

const at = (path: string): string => `${BASE}${path}${path.includes('?') ? '&' : '?'}seed=${SEED}&perf=1`;

interface Measured {
  readonly space: string;
  readonly riding: boolean;
  readonly draws: number;
  readonly tris: number;
  readonly drawsMin: number;
  readonly trisMin: number;
  readonly gpu: string;
  /** Objects reachable from the scene — what `updateMatrixWorld` and the render walk. */
  readonly sceneObjects: number;
  /** Objects under registered space roots that are out of the graph. */
  readonly keptOut: number;
  /** Whether the live game is taking undrawn spaces out of the graph at all. */
  readonly detaching: boolean;
  /** Roots of a space she is not in that are in the graph anyway. Must be empty. */
  readonly strays: readonly { readonly space: string; readonly name: string; readonly objects: number }[];
  /** The registered roots, as counted: `space/name objects in|out`. */
  readonly census: readonly string[];
}

/**
 * **`MUTATE=reattach`** — proves the stray count can go red. In the page,
 * before the census, one detached space root is put back in the scene the way
 * a careless `scene.add` would: straight past `DrawnSpaces`.
 */
const MUTATE_REATTACH = process.env.MUTATE === 'reattach';

async function measure(page: Page, scene: Scene): Promise<Measured> {
  // Settled = the probe exists, she is where the link says, and SETTLE_FRAMES
  // have been drawn there.
  const settledFrom = await page.waitForFunction(
    ({ space, riding }) => {
      const perf = (window as unknown as { __perf?: { frameCount: number; context(): Record<string, unknown> } }).__perf;
      if (!perf) return false;
      const context = perf.context();
      if (!String(context['space']).startsWith(space)) return false;
      if (riding && context['riding'] !== true) return false;
      return perf.frameCount;
    },
    { space: scene.space, riding: scene.riding === true },
    { timeout: BOOT_TIMEOUT_MS, polling: 200 },
  );
  const from = Number(await settledFrom.jsonValue());
  await page.waitForFunction(
    (until) => ((window as unknown as { __perf: { frameCount: number } }).__perf.frameCount >= until),
    from + SETTLE_FRAMES,
    { timeout: BOOT_TIMEOUT_MS, polling: 200 },
  );
  // **Then stop the clock**, so the sample is of one moment, not of how fast
  // this machine is. Frames are counted, but game time per frame is not: on
  // a GPU 20 frames are a sixth of a second, on CI's software renderer
  // (clamped at `MAX_FRAME_DELTA`) they are seconds — long enough for the Rail
  // Race's 3 s countdown to end and the cart to be somewhere else. With the
  // clock frozen the frame still renders every pass; only the world holds
  // still. `window.game` is the dev server's (`main.ts`), which is what the
  // served checks run against.
  const frozen = await page.evaluate(() => {
    const g = (window as unknown as { game?: { timeScale: number } }).game;
    if (!g) return false;
    g.timeScale = 0;
    return true;
  });
  if (!frozen) throw new Error('no window.game to freeze — run against the dev server (`check:served-render-budget`), not a production build');
  const sampleFrom = await page.evaluate(() => (window as unknown as { __perf: { frameCount: number } }).__perf.frameCount);
  await page.waitForFunction(
    (until) => ((window as unknown as { __perf: { frameCount: number } }).__perf.frameCount >= until),
    sampleFrom + SAMPLE_FRAMES,
    { timeout: BOOT_TIMEOUT_MS, polling: 200 },
  );
  return page.evaluate(({ n, reattach }) => {
    const perf = (window as unknown as {
      __perf: { frames(): { draws: number; tris: number }[]; context(): Record<string, unknown> };
    }).__perf;
    const frames = perf.frames().slice(-n);
    const context = perf.context();
    const space = String(context['space']);
    // **The graph census** (120 fps plan, step 2). `DrawnSpaces` says which
    // roots it owns and what space each belongs to; whether one is *in the
    // graph* is not taken from it — the scene is walked here, the way the
    // renderer walks it, and a root is "in" if that walk reaches it.
    interface Node { uuid: string; name: string; parent: Node | null; traverse(visit: (o: Node) => void): void; add(o: Node): void }
    const game = (window as unknown as {
      game: {
        engine: { scene: Node };
        world: {
          drawnSpaces: {
            isDetaching: boolean;
            detachedRoots(): Node[];
            census(): { space: string; name: string; uuid: string; objects: number }[];
          };
        };
      };
    }).game;
    const spaces = game.world.drawnSpaces;
    if (reattach) {
      const victim = spaces.detachedRoots()[0];
      if (victim) game.engine.scene.add(victim);
    }
    const reachable = new Set<string>();
    game.engine.scene.traverse((o) => reachable.add(o.uuid));
    const rows = spaces.census();
    return {
      space,
      riding: context['riding'] === true,
      gpu: String(context['gpu']),
      draws: Math.max(...frames.map((f) => f.draws)),
      tris: Math.max(...frames.map((f) => f.tris)),
      drawsMin: Math.min(...frames.map((f) => f.draws)),
      trisMin: Math.min(...frames.map((f) => f.tris)),
      sceneObjects: reachable.size,
      keptOut: rows.filter((r) => !reachable.has(r.uuid)).reduce((sum, r) => sum + r.objects, 0),
      detaching: spaces.isDetaching === true,
      // A root may be in the graph only in its own space: the row's label is
      // the stem of that space's id (`castle` for `castle.great-hall`).
      strays: rows.filter((r) => reachable.has(r.uuid) && !space.startsWith(r.space)).map((r) => ({ space: r.space, name: r.name, objects: r.objects })),
      census: rows.map((r) => `${r.space}/${r.name} ${r.objects} ${reachable.has(r.uuid) ? 'in' : 'out'}`),
    };
  }, { n: SAMPLE_FRAMES, reattach: MUTATE_REATTACH });
}

async function runScene(name: string, scene: Scene): Promise<{ result?: Measured; error?: string }> {
  // A fresh browser per scene: two parks in one Chromium under a software
  // renderer starve each other (check-deep-links.mts, `runInFreshBrowser`).
  // SWIFTSHADER=1 forces the software rasteriser CI's runners have, so a
  // local run can show the counts are the same there (they are counts, not
  // timings — that is the point of this check).
  const args = ['--mute-audio', ...(process.env.SWIFTSHADER === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])];
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args });
  const errors: string[] = [];
  const seeds: number[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String((e as Error)?.message ?? e)));
    page.on('console', (message) => {
      const said = /park seed (\d+)/.exec(message.text());
      if (said) seeds.push(Number(said[1]));
    });
    await page.goto(at(scene.path), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const result = await measure(page, scene);
    const wrong = seeds.filter((s) => s !== SEED);
    if (seeds.length === 0) return { error: `${name}: the page never reported its park seed, so the pin to ${SEED} is unproven` };
    if (wrong.length > 0) return { error: `${name}: asked for park seed ${SEED}, the page built ${wrong.join(', ')}` };
    if (errors.length > 0) return { error: `${name}: page errors: ${errors.slice(0, 3).join(' | ')}` };
    return { result };
  } catch (error) {
    return { error: `${name} (${scene.path}): ${String((error as Error)?.message ?? error).split('\n')[0]}${errors.length ? ` — page errors: ${errors.slice(0, 3).join(' | ')}` : ''}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

const say = (line: string): void => {
  // stderr: a passing run's coverage note must be audible (CLAUDE.md).
  process.stderr.write(`[render-budget] ${line}\n`);
};

try {
  const response = await fetch(`${BASE}/`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch (error) {
  throw new Error(
    `check:render-budget: nothing is serving ${BASE} (${String(error)}). ` +
      'Run `pnpm run check:served-render-budget`, or point CHECK_RENDER_BUDGET_URL at your own dev server.',
  );
}

const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const failures: string[] = [];
const rows: string[] = [];
let measuredScenes = 0;
for (const [name, scene] of Object.entries(BUDGETS)) {
  if (only && !only.has(name)) continue;
  const started = Date.now();
  const { result, error } = await runScene(name, scene);
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  if (error || !result) {
    failures.push(error ?? `${name}: no result`);
    say(`${name}: FAILED to measure (${secs} s)`);
    continue;
  }
  measuredScenes++;
  const drawCeiling = Math.ceil(scene.draws * HEADROOM);
  const triCeiling = Math.ceil(scene.tris * HEADROOM);
  const row =
    `${name.padEnd(14)} ${result.space.padEnd(14)} draws ${String(result.draws).padStart(5)} (min ${result.drawsMin}) / ceiling ${drawCeiling}` +
    `   tris ${String(result.tris).padStart(9)} (min ${result.trisMin}) / ceiling ${triCeiling}   ${secs} s`;
  rows.push(row);
  say(row);
  if (rows.length === 1) say(`renderer: ${result.gpu}`);
  say(`${name}: scene graph ${result.sceneObjects} objects, ${result.keptOut} kept out of it — ${result.census.join('; ')}`);
  if (MEASURE) continue;
  // **Nothing from a space she is not in is in the graph the renderer walks**
  // (step 2). Asserted in every space this check visits, so the list of spaces
  // has one owner: BUDGETS above.
  if (!result.detaching) {
    failures.push(`${name}: the game is not detaching undrawn spaces at all (DrawnSpaces.isDetaching is false) — every interior is in the graph`);
  }
  for (const stray of result.strays) {
    failures.push(`${name}: she is in "${result.space}", yet "${stray.name}" (${stray.space}, ${stray.objects} objects) is in the scene graph — a space that is not drawn must be detached, not hidden`);
  }
  if (result.keptOut === 0) {
    failures.push(`${name}: 0 objects are kept out of the scene graph — nothing is registered or nothing is detached, so "no strays" says nothing here`);
  }
  if (!(result.draws > 0 && result.tris > 0)) {
    failures.push(`${name}: counted ${result.draws} draws and ${result.tris} triangles — the probe is not counting, so nothing here is measured`);
    continue;
  }
  if (result.draws > drawCeiling) {
    failures.push(`${name}: ${result.draws} draw calls a frame, ceiling ${drawCeiling} (measured ${scene.draws} + ${Math.round((HEADROOM - 1) * 100)} %)`);
  }
  if (result.tris > triCeiling) {
    failures.push(`${name}: ${result.tris} triangles a frame, ceiling ${triCeiling} (measured ${scene.tris} + ${Math.round((HEADROOM - 1) * 100)} %)`);
  }
  if (result.draws < scene.draws * 0.8 || result.tris < scene.tris * 0.8) {
    say(`${name}: well under its measured count — lower its entry in BUDGETS in this PR so the gain is kept`);
  }
}

say(`measured ${measuredScenes} of ${Object.keys(BUDGETS).length} spaces on park seed ${SEED}; draws and triangles only — frame time is gpu:frame-time's, on a real GPU`);
if (MEASURE) {
  say('MEASURE=1: counts printed, nothing asserted');
} else if (failures.length > 0) {
  console.error(`\ncheck:render-budget FAILED:\n  - ${failures.join('\n  - ')}`);
  process.exitCode = 1;
} else {
  console.log('check:render-budget: every space is within its draw and triangle ceiling.');
}
