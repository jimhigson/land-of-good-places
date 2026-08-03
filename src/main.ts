import './style.css';
import { Vector3 } from 'three';
import { registerSW } from 'virtual:pwa-register';
import { Game, type GameOptions } from './Game';
import { UpdateGate } from './ui/UpdateGate';
import { CharacterCreation, ContinueOrRestart, DevBadge, defaultCharacterChoice } from './ui';
import { gameStore } from './state';
import { saveFlags } from './state/flags';
import { clearSave, consumeReopenCharacterCreator, loadSave, type SaveFile } from './state/save';
import { startVersionCheck } from './version-check';

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
 * The four ways a load can go:
 *
 * - **A readable save**: the welcome-back screen (`ui/ContinueOrRestart.ts`)
 *   offers *keep playing* or *start a new game*.
 * - **No save**: straight into the character creator, exactly as before.
 * - **An unreadable save** — corrupt, or a schema this build cannot migrate:
 *   `loadSave()` returns `null`, which is the same path as "no save". A
 *   fresh start is always offered rather than a crash or a half-loaded park;
 *   see `state/save.ts`.
 * - **A readable save with the reopen-creator flag set**: the HUD's "Look"
 *   pill reloaded the page to get here (`Game.reopenCharacterCreator`,
 *   `state/save.ts`'s `markReopenCharacterCreator`). Skips both the
 *   welcome-back prompt and `startFresh`'s `clearSave()` — see
 *   {@link reopenCharacterCreation}.
 *
 * `RIDE_DEEP_LINKS` below is a fifth, developer-only path: a URL typed by
 * hand, not a button a child presses, so it also skips the welcome-back
 * prompt straight into {@link continueGame} — there being nobody to *ask*
 * "keep playing?" is the entire point of pasting the link in the first place.
 */
function boot(): void {
  const canvas = document.getElementById('game-canvas');
  const uiRoot = document.getElementById('ui-root');
  const splash = document.getElementById('boot-splash');

  if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) {
    throw new Error('Land of Good Places: expected #game-canvas and #ui-root in the document.');
  }

  const save = loadSave();
  const reopenCreator = consumeReopenCharacterCreator();
  const rideDeepLink = RIDE_DEEP_LINKS[location.pathname];
  const debugView = parseDebugView(location.pathname, location.search) ?? undefined;

  // A save from before the character creator existed, or one where "start
  // again" was pressed and the tab was closed mid-creation, has everything
  // except a character. There is nothing to offer to continue, so don't ask.
  if (save && save.flags.createdCharacter) {
    // Both branches supply their own full-screen backdrop immediately, so the
    // generic "building the garden…" splash card would only be a flash behind
    // them — hide it now rather than waiting for a first game frame that is
    // still a button press away.
    splash?.classList.add('hidden');
    if (reopenCreator) {
      reopenCharacterCreation(canvas, uiRoot, splash, save);
      return;
    }
    if (rideDeepLink) {
      continueGame(canvas, uiRoot, splash, save, rideDeepLink);
      return;
    }
    if (debugView) {
      continueGame(canvas, uiRoot, splash, save, undefined, debugView);
      return;
    }
    new ContinueOrRestart(uiRoot, save, {
      onContinue: () => continueGame(canvas, uiRoot, splash, save),
      onStartAgain: () => startFresh(canvas, uiRoot, splash, rideDeepLink),
    });
    return;
  }

  // No save to skip past, but a deep link still boards the ride the instant
  // the brand-new character exists.
  splash?.classList.add('hidden');
  startFresh(canvas, uiRoot, splash, rideDeepLink, debugView);
}

/**
 * `/rail-race` and friends: a URL a developer types to reach a ride under
 * test without walking there.
 *
 * Every entry maps straight to a **stall id**, and that is deliberately the
 * only thing it knows about the ride. Two quite different things can sit
 * behind one: a world ride that `MiniGameHost.boardRide` boards in the park
 * (the Rail Race, the Sky Cruiser — see `Game.ts`'s own wiring of it), or a
 * stall with a curtain mini-game behind it (the Space Ferris Wheel, until it
 * becomes a world ride too). {@link launchGame} tries the ride first and falls
 * back to opening the stall, so adding one here is one line either way — and a
 * ride that later changes from one kind to the other needs no change at all.
 */
