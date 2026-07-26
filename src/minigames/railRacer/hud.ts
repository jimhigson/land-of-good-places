import { hexToCss } from '../../core/palette';

/**
 * The race HUD: who is winning, how far there is to go, and the odd shout.
 *
 * Plain DOM on the framework's overlay layer, for the same reason the park's
 * HUD is: text drawn by the browser is crisper, reflows for a phone, and costs
 * the renderer nothing. Everything here is `pointer-events: none` — the whole
 * screen underneath is the hold button and nothing may steal a press from it.
 */

export interface RiderPip {
  readonly colour: number;
  /** 0 at the start banner, 1 at the finish arch. */
  readonly progress: number;
  readonly you: boolean;
}

export interface RaceHud {
  setPlace(place: number, of: number): void;
  setPips(pips: readonly RiderPip[]): void;
  /** Big centred number: the 3-2-1. `null` clears it. */
  setCount(text: string | null): void;
  /** A short cheerful interjection ("Ooh, mind the branch!"). */
  shout(text: string, seconds?: number): void;
  /** The end-of-race card. */
  showResult(title: string, line: string, hint: string): void;
  update(dt: number): void;
  dispose(): void;
}

const PLACE_NAMES = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

export function placeName(place: number): string {
  return PLACE_NAMES[place - 1] ?? `${place}th`;
}

export function createRaceHud(container: HTMLElement): RaceHud {
  const root = document.createElement('div');
  root.style.display = 'contents';

  const topRow = document.createElement('div');
  topRow.className = 'mg-toprow';

  const placePill = document.createElement('div');
  placePill.className = 'mg-pill';
  placePill.innerHTML = '<b>1st</b> of 4';

  const track = document.createElement('div');
  track.className = 'mg-track';

  topRow.append(placePill, track);

  const centre = document.createElement('div');
  centre.className = 'mg-centre';

  root.append(topRow, centre);
  container.append(root);

  const pipElements: HTMLElement[] = [];
  let shoutElement: HTMLElement | null = null;
  let shoutTimer = 0;
  let countElement: HTMLElement | null = null;

  return {
    setPlace(place: number, of: number): void {
      placePill.innerHTML = `<b>${placeName(place)}</b> of ${of}`;
    },

    setPips(pips: readonly RiderPip[]): void {
      // Built lazily and then only moved: a HUD that rebuilds its DOM every
      // frame is the fastest way to make a phone stutter.
      while (pipElements.length < pips.length) {
        const pip = document.createElement('span');
        pip.className = 'mg-pip';
        track.append(pip);
        pipElements.push(pip);
      }
      pips.forEach((pip, index) => {
        const element = pipElements[index];
        if (!element) return;
        element.style.left = `${Math.max(0, Math.min(1, pip.progress)) * 100}%`;
        element.style.background = hexToCss(pip.colour);
        element.dataset.you = pip.you ? 'true' : 'false';
      });
    },

    setCount(text: string | null): void {
      if (text === null) {
        countElement?.remove();
        countElement = null;
        return;
      }
      if (countElement?.textContent === text) return;
      countElement?.remove();
      countElement = document.createElement('div');
      countElement.className = 'mg-count';
      countElement.textContent = text;
      centre.append(countElement);
    },

    shout(text: string, seconds = 1.4): void {
      shoutElement?.remove();
      shoutElement = document.createElement('div');
      shoutElement.className = 'mg-shout';
      shoutElement.textContent = text;
      centre.append(shoutElement);
      shoutTimer = seconds;
    },

    showResult(title: string, line: string, hint: string): void {
      const card = document.createElement('div');
      card.className = 'mg-card';
      const heading = document.createElement('h2');
      heading.textContent = title;
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      const small = document.createElement('p');
      small.className = 'mg-sub';
      small.textContent = hint;
      card.append(heading, paragraph, small);
      centre.append(card);
    },

    update(dt: number): void {
      if (shoutTimer > 0) {
        shoutTimer -= dt;
        if (shoutTimer <= 0) {
          shoutElement?.remove();
          shoutElement = null;
        }
      }
    },

    dispose(): void {
      root.remove();
    },
  };
}
