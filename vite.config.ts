import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { VERSION_FILE_NAME } from './src/version-file';

// No `@types/node` in this project (a browser game has no business seeing
// `process`, `Buffer`, `require`, etc as ambient globals in `src/`) — the
// `child_process`/`fs` typings this file needs are hand-declared in
// `vite-config-env.d.ts` instead (a `.d.ts` file, not a module with its own
// imports, is what lets an ambient `declare module` for an external module
// actually take).
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

/**
 * The running build's own identity — the current commit, or a timestamp if
 * this somehow isn't a git checkout. Baked into the bundle as `__APP_VERSION__`
 * (below) and written verbatim to `dist/version.txt` by {@link versionFilePlugin},
 * so a client polling that file (`src/version-check.ts`) is comparing exactly
 * what it already knows about itself against exactly what the server would
 * hand a brand-new visitor right now.
 */
const APP_VERSION = (() => {
  // `APP_VERSION=<something>` overrides the commit. Only one thing sets it:
  // `scripts/check-update-adoption.mts`, which has to mint **two** builds that
  // differ from a single working tree — the same source built twice is byte
  // identical, so without this there would be no second build to update *to*,
  // and the check would be testing the current commit against itself. Because
  // the version is inlined into the bundle (`__APP_VERSION__` below), giving it
  // a different value is enough to change every hashed filename, which is
  // exactly what that check measures.
  const override = process.env.APP_VERSION;
  if (override) return override;
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return `unknown-${Date.now()}`;
  }
})();

/**
 * Writes `version.txt` straight into the build output, not `public/` — it is
 * generated fresh every build, not hand-authored, so it has no business being
 * a tracked source file that could go stale between commits.
 *
 * The name comes from `src/version-file.ts`, which is also what
 * `src/version-check.ts` polls and what `scripts/check-live-version.mts`
 * fetches off the live site: one owner, so the writer and the readers cannot
 * drift apart.
 */
function versionFilePlugin(version: string): Plugin {
  return {
    name: 'land-of-good-places-version-file',
    apply: 'build',
    writeBundle(options) {
      writeFileSync(`${options.dir ?? 'dist'}/${VERSION_FILE_NAME}`, version);
    },
  };
}

