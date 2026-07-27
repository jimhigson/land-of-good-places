import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { Game, type GameOptions } from './Game';
import { UpdateGate } from './ui/UpdateGate';
import { CharacterCreation, ContinueOrRestart, DevBadge } from './ui';
import { gameStore } from './state';
import { saveFlags } from './state/flags';
import { clearSave, loadSave, type SaveFile } from './state/save';

/**
 * Entry point. Finds the canvas, offers to continue a saved park, shows the
 * character creator when there is nothing to continue, then builds the game
 * and hides the splash.
 *
 * The splash is dismissed on the first rendered frame rather than immediately,
 * so nobody ever sees an empty blue rectangle while the park is being built.
 *
 * **All of this runs before `Game` exists** — deliberately not `Game`-owned
 * overlays like `WhatsNew`. `Player`'s constructor reads
 * `gameStore.get().player` (name, hair colour and style, outfit colour) the
 * moment it builds the kid, so both the save and the character creator have to
 * have finished writing the store before that happens; there is no "rebuild
 * the live player model" path in the game, and a hair *style* change swaps
 * meshes rather than a colour. It also guarantees both finish before the
 * cat-bus arrival sequence (`world/entrance/`), whenever that gets wired up —
 * nothing downstream of `new Game(...)` can run before this does.
 *
 * The three ways a load can go:
 *
 * - **A readable save**: the welcome-back screen (`ui/ContinueOrRestart.ts`)
 *   offers *keep playing* or *start a new game*.
 * - **No save**: straight into the character creator, exactly as before.
 * - **An unreadable save** — corrupt, or a schema this build cannot migrate:
 *   `loadSave()` returns `null`, which is the same path as "no save". A
 *   fresh start is always offered rather than a crash or a half-loaded park;
 *   see `state/save.ts`.
 */
function boot(): void {
  const canvas = document.getElementById('game-canvas');
  const uiRoot = document.getElementById('ui-root');
  const splash = document.getElementById('boot-splash');

  if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) {
    throw new Error('Land of Good Places: expected #game-canvas and #ui-root in the document.');
  }

  const save = loadSave();

  // A save from before the character creator existed, or one where "start
  // again" was pressed and the tab was closed mid-creation, has everything
  // except a character. There is nothing to offer to continue, so don't ask.
  if (save && save.flags.createdCharacter) {
    // Both branches supply their own full-screen backdrop immediately, so the
    // generic "building the garden…" splash card would only be a flash behind
    // them — hide it now rather than waiting for a first game frame that is
    // still a button press away.
    splash?.classList.add('hidden');
    new ContinueOrRestart(uiRoot, save, {
      onContinue: () => continueGame(canvas, uiRoot, splash, save),
      onStartAgain: () => startFresh(canvas, uiRoot, splash),
    });
    return;
  }

  splash?.classList.add('hidden');
  startFresh(canvas, uiRoot, splash);
}

/** Loads the park back exactly as it was left. */
function continueGame(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  splash: HTMLElement | null,
  save: SaveFile,
): void {
  gameStore.hydrate(save);
  saveFlags.hydrate(save.flags);
  // Omitted rather than passed as undefined — `exactOptionalPropertyTypes`.
  const options: GameOptions = save.place ? { startPlace: save.place } : {};
  launchGame(canvas, uiRoot, splash, options);
}

/**
 * Throws away whatever was saved and makes a brand-new character.
 *
 * The save is cleared *first*, before the creator opens, so that closing the
 * tab halfway through making a new character cannot leave the old park behind
 * to be offered again — the child already said goodbye to it, and being asked
 * a second time would be worse than either answer.
 */
function startFresh(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  splash: HTMLElement | null,
): void {
  clearSave();
  new CharacterCreation(uiRoot, {
    onComplete: (choice) => {
      gameStore.completeCharacterCreation(choice);
      saveFlags.markCharacterCreated();
      launchGame(canvas, uiRoot, splash, {});
    },
  });
}

function launchGame(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  splash: HTMLElement | null,
  options: GameOptions,
): void {
  const game = new Game(canvas, uiRoot, options);
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
