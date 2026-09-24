// @ts-check
/**
 * **Park files for the dev server** — so the dev client runs exactly the path
 * production does: it fetches `/parks/<seed>.json` and hydrates, and has no
 * solver of its own (`docs/design/PREBUILT-PARKS.md`).
 *
 * Solving still happens, but here, in build tooling: the first request for a
 * seed runs `scripts/park-file-probe.mts write` in a child Node process (the
 * same solve `build:parks` runs), caches the file under
 * `.parks/dev/<source hash>/`, and serves it stamped with this build's
 * version. The cache is keyed on {@link parkSourceHash}, so an edit to `src/`
 * re-solves on the next request rather than serving a park from other code.
 * A seed outside the game's parks gets a 404 — the same error the game shows
 * for it in production. Files `build:parks` wrote for the current source are
 * served straight from `.parks/`, so a browser session over many seeds can be
 * made instant by running it first.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { parkSourceHash } from './park-source-hash.mjs';

const run = promisify(execFile);

/**
 * @param {string} root repository root
 * @param {string} version the bundle's `__APP_VERSION__`
 * @param {readonly number[]} seeds the seeds the game has
 */
export function devParksMiddleware(root, version, seeds) {
  /** @type {Map<string, Promise<string>>} */
  const inFlight = new Map();

  /** @param {number} seed */
  async function parkFile(seed) {
    const source = parkSourceHash(root);
    // Parks `pnpm run build:parks` already solved from this very source are
    // used as they are — run it once before a browser session that will visit
    // many seeds, and nothing is solved on request.
    try {
      const manifest = JSON.parse(readFileSync(join(root, '.parks', 'manifest.json'), 'utf8'));
      const built = join(root, '.parks', `${seed}.json`);
      if (manifest.sourceHash === source && manifest.seeds.includes(seed) && existsSync(built)) return built;
    } catch {
      // No build:parks output (or an unreadable one): solve on request below.
    }
    const dir = join(root, '.parks', 'dev', source.slice(0, 16));
    const file = join(dir, `${seed}.json`);
    if (existsSync(file)) return file;
    const key = file;
    let pending = inFlight.get(key);
    if (!pending) {
      pending = (async () => {
        mkdirSync(dir, { recursive: true });
        const partial = `${file}.${process.pid}.partial`;
        const started = Date.now();
        console.log(`[dev parks] solving seed ${seed} (first request since the source changed)…`);
        await run(
          process.execPath,
          ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', 'scripts/park-file-probe.mts', 'write', partial],
          { cwd: root, env: { ...process.env, LGP_SEED: String(seed) }, maxBuffer: 256 * 1024 * 1024 },
        );
        renameSync(partial, file);
        console.log(`[dev parks] seed ${seed} solved in ${((Date.now() - started) / 1000).toFixed(1)} s`);
        return file;
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return pending;
  }

  /** @type {(req: { url?: string }, res: any, next: () => void) => void} */
  return (req, res, next) => {
    const match = /^\/parks\/(\d+)\.json(?:\?.*)?$/.exec(req.url ?? '');
    if (!match) return next();
    const seed = Number(match[1]);
    if (!seeds.includes(seed)) {
      res.statusCode = 404;
      res.setHeader('content-type', 'text/plain');
      res.end(`no park ${seed}: this game has seeds ${seeds.join(', ')}`);
      return;
    }
    parkFile(seed).then(
      (file) => {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify({ ...parsed, build: version }));
      },
      (error) => {
        console.error(`[dev parks] seed ${seed} failed to solve:`, error);
        res.statusCode = 500;
        res.setHeader('content-type', 'text/plain');
        res.end(`park ${seed} failed to solve: ${String(error)}`);
      },
    );
  };
}
