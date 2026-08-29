import { VERSION_FILE_PATH } from './version-file';

const CHECK_INTERVAL_MS = 2 * 60 * 1000;

/**
 * Polls `/version.txt` — written fresh by every build, see `vite.config.ts` —
 * against this bundle's own baked-in `__APP_VERSION__`, and nudges the
 * service worker to check for a real update the moment they disagree.
 *
 * Why not just rely on the service worker's own update check? A browser only
 * runs that on navigation, and the family leaves the game open on a phone for
 * hours mid-session while a deploy lands — so it could sit undetected the
 * whole time. This is not a second update mechanism competing with
 * `onNeedRefresh`/`UpdateGate` (`main.ts`'s `setupUpdateGate`); it is a second
 * way to *trigger* that exact same flow sooner, with nothing more than a
 * plain HTTP GET of a text file.
 *
 * Paused while the tab is in the background — no point spending battery or
 * data polling a page nobody is looking at.
 */
export function startVersionCheck(): void {
  if (!('serviceWorker' in navigator)) return;

  const check = async (): Promise<void> => {
    if (document.visibilityState !== 'visible') return;

    let latest: string;
    try {
      const response = await fetch(VERSION_FILE_PATH, { cache: 'no-store' });
      if (!response.ok) return;
      latest = (await response.text()).trim();
    } catch {
      // Offline, or between deploys with nothing serving yet — try again next tick.
      return;
    }
    if (!latest || latest === __APP_VERSION__) return;

    // `update()` is what makes the service worker actually re-check the
    // network for a new build; everything downstream — a new worker
    // installing, going "waiting", and `onNeedRefresh` firing — is the exact
    // same machinery `setupUpdateGate` already wires up.
    const registration = await navigator.serviceWorker.getRegistration();
    void registration?.update();
  };

  void check();
  window.setInterval(() => void check(), CHECK_INTERVAL_MS);
}
