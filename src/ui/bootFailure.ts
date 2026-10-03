import { parkUnavailableIn } from '../world/prebuilt/parkUnavailable';
import { showParkUnavailable } from './ParkUnavailableScreen';

/**
 * The apology card, for when the park cannot be opened at all.
 *
 * Its own function because there are now **two** ways to get here and they are
 * not both a `throw` past `boot()`. Generation that fails during the cat-bus
 * ride is caught inside `ParkGeneration` — a rejected promise, several frames
 * deep in a `requestAnimationFrame` loop, a long way from any `try` — and
 * before this existed that case simply hung: the bus would idle at the kerb
 * forever, waiting for a park that was never going to arrive. A loading screen
 * that lies is worse than one that waits, and one that waits for ever is worse
 * than either.
 */
export function showBootFailure(error: unknown): void {
  console.error(error);
  const splash = document.getElementById('boot-splash');
  // A park with no usable park file (`docs/design/PREBUILT-PARKS.md`): an
  // error with its own screen, naming the seed and why, and a retry.
  const unavailable = parkUnavailableIn(error);
  if (unavailable) {
    showParkUnavailable(unavailable, splash);
    return;
  }
  if (splash) {
    splash.classList.remove('hidden');
    splash.innerHTML =
      '<div class="boot-card"><h1>Oh no!</h1>' +
      '<p class="boot-sub">The park could not open.</p>' +
      '<p class="boot-hint">Check the browser console for details.</p></div>';
  }
}

