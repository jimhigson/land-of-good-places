/**
 * **When it is safe to take a new build without asking first.**
 *
 * Issue #341, and the reason this file exists at all: a returning player was
 * stuck on an old build *for ever*. `vite.config.ts` runs the service worker in
 * `prompt` mode — `skipWaiting: false`, `clientsClaim: false` — so a freshly
 * downloaded build installs and then sits in the browser's `waiting` state until
 * something sends it `SKIP_WAITING`. **A reload does not do that.** The tab
 * being reloaded stays a client of the old worker for the whole navigation, so
 * the old worker is never the last client to leave and the new one is never
 * promoted. Reload, hard-reload, wait two minutes, reload again: the same old
 * bundle every time. Only the update gate's button (or closing every tab on the
 * origin) could break the loop, and Jim's ruling on that is the standard here:
 *
 * > "a failure to reload is an unambiguous bug in the app"
 *
 * So the page now presses that button itself — but only when doing so cannot
 * take anything away from anyone. That "only when" is this module's whole job,
 * and it is one question with one owner:
 *
 * ## The rule: nobody has touched this page yet
 *
 * A swap means a reload, and a reload mid-ride loses the ride. But a page that
 * has not been touched *at all* since it loaded has nothing in flight to lose —
 * she has not started playing yet, she has walked nowhere, she is looking at the
 * splash or the bus. That is exactly the state a reload leaves a browser in, and
 * therefore exactly the state a returning player is in when this matters.
 *
 * The moment she touches anything, we stop deciding for her and the gate goes
 * back to waiting for its button — which is also `GAME_DESIGN.md`'s "updates are
 * not optional" moment, unchanged: still full-screen, still unskippable, still
 * "A brand new park!". The gate did not become optional; it became the
 * *presentation* of an update that is going to happen anyway.
 *
 * ## Why not just `skipWaiting: true` in the worker
 *
 * Because that swaps the precache under a page that is **playing**, with no
 * reload at all: the new worker activates the instant it installs, sweeps the
 * old build's hashed chunks out of the precache, and the very next lazy
 * `import()` — the park generates itself through a dozen of them, spread over
 * the whole cat-bus ride (`boot/parkGeneration.ts`) — 404s into the apology
 * card and stays there. Deciding *in the page*, where we know whether anyone is
 * playing, is the difference between a swap that is followed by an immediate
 * reload and a swap that is not followed by anything.
 */

/**
 * Remembers the version we last swapped away from, so a swap that does not take
 * cannot become a reload loop. Per tab, cleared when the tab closes —
 * `sessionStorage`, not `localStorage`, because a stuck tab must not be able to
 * poison a fresh one.
 */
const ADOPTED_FROM_KEY = 'lgp.updateAdoptedFrom';

/** True until the first touch/click/keypress of this page load. */
let untouched = true;

const markTouched = (): void => {
  untouched = false;
};

/**
 * Starts watching for the first sign of a person. Capture phase so nothing can
 * swallow it first (`UpdateGate` swallows the whole keyboard while it is up, and
 * `InputSystem` stops plenty else), and `once` so this costs one dispatch and
 * then nothing at all.
 */
export function watchForFirstTouch(): void {
  for (const type of ['pointerdown', 'touchstart', 'keydown'] as const) {
    window.addEventListener(type, markTouched, { capture: true, passive: true, once: true });
  }
}

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // Storage can be disabled outright. A missing note only costs us the loop
    // guard, which is a backstop, not the mechanism.
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* see above */
  }
}

/**
 * Should the waiting build be adopted right now, with nobody asked?
 *
 * Two ways to get a `false`, and they are different failures:
 *
 * - **Someone is playing.** Ask, don't grab — that is the gate's button.
 * - **We already tried, from this exact version, in this tab.** The reload that
 *   followed should have landed us on a *different* `__APP_VERSION__`; if it did
 *   not, the swap is not working and repeating it would be an infinite reload
 *   loop in a six-year-old's hands. Fall back to the button, which at least
 *   tells her something is happening, and leave a console line saying why.
 */
export function canAdoptWithoutAsking(): boolean {
  if (!untouched) return false;
  if (readSession(ADOPTED_FROM_KEY) === __APP_VERSION__) {
    console.warn(
      'Land of Good Places: a new build was adopted from this version already and we are ' +
        'still running it — not reloading again. Showing the update gate instead.',
    );
    return false;
  }
  return true;
}

/** Called as the swap is asked for, so the guard above can see it next load. */
export function noteAdopting(): void {
  writeSession(ADOPTED_FROM_KEY, __APP_VERSION__);
}
