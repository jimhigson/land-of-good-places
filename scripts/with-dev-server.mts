/**
 * **Serve the game, run some checks against it, stop the server.**
 *
 * ```
 * pnpm run with-dev-server pnpm run check:walking -- pnpm run check:deep-links
 * ```
 *
 * In the gate as every `check:served-*` script (`check:served-walking` alone
 * is ~10 min on the hosted runner's software renderer). Walking and deep links
 * were pulled out once for flakiness, and neither cause was this harness:
 * `check:walking` (#699) tapped a fixed screen spot that, on some seeds, was a
 * tree; `check:deep-links` (#700) most likely lost its Escape to `InputSystem`
 * dropping a key pressed and released inside one frame (unreproduced).
 *
 * Some checks drive a real page: `check:walking` presses arrow keys at a
 * running park, `check:deep-links` opens every deep link. They were written to
 * be pointed at a dev server by hand and so, for weeks, nothing in CI ran them
 * (#526, #693) — they were `check:*` scripts that only ever checked when
 * somebody remembered. This is the missing half: the server, owned by the one
 * process that needs it.
 *
 * - **The dev server, not `vite preview`** — measured, not assumed: these checks
 *   read `window.game`, which `main.ts` exposes only under
 *   `import.meta.env.DEV`. Against a production build every case waits its
 *   full 240 s for a game that is never published and fails on a timeout —
 *   a red run about the harness, not the park.
 * - **Its own port, with `--strictPort`** (CLAUDE.md, "The browser"): a port
 *   collision is loud rather than a silent drift onto the next free one — and
 *   a check pointed at somebody else's server on the default port would be a
 *   green run about the wrong game.
 * - **Stopped by PID**, never by a process-name match, in every exit path.
 *
 * Commands are separated by `--`. Each runs in turn with the URL in the
 * environment variables those checks read; the first failure stops the rest
 * and is this process's exit code.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/**
 * **A port nobody else is on — asked of the OS, never a fixed number.** It was a
 * fixed 5947, and several agents run `pnpm run check` at once on one Mac: on
 * 11 Nov 2026 this harness's own vite failed `--strictPort` on 5947 ("Port 5947
 * is already in use"), the readiness probe below was answered by *another
 * worktree's* server on that port, and `check:deep-links` ran against that
 * server until it stopped — every later link ERR_CONNECTION_REFUSED, a red run
 * about somebody else's game. The OS hands out a free port (bind to 0, read it,
 * release it); `--strictPort` still makes the rare race on it loud.
 * `SERVED_CHECKS_PORT` pins one by hand.
 */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('no free port from the OS'))));
    });
  });
const PORT = process.env.SERVED_CHECKS_PORT ? Number(process.env.SERVED_CHECKS_PORT) : await freePort();
const BASE = `http://127.0.0.1:${PORT}`;
/** A cold dev server answers in a second or two; this is only a backstop. */
const READY_TIMEOUT_MS = 60_000;

const commands: string[][] = [[]];
for (const arg of process.argv.slice(2)) {
  if (arg === '--') commands.push([]);
  else commands.at(-1)!.push(arg);
}
if (commands.some((c) => c.length === 0)) {
  throw new Error('usage: with-dev-server.mts <command...> [-- <command...>]...  (no empty commands)');
}

const say = (line: string): void => {
  process.stdout.write(`[with-dev-server] ${line}\n`);
};

let server: ChildProcess | null = spawn(
  'pnpm',
  ['exec', 'vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'], detached: true },
);
say(`vite dev server pid ${server.pid} on ${BASE}`);

/** Kills the server's whole process group — `pnpm exec` is a wrapper round vite. */
const stopServer = (): void => {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
  say(`stopped vite dev server pid ${server.pid}`);
  server = null;
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopServer();
    process.exit(1);
  });
}
server.on('exit', (code) => {
  if (server) {
    say(`vite dev server exited on its own (code ${code}) — is port ${PORT} taken?`);
    server = null;
    process.exit(1);
  }
});

const deadline = Date.now() + READY_TIMEOUT_MS;
for (;;) {
  try {
    const response = await fetch(`${BASE}/`);
    if (response.ok) break;
  } catch {
    // Not listening yet.
  }
  if (Date.now() > deadline) {
    stopServer();
    throw new Error(`vite dev server did not answer on ${BASE} within ${READY_TIMEOUT_MS / 1000} s`);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
// And it must be OUR server that answered: a vite that lost `--strictPort` exits within a second of starting,
// and the probe above can be answered meanwhile by whoever does hold the port.
await new Promise((resolve) => setTimeout(resolve, 1500));
if (!server || server.exitCode !== null) {
  throw new Error(`the vite dev server this harness started is not running — whatever answered on ${BASE} is somebody else's`);
}
say(`serving ${BASE}`);

/**
 * **The canonical park, asked for before any check asks for it.** The dev
 * server answers from the checked-in `parks/` (`scripts/lib/dev-parks.mjs`),
 * so this is instant; it stays as the one place a broken tree — a missing
 * park, a file out of step with its manifest line — fails by name, with the
 * server's own instruction, rather than as a timeout in whichever check loaded
 * a page first. (It used to wait up to 40 minutes here, for the dev server to
 * *solve* the seed after any source change: 611 s and 675 s for seeds 5 and 12
 * on 26 Oct 2026. Nothing solves on request any more.)
 */
const warmStarted = Date.now();
{
  const response = await fetch(`${BASE}/parks/${CANONICAL_PARK_SEED}.json`, { signal: AbortSignal.timeout(READY_TIMEOUT_MS) }).catch(
    (error: unknown) => {
      stopServer();
      throw new Error(`park seed ${CANONICAL_PARK_SEED} did not come from ${BASE}/parks/${CANONICAL_PARK_SEED}.json: ${String(error)}`);
    },
  );
  if (!response.ok) {
    const why = (await response.text()).slice(0, 600);
    stopServer();
    throw new Error(`park seed ${CANONICAL_PARK_SEED} did not come from ${BASE}/parks/${CANONICAL_PARK_SEED}.json — HTTP ${response.status}: ${why}`);
  }
  await response.arrayBuffer();
}
say(`park seed ${CANONICAL_PARK_SEED} served from the checked-in parks in ${Date.now() - warmStarted} ms`);

let exitCode = 0;
for (const command of commands) {
  say(`running: ${command.join(' ')}`);
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      CHECK_WALKING_URL: BASE,
      CHECK_DEEP_LINKS_URL: BASE,
      CHECK_BOOK_READER_URL: BASE,
      CHECK_MENU_REACH_URL: BASE,
      CHECK_RENDER_BUDGET_URL: BASE,
      CHECK_STATIC_FREEZE_URL: BASE,
      // check:dom-churn reads this one; without it the check falls back to
      // port 5173 and measures nothing, or somebody else's game.
      CHECK_DOM_CHURN_URL: BASE,
      // The same hole, found at integration: check:cull-audit reads this one.
      CHECK_CULL_AUDIT_URL: BASE,
    },
  });
  if (result.status !== 0) {
    say(`FAILED: ${command.join(' ')} (exit ${result.status ?? result.signal})`);
    exitCode = result.status ?? 1;
    break;
  }
}

stopServer();
process.exit(exitCode);
