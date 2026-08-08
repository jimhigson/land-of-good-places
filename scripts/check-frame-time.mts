/**
 * **The park's frame-time tail, measured on a real GPU.**
 *
 * Nothing in this repo measured render cost at all until this landed. The
 * average frame rate was never the problem — Jim's report was *"the frame rate
 * is generally ok but there seem to be large GPU pauses from time to time"* —
 * and a mean frame time is exactly the statistic that cannot see that. So this
 * asserts on the **tail**: p99.9, the number of frames long enough to read as a
 * freeze, and the worst single blocking GL call.
 *
 * ## Why it is not part of `npm run build`
 *
 * It drives a real browser against a real GPU and takes minutes. CI has
 * neither, so wiring it into `build` would either fail on every PR or be
 * quietly skipped, and a check that is quietly skipped is worse than no check —
 * see CLAUDE.md. It is opt-in, and it is the thing to run when touching
 * anything that draws.
 *
 * ## Running it
 *
 * ```
 * npm run build            # it measures dist/, i.e. what actually ships
 * npm run check:frame-time
 * ```
 *
 * It starts its own `vite preview`, boots the game through the character
 * creator, sits through the bus ride and the arrival, then walks about for
 * `WALK_S` seconds and reports the distribution.
 *
 * `FRAMES_JSON=<file>` re-checks a capture recorded earlier instead of driving
 * a browser. That is how the thresholds below were shown to go **red** against
 * the pre-fix build rather than merely green against the fixed one.
 *
 * ## Where the thresholds come from
 *
 * From the display, not from a number that happened to pass. A frame that
 * misses two refresh intervals is a hitch a person sees, so the p99.9 limit is
 * derived from the run's own measured p50 (which *is* the refresh interval on a
 * vsync-limited game) rather than hard-coded — the same machine at 60 Hz and at
 * 120 Hz should not need two different checks.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const PORT = Number(process.env.PORT ?? 5439);
const WALK_S = Number(process.env.WALK_S ?? 120);
const SETTLE_S = Number(process.env.SETTLE_S ?? 60);
const FRAMES_JSON = process.env.FRAMES_JSON ?? '';

/** Frames this long during play are a visible freeze, whatever the refresh rate. */
const FREEZE_MS = 100;
/**
 * The worst single synchronous GL call allowed during play. Shader program
 * setup used to block here for 120–152 ms at a time; see `boot/shaderWarmup.ts`.
 */
const MAX_BLOCKING_GL_MS = 25;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH ?? '',
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

interface Frame {
  readonly ts: number;
  readonly iv: number;
  readonly cpu: number;
}
interface SlowGl {
  readonly t: number;
  readonly name: string;
  readonly ms: number;
}
interface Capture {
  readonly frames: readonly Frame[];
  readonly slowGl: readonly SlowGl[];
  readonly tPlayFrom: number;
}

function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length))] ?? NaN;
}

function findChrome(): string {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'check:frame-time needs a Chromium build with a real GPU backend. Set CHROME_PATH, ' +
      `or install Playwright's browsers. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`,
  );
}

async function capture(): Promise<Capture> {
  const { chromium } = (await import('playwright-core')) as typeof import('playwright-core');
  const executablePath = findChrome();

  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new Error('No dist/ to measure. Run `npm run build` first — this checks what ships.');
  }

  const server: ChildProcess = spawn(
    'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore' },
  );
  const base = `http://localhost:${PORT}`;
  try {
    await waitForServer(base);
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--mute-audio'],
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      await page.addInitScript({ path: path.join(HERE, 'frame-time-probe.js') });
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });

      const go = page.locator('button', { hasText: /Let.s go/i }).first();
      await go.waitFor({ state: 'visible', timeout: 60_000 });
      await go.click();
      await sleep(SETTLE_S * 1000);

      const tPlayFrom = await page.evaluate(() => performance.now());
      const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
      const until = Date.now() + WALK_S * 1000;
      let i = 0;
      while (Date.now() < until) {
        const key = keys[i++ % keys.length] ?? 'KeyW';
        await page.keyboard.down(key);
        await sleep(2500);
        await page.keyboard.up(key);
      }
      const collected = (await page.evaluate(() => ({
        frames: window.__frameProbe.frames,
        slowGl: window.__frameProbe.slowGl,
      }))) as { frames: Frame[]; slowGl: SlowGl[] };
      return { ...collected, tPlayFrom };
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
}

function waitForServer(base: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000;
    const poll = (): void => {
      fetch(base)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() > deadline) reject(new Error(`preview never came up on ${base}`));
          else setTimeout(poll, 300);
        });
    };
    poll();
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const data: Capture = FRAMES_JSON
    ? (JSON.parse(fs.readFileSync(FRAMES_JSON, 'utf8')) as Capture)
    : await capture();

  // Only frames from ordinary play. The ride deliberately does heavy work
  // behind a moving bus; that is a different budget and it is not this check's.
  const play = data.frames.filter((f) => f.iv > 0 && f.ts > data.tPlayFrom);
  if (play.length < 1000) {
    throw new Error(`check:frame-time: only ${play.length} frames of play captured — too few to judge.`);
  }
  const intervals = play.map((f) => f.iv);
  const p50 = percentile(intervals, 50);
  const p99 = percentile(intervals, 99);
  const p999 = percentile(intervals, 99.9);
  const worst = Math.max(...intervals);
  // A vsync-limited game's p50 *is* the refresh interval. Missing two of them
  // is the point a person sees a stutter.
  const p999Limit = Math.max(2 * p50 + 1, 16.7);
  const freezes = play.filter((f) => f.iv > FREEZE_MS);
  const slowPlay = data.slowGl.filter((g) => g.t > data.tPlayFrom);
  const worstGl = slowPlay.reduce((a, g) => Math.max(a, g.ms), 0);

  console.log(
    `frame time (${play.length} frames of play): p50 ${p50.toFixed(2)} ms, ` +
      `p99 ${p99.toFixed(2)}, p99.9 ${p999.toFixed(2)}, worst ${worst.toFixed(1)}`,
  );
  console.log(
    `frames over ${FREEZE_MS} ms: ${freezes.length}; ` +
      `worst blocking GL call: ${worstGl.toFixed(1)} ms (${slowPlay.length} over 2 ms)`,
  );

  const failures: string[] = [];
  if (!(p999 <= p999Limit)) {
    failures.push(
      `p99.9 frame time ${p999.toFixed(2)} ms exceeds ${p999Limit.toFixed(2)} ms ` +
        `(two refresh intervals at the measured p50 of ${p50.toFixed(2)} ms)`,
    );
  }
  if (freezes.length > 0) {
    failures.push(
      `${freezes.length} frame(s) over ${FREEZE_MS} ms during play: ` +
        `${freezes.map((f) => f.iv.toFixed(0)).slice(0, 8).join(', ')} ms`,
    );
  }
  if (worstGl > MAX_BLOCKING_GL_MS) {
    const culprit = slowPlay.reduce((a, g) => (g.ms > a.ms ? g : a), slowPlay[0]!);
    failures.push(
      `a single ${culprit.name} call blocked the main thread for ${worstGl.toFixed(1)} ms ` +
        `(limit ${MAX_BLOCKING_GL_MS} ms) — shader setup is escaping the ride's warm-up again`,
    );
  }

  if (failures.length > 0) {
    console.error(`\ncheck:frame-time FAILED:\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('check:frame-time: the tail is within budget. ✓');
}

await main();