/**
 * Vite config.
 *
 * The PWA half exists so the family can play full-screen on a phone: added to
 * the home screen the game loses the browser chrome (which on a small screen is
 * about a fifth of the park), and the service worker precaches the whole build,
 * so it opens instantly and keeps working somewhere with no signal.
 *
 * The game deploys at the root of a workers.dev domain, so `start_url` and
 * `scope` are both `/` and there is no `base` to set. If it ever moves under a
 * path, all three have to change together.
 *
 * **`registerType: 'prompt'`, not `autoUpdate`.** `autoUpdate` swaps the
 * service worker and reloads the page the moment a new build is noticed —
 * silently, mid-session. That is fine for most of the day, but the family
 * plays with the game open on a phone for hours while features land, and an
 * unannounced reload can land mid-ride (the slide, the ferris wheel, a
 * mini-game) and lose a moment nobody asked to lose. `prompt` instead leaves
 * the new worker "waiting" until something calls `updateSW()`, which is what
 * lets `src/main.ts` raise the full-screen "A brand new park!" gate
 * (`src/ui/UpdateGate.ts`) rather than reloading out of nowhere.
 * `injectRegister: false` because that gate needs the `onNeedRefresh`
 * callback, which means registering the service worker ourselves from
 * `virtual:pwa-register` instead of letting the plugin inject its own
 * registration script — doing both would register twice.
 *
 * **Who calls `updateSW()` is decided in the page, not here** — see
 * `src/update-adoption.ts`. On a page nobody has touched yet (a returning
 * player who has just reloaded, which is the only way most people ever see an
 * update) the gate presses its own button, because a reload on its own
 * **cannot** promote a waiting worker and that left real players on a
 * months-old bundle for ever, issue #341. Once somebody is playing, it waits
 * to be asked. That is the whole reason the two flags below stay false: the
 * *timing* of the swap is a decision only the page has the facts for, and the
 * worker skipping waiting by itself takes it away.
 */
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  // The bundle's own baked-in copy of `APP_VERSION`, read by
  // `src/version-check.ts` — see that file for why polling a flat text file
  // beats waiting on the service worker's own, much less frequent, update
  // checks.
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [
    versionFilePlugin(APP_VERSION),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // The plugin already precaches the manifest and every icon listed in it,
      // so the glob below deliberately leaves PNGs alone — sweeping them up
      // there as well just duplicates entries. This one is not in the manifest.
      includeAssets: ['apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Land of Good Places',
        short_name: 'Good Places',
        description: 'A cute, cosy theme park. By Eleri age 6, and Jim age 44.',
        lang: 'en-GB',
        display: 'standalone',
        // Phones get held whichever way round; the camera copes with both.
        orientation: 'any',
        start_url: '/',
        scope: '/',
        // The theme colour matches the sky the boot splash fades in from, so the
        // launch screen is the same colour as the game behind it.
        theme_color: '#8fd3ff',
        background_color: '#7ec8f0',
        categories: ['games', 'kids'],
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The whole park is code — precaching it is precaching the game.
        globPatterns: ['**/*.{js,css,html,svg,ico}'],
        // Raised from workbox's 2 MiB default so that a future asset cannot
        // silently drop out of the precache and break offline play.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Both **false**, the opposite of the old `autoUpdate` setup: this is
        // the actual mechanism `prompt` mode relies on. A new service worker
        // installs but sits in the browser's "waiting" state — not
        // `clientsClaim`ing the open tab, not told to `skipWaiting` — until
        // something calls `updateSW(true)`, which posts `SKIP_WAITING` to it.
        // Leaving either of these `true` makes the new worker take over the
        // instant it is downloaded, in the background, regardless of
        // `registerType`, which quietly defeats the gate: the callback would
        // still fire, but the swap it is meant to be asking permission for
        // would already have happened — under a page that is *playing*, whose
        // next lazy `import()` would then 404 out of a precache that no longer
        // has it. `scripts/check-update-adoption.mts` fails if either of these
        // is turned on, and fails just as loudly if the page stops adopting a
        // waiting build on a plain reload. Both halves, one check.
        clientsClaim: false,
        skipWaiting: false,
      },
      // **Off by default.** A dev-mode service worker outlives the code it
      // was built from: `registerType: 'prompt'` plus `skipWaiting: false`
      // above mean once a browser tab registers one against a given
      // origin+port, that origin keeps serving the old cached bundle through
      // every subsequent edit, `git checkout`, or restart, until someone
      // manually unregisters it — the exact trap CLAUDE.md's "a stale service
      // worker will waste your hour" section warns about, except it used to
      // fire on *every* dev server, not just after a real deploy. With a
      // dozen agents each picking a fresh port for `npm run dev` all day,
      // that was a service worker minted (and then gone stale) many times an
      // hour for no reason a plain Vite dev server should have.
      //
      // **`npm run preview` is where the worker gets tested** — not a dev
      // server with the flag below. `workbox.globPatterns` above precaches the
      // *built* output, and in dev there is no built output: Vite serves
      // unbundled ES modules straight out of `src/`. A dev worker therefore
      // caches a different set of files by a different mechanism than the one
      // that ships, so it can show the registration plumbing is wired up but
      // never that the thing which actually reaches a phone is right.
      // `vite preview` serves real `dist/` with the generated `sw.js`, the
      // real precache manifest, and the real `clientsClaim`/`skipWaiting`
      // waiting-worker behaviour the update toast leans on — subtle enough to
      // deserve a truthful test rather than an approximate one. Measured
      // 6 Aug 2026: `npm run dev` registers no worker and leaves `caches`
      // empty, while `npm run preview` registers one and precaches the nine
      // entries `dist/sw.js` lists.
      //
      // This flag is the **one owner** of that decision. `src/main.ts`'s
      // `registerSW(...)` is deliberately left unguarded: with `enabled`
      // false the plugin resolves `virtual:pwa-register` to a stub whose
      // `registerSW` ignores its options and returns a no-op, so nothing
      // reaches `onRegisterError` and nothing throws. Do not add a second
      // `import.meta.env` check there to match this one — that is two places
      // to keep in sync, and the config would stop being the answer.
      //
      // Kept for the rare case of exercising that registration plumbing
      // itself under HMR: `VITE_PWA_DEV=1 npm run dev`.
      devOptions: {
        enabled: !!process.env.VITE_PWA_DEV,
        type: 'module',
      },
    }),
  ],
});
