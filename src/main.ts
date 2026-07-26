import './style.css';
import { Game } from './Game';
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
