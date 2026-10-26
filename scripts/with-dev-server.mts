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
import { fileURLToPath } from 'node:url';
import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Not 5173 (Vite's default) and not any port a handoff has named. */
const PORT = Number(process.env.SERVED_CHECKS_PORT ?? 5947);
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
say(`serving ${BASE}`);

/**
 * **The canonical park, built before any check asks for it.** On a source the
 * dev server has no park for yet, the first request for one runs the accept
 * loop (`scripts/lib/dev-parks.mjs`) — minutes — and a check that times its
 * pages from their first load spends its waits on that build instead: on
 * 26 Oct 2026, run locally after a source change, `check:deep-links`'s first
 * five links timed out at 120 s each while seeds 5 and 12 were built (611 s
 * and 675 s), and every link after them passed. In CI `.parks/` is restored
 * first and this is instant; on a cold tree it is the one wait, said out loud.
 * Asked again on a headers timeout (Node's fetch gives up on headers after
 * five minutes): the dev server builds a seed once, however often it is asked.
 */
const WARM_TIMEOUT_MS = 40 * 60_000;
const warmStarted = Date.now();
say(`warming park seed ${CANONICAL_PARK_SEED} — built on the first request since the source changed, which can take minutes`);
for (;;) {
  try {
    const response = await fetch(`${BASE}/parks/${CANONICAL_PARK_SEED}.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    await response.arrayBuffer();
    break;
  } catch (error) {
    const timedOut = String((error as { cause?: { code?: string } })?.cause?.code ?? '').includes('TIMEOUT');
    if (!timedOut || Date.now() - warmStarted > WARM_TIMEOUT_MS) {
      stopServer();
      throw new Error(`park seed ${CANONICAL_PARK_SEED} did not come from ${BASE}/parks/${CANONICAL_PARK_SEED}.json: ${String(error)}`);
    }
  }
}
say(`park seed ${CANONICAL_PARK_SEED} ready, ${((Date.now() - warmStarted) / 1000).toFixed(1)} s after it was asked for`);

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
