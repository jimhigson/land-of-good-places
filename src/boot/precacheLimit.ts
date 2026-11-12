/**
 * **The largest single file the service worker will precache**, in bytes.
 *
 * One owner for two readers: `vite.config.ts` hands it to workbox as
 * `maximumFileSizeToCacheInBytes`, and `check:boot-chunk` holds every emitted
 * chunk under it and the boot chunks well under it. A file over this is not
 * precached — and the build fails rather than ship a game that cannot start
 * offline (that is what turned main red on 12 Nov 2026, when the one Game
 * chunk carried every interior and grew to 4.2 MB).
 *
 * **Do not raise it to make a build pass.** Jim's ruling, the same day: the
 * fix for a chunk that is too big is to load what it carries on demand — every
 * interior when she enters it, every mini-game when she goes through its
 * curtain — not a bigger limit.
 */
export const PRECACHE_FILE_LIMIT_BYTES = 4 * 1024 * 1024;
