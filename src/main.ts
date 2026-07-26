import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { Game } from './Game';
import { UpdateToast } from './ui/UpdateToast';
import { DevBadge } from './ui';

/**
 * Entry point. Finds the canvas, builds the game, hides the splash.
 *
 * The splash is dismissed on the first rendered frame rather than immediately,
 * so nobody ever sees an empty blue rectangle while the park is being built.
 */
function boot(): void {
  const canvas = document.getElementById('game-canvas');
  const uiRoot = document.getElementById('ui-root');
  const splash = document.getElementById('boot-splash');

  if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) {
    throw new Error('Land of Good Places: expected #game-canvas and #ui-root in the document.');
  }

  const game = new Game(canvas, uiRoot);
  game.start();

  // Unmissable red "DEV" watermark — never present in a production build.
  DevBadge.mountIfDev(uiRoot);

  // Give the first frame a moment to land before revealing the park.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => splash?.classList.add('hidden'));
  });

  // Handy for poking at the world from the browser console during development.
  if (import.meta.env.DEV) {
    (window as unknown as { game: Game }).game = game;
  }
}

/**
 * Registers the service worker ourselves (rather than the PWA plugin's own
 * injected script — see `vite.config.ts`'s `injectRegister: false`) purely to
 * get at `onNeedRefresh`: the one hook that fires when a new deploy has
 * finished downloading in the background and is sat waiting. That is the
 * entire trigger for the toast — nothing here polls or schedules anything.
 *
 * Kept out of `Game` entirely, and called below independently of `boot()`'s
 * own try/catch: a new version of the *code*, not of the park, so it must
 * keep working even on the day `Game`'s constructor throws and the splash
 * turns into an apology — that is exactly the day the family most needs to be
 * able to refresh their way to a fix.
 */
function setupUpdateToast(uiRoot: HTMLElement): void {
  const toast = new UpdateToast(uiRoot);
  const updateSW = registerSW({
    onNeedRefresh: () => {
      toast.show(() => updateSW(true));
    },
    onRegisterError: (error: unknown) => {
      console.error('Land of Good Places: service worker registration failed.', error);
    },
  });
  // Exposed for the same reason `window.game` is: this is how a "new version
  // ready" toast gets exercised from the console without waiting for a real
  // deploy.
  if (import.meta.env.DEV) {
    (window as unknown as { __triggerUpdateToast: () => void }).__triggerUpdateToast = () =>
      toast.show(() => updateSW(true));
  }
}

try {
  boot();
} catch (error) {
  console.error(error);
  const splash = document.getElementById('boot-splash');
  if (splash) {
    splash.innerHTML =
      '<div class="boot-card"><h1>Oh no!</h1>' +
      '<p class="boot-sub">The park could not open.</p>' +
      '<p class="boot-hint">Check the browser console for details.</p></div>';
  }
}

// Outside `boot()`'s own try/catch on purpose — see `setupUpdateToast`'s doc
// comment. `#ui-root` is the one element both the game and the toast need;
// if even that is missing the page is broken beyond a toast's help anyway.
const uiRoot = document.getElementById('ui-root');
if (uiRoot) setupUpdateToast(uiRoot);
