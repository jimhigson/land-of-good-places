/**
 * **Does an ordinary reload put a returning player on the newest build?**
 *
 * Issue #341: it did not. A returning player — one whose browser already has
 * our service worker installed — kept executing the *old* bundle through reload
 * after reload after reload, because `registerType: 'prompt'` leaves the newly
 * downloaded worker in the browser's `waiting` state and **a reload does not
 * promote a waiting worker**: the tab it is reloading is still a client of the
 * old one for the whole of the navigation, so the old one is never the last
 * client to go. Only `SKIP_WAITING` (the update gate's button) or closing every
 * tab could do it. That is how Jim ended up looking at a park with no bridges in
 * it, days after the bridges shipped, and being told to open a devtools console.
 *
 * This check is that report, scripted, and it is the only kind of check that
 * could have caught it: nothing about the *source* is wrong in the stale case —
 * the bundle builds, the worker registers, the gate even appears. The bug lives
 * entirely in what a second browser visit executes.
 *
 * ## What it does
 *
 * Two **real builds** of the current tree (`APP_VERSION` is the only difference,
 * which is enough to change every hashed filename — see `vite.config.ts`),
 * served from one static server whose document root can be flipped: that flip is
 * the deploy. One **persistent** Chromium profile visits it — a returning
 * player, not a fresh incognito visit — reloads until the worker controls the
 * page, then the deploy lands and it reloads **once** more.
 *
 * Then it does the opposite experiment, because the cheap fix for the first
 * half is a `skipWaiting: true` that breaks the second: it touches the page (now
 * somebody is playing), deploys again, and proves the page does **not** swap
 * itself out from under her — the gate appears and waits for its button, which
 * then has to work too.
 *
 * The measurement is the same one the issue quotes: the `src` of the module
 * script the page is actually executing, read off the page.
 *
 * ```
 * npm run check:update-adoption
 * ```
 *
 * `KEEP_BUILDS=<dir>` reuses (and leaves behind) the two builds, which turns a
 * four-minute check into a twenty-second one while iterating on the client-side
 * fix. `HEADED=1` shows the browser.
 *
 * ## Why it is not in `npm run build`
 *
 * It drives a browser, and `npm run build` runs on a CI runner with none —
 * a check that is quietly skipped is worse than no check (CLAUDE.md), so it
 * gets its own workflow that installs a browser on purpose
 * (`.github/workflows/update-adoption.yml`), and stays out of the suite that
 * has to run everywhere.
 */
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const PORT = Number(process.env.PORT ?? 5482);
const ORIGIN = `http://127.0.0.1:${PORT}`;
/**
 * How long the page gets, after the one reload, to be executing the new bundle.
 * Generous on purpose: the honest answer is "a couple of seconds", and a check
 * that fails on a loaded box is a check people learn to re-run rather than read.
 * What it must never be is *infinite* — a stale build never becomes fresh, so
 * the pre-fix behaviour spends the whole budget and then reports real hashes.
 */
const ADOPT_TIMEOUT_MS = 25_000;

// ------------------------------------------------------------------ builds

interface Build {
  readonly label: string;
  readonly dir: string;
  readonly version: string;
  /** The hashed entry chunk, e.g. `index-cAnvqz7M.js` — the thing measured. */
  readonly entry: string;
}

function entryChunkOf(dir: string): string {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const match = /<script[^>]+src="\/assets\/(index-[^"]+\.js)"/.exec(html);
  if (!match?.[1]) throw new Error(`no module entry script in ${dir}/index.html`);
  return match[1];
}

function build(label: string, version: string, outDir: string): Build {
  if (!fs.existsSync(path.join(outDir, 'index.html'))) {
    process.stdout.write(`building ${label} (APP_VERSION=${version}) …\n`);
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', outDir, '--emptyOutDir'],
      { cwd: ROOT, env: { ...process.env, APP_VERSION: version }, stdio: 'inherit' },
    );
    if (result.status !== 0) throw new Error(`${label} build failed (exit ${result.status})`);
  }
  return { label, dir: outDir, version, entry: entryChunkOf(outDir) };
}

