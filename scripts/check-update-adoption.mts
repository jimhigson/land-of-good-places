/**
 * **Does ONE reload put a returning player on the newest build — in Chromium
 * and in WebKit, and when the new build takes a while to download?**
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
 * And 15 Nov 2026, on his iPhone, after #341 was fixed: *"refreshed the page a
 * few times and eventually we have it"*. The reload does adopt a build that has
 * *finished* downloading — but on a phone the download is seconds, and for
 * those seconds the page used to boot the old build, fully playable, with
 * nothing on screen saying a new one was coming. The first tap in that window
 * (she starts playing) turned "adopt it" into "ask", and a reload in that window
 * just showed the old build again. So the second half of this check holds the
 * new build's download open on purpose and makes the child touch the screen
 * while it is held.
 *
 * This check is those reports, scripted, and it is the only kind of check that
 * could have caught them: nothing about the *source* is wrong in the stale case
 * — the bundle builds, the worker registers, the gate even appears. The bug
 * lives entirely in what a second browser visit executes.
 *
 * ## What it does
 *
 * Two **real builds** of the current tree (`APP_VERSION` is the only difference,
 * which is enough to change every hashed filename — see `vite.config.ts`),
 * served from one static server whose document root can be flipped: that flip is
 * the deploy. The server can also **hold back one file of the new build** — its
 * entry chunk, which the incoming worker's install has to fetch — until the
 * check releases it: that is a slow phone download, made deterministic. One
 * **persistent** profile per engine visits it — a returning player, not a fresh
 * incognito visit — and goes through, in order:
 *
 * 1. **A returning player.** Two visits on the old build; the second is
 *    controlled by the worker. The second visit is made with `version.txt` held,
 *    so it also proves a server that does not answer only delays the boot by
 *    the bound (`ASK_SERVER_WITHIN_MS`), never hangs it.
 * 2. **One reload after a deploy, with the download held.** The gate must be up
 *    ("Getting it…") and the old park must not have started; the child presses a
 *    key; the download is released; the page must be on the new build — with
 *    nobody pressing the gate's button.
 * 3. **A deploy while she is playing.** Touched page, deploy, the poll's
 *    `update()`: the gate must come up and *wait* — no swap, no reload — and its
 *    button must then work. This is what `skipWaiting: true` would break.
 * 4. **A reload that lands mid-download.** She is playing, a deploy lands, the
 *    poll starts the download (held), and *then* she reloads — once. Same
 *    assertions as 2.
 * 5. **A download that does not finish in time.** The gate waits for
 *    `FETCH_NEW_BUILD_WITHIN_MS`, then stands down and the build she already
 *    has boots — bounded, not hung. When the download does finish, she has
 *    been playing, so the gate asks rather than reloading under her.
 *
 * The measurement throughout is the same one #341 quotes: the `src` of the
 * module script the page is actually executing, read off the page — plus the
 * game's own "park seed" boot line, to know whether the old park started, and
 * the main frame's navigations, to know whether anything reloaded.
 *
 * ```
 * pnpm run check:update-adoption
 * ```
 *
 * `UPDATE_ADOPTION_BROWSERS=chromium` (or `webkit`) runs one engine; the
 * default is both, because the report that reopened this was Safari's.
 * `KEEP_BUILDS=<dir>` reuses (and leaves behind) the two builds while iterating
 * on the client-side fix. `HEADED=1` shows the browser. `PORT` moves the server.
 *
 * ## Why it is not in `pnpm run check`
 *
 * It drives two browsers, and needs WebKit, which the check shards do not
 * install — a check that is quietly skipped is worse than no check (CLAUDE.md),
 * so it gets its own workflow that installs both on purpose
 * (`.github/workflows/update-adoption.yml`).
 */
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit, type BrowserContext, type BrowserType, type Page } from 'playwright-core';
import { SUPPORTED_PARK_SEEDS } from '../src/world/prebuilt/parkFileName.ts';
import { ASK_SERVER_WITHIN_MS, FETCH_NEW_BUILD_WITHIN_MS } from '../src/update-adoption.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const PORT = Number(process.env.PORT ?? 5482);
const ORIGIN = `http://127.0.0.1:${PORT}`;
/**
 * **The page this check visits, with its park pinned.** The profile never makes
 * a character, and a character-less page whose seed was *remembered* from an
 * earlier visit forgets it and reloads itself (`startFresh` in `src/main.ts`,
 * issue #426). So on a bare `/`, every reload this check makes is followed by a
 * second one the page makes, at whatever moment the boot gets there. Measured
 * 14 Nov 2026 on a production build: two main-frame navigations per reload on
 * `/`, exactly one on `/?seed=0`. The second navigation is what failed this check
 * at visit 2 ("page.evaluate: Execution context was destroyed") on a loaded Mac
 * while CI passed, and it quietly made "one ordinary reload" two. A pinned seed
 * is never remembered, so the only navigations now are this check's and the
 * adoption's own.
 */
