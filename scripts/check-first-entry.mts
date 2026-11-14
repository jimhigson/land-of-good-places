/**
 * **`gpu:first-entry` — the first walk into every room and the first ride on
 * every ride links nothing on a frame she can see, and freezes no frame she
 * can see.** (120 fps plan, steps 8 and 9; `docs/perf/FRAME-DROPS-2026-11.md`
 * items 14 and 19; the mechanism is `src/core/viewWarmup.ts`.)
 *
 * ```
 * pnpm run build              # it measures dist/, i.e. what ships
 * pnpm run gpu:first-entry
 * FIRST_ENTRY_ONLY=door-library pnpm run gpu:first-entry   # one scenario
 * ```
 *
 * Not a `check:`, for the reason `gpu:frame-time` is not: its frame times
 * mean something only on a real GPU, and CI's runners have a software
 * rasteriser. `check:chain-coverage` names it on every run as not gating.
 *
 * Each scenario gets a **fresh browser** — a fresh profile and a GPU process
 * with no program cache, which is a child's first visit — on the checked-in
 * park of seed 5, at the spot its door or stand is on that park. It does what
 * a child does (walks through the door, presses E at the stand, or boots
 * straight in by a deep link) and records every frame (`first-entry-probe.js`).
 * A frame **she can see** is one whose gap began with the iris open (any hole
 * at all), no curtain shut over it, and — on a boot — after the first frame
 * that drew the park. It asserts, from the press to two seconds after the
 * cover lifted:
 *
 *  1. **the cover went up and came down** — a door or a ride closed the iris
 *     and opened it, a curtain game shut its curtain and opened it;
 *  2. **no link was waited for on a frame she can see** — a program's first
 *     use whose `KHR_parallel_shader_compile` status said it was not linked
 *     yet (without the extension, any link at all);
 *  3. **no frame she can see is longer than {@link FREEZE_MS}** — a room built
 *     in the frame that asked for the iris is a freeze with no link in it, and
 *     (2) cannot see that;
 *  4. on a door, **the first frame that drew the new room was drawn with the
 *     iris shut** — nothing of a room is shown before it is built and warm.
 *
 * And it prints, per scenario, the worst frame she could see and the worst
 * under the cover, so the numbers in a PR are this script's numbers.
 *
 * **Proven red before trusted green**, 14 Nov 2026, on `main` d2ebb4c1's
 * build (M4 Pro, Chrome for Testing 1234 headless on Metal, machine load
 * 30–60 from a VM): see the PR for #first-entry-warmup for the transcript.
 *
 * The spots are **seed 5's**. Parks are checked in and only a rejected seed is
 * re-solved, so they hold; if seed 5 is ever re-solved, a scenario fails with
 * "no cover seen" and the spots want reading again (`Game.world.interactZones()`
 * on a dev server).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.PORT ?? 5447);
const BASE = process.env.FIRST_ENTRY_BASE ?? '';
const ONLY = process.env.FIRST_ENTRY_ONLY ?? '';

/**
 * The longest frame she may see on a first entry. Two 60 Hz frames would be
 * the ideal (33 ms), and is what the plan asks of a quiet machine; this is
 * set at three times that so a busy one — a VM beside it, a GC — does not
 * fail a build for reasons that are not a first entry. What it is for is the
 * freeze: a room built in the door's frame was 106–125 ms, a ride's car built
 * at the press 52 ms plus the links of its first frames, 84–123 ms.
 */
const FREEZE_MS = 100;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH ?? '',
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

type Kind = 'door' | 'ride' | 'curtain' | 'boot';
interface Scenario {
  readonly name: string;
  readonly url: string;
  readonly kind: Kind;
  readonly keys?: readonly string[];
  readonly press?: string;
}