// ------------------------------------------------------------------ server

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * The deploy. Serves one directory; point it at the other one and every
 * subsequent request is the new build — including, crucially, `sw.js`, which is
 * what the browser's own update check fetches on navigation.
 *
 * A **missing file is a 404, never a fallback to `index.html`** for anything
 * under `/assets/`. That matters: after a deploy the old build's hashed chunks
 * are gone, and a server that quietly handed back HTML instead would hide
 * exactly the failure mode this whole area is about.
 */
function startServer(getRoot: () => string): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', ORIGIN);
    let file = path.join(getRoot(), decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') file = path.join(getRoot(), 'index.html');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (url.pathname.startsWith('/assets/')) {
        res.writeHead(404).end('gone with the last deploy');
        return;
      }
      file = path.join(getRoot(), 'index.html');
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      // Hashed assets are immutable; everything else — index.html, sw.js,
      // version.txt — must not be served from the HTTP cache, or the "deploy"
      // would not be visible to the browser at all. This is what a real static
      // host does, and it is deliberately not the thing under test.
      'cache-control': url.pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

// ------------------------------------------------------------------ probing

interface Reading {
  /** The entry chunk the page is executing right now. */
  readonly entry: string;
  /** The service worker script controlling the page, or `none`. */
  readonly controller: string;
  readonly waiting: boolean;
  readonly gate: boolean;
}

/**
 * Reads the page. Retried, because the page may be navigating underneath us —
 * which after the fix is the *expected* state of affairs, since adopting the new
 * build reloads the tab.
 */
async function read(page: Page): Promise<Reading> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.evaluate(async () => {
        const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
        const registration = await navigator.serviceWorker?.getRegistration();
        const controllerUrl = navigator.serviceWorker?.controller?.scriptURL ?? '';
        return {
          entry: script ? script.src.split('/').pop() ?? '' : '',
          controller: controllerUrl ? controllerUrl.split('/').pop() ?? '' : 'none',
          waiting: !!registration?.waiting,
          gate: document.querySelector<HTMLElement>('.update-gate')?.dataset.show === 'true',
        };
      });
    } catch (error) {
      if (attempt >= 20) throw error;
      await page.waitForTimeout(250);
    }
  }
}

function line(label: string, reading: Reading): string {
  return (
    `${label.padEnd(34)}: ${reading.entry.padEnd(22)}` +
    ` sw=${reading.controller.padEnd(6)} waiting=${String(reading.waiting).padEnd(5)}` +
    ` gate=${reading.gate}`
  );
}

/** Fails loudly rather than returning false — every one of these is the check. */
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// --------------------------------------------------------------------- run

