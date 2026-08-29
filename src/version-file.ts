/**
 * The published build's identity file — **one owner, three consumers.**
 *
 * `vite.config.ts` writes this file into `dist/` on every build, `version-check.ts`
 * polls it from the running game, and `scripts/check-live-version.mts` fetches it
 * from the live site to prove the deploy actually landed. Those three used to
 * each carry their own `'version.txt'`/`'/version.txt'` literal, which is this
 * repo's most-cited bug class (CLAUDE.md, "Two definitions of one thing, kept in
 * step by hand"): rename the file in the build and the poller silently 404s
 * forever, which reads exactly like "no update available".
 *
 * Contains no imports and no browser or Node globals on purpose, so the browser
 * bundle, the Vite config and a bare `node` script can all take it.
 */

/** The file's name as written into the build output directory. */
export const VERSION_FILE_NAME = 'version.txt';

/** The path it is served at — the game deploys at the root of its domain. */
export const VERSION_FILE_PATH = `/${VERSION_FILE_NAME}`;
