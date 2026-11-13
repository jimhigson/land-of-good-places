// @ts-check
/**
 * **Park files for the dev server** — so the dev client runs exactly the path
 * production does: it fetches `/parks/<seed>.json` and hydrates, and has no
 * solver of its own (`docs/design/PREBUILT-PARKS.md`).
 *
 * **The parks are the checked-in ones, and nothing is ever solved here.** Each
 * request is answered from `parks/<seed>.json`, stamped with this build's
 * version and its park stamp by the same function `vite build` ships them with
 * (`checked-in-parks.mjs`'s `servedParkText`) — so a fresh worktree opens the
 * game the moment `pnpm install` has finished, whatever has been edited.
 *
 * Until 13 November 2026 the first request after *any* edit inside the park
 * source closure — a render-only one included — ran `build:parks` for that
 * seed in a child process: 12-30 minutes before the page could draw, for a
 * park that came out identical. That stopped a whole fleet of engineers
 * opening the game one morning, and Jim asked why the solve was needed at all.
 *
 * It does not ask whether the edited source still *accepts* the park either:
 * the dev server shows the tree as it is. `pnpm run validate:parks` answers
 * that, and CI runs it on every push.
 *
 * A seed outside the game's parks gets a 404 — the same error the game shows
 * for it in production. A park that is missing, or is not the file its
 * manifest line records, gets a 500 whose text is what to do about it.
 */
import { servedParkText } from './checked-in-parks.mjs';

/**
 * @param {string} root repository root
 * @param {string} version the bundle's `__APP_VERSION__`
 * @param {readonly number[]} seeds the seeds the game has
 */
export function devParksMiddleware(root, version, seeds) {
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
    let text;
    try {
      text = servedParkText(root, seed, version);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[dev parks] seed ${seed} cannot be served: ${message}`);
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain');
      res.end(`park ${seed} cannot be served: ${message}`);
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(text);
  };
}