const PAGE = `${ORIGIN}/?seed=${SUPPORTED_PARK_SEEDS[0]}`;
/**
 * How long the page gets, after the download is released, to be executing the
 * new bundle. Generous on purpose: the honest answer is "a couple of seconds",
 * and a check that fails on a loaded box is a check people learn to re-run
 * rather than read. What it must never be is *infinite* — a stale build never
 * becomes fresh, so the pre-fix behaviour spends the whole budget and then
 * reports real hashes.
 */
const ADOPT_TIMEOUT_MS = 25_000;
/**
 * How long, after the one reload, the gate gets to be up. The page raises it
 * as soon as `version.txt` answers, which on this server is milliseconds; the
 * slack is for a loaded runner, and it is still well inside
 * `ASK_SERVER_WITHIN_MS` plus a boot.
 */
const GATE_UP_WITHIN_MS = 10_000;
/** How long a held download is kept held while the child presses things. */
const HELD_FOR_MS = 2_000;

const ENGINES: Readonly<Record<string, BrowserType>> = { chromium, webkit };

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
 * The deploy, and the network. Serves one directory; point it at the other one
 * and every subsequent request is the new build — including, crucially,
 * `sw.js`, which is what the browser's own update check fetches on navigation.
 *
 * `hold` is a slow network made deterministic: a request for exactly that path
 * is not answered until {@link Server.release}. Holding **one** file is enough
 * to hold a whole install open (workbox's precache install finishes only when
 * every entry has arrived), and it leaves the browser's other connections to
 * this host free — holding everything would starve `version.txt` and `sw.js`
 * of a connection, and measure that instead of the app.
 *
 * A **missing file is a 404, never a fallback to `index.html`** for anything
 * under `/assets/`. That matters: after a deploy the old build's hashed chunks
 * are gone, and a server that quietly handed back HTML instead would hide
 * exactly the failure mode this whole area is about.
 */
interface Server {
  root: string;
  hold: string | null;
  /** Every request for the held path that arrived while it was held. */
  readonly heldRequests: number[];
  release(): void;
  close(): Promise<void>;
}