const RIDE_DEEP_LINKS: Readonly<Record<string, string>> = {
  '/rail-race': 'railRacer',
  '/sky-cruiser': 'skyCruiser',
  '/ferris': 'spaceFerrisWheel',
};

/** What `/view` needs to drop a debug camera into the built park. See {@link parseDebugView}. */
interface DebugViewParams {
  readonly position: Vector3;
  readonly lookAt: Vector3;
  readonly timeOfDay?: number;
  /** 0..1 towards space — see `DayNight.setSpaceFactor`. */
  readonly space?: number;
}

/**
 * `/view?camPos=x,y,z&camDir=x,y,z&timeOfDay=HH:MM` — a debug-only way to look
 * at any point in the built park, from any angle, at any time of day, without
 * boarding a ride or walking there. A URL a developer types, never a button a
 * child presses — same spirit as {@link RIDE_DEEP_LINKS}, and it reuses the
 * same "skip the welcome-back prompt" wiring below.
 *
 * `camPos` defaults to a wide establishing view rather than the origin, which
 * sits inside the ball pit; `camDir` defaults to looking back at the origin
 * from wherever `camPos` is, so leaving it off (as in the family's own example
 * URL) still points the camera at the park rather than off into empty sky.
 * `timeOfDay` is genuinely optional — omit it and the clock runs normally.
 */
function parseDebugView(pathname: string, search: string): DebugViewParams | null {
  if (pathname !== '/view') return null;
  const params = new URLSearchParams(search);
  const position = parseVector3(params.get('camPos')) ?? new Vector3(40, 30, 40);
  const direction = parseVector3(params.get('camDir'));
  const lookAt =
    direction && direction.lengthSq() > 0
      ? position.clone().add(direction.normalize())
      : new Vector3(0, 0, 0);
  const timeOfDay = parseClockFraction(params.get('timeOfDay'));
  const space = parseUnitFraction(params.get('space'));
  // Assigned rather than spread, so an absent param stays *absent* — under
  // `exactOptionalPropertyTypes` an optional property may be missing but never
  // explicitly `undefined`.
  const view: {
    position: Vector3;
    lookAt: Vector3;
    timeOfDay?: number;
    space?: number;
  } = { position, lookAt };
  if (timeOfDay !== undefined) view.timeOfDay = timeOfDay;
  if (space !== undefined) view.space = space;
  return view;
}

