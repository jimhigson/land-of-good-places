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
/** Measured + 15 %: room for the counts' frame-to-frame wobble (NPCs walking in and out of view), and no more. */
const HEADROOM = 1.15;

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
 * Measured on `perf-step0` (see its PR for the transcript), canonical seed,
 * 1000×700 at DPR 1. Counts do not depend on resolution, only on what is drawn.
 */
const BUDGETS: Readonly<Record<string, Scene>> = {
  park: { path: '/spawn', space: 'garden', draws: 0, tris: 0 },
  library: { path: '/library', space: 'library', draws: 0, tris: 0 },
  'reptile house': { path: '/reptile-house', space: 'reptileHouse', draws: 0, tris: 0 },
  castle: { path: '/castle', space: 'castle.', draws: 0, tris: 0 },
  hotel: { path: '/hotel', space: 'hotel.', draws: 0, tris: 0 },
  'rail race': { path: '/rail-race', space: '', riding: true, draws: 0, tris: 0 },
};

const at = (path: string): string => `${BASE}${path}${path.includes('?') ? '&' : '?'}seed=${SEED}&perf=1`;

interface Measured {
  readonly space: string;
  readonly riding: boolean;
  readonly draws: number;
  readonly tris: number;
  readonly drawsMin: number;
  readonly trisMin: number;
}

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
    from + SETTLE_FRAMES + SAMPLE_FRAMES,
    { timeout: BOOT_TIMEOUT_MS, polling: 200 },
  );
  return page.evaluate((n) => {
    const perf = (window as unknown as {
      __perf: { frames(): { draws: number; tris: number }[]; context(): Record<string, unknown> };
    }).__perf;
    const frames = perf.frames().slice(-n);
    const context = perf.context();
    return {
      space: String(context['space']),
      riding: context['riding'] === true,
      draws: Math.max(...frames.map((f) => f.draws)),
      tris: Math.max(...frames.map((f) => f.tris)),
      drawsMin: Math.min(...frames.map((f) => f.draws)),
      trisMin: Math.min(...frames.map((f) => f.tris)),
    };
  }, SAMPLE_FRAMES);
}

async function runScene(name: string, scene: Scene): Promise<{ result?: Measured; error?: string }> {
  // A fresh browser per scene: two parks in one Chromium under a software
  // renderer starve each other (check-deep-links.mts, `runInFreshBrowser`).
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--mute-audio'] });
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
  if (MEASURE) continue;
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