async function startServer(initialRoot: string): Promise<Server> {
  const parked: Array<() => void> = [];
  const state: Server = {
    root: initialRoot,
    hold: null,
    heldRequests: [],
    release() {
      state.hold = null;
      for (const answer of parked.splice(0)) answer();
    },
    close: () => new Promise<void>((resolve) => http_.close(() => resolve())),
  };
  const http_ = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', ORIGIN);
    const root = state.root;
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') file = path.join(root, 'index.html');
    const answer = (): void => {
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        if (url.pathname.startsWith('/assets/')) {
          res.writeHead(404).end('gone with the last deploy');
          return;
        }
        file = path.join(root, 'index.html');
      }
      // What the live host sends for **every** file, hashed assets included —
      // measured on landofgoodplaces.blockstack.ing, 15 Nov 2026: `public,
      // max-age=0, must-revalidate` and an ETag. So a browser revalidates each
      // one, and a file it already has costs a request and a 304 rather than
      // nothing. That matters here twice: it is the real cost of a download,
      // and it is what lets a held file hold an install of a build this
      // profile has downloaded before (phase 4 installs the same build as
      // phase 2; workbox fetches a hashed file with the HTTP cache allowed).
      const stat = fs.statSync(file);
      const etag = `"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
      const headers = {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'public, max-age=0, must-revalidate',
        etag,
      };
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers).end();
        return;
      }
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(res);
    };
    if (state.hold !== null && url.pathname === state.hold) {
      state.heldRequests.push(Date.now());
      parked.push(answer);
      return;
    }
    answer();
  });
  await new Promise<void>((resolve) => http_.listen(PORT, '127.0.0.1', () => resolve()));
  return state;
}

// ------------------------------------------------------------------ probing

type GateState = 'down' | 'asking' | 'getting';

interface Reading {
  /** The entry chunk the page is executing right now. */
  readonly entry: string;
  /** The service worker script controlling the page, or `none`. */
  readonly controller: string;
  readonly waiting: boolean;
  readonly installing: boolean;
  /** Down; up with its button live ("Take me there!"); or up and on its way ("Getting it…"). */
  readonly gate: GateState;
}

/**
 * Reads the page. Retried, because the page may be navigating underneath us —
 * which is the *expected* state of affairs when the new build is adopted, since
 * that reloads the tab.
 */
async function read(page: Page): Promise<Reading> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.evaluate(async () => {
        const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
        const registration = await navigator.serviceWorker?.getRegistration();
        const controllerUrl = navigator.serviceWorker?.controller?.scriptURL ?? '';
        const gate = document.querySelector<HTMLElement>('.update-gate');
        const button = gate?.querySelector<HTMLButtonElement>('.update-gate-go');
        const up = gate?.dataset.show === 'true';
        return {
          entry: script ? script.src.split('/').pop() ?? '' : '',
          controller: controllerUrl ? controllerUrl.split('/').pop() ?? '' : 'none',
          waiting: !!registration?.waiting,
          installing: !!registration?.installing,
          gate: (!up ? 'down' : button?.disabled ? 'getting' : 'asking') as GateState,
        };
      });
    } catch (error) {
      if (attempt >= 40) throw error;
      await page.waitForTimeout(250);
    }
  }
}

/** Fails loudly rather than returning false — every one of these is the check. */
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** What the page did, from the outside: every boot of the game and every navigation. */
interface Watch {
  /** `Date.now()` of each "park seed" line — `main.ts`'s `boot()` starting a park. */
  readonly boots: number[];
  /** `Date.now()` of each main-frame navigation. */
  readonly navigations: number[];
}

function watch(page: Page): Watch {
  const seen: Watch = { boots: [], navigations: [] };
  page.on('console', (message) => {
    if (/park seed \d+/.test(message.text())) seen.boots.push(Date.now());
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) seen.navigations.push(Date.now());
  });
  return seen;
}

const since = (times: readonly number[], from: number): number => times.filter((t) => t >= from).length;

// ------------------------------------------------------------------ run

interface Outcome {
  readonly engine: string;
  readonly trace: string[];
  readonly failure: Error | null;
}

async function launch(engine: string, profile: string): Promise<BrowserContext> {
  const type = ENGINES[engine];
  assert(type !== undefined, `unknown engine "${engine}" — expected one of ${Object.keys(ENGINES).join(', ')}`);
  return type.launchPersistentContext(profile, {
    headless: !process.env.HEADED,
    ...(engine === 'chromium'
      ? {
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
          ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        }
      : {}),
  });
}

/**
 * Which phases run. All of them, always, unless `UPDATE_ADOPTION_PHASES` names
 * a subset (`2,4`) — which exists so each phase can be proved red on its own
 * against an old tree, and is announced on stderr every time it is used.
 * Phase 1 is the returning player every other phase stands on, so it always
 * runs.
 */
const ALL_PHASES = [1, 2, 3, 4, 5] as const;
type Phase = (typeof ALL_PHASES)[number];
function phasesAsked(): ReadonlySet<Phase> {
  const asked = process.env.UPDATE_ADOPTION_PHASES;
  if (!asked) return new Set(ALL_PHASES);
  const picked = new Set<Phase>([1]);
  for (const part of asked.split(',')) {
    const n = Number(part.trim()) as Phase;
    assert(ALL_PHASES.includes(n), `UPDATE_ADOPTION_PHASES: no phase "${part}" (phases are ${ALL_PHASES.join(', ')})`);
    picked.add(n);
  }
  const skipped = ALL_PHASES.filter((n) => !picked.has(n));
  if (skipped.length > 0) {
    process.stderr.write(
      `check:update-adoption: UPDATE_ADOPTION_PHASES=${asked} — phase(s) ${skipped.join(', ')} SKIPPED, ` +
        'and this run asserts nothing about them.\n',
    );
  }
  return picked;
}

async function runEngine(
  engine: string,
  server: Server,
  a: Build,
  b: Build,
  buildRoot: string,
  phases: ReadonlySet<Phase>,
): Promise<Outcome> {
  const trace: string[] = [];
  const line = (label: string, reading: Reading, extra = ''): void => {
    trace.push(
      `${label.padEnd(40)}: ${reading.entry.padEnd(22)}` +
        ` sw=${reading.controller.padEnd(6)} installing=${String(reading.installing).padEnd(5)}` +
        ` waiting=${String(reading.waiting).padEnd(5)} gate=${reading.gate}${extra ? `  ${extra}` : ''}`,
    );
  };
  /** The build the page is on, and so the one every deploy moves away from. */
  let current = a;
  const other = (): Build => (current === a ? b : a);
  const deploy = (hold: boolean, label: string): Build => {
    const to = other();
    server.root = to.dir;
    server.hold = hold ? `/assets/${to.entry}` : null;
    server.heldRequests.length = 0;
    trace.push(`>>> ${label}: ${current.entry} -> ${to.entry}${hold ? ` (its download held at /assets/${to.entry})` : ''}`);
    return to;
  };

  const profile = fs.mkdtempSync(path.join(buildRoot, `profile-${engine}-`));
  const context = await launch(engine, profile);
  const page = await context.newPage();
  const seen = watch(page);

  /** Polls the page until `done` holds or `ms` pass; returns the last reading either way. */
  const until = async (ms: number, done: (r: Reading) => boolean): Promise<Reading> => {
    const deadline = Date.now() + ms;
    let reading = await read(page);
    while (!done(reading) && Date.now() < deadline) {
      await page.waitForTimeout(250);
      reading = await read(page);
    }
    return reading;
  };

  /** Waits until the page's last navigation has started a park, and says whether it did. */
  const bootedSinceLastNavigation = async (): Promise<boolean> => {
    const deadline = Date.now() + 15_000;
    const started = (): boolean => (seen.boots.at(-1) ?? 0) >= (seen.navigations.at(-1) ?? 0);
    while (!started() && Date.now() < deadline) await page.waitForTimeout(250);
    return started();
  };

  /**
   * She is playing: a key pressed once the page can notice it.
   *
   * **Only once the page can notice the touch.** A wait for a new entry chunk
   * ends the moment the new build's entry script is in the DOM, which is as
   * soon as the adoption's reload has parsed its HTML — long before the page
   * starts `watchForFirstTouch`. A key pressed in that gap is pressed at
   * nothing: the page stays "untouched", adopts the next deploy on its own, and
   * this went red on PR #721's 1648d36a for a race of its own, not the app's.
   * The watch now starts as the park starts to load (`update-adoption.ts`,
   * "before the park has started"), so the park's own boot line is the sign it
   * is on.
   */
  const startPlaying = async (): Promise<number> => {
    assert(await bootedSinceLastNavigation(), 'the page never started its park, so there was nothing to be playing');
    await page.keyboard.press('Shift');
    return Date.now();
  };

  /** What `version-check.ts`'s once-a-minute poll does when it sees a new version, minus the minute. */
  const poll = (): Promise<void> =>
    page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      void registration?.update();
    });

  /**
   * The shared middle of phases 2 and 4: a reload has just happened with the
   * new build's download held. The gate must be up and on its way, the old park
   * must not have started, a key press must change nothing, and releasing the
   * download must land the page on `to` with nobody pressing the button.
   */
  const heldReloadLandsOn = async (to: Build, reloadedAt: number, label: string): Promise<void> => {
    const from = current;
    const held = await until(GATE_UP_WITHIN_MS, (r) => r.gate !== 'down');
    line(`${label}: download held`, held, `old park booted=${since(seen.boots, reloadedAt)}`);
    assert(
      held.entry === from.entry,
      `${label}: expected the old build ${from.entry} while the new one's download is held, got ${held.entry}`,
    );
    assert(
      held.gate === 'getting',
      `${label}: one reload after the deploy and the gate is "${held.gate}" — nothing on screen says a new park ` +
        `is coming, so she starts playing the old one while it downloads (the 15 Nov report). Expected the gate up ` +
        `and "Getting it…" within ${GATE_UP_WITHIN_MS / 1000}s, as soon as version.txt answers.`,
    );
    assert(
      since(seen.boots, reloadedAt) === 0,
      `${label}: the old park started (${since(seen.boots, reloadedAt)} boot line(s) after the reload) while a newer ` +
        'build was known to be on its way — the boot should wait for it, bounded',
    );

    // She touches the screen while it downloads. On the old flow this is the
    // moment the adoption became a question she then had to answer.
    await page.keyboard.press('Shift');
    await page.waitForTimeout(HELD_FOR_MS);
    const touched = await read(page);
    line(`${label}: touched, still held`, touched, `old park booted=${since(seen.boots, reloadedAt)}`);
    assert(
      touched.entry === from.entry && touched.gate === 'getting',
      `${label}: a key press during the download changed the page: ${JSON.stringify(touched)}`,
    );
    // Asked again, now, and not only above: the gate goes up the instant
    // `version.txt` answers, which is before an old park that *was* booting
    // underneath it would have logged a line. Proved 15 Nov 2026 by taking the
    // boot's wait out of `bootstrap.ts`: the first reading said 0 and passed.
    // The old park boots in well under HELD_FOR_MS (visit 2 measures it), so a
    // 0 here means it was held for the whole download, not merely early.
    assert(
      since(seen.boots, reloadedAt) === 0,
      `${label}: the old park started under the gate (${since(seen.boots, reloadedAt)} boot line(s) during the ` +
        `held download) — the boot should wait for the new build, bounded, not race it`,
    );
    assert(
      server.heldRequests.length > 0,
      `${label}: the download was never actually held — no request for ${server.hold} arrived, so this proved nothing`,
    );

    server.release();
    trace.push(`>>> ${label}: download released`);
    const after = await until(ADOPT_TIMEOUT_MS, (r) => r.entry === to.entry);
    line(`${label}: after the download`, after);
    assert(
      after.entry === to.entry,
      `${label}: a returning player is STILL executing ${after.entry} ${ADOPT_TIMEOUT_MS / 1000}s after the download ` +
        `finished; the deployed build is ${to.entry}. waiting=${after.waiting} gate=${after.gate} sw=${after.controller}.`,
    );
    assert(
      after.controller === 'sw.js',
      `${label}: the new build is running but no service worker controls it (sw=${after.controller}) — ` +
        'offline play would be broken even though the version is right',
    );
    // The new build boots its park — the adoption was not a dead end.
    assert(await bootedSinceLastNavigation(), `${label}: the page reached ${to.entry} but its park never started booting`);
    current = to;
  };

  let failure: Error | null = null;
  try {
    // ---- 1. A returning player: two visits on the old build, worker installed.
    await page.goto(PAGE, { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    line('1. visit 1 (old build, SW installs)', await read(page));

    // Visit 2 with `version.txt` unanswered: the boot may wait for it, but only
    // for the bound.
    server.hold = '/version.txt';
    const visit2At = Date.now();
    await page.reload({ waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    const askBound = ASK_SERVER_WITHIN_MS + 8_000;
    while (since(seen.boots, visit2At) === 0 && Date.now() < visit2At + askBound) await page.waitForTimeout(100);
    const visit2 = await read(page);
    const bootedAfter = (seen.boots.find((t) => t >= visit2At) ?? Infinity) - visit2At;
    line('1. visit 2 (old build, SW controls)', visit2, `version.txt held; park booted after ${bootedAfter} ms`);
    assert(
      server.heldRequests.length > 0,
      'visit 2 never asked for version.txt, so the "server does not answer" case was not exercised',
    );
    assert(
      Number.isFinite(bootedAfter) && bootedAfter < askBound,
      `with version.txt unanswered the park had not booted ${askBound / 1000}s after the reload — a slow server ` +
        `must cost at most ASK_SERVER_WITHIN_MS (${ASK_SERVER_WITHIN_MS} ms), never hang the boot`,
    );
    server.release();

    // Without these two, everything below could pass while proving nothing:
    // an uncontrolled page picks up a new build on any reload, service worker
    // or no service worker.
    assert(visit2.entry === a.entry, `visit 2 was executing ${visit2.entry}, expected the old build's ${a.entry}`);
    assert(
      visit2.controller !== 'none',
      'no service worker was controlling the page before the deploy — this run was not a ' +
        'returning player at all, and could not have observed the bug',
    );

    // ---- 2. The deploy, a slow download, and ONE ordinary reload.
    if (phases.has(2)) {
      const to = deploy(true, '2. deploy');
      const reloadedAt = Date.now();
      await page.reload({ waitUntil: 'load' });
      await heldReloadLandsOn(to, reloadedAt, '2. one reload');
    }

    // ---- 3. A deploy while she is playing: ask, never yank.
    //
    // `skipWaiting: true` in the worker looks like the cheap way to make a
    // reload adopt the new build, and it would be **wrong**: it swaps the
    // precache under a page that is playing, so the next lazy chunk the park
    // generator asks for is already gone. (Nor does it make a reload go green:
    // measured 14 Nov 2026, the reload stays on the old build, because its own
    // navigation is answered by the old worker before the new one installs.)
    // The rule is "nobody has touched this page yet", so touch it, deploy
    // again, and prove the page now *waits* — gate up, ride intact.
    if (phases.has(3)) {
      const playingAt = await startPlaying();
      const to = deploy(false, '3. deploy while playing');
      await poll();
      await until(8_000, (r) => r.gate !== 'down');
      await page.waitForTimeout(4_000);
      const playing = await read(page);
      line('3. mid-play deploy (must ask first)', playing, `navigations=${since(seen.navigations, playingAt)}`);
      assert(
        playing.entry === current.entry && since(seen.navigations, playingAt) === 0,
        `the page swapped itself to ${playing.entry} (or reloaded: ${since(seen.navigations, playingAt)} navigation(s)) ` +
          'while someone was playing, without being asked. That loses whatever ride she was on, and it is what ' +
          '`skipWaiting: true` does.',
      );
      assert(
        playing.gate === 'asking',
        `a deploy landed mid-play and the update gate is "${playing.gate}", not asking — she would be left on the ` +
          'old build with nothing offering her the new one',
      );

      // The button a finger presses still has to work, and it is the same code
      // path the untouched page takes automatically.
      await page.click('.update-gate-go');
      const pressed = await until(ADOPT_TIMEOUT_MS, (r) => r.entry === to.entry);
      line('3. after pressing "Take me there!"', pressed);
      assert(
        pressed.entry === to.entry,
        `"Take me there!" was pressed and the page is still executing ${pressed.entry}, not the deployed ${to.entry}`,
      );
      current = to;
    }

    // ---- 4. A reload that lands while the new build is still downloading.
    if (phases.has(4)) {
      const playingAt = await startPlaying();
      const to = deploy(true, '4. deploy while playing');
      // The poll again — and this time the download it starts is held, so it
      // is still in flight when she reloads.
      await poll();
      const downloading = await until(10_000, (r) => r.installing);
      line('4. playing, download in flight', downloading, `navigations=${since(seen.navigations, playingAt)}`);
      assert(downloading.installing, 'the new build never started installing, so there was nothing to reload into the middle of');
      assert(
        downloading.entry === current.entry && downloading.gate === 'down' && since(seen.navigations, playingAt) === 0,
        `while she plays and the new build is still downloading, nothing may change under her: ${JSON.stringify(downloading)}`,
      );
      const reloadedAt = Date.now();
      await page.reload({ waitUntil: 'load' });
      await heldReloadLandsOn(to, reloadedAt, '4. reload mid-download');
    }

    // ---- 5. A download that does not finish in time: bounded, then it asks.
    if (phases.has(5)) {
      deploy(true, '5. deploy, download stalls');
      const reloadedAt = Date.now();
      await page.reload({ waitUntil: 'load' });
      const waitingFor = await until(GATE_UP_WITHIN_MS, (r) => r.gate !== 'down');
      line('5. download stalled', waitingFor);
      assert(
        waitingFor.gate === 'getting',
        `5. the gate is "${waitingFor.gate}" one reload after a deploy; expected it up and on its way`,
      );
      const giveUpBound = FETCH_NEW_BUILD_WITHIN_MS + 15_000;
      const gaveUp = await until(giveUpBound, (r) => r.gate === 'down');
      const stoodDownAfter = Date.now() - reloadedAt;
      // The build she has must then actually start, not sit behind a dead gate.
      const booted = await bootedSinceLastNavigation();
      line('5. gave up waiting', gaveUp, `after ${stoodDownAfter} ms; park booted=${since(seen.boots, reloadedAt)}`);
      assert(
        gaveUp.gate === 'down' && gaveUp.entry === current.entry,
        `5. the download never finished and the gate did not stand down within ${giveUpBound / 1000}s ` +
          `(${JSON.stringify(gaveUp)}) — a slow network must fall back to the build she has, not hang`,
      );
      assert(booted && since(seen.boots, reloadedAt) === 1, '5. the gate stood down but the park she has did not boot');

      // Now she is playing the build she had, and the download finally lands.
      const playingAt = await startPlaying();
      server.release();
      trace.push('>>> 5. download released while she plays');
      const asks = await until(ADOPT_TIMEOUT_MS, (r) => r.gate !== 'down');
      await page.waitForTimeout(2_000);
      const late = await read(page);
      line('5. download lands mid-play', late, `navigations=${since(seen.navigations, playingAt)}`);
      assert(
        asks.gate === 'asking' &&
          late.gate === 'asking' &&
          late.entry === current.entry &&
          since(seen.navigations, playingAt) === 0,
        `5. the late download should raise the gate and ask, without reloading under her: ${JSON.stringify(late)}, ` +
          `${since(seen.navigations, playingAt)} navigation(s)`,
      );
    }
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }

  server.release();
  await context.close();
  return { engine, trace, failure };
}

async function main(): Promise<void> {
  const keep = process.env.KEEP_BUILDS;
  const buildRoot = keep ?? fs.mkdtempSync(path.join(ROOT, 'node_modules', '.update-adoption-'));
  fs.mkdirSync(buildRoot, { recursive: true });
  const engines = (process.env.UPDATE_ADOPTION_BROWSERS ?? 'chromium,webkit')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  for (const engine of engines) {
    assert(engine in ENGINES, `UPDATE_ADOPTION_BROWSERS: unknown engine "${engine}" (expected ${Object.keys(ENGINES).join(', ')})`);
  }
  const phases = phasesAsked();

  const oldBuild = build('old build', 'check-old-build', path.join(buildRoot, 'old'));
  const newBuild = build('new build', 'check-new-build', path.join(buildRoot, 'new'));

  assert(
    oldBuild.entry !== newBuild.entry,
    `the two builds are the same bundle (${oldBuild.entry}) — nothing to update to, ` +
      `so this check could not fail. Is the APP_VERSION override in vite.config.ts still there?`,
  );

  const outcomes: Outcome[] = [];
  for (const engine of engines) {
    const server = await startServer(oldBuild.dir);
    try {
      outcomes.push(await runEngine(engine, server, oldBuild, newBuild, buildRoot, phases));
    } catch (error) {
      outcomes.push({ engine, trace: [], failure: error instanceof Error ? error : new Error(String(error)) });
    }
    await server.close();
  }
  if (!keep) fs.rmSync(buildRoot, { recursive: true, force: true });

  for (const outcome of outcomes) {
    process.stdout.write(`\n── ${outcome.engine}\n${outcome.trace.join('\n')}\n`);
  }
  process.stdout.write('\n');
  const failed = outcomes.filter((outcome) => outcome.failure);
  for (const outcome of failed) {
    process.stdout.write(`check:update-adoption FAILED in ${outcome.engine}\n  ${outcome.failure?.message}\n`);
  }
  if (failed.length > 0) {
    process.exitCode = 1;
    return;
  }
  // Only what actually ran: a green line describing phases that were skipped is
  // the false cover CLAUDE.md warns about.
  const proved: Record<Phase, string> = {
    1: `a returning player's boot waited at most ${ASK_SERVER_WITHIN_MS / 1000}s for an unanswered version.txt`,
    2: 'one reload after a deploy reached the new build with its download held and the child pressing keys',
    3: 'a deploy mid-play asked first and its button worked',
    4: 'a reload that landed mid-download reached the new build too',
    5: `a stalled download fell back to the build she had after ${FETCH_NEW_BUILD_WITHIN_MS / 1000}s, then asked`,
  };
  process.stdout.write(
    `check:update-adoption OK in ${engines.join(' and ')} — ` +
      `${ALL_PHASES.filter((n) => phases.has(n)).map((n) => `(${n}) ${proved[n]}`).join('; ')}.\n`,
  );
}

await main();
