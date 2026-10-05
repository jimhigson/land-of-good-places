import { registerSW } from 'virtual:pwa-register';
import { UpdateGate } from './ui/UpdateGate';
import { canAdoptWithoutAsking, noteAdopting, watchForFirstTouch } from './update-adoption';
import { startVersionCheck } from './version-check';

/**
 * Registers the service worker ourselves (rather than the PWA plugin's own
 * injected script — see `vite.config.ts`'s `injectRegister: false`) purely to
 * get at `onNeedRefresh`: the one hook that fires when a new deploy has
 * finished downloading in the background and is sat waiting. That is the gate's
 * entire trigger — this function itself polls or schedules nothing.
 *
 * `startVersionCheck` (`version-check.ts`), in production only, is what
 * actually schedules anything: a browser only checks a service worker for
 * updates on navigation, and the family leaves the game open on a phone for
 * hours mid-session, so a deploy could otherwise sit undetected the whole
 * time it is open. It polls a plain `version.txt` every two minutes and, the
 * moment that disagrees with this bundle's own version, calls the service
 * worker's own `update()` — which is what makes `onNeedRefresh` below fire,
 * same as it always has. One trigger path, just two ways to reach it.
 *
 * Kept out of `Game` and `main.ts` entirely, and called by `bootstrap.ts`
 * before the park is even loaded: a new version of the *code*, not of the park, so it must
 * keep working even on the day `Game`'s constructor throws and the splash
 * turns into an apology — that is exactly the day the family most needs to be
 * able to refresh their way to a fix. `UpdateGate` touches nothing but the
 * DOM for the same reason.
 */
export function setupUpdateGate(uiRoot: HTMLElement): void {
  const gate = new UpdateGate(uiRoot);
  watchForFirstTouch();
  const takeIt = (): void => {
    noteAdopting();
    updateSW(true);
  };
  const updateSW = registerSW({
    // Register now rather than on the window `load` event (workbox's default).
    // "Am I even the right build?" is not a question to ask after every image
    // and font has finished arriving: the sooner the answer comes back, the
    // smaller the window in which this page pulls lazy chunks that the incoming
    // worker is about to sweep out of the precache — see `update-adoption.ts`.
    immediate: true,
    onNeedRefresh: () => {
      // The whole of issue #341 is this branch. A reload cannot promote a
      // waiting service worker, so on a page nobody has touched yet we take the
      // new build without asking; once she is playing, the gate waits for its
      // button as it always has, because a swap means a reload and a reload
      // mid-ride loses the ride.
      if (canAdoptWithoutAsking()) gate.showAndGo(takeIt);
      else gate.show(takeIt);
    },
    onRegisterError: (error: unknown) => {
      console.error('Land of Good Places: service worker registration failed.', error);
    },
  });
  // Exposed for the same reason `window.game` is: this is how the "new version
  // ready" gate gets exercised from the console without waiting for a real
  // deploy. Note that pressing its button really does reload the page.
  if (import.meta.env.DEV) {
    (window as unknown as { __triggerUpdateGate: () => void }).__triggerUpdateGate = () =>
      gate.show(takeIt);
  }
  // `version.txt` only exists in a real build (`vite.config.ts`'s
  // `versionFilePlugin`), so polling for it in dev would just be a 404 every
  // two minutes for nothing — dev already gets instant feedback from HMR.
  if (import.meta.env.PROD) startVersionCheck();
}

