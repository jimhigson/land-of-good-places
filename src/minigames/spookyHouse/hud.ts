/**
 * The Spooky House's tiny HUD: a candy counter, and one soft hint at the start.
 *
 * There is no score and no fail state — "it's a toy box" (GAME_DESIGN.md) — so
 * this is deliberately smaller than the Rail Racer's: just enough feedback
 * that a candy dropped in the backpack registers as *something happened*.
 * Reuses the framework's own `mg-pill` / `mg-shout` / `mg-centre` classes
 * (`minigames/overlay.ts`) so it looks like part of the same family of games
 * rather than inventing new chrome.
 */
export interface SpookyHud {
  setCandyCount(count: number): void;
  /** A short cheerful line, centred, that fades on its own. */
  shout(text: string, seconds?: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createSpookyHud(container: HTMLElement): SpookyHud {
  const root = document.createElement('div');
  root.style.display = 'contents';

  const topRow = document.createElement('div');
  topRow.className = 'mg-toprow';

  const candyPill = document.createElement('div');
  candyPill.className = 'mg-pill';
  candyPill.innerHTML = '<span>🍬</span> <b>0</b>';

  topRow.append(candyPill);

  const centre = document.createElement('div');
  centre.className = 'mg-centre';

  root.append(topRow, centre);
  container.append(root);

  let shoutElement: HTMLElement | null = null;
  let shoutTimer = 0;

  return {
    setCandyCount(count: number): void {
      candyPill.innerHTML = `<span>🍬</span> <b>${count}</b>`;
    },

    shout(text: string, seconds = 2.2): void {
      shoutElement?.remove();
      shoutElement = document.createElement('div');
      shoutElement.className = 'mg-shout';
      shoutElement.textContent = text;
      centre.append(shoutElement);
      shoutTimer = seconds;
    },

    update(dt: number): void {
      if (shoutTimer <= 0) return;
      shoutTimer -= dt;
      if (shoutTimer <= 0) {
        shoutElement?.remove();
        shoutElement = null;
      }
    },

    dispose(): void {
      root.remove();
    },
  };
}
