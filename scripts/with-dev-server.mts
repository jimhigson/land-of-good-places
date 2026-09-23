/**
 * **Serve the game, run some checks against it, stop the server.**
 *
 * ```
 * node ... scripts/with-dev-server.mts pnpm run check:walking -- pnpm run check:deep-links
 * ```
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
