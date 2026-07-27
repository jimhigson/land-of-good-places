import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { Game } from './Game';
import { UpdateGate } from './ui/UpdateGate';
import { CharacterCreation, DevBadge, hasCreatedCharacter, markCharacterCreated } from './ui';
import { gameStore } from './state';

/**
 * Entry point. Finds the canvas, shows the character creator on a brand-new
 * browser, then builds the game and hides the splash.
 *
 * The splash is dismissed on the first rendered frame rather than immediately,
 * so nobody ever sees an empty blue rectangle while the park is being built.
 *
 * **Character creation runs here, before `Game` exists** — deliberately not
 * a `Game`-owned overlay like `WhatsNew`. `Player`'s constructor reads
 * `gameStore.get().player` (name, hair colour and style, outfit colour) the
 * moment it builds the kid; running the chooser first means that read simply
 * sees the family's actual choices, rather than needing a "rebuild the live
 * player model" path that nothing else in the game has (a hair *style*
 * change swaps meshes, not just a colour). It also guarantees the chooser
 * finishes before the cat-bus arrival sequence (`world/entrance/`), whenever
 * that gets wired up — nothing downstream of `new Game(...)` can run before
 * this does, because `Game` itself doesn't exist yet.
 */
function boot(): void {
  const canvas = document.getElementById('game-canvas');
  const uiRoot = document.getElementById('ui-root');
  const splash = document.getElementById('boot-splash');

  if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) {
    throw new Error('Land of Good Places: expected #game-canvas and #ui-root in the document.');
  }

  if (hasCreatedCharacter()) {
    launchGame(canvas, uiRoot, splash);
    return;
  }

  // The chooser supplies its own full-screen backdrop immediately, so the
  // generic "building the garden…" splash card would only be a flash behind
  // it — hide it now rather than waiting for a first game frame that is still
  // a form submission away.
  splash?.classList.add('hidden');
  new CharacterCreation(uiRoot, {
    onComplete: (choice) => {
      gameStore.completeCharacterCreation(choice);
      markCharacterCreated();
      launchGame(canvas, uiRoot, splash);
    },
  });
}

function launchGame(canvas: HTMLCanvasElement, uiRoot: HTMLElement, splash: HTMLElement | null): void {
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
 * entire trigger for the gate — nothing here polls or schedules anything.
 *
 * Kept out of `Game` entirely, and called below independently of `boot()`'s
 * own try/catch: a new version of the *code*, not of the park, so it must
 * keep working even on the day `Game`'s constructor throws and the splash
 * turns into an apology — that is exactly the day the family most needs to be
 * able to refresh their way to a fix. `UpdateGate` touches nothing but the
 * DOM for the same reason.
 */
function setupUpdateGate(uiRoot: HTMLElement): void {
  const gate = new UpdateGate(uiRoot);
  const updateSW = registerSW({
    onNeedRefresh: () => {
      gate.show(() => updateSW(true));
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
      gate.show(() => updateSW(true));
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

// Outside `boot()`'s own try/catch on purpose — see `setupUpdateGate`'s doc
// comment. `#ui-root` is the one element both the game and the gate need;
// if even that is missing the page is broken beyond a panel's help anyway.
const uiRoot = document.getElementById('ui-root');
if (uiRoot) setupUpdateGate(uiRoot);
