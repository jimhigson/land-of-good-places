import { VERSION_FILE_PATH } from './version-file';

/**
 * How often an open, visible tab asks whether a newer build is out — which is
 * how a deploy reaches her mid-game. Jim, 17 Nov 2026: *"I'd like it to also
 * periodically check if there is a new deploy during gameplay, like every
 * minute"* (it was every two). The request is a few bytes; the download and
 * the gate only follow when the answer has changed.
 */
const CHECK_INTERVAL_MS = 60 * 1000;

/**
 * A tab brought back to the front is asked about again — but not if it was
 * asked this recently, so flicking between apps does not fire a request a
 * flick.
 */
const RECHECK_ON_RETURN_AFTER_MS = 30 * 1000;

/** What the server would hand a brand-new visitor right now, against this bundle. */
export type ServerBuild = 'this build' | 'another build' | 'unknown';

/**
 * Asks the server once. Never rejects: offline, a 404 between deploys, or an
 * empty file are all `unknown`, which every caller treats as "carry on with
 * the build you have".
 */
async function askServer(): Promise<ServerBuild> {
  try {
    const response = await fetch(VERSION_FILE_PATH, { cache: 'no-store' });
    if (!response.ok) return 'unknown';
    const latest = (await response.text()).trim();
    if (!latest) return 'unknown';
    return latest === __APP_VERSION__ ? 'this build' : 'another build';
  } catch {
    return 'unknown';
  }
}

/**
 * Asks `/version.txt` — written fresh by every build, see `vite.config.ts` —
 * whether this bundle's own baked-in `__APP_VERSION__` is still the one being
 * served, **at boot, every minute, and whenever the tab comes back to the
 * front**; and the moment it is not, nudges the service worker to fetch the
 * new build and tells `onAnotherBuild`.
 *
 * Why not just rely on the service worker's own update check? A browser only
 * runs that on navigation, and the family leaves the game open on a phone for
 * hours mid-session while a deploy lands — so it could sit undetected the
 * whole time. And even on a navigation the worker's check says nothing to the
 * *page* until the whole new build has downloaded, which on a phone is
 * seconds: long enough to start playing the old one (see `updateGateSetup.ts`).
 * The answer here comes back in one small request, which is what lets the boot
 * know, before the park starts, that a newer one is on its way.
 *
 * This is not a second update mechanism competing with
 * `onNeedRefresh`/`UpdateGate`; it is a second way to *trigger* that exact
 * same flow sooner, with nothing more than a plain HTTP GET of a text file.
 *
 * Paused while the tab is in the background — no point spending battery or
 * data polling a page nobody is looking at.
 *
 * @returns the boot's own answer, for `setupUpdateGate` to wait on (bounded).
 */
export function startVersionCheck(onAnotherBuild: () => void): Promise<ServerBuild> {
  if (!('serviceWorker' in navigator)) return Promise.resolve('unknown');
  let askedAt = -Infinity;

  const check = async (): Promise<ServerBuild> => {
    if (document.visibilityState !== 'visible') return 'unknown';
    askedAt = Date.now();
    const answer = await askServer();
    if (answer !== 'another build') return answer;

    onAnotherBuild();
    // `update()` is what makes the service worker actually re-check the
    // network for a new build; everything downstream — a new worker
    // installing, going "waiting", and `onNeedRefresh` firing — is the exact
    // same machinery `setupUpdateGate` already wires up. If the navigation's
    // own check already started that download, this one queues behind it and
    // finds nothing new: harmless. Not awaited — while a download is under way
    // `update()` resolves only once it is done, and the answer is already in.
    void navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.update())
      .catch(() => undefined);
    return answer;
  };

  window.setInterval(() => void check(), CHECK_INTERVAL_MS);
  // "Simply opening the game" on a phone is often not a navigation at all:
  // the tab or the home-screen app was only in the background, and comes back
  // exactly as it was. Without this, a deploy that landed meanwhile would wait
  // for the next tick of the interval above.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - askedAt >= RECHECK_ON_RETURN_AFTER_MS) {
      void check();
    }
  });
  return check();
}