async function main(): Promise<void> {
  const keep = process.env.KEEP_BUILDS;
  const buildRoot = keep ?? fs.mkdtempSync(path.join(ROOT, 'node_modules', '.update-adoption-'));
  fs.mkdirSync(buildRoot, { recursive: true });

  const oldBuild = build('old build', 'check-old-build', path.join(buildRoot, 'old'));
  const newBuild = build('new build', 'check-new-build', path.join(buildRoot, 'new'));

  assert(
    oldBuild.entry !== newBuild.entry,
    `the two builds are the same bundle (${oldBuild.entry}) — nothing to update to, ` +
      `so this check could not fail. Is the APP_VERSION override in vite.config.ts still there?`,
  );

  let served = oldBuild.dir;
  const server = await startServer(() => served);

  const profile = fs.mkdtempSync(path.join(buildRoot, 'profile-'));
  const context: BrowserContext = await chromium.launchPersistentContext(profile, {
    headless: !process.env.HEADED,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const browser: Browser | null = context.browser();
  const page = await context.newPage();

  const trace: string[] = [];
  let failure: Error | null = null;
  try {
    // ---- a returning player: two visits on the old build, worker installed.
    await page.goto(ORIGIN, { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    const visit1 = await read(page);
    trace.push(line('visit 1 (old build, SW installs)', visit1));

    await page.reload({ waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    const visit2 = await read(page);
    trace.push(line('visit 2 (old build, SW controls)', visit2));

    // Without these two, everything below could pass while proving nothing:
    // an uncontrolled page picks up a new build on any reload, service worker
    // or no service worker.
    assert(
      visit2.entry === oldBuild.entry,
      `visit 2 was executing ${visit2.entry}, expected the old build's ${oldBuild.entry}`,
    );
    assert(
      visit2.controller !== 'none',
      'no service worker was controlling the page before the deploy — this run was not a ' +
        'returning player at all, and could not have observed the bug',
    );

    // ---- the deploy.
    served = newBuild.dir;
    trace.push(`>>> deploy: ${oldBuild.entry} -> ${newBuild.entry}`);

    // ---- ONE ordinary reload. No clicking, no clearing, no closing tabs.
    await page.reload({ waitUntil: 'load' });
    const deadline = Date.now() + ADOPT_TIMEOUT_MS;
    let after = await read(page);
    while (after.entry !== newBuild.entry && Date.now() < deadline) {
      await page.waitForTimeout(500);
      after = await read(page);
    }
    trace.push(line('visit 3 (one reload after deploy)', after));

    assert(
      after.entry === newBuild.entry,
      `a returning player is STILL executing ${after.entry} ${Math.round(ADOPT_TIMEOUT_MS / 1000)}s ` +
        `after an ordinary reload; the deployed build is ${newBuild.entry}. ` +
        `waiting=${after.waiting} gate=${after.gate} sw=${after.controller}. That is issue #341.`,
    );
    assert(
      after.controller === 'sw.js',
      `the new build is running but no service worker controls it (sw=${after.controller}) — ` +
        'offline play would be broken even though the version is right',
    );

    // ---- and the other direction, which matters just as much.
    //
    // The cheap way to make everything above go green is `skipWaiting: true` in
    // the worker, and it would be **wrong**: it swaps the precache under a page
    // that is playing, so the next lazy chunk the park generator asks for is
    // already gone. The rule is "nobody has touched this page yet", so touch it,
    // deploy again, and prove the page now *waits* — gate up, ride intact.
    await page.keyboard.press('Shift');
    served = oldBuild.dir;
    trace.push(`>>> deploy while playing: ${newBuild.entry} -> ${oldBuild.entry}`);
    // What `version-check.ts`'s two-minute poll does when it sees a new
    // version, minus the two minutes. Same trigger, same flow.
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });
    const settle = Date.now() + 8_000;
    let playing = await read(page);
    while (!playing.gate && Date.now() < settle) {
      await page.waitForTimeout(250);
      playing = await read(page);
    }
    await page.waitForTimeout(4_000);
    playing = await read(page);
    trace.push(line('mid-play deploy (must ask first)', playing));

    assert(
      playing.entry === newBuild.entry,
      `the page swapped itself to ${playing.entry} while someone was playing, without being ` +
        'asked. That loses whatever ride she was on, and it is what `skipWaiting: true` does.',
    );
    assert(
      playing.gate,
      'a deploy landed mid-play and the update gate never appeared — she would be left on the ' +
        'old build with nothing offering her the new one',
    );

    // The button a finger presses still has to work, and it is the same code
    // path the untouched page takes automatically.
    await page.click('.update-gate-go');
    const buttonDeadline = Date.now() + ADOPT_TIMEOUT_MS;
    let pressed = await read(page);
    while (pressed.entry !== oldBuild.entry && Date.now() < buttonDeadline) {
      await page.waitForTimeout(500);
      pressed = await read(page);
    }
    trace.push(line('after pressing "Take me there!"', pressed));
    assert(
      pressed.entry === oldBuild.entry,
      `"Take me there!" was pressed and the page is still executing ${pressed.entry}, ` +
        `not the deployed ${oldBuild.entry}`,
    );
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }

  await context.close();
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!keep) fs.rmSync(buildRoot, { recursive: true, force: true });

  process.stdout.write(`\n${trace.join('\n')}\n\n`);
  if (failure) {
    process.stdout.write(`check:update-adoption FAILED\n  ${failure.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `check:update-adoption OK — one reload after the deploy moved the executing bundle ` +
      `from ${oldBuild.entry} to ${newBuild.entry}, with nobody pressing anything.\n`,
  );
}

await main();