/** Seed 5's doors and stands (see the header). */
const SCENARIOS: readonly Scenario[] = [
  { name: 'door-library', url: '/library-door?seed=5&perf=1', kind: 'door', keys: ['KeyW'] },
  { name: 'door-reptile', url: '/reptile-house-door?seed=5&perf=1', kind: 'door', keys: ['KeyW'] },
  { name: 'door-hotel', url: '/spawn?pos=-7.28,-41.42&facing=225&seed=5&perf=1', kind: 'door', keys: ['KeyW'] },
  { name: 'door-castle', url: '/spawn?pos=24.52,-18.17&facing=180&seed=5&perf=1', kind: 'door', keys: ['KeyW', 'KeyD'] },
  { name: 'ride-rail-race', url: '/spawn?pos=89.72,17.49&seed=5&perf=1', kind: 'ride', press: 'KeyE' },
  { name: 'ride-ferris', url: '/spawn?pos=-40.67,-40.85&seed=5&perf=1', kind: 'ride', press: 'KeyE' },
  { name: 'ride-sky-cruiser', url: '/spawn?pos=35.69,-26.62&seed=5&perf=1', kind: 'ride', press: 'KeyE' },
  { name: 'curtain-dodgems', url: '/spawn?pos=-36.6,21.44&seed=5&perf=1', kind: 'curtain', press: 'KeyE' },
  { name: 'curtain-water-fight', url: '/spawn?pos=33.22,49.31&seed=5&perf=1', kind: 'curtain', press: 'KeyE' },
  { name: 'curtain-spooky-house', url: '/spawn?pos=16.06,49.03&seed=5&perf=1', kind: 'curtain', press: 'KeyE' },
  { name: 'boot-spawn', url: '/spawn?seed=5&perf=1', kind: 'boot' },
  { name: 'boot-castle', url: '/castle?deck=0&seed=5&perf=1', kind: 'boot' },
  { name: 'boot-library', url: '/library?seed=5&perf=1', kind: 'boot' },
];

interface Frame {
  readonly t: number;
  readonly interval: number;
  readonly hole: number;
  readonly curtainShut: boolean | null;
  readonly blocking: number;
  readonly links: number;
  readonly draws: number;
  readonly space: string | null;
}
interface Capture {
  readonly frames: readonly Frame[];
  readonly marks: readonly (readonly [number, string | null])[];
  readonly parallel: boolean | null;
  readonly start: number;
}