/** "0.6" -> 0.6, clamped to 0..1. Anything else is treated as absent. */
function parseUnitFraction(text: string | null): number | undefined {
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

/** "x,y,z" -> a Vector3, or null if missing/malformed — never throws on a hand-typed URL. */
function parseVector3(text: string | null): Vector3 | null {
  if (!text) return null;
  const parts = text.split(',').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return new Vector3(parts[0], parts[1], parts[2]);
}

/** "HH:MM" -> a [0,1) fraction of a day, the same clock {@link DayNight} keeps. */
function parseClockFraction(text: string | null): number | undefined {
  if (!text) return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return (hours * 60 + minutes) / (24 * 60);
}

/**
 * Loads the park back exactly as it was left.
 *
 * `boardStallId` — set only by a {@link RIDE_DEEP_LINKS} match — boards that
 * ride the moment the park exists, ahead of wherever `save.place` would
 * otherwise have put her.
 */
function continueGame(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  splash: HTMLElement | null,
  save: SaveFile,
  boardStallId?: string,
  debugView?: DebugViewParams,
): void {
  gameStore.hydrate(save);
  saveFlags.hydrate(save.flags);
  // Omitted rather than passed as undefined — `exactOptionalPropertyTypes`.
  const options: GameOptions = save.place ? { startPlace: save.place } : {};
  launchGame(canvas, uiRoot, splash, options, boardStallId, debugView);
}

/**
 * Throws away whatever was saved and makes a brand-new character.
 *
 * The save is cleared *first*, before the creator opens, so that closing the
 * tab halfway through making a new character cannot leave the old park behind
 * to be offered again — the child already said goodbye to it, and being asked
 * a second time would be worse than either answer.
 *
 * `boardStallId` set means a ride deep link brought us here with nobody to
 * ask — "goes straight into the ride" has to be true even from a completely
 * empty profile, not only a returning one, so this skips the form itself and
 * hands `defaultCharacterChoice()` (`ui/CharacterCreation.ts` — the exact
 * defaults the form would otherwise have started on) straight to
 * `completeCharacterCreation`, same as the form's own "Let's go!" would.
 */
function startFresh(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  splash: HTMLElement | null,
  boardStallId?: string,
  debugView?: DebugViewParams,
): void {
  clearSave();
  if (boardStallId || debugView) {
    gameStore.completeCharacterCreation(defaultCharacterChoice());
    saveFlags.markCharacterCreated();
    launchGame(canvas, uiRoot, splash, {}, boardStallId, debugView);
    return;
  }
  new CharacterCreation(uiRoot, {
    onComplete: (choice) => {
      gameStore.completeCharacterCreation(choice);
      saveFlags.markCharacterCreated();
      launchGame(canvas, uiRoot, splash, {}, boardStallId, debugView);
    },
  });
}

/**
 * Same park, brand-new look — what the HUD's "Look" pill triggers, by way of
 * a reload (`Game.reopenCharacterCreator` sets the flag {@link
 * consumeReopenCharacterCreator} reads above, then reloads the page).
 *
 * Unlike {@link startFresh} the save is **not** cleared and `createdCharacter`
 * is left exactly as it was: this hydrates the store from the existing save
 * first, exactly like {@link continueGame}, so money, the Cute-o-dex, the
 * inventory and the park name are all already sitting in the store by the
 * time the creator's "done" button fires `completeCharacterCreation`, which
 * only overwrites the cosmetic fields. Finishing launches back into the same
 * `save.place` rather than the default spawn, so she lands back where she was
 * standing when she pressed the pill.
 */
function reopenCharacterCreation(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  splash: HTMLElement | null,
  save: SaveFile,
): void {
  gameStore.hydrate(save);
  saveFlags.hydrate(save.flags);
  new CharacterCreation(uiRoot, {
    onComplete: (choice) => {
      gameStore.completeCharacterCreation(choice);
      // Already true on this save — restated so the flag and the fact can
      // never disagree, the same reason `startFresh` sets it below.
      saveFlags.markCharacterCreated();
      // Omitted rather than passed as undefined — `exactOptionalPropertyTypes`.
      const options: GameOptions = save.place ? { startPlace: save.place } : {};
      launchGame(canvas, uiRoot, splash, options);
    },
  });
}

function launchGame(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  splash: HTMLElement | null,
  options: GameOptions,
  boardStallId?: string,
  debugView?: DebugViewParams,
): void {
  const game = new Game(canvas, uiRoot, options);
  game.start();

  if (boardStallId) {
    // Both wired synchronously inside `Game`'s own constructor, which has
    // already returned by this point — nothing here waits a frame.
    game.whatsNew.close();
    // A world ride boards through `boardRide`; a stall with a curtain
    // mini-game behind it opens through `open()`. Trying the ride first and
    // falling back is what lets one deep-link table serve both kinds — and
    // what means a stall that graduates from mini-game to world ride is
    // already wired the day it does. `boardRide` returns false for an id it
    // does not know, which is exactly the signal needed here.
    if (!game.miniGames.boardRide?.(boardStallId)) game.miniGames.open(boardStallId);
  }
  if (debugView) {
    game.whatsNew.close();
    game.enterDebugView(
      debugView.position,
      debugView.lookAt,
      debugView.timeOfDay,
      debugView.space,
    );
  }

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
  // `version.txt` only exists in a real build (`vite.config.ts`'s
  // `versionFilePlugin`), so polling for it in dev would just be a 404 every
  // two minutes for nothing — dev already gets instant feedback from HMR.
  if (import.meta.env.PROD) startVersionCheck();
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
