import { registerSW } from 'virtual:pwa-register';
import { UpdateGate } from './ui/UpdateGate';
import {
  ASK_SERVER_WITHIN_MS,
  FETCH_NEW_BUILD_WITHIN_MS,
  canAdoptWithoutAsking,
  noteAdopting,
  watchForFirstTouch,
} from './update-adoption';
import { startVersionCheck } from './version-check';

/** What `bootstrap.ts` waits on before it starts a park. */
export interface UpdateGateSetup {
  /**
   * Resolves once this build may go on booting: the server says it is current,
   * or did not answer within `ASK_SERVER_WITHIN_MS`, or a newer build did not
   * arrive within `FETCH_NEW_BUILD_WITHIN_MS`. **Never resolves while a newer
   * build is being taken** — that ends in a reload into it.
   */
  readonly readyToBoot: Promise<void>;
}

/** `true` if `promise` settles within `ms`; `false` if it rejects or the time runs out first. */
function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(false), ms);
    promise.then(
      () => {
        window.clearTimeout(timer);
        resolve(true);
      },
      () => {
        window.clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

/**
 * Registers the service worker ourselves (rather than the PWA plugin's own
 * injected script — see `vite.config.ts`'s `injectRegister: false`) purely to
 * get at `onNeedRefresh`: the one hook that fires when a new deploy has
 * finished downloading in the background and is sat waiting.
 *
 * `startVersionCheck` (`version-check.ts`), in production only, is the other
 * trigger: a small `version.txt` request at boot, every two minutes, and
 * whenever the tab comes back to the front, which says a newer build *exists*
 * long before `onNeedRefresh` can say it has *arrived*. Both triggers make the
 * same one decision ({@link decide}) and go through the same one door, the
 * gate's button ({@link takeIt}).
 *
 * ## Why the boot waits for the answer — 15 Nov 2026
 *
 * Jim, on his iPhone, a deploy just landed: *"refreshed the page a few times and
 * eventually we have it"*. Measured, in Chromium and WebKit: a reload after a
 * deploy is answered by the old worker, so the old build boots — fully
 * playable — while the new one downloads behind it, which on a phone is
 * seconds. `onNeedRefresh` fires only when that download is done, and adopts
 * only if nobody has touched the page in the meantime. So the first tap (she
 * starts playing) turned the adoption into a question, and a reload during the
 * download just booted the old build again. Several reloads, then, until one
 * happened to land after a download had finished.
 *
 * Now the first answer is waited for before the park starts, briefly and in
 * parallel with the park file. If it says another build is current and nobody
 * is playing — nobody can be, the park has not started — the gate goes up at
 * once, "Getting it…", and the boot waits for the download and the swap. She
 * can no more start on the old build than she can get behind the gate. Both
 * waits are bounded, because a phone on one bar of signal must still get a
 * park: past them, she plays the build she has, and the gate says so.
 *
 * Kept out of `Game` and `main.ts` entirely, and called by `bootstrap.ts`
 * before the park is even loaded: a new version of the *code*, not of the park, so it must
 * keep working even on the day `Game`'s constructor throws and the splash
 * turns into an apology — that is exactly the day the family most needs to be
 * able to refresh their way to a fix. `UpdateGate` touches nothing but the
 * DOM for the same reason.
 */
export function setupUpdateGate(uiRoot: HTMLElement): UpdateGateSetup {
  const gate = new UpdateGate(uiRoot);

  /** A newer build has finished downloading and is waiting to take over: `onNeedRefresh` has fired. */
  let downloaded = false;
  let markDownloaded = (): void => {};
  const whenDownloaded = new Promise<void>((resolve) => {
    markDownloaded = resolve;
  });

  /** The swap under way, if one is: `true` once it has been asked for, `false` if it gave up waiting. */
  let adopting: Promise<boolean> | null = null;

  /**
   * The one decision, whichever trigger asks for it.
   *
   * The whole of issue #341 is the first branch. A reload cannot promote a
   * waiting service worker, so on a page nobody has touched yet we take the
   * new build without asking — now even before it has finished downloading,
   * which is the 15 Nov half. Once she is playing, the gate waits for its
   * button as it always has, because a swap means a reload and a reload
   * mid-ride loses the ride — and it asks only once there is something to swap
   * to, so she is never held at a card for a download.
   */
  const decide = (): void => {
    if (gate.isUp || adopting) return;
    if (canAdoptWithoutAsking()) gate.showAndGo(takeIt);
    else if (downloaded) gate.show(takeIt);
  };

  /**
   * The gate's button, pressed by a finger or by the page itself: wait,
   * bounded, for the new build to finish downloading, then ask it to take over
   * (`updateSW(true)`, which posts `SKIP_WAITING`; the plugin reloads the page
   * when the new worker takes control). One swap at a time — a second press,
   * or a trigger arriving mid-swap, joins the one under way.
   */
  const takeIt = (): Promise<boolean> => (adopting ??= adopt());

  const adopt = async (): Promise<boolean> => {
    if (await within(whenDownloaded, FETCH_NEW_BUILD_WITHIN_MS)) {
      noteAdopting();
      await updateSW(true);
      return true;
    }
    console.warn(
      `Land of Good Places: a newer build is on the server but had not downloaded after ` +
        `${FETCH_NEW_BUILD_WITHIN_MS / 1000}s — playing the build this device already has. ` +
        'It will be offered as soon as it arrives.',
    );
    await gate.standDown();
    adopting = null;
    // It may have arrived while the gate was saying it had not.
    if (downloaded) decide();
    return false;
  };

  const updateSW = registerSW({
    // Register now rather than on the window `load` event (workbox's default).
    // "Am I even the right build?" is not a question to ask after every image
    // and font has finished arriving: the sooner the answer comes back, the
    // smaller the window in which this page pulls lazy chunks that the incoming
    // worker is about to sweep out of the precache — see `update-adoption.ts`.
    immediate: true,
    onNeedRefresh: () => {
      downloaded = true;
      markDownloaded();
      decide();
    },
    onRegisterError: (error: unknown) => {
      console.error('Land of Good Places: service worker registration failed.', error);
    },
  });
  // Exposed for the same reason `window.game` is: this is how the "new version
  // ready" gate gets exercised from the console without waiting for a real
  // deploy. Note that pressing its button really does reload the page.
  if (import.meta.env.DEV) {
    (window as unknown as { __triggerUpdateGate: () => void }).__triggerUpdateGate = () => {
      downloaded = true;
      markDownloaded();
      gate.show(takeIt);
    };
  }

  // `version.txt` only exists in a real build (`vite.config.ts`'s
  // `versionFilePlugin`), so asking for it in dev would just be a 404 for
  // nothing — dev already gets instant feedback from HMR.
  const readyToBoot = import.meta.env.PROD
    ? (async (): Promise<void> => {
        if (!(await within(startVersionCheck(decide), ASK_SERVER_WITHIN_MS))) {
          console.info(
            `Land of Good Places: the server did not say which build is current within ` +
              `${ASK_SERVER_WITHIN_MS / 1000}s — starting the build this device has, and asking again in the background.`,
          );
        }
        // Whichever trigger started a swap — that answer, or a build that had
        // already finished downloading — wait for it: it either ends in a
        // reload into the new build, or gives up (bounded) and hands the boot
        // back.
        while (adopting) {
          if (await adopting) await new Promise<never>(() => {});
        }
      })()
    : Promise.resolve();
  // From the moment the park starts to load, a touch means she is playing.
  // Before it there was nothing to lose, however much she tapped the splash or
  // the gate's own card ("before the park has started" in `update-adoption.ts`).
  // Registered here, before `bootstrap.ts` awaits the same promise, so the watch
  // is on before the game's first line runs.
  void readyToBoot.then(watchForFirstTouch);
  return { readyToBoot };
}