/** A gap between two frames: what showed for how long, and the GL work that made it. */
interface Gap {
  readonly at: number;
  readonly ms: number;
  readonly seen: boolean;
  readonly blocking: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function findChrome(): string {
  for (const candidate of CHROME_CANDIDATES) if (fs.existsSync(candidate)) return candidate;
  throw new Error(`gpu:first-entry needs a Chromium with a real GPU backend. Set CHROME_PATH. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
}

function waitForServer(base: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000;
    const poll = (): void => {
      fetch(base)
        .then(() => resolve())
        .catch(() => (Date.now() > deadline ? reject(new Error(`preview never came up on ${base}`)) : setTimeout(poll, 300)));
    };
    poll();
  });
}

async function capture(base: string, scenario: Scenario): Promise<Capture | string> {
  const { chromium } = (await import('playwright-core')) as typeof import('playwright-core');
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.addInitScript({ path: path.join(HERE, 'first-entry-probe.js') });
    await page.goto(base + scenario.url, { waitUntil: 'domcontentloaded' });
    let drew = false;
    for (let i = 0; i < 480 && !drew; i += 1) {
      await sleep(250);
      drew = await page
        .evaluate(() => {
          const perf = (window as unknown as { __perf?: { frameCount: number; frames(): { draws: number }[] } }).__perf;
          if (!perf || perf.frameCount < 20) return false;
          const frames = perf.frames();
          return (frames[frames.length - 1]?.draws ?? 0) > 20;
        })
        .catch(() => false);
    }
    if (!drew) return 'the park never drew';
    if (scenario.kind === 'boot') {
      await sleep(4000);
      return (await page.evaluate(() => {
        const p = (window as unknown as { __firstEntry: { frames: unknown[]; marks: unknown[]; parallel: boolean | null } }).__firstEntry;
        return { frames: p.frames, marks: p.marks, parallel: p.parallel, start: 0 };
      })) as Capture;
    }
    // Long enough for a door's prefetch to land and the park to settle.
    await sleep(3000);
    const start = await page.evaluate(() => {
      const p = (window as unknown as { __firstEntry: { frames: unknown[]; marks: unknown[] } }).__firstEntry;
      p.frames.length = 0;
      p.marks.length = 0;
      return performance.now();
    });
    for (const key of scenario.keys ?? []) await page.keyboard.down(key);
    if (scenario.press) {
      await page.keyboard.down(scenario.press);
      await sleep(80);
      await page.keyboard.up(scenario.press);
    }
    // A door or a ride: until the iris has closed and opened. A curtain: six
    // seconds, which is the curtain shutting, the game built and warmed, and
    // the curtain open on it.
    const deadline = Date.now() + (scenario.kind === 'curtain' ? 6000 : 20_000);
    while (Date.now() < deadline) {
      await sleep(100);
      if (scenario.kind === 'curtain') continue;
      const opened = await page.evaluate(() => {
        const marks = (window as unknown as { __firstEntry: { marks: [number, string | null][] } }).__firstEntry.marks;
        const close = marks.findIndex((m) => m[1] === 'true');
        return close >= 0 && marks.slice(close + 1).some((m) => m[1] === 'false');
      });
      if (opened) break;
    }
    await sleep(600);
    for (const key of scenario.keys ?? []) await page.keyboard.up(key);
    await sleep(2400);
    return (await page.evaluate((s) => {
      const p = (window as unknown as { __firstEntry: { frames: unknown[]; marks: unknown[]; parallel: boolean | null } }).__firstEntry;
      return { frames: p.frames, marks: p.marks, parallel: p.parallel, start: s };
    }, start)) as Capture;
  } finally {
    await browser.close();
  }
}

/** Every gap between frames, with whether she could see it. */
function gapsOf(scenario: Scenario, frames: readonly Frame[]): Gap[] {
  const firstDrawn = frames.findIndex((f) => f.draws > 20);
  const gaps: Gap[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1]!;
    const b = frames[i]!;
    let seen = a.hole !== 0 && a.curtainShut !== true;
    // A boot shows an empty canvas until its first frame that draws the park;
    // that frame's own cost delays the first picture, it does not freeze one.
    if (scenario.kind === 'boot') seen = seen && firstDrawn >= 0 && i - 1 > firstDrawn;
    gaps.push({ at: a.t, ms: b.interval, seen, blocking: a.blocking });
  }
  return gaps;
}

interface Verdict {
  readonly lines: string[];
  readonly failures: string[];
}

function judge(scenario: Scenario, data: Capture): Verdict {
  const lines: string[] = [];
  const failures: string[] = [];
  const frames = data.frames;
  if (frames.length < 30) return { lines, failures: [`${scenario.name}: only ${frames.length} frames recorded`] };
  let from = data.start;
  let to = frames[frames.length - 1]!.t;
  // 1. The cover went up and came down.
  if (scenario.kind === 'door' || scenario.kind === 'ride') {
    const close = data.marks.find((m) => m[1] === 'true');
    const open = close ? data.marks.find((m) => m[1] === 'false' && m[0] > close[0]) : undefined;
    if (!close || !open) {
      failures.push(`${scenario.name}: no cover seen — the iris never closed and opened (has seed 5's park moved?)`);
      return { lines, failures };
    }
    from = Math.min(from, close[0] - 300);
    to = Math.min(to, open[0] + 2000);
  } else if (scenario.kind === 'curtain') {
    const shut = frames.findIndex((f) => f.curtainShut === true);
    const reopened = shut >= 0 ? frames.slice(shut).findIndex((f) => f.curtainShut === false) : -1;
    if (frames.every((f) => f.curtainShut === null)) {
      failures.push(`${scenario.name}: this build's ?perf=1 does not say whether a curtain is shut — it cannot be judged`);
      return { lines, failures };
    }
    if (shut < 0 || reopened < 0) {
      failures.push(`${scenario.name}: no cover seen — the curtain never shut and opened again`);
      return { lines, failures };
    }
  }
  const gaps = gapsOf(scenario, frames).filter((g) => g.at >= from && g.at <= to);
  const seen = gaps.filter((g) => g.seen);
  const hidden = gaps.filter((g) => !g.seen);
  const worstSeen = seen.reduce((w, g) => (g.ms > w.ms ? g : w), { at: from, ms: 0, seen: true, blocking: 0 });
  const worstHidden = hidden.reduce((w, g) => Math.max(w, g.ms), 0);
  const blockingSeen = seen.reduce((n, g) => n + g.blocking, 0);
  const blockingHidden = hidden.reduce((n, g) => n + g.blocking, 0);
  lines.push(
    `${scenario.name.padEnd(22)} worst frame she saw ${worstSeen.ms.toFixed(1).padStart(6)} ms, under the cover ${worstHidden.toFixed(1).padStart(6)} ms; ` +
      `links waited for: ${blockingSeen} where she could see, ${blockingHidden} under the cover`,
  );
  // 2. No link waited for where she could see.
  if (blockingSeen > 0) {
    const where = seen.filter((g) => g.blocking > 0).map((g) => `${g.blocking} at ${(g.at - from).toFixed(0)} ms (a ${g.ms.toFixed(0)} ms frame)`);
    failures.push(`${scenario.name}: ${blockingSeen} link(s) waited for on frames she could see — ${where.slice(0, 6).join('; ')}`);
  }
  // 3. No freeze where she could see.
  if (worstSeen.ms > FREEZE_MS) {
    failures.push(`${scenario.name}: a ${worstSeen.ms.toFixed(0)} ms frame she could see, ${(worstSeen.at - from).toFixed(0)} ms in (limit ${FREEZE_MS} ms)`);
  }
  // 4. A door's new room is first drawn with the iris shut.
  if (scenario.kind === 'door') {
    const before = frames[0]?.space ?? null;
    const first = frames.find((f) => f.t >= from && f.space !== null && f.space !== before && f.draws > 0);
    if (!first) failures.push(`${scenario.name}: she never arrived anywhere new (still in ${before})`);
    else if (first.hole !== 0) failures.push(`${scenario.name}: the first frame of ${first.space} was drawn with the iris ${first.hole.toFixed(0)} px open`);
    else lines.push(`${''.padEnd(22)} first frame of ${first.space} drawn with the iris shut`);
  }
  return { lines, failures };
}

async function main(): Promise<void> {
  if (!BASE && !fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new Error('No dist/ to measure. Run `pnpm run build` first — this checks what ships.');
  }
  const scenarios = SCENARIOS.filter((s) => !ONLY || ONLY.split(',').includes(s.name));
  if (scenarios.length === 0) throw new Error(`FIRST_ENTRY_ONLY=${ONLY} names no scenario`);
  let server: ChildProcess | null = null;
  const base = BASE || `http://localhost:${PORT}`;
  if (!BASE) {
    server = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    await waitForServer(base);
  }
  const failures: string[] = [];
  let parallel: boolean | null = null;
  try {
    for (const scenario of scenarios) {
      const data = await capture(base, scenario);
      if (typeof data === 'string') {
        failures.push(`${scenario.name}: ${data}`);
        console.log(`${scenario.name.padEnd(22)} ✗ ${data}`);
        continue;
      }
      parallel ??= data.parallel;
      const verdict = judge(scenario, data);
      for (const line of verdict.lines) console.log(line);
      for (const failure of verdict.failures) console.log(`  ✗ ${failure}`);
      failures.push(...verdict.failures);
    }
  } finally {
    server?.kill();
  }
  console.log(
    parallel === false
      ? '\n(no KHR_parallel_shader_compile on this GPU: every link counts as waited for)'
      : '\n(links counted as waited for: a first use whose KHR_parallel_shader_compile status was not yet linked)',
  );
  if (failures.length > 0) {
    console.error(`\ngpu:first-entry FAILED — ${failures.length} clause(s):\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`gpu:first-entry: ${scenarios.length} first entries, nothing linked or frozen where she could see. ✓`);
}

await main();
