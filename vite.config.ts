import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// No `@types/node` in this project (a browser game has no business seeing
// `process`, `Buffer`, `require`, etc as ambient globals in `src/`) — this
// config file is the one place that legitimately needs the one field of
// `process` it actually reads.
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

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
 * lets `src/main.ts` show the friendly "🎈 a new version is ready" toast
 * (`src/ui/UpdateToast.ts`) and only reload when the child taps Refresh.
 * `injectRegister: false` because that toast needs the `onNeedRefresh`
 * callback, which means registering the service worker ourselves from
 * `virtual:pwa-register` instead of letting the plugin inject its own
 * registration script — doing both would register twice.
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
  plugins: [
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
        // `UpdateToast`'s Refresh button calls `updateSW(true)`, which posts
        // `SKIP_WAITING` to it. Leaving either of these `true` makes the new
        // worker take over the instant it is downloaded, in the background,
        // regardless of `registerType`, which quietly defeats the toast: the
        // callback would still fire, but the swap it is meant to be asking
        // permission for would already have happened.
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
      // Testing the manifest/update-toast machinery itself is rare enough to
      // be worth an explicit opt-in instead of the default every dev server
      // paid for: `VITE_PWA_DEV=1 npm run dev`.
      devOptions: {
        enabled: !!process.env.VITE_PWA_DEV,
        type: 'module',
      },
    }),
  ],
});
