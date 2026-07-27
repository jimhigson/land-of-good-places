/**
 * The dodgems HUD: how long is left, how many bumps, how many tree bonks — and
 * a picture of the thumb-stick so a child can see what their finger is doing.
 *
 * Plain DOM on the framework's overlay layer, and it re-uses the framework's
 * own pill / card classes rather than restyling them, so the two stalls look
 * like they belong to the same fair. The only new CSS is the stick and the
 * hint, which are injected from here under their own id — a mini-game must be
 * addable without editing a line the park or the framework owns.
 *
 * Everything is `pointer-events: none`. The whole screen underneath is the go
 * button and the steering stick; nothing here may steal a press from it.
 *
 * **Nothing shouts over the rink any more (28 July 2026 feedback).** The
 * family, on the dodgems: *"same fix as water fights — labels in the middle
 * cover up too much; use portraits"*, and *"no need to annotate apple
 * bonks"*. So `shout()` is gone from this HUD entirely rather than being
 * quietened: a bonk, a bump and a wallop now show on the driver's own portrait
 * at the edge of the screen (`minigames/portraitStrip.ts`), an apple says
 * nothing at all, and "GO!" is just the last frame of the 3-2-1 instead of a
 * banner of its own. What is left in the middle of the screen is the countdown
 * and the finish card, both of which are the whole screen's business for a
 * moment and then gone.
 *
 * The one line that is not a reaction — telling a child who has not moved yet
 * how to drive — became {@link DodgemsHud.setHint}, tucked under the counters
 * at the top. It is information, not celebration, and it never sits over the
 * cars.
 */

const STYLE_ID = 'lgp-dodgems-styles';

const STYLES = `
.dg-stick {
  position: absolute;
  left: 0;
  top: 0;
  width: 7.25rem;
  height: 7.25rem;
  margin: -3.625rem 0 0 -3.625rem;
  border-radius: 50%;
  border: 0.25rem solid #fff6eacc;
  background: #ffffff26;
  pointer-events: none;
  opacity: 0;
  transition: opacity 140ms ease;
  z-index: 1;
}
.dg-stick[data-on='true'] { opacity: 1; }
.dg-stick-knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 3.25rem;
  height: 3.25rem;
  margin: -1.625rem 0 0 -1.625rem;
  border-radius: 50%;
  background: #ff8fc0;
  box-shadow: 0 0.1875rem 0 rgba(74, 58, 82, 0.25);
}
.dg-counts { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.dg-tree { background: #d9f7c8e6 !important; }
.dg-time { min-width: 4.625rem; text-align: center; }

/* Under the counters, not over the rink. Sized to sit inside the portrait
   strip's top clearance so it never lands on a driver's face. */
.dg-hint {
  align-self: flex-start;
  max-width: 22rem;
  padding: 0.4375rem 1rem;
  border-radius: 999px;
  background: #fff6eacc;
  font-size: var(--lgp-text-min);
  font-weight: 700;
  opacity: 0.9;
  animation: mg-pop 240ms cubic-bezier(0.25, 1.4, 0.5, 1) both;
}
@media (prefers-reduced-motion: reduce) {
  .dg-hint { animation: none; }
}
`;

export interface DodgemsHud {
  setTime(secondsLeft: number): void;
  setBumps(bumps: number): void;
  setTreeBonks(bonks: number): void;
  /** Big centred number for the 3-2-1, ending in "GO!". `null` clears it. */
  setCount(text: string | null): void;
  /** One quiet line under the counters saying how to drive. `null` clears it. */
  setHint(text: string | null): void;
  /** Draws the thumb-stick where the finger is, or hides it with `null`. */
  setStick(
    stick: { readonly originX: number; readonly originY: number; readonly x: number; readonly y: number } | null,
  ): void;
  showResult(title: string, line: string, hint: string): void;
  dispose(): void;
}

export function createDodgemsHud(container: HTMLElement): DodgemsHud {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.append(style);
  }

  const root = document.createElement('div');
  root.style.display = 'contents';

  const topRow = document.createElement('div');
  topRow.className = 'mg-toprow dg-counts';

  const timePill = document.createElement('div');
  timePill.className = 'mg-pill dg-time';
  timePill.innerHTML = '<b>60</b>s';

  const bumpPill = document.createElement('div');
  bumpPill.className = 'mg-pill';
  bumpPill.innerHTML = '💥 <b>0</b> bumps';

  const treePill = document.createElement('div');
  treePill.className = 'mg-pill dg-tree';
  treePill.innerHTML = '🌳 <b>0</b> tree bonks';

  topRow.append(timePill, bumpPill, treePill);

  const centre = document.createElement('div');
  centre.className = 'mg-centre';

  const stick = document.createElement('div');
  stick.className = 'dg-stick';
  stick.dataset.on = 'false';
  const knob = document.createElement('div');
  knob.className = 'dg-stick-knob';
  stick.append(knob);

  root.append(topRow, centre, stick);
  container.append(root);

  let hintElement: HTMLElement | null = null;
  let countElement: HTMLElement | null = null;
  let lastTime = -1;

  return {
    setTime(secondsLeft: number): void {
      const whole = Math.max(0, Math.ceil(secondsLeft));
      if (whole === lastTime) return;
      lastTime = whole;
      timePill.innerHTML = `<b>${whole}</b>s`;
    },

    setBumps(bumps: number): void {
      bumpPill.innerHTML = `💥 <b>${bumps}</b> bump${bumps === 1 ? '' : 's'}`;
    },

    setTreeBonks(bonks: number): void {
      treePill.innerHTML = `🌳 <b>${bonks}</b> tree bonk${bonks === 1 ? '' : 's'}`;
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

    setHint(text: string | null): void {
      if (text === null) {
        hintElement?.remove();
        hintElement = null;
        return;
      }
      if (!hintElement) {
        hintElement = document.createElement('div');
        hintElement.className = 'dg-hint';
        // After the counters, so it lands under them in the overlay's column
        // rather than anywhere near the cars.
        topRow.after(hintElement);
      }
      hintElement.textContent = text;
    },

    setStick(reading): void {
      if (!reading) {
        stick.dataset.on = 'false';
        return;
      }
      stick.dataset.on = 'true';
      stick.style.transform = `translate(${reading.originX}px, ${reading.originY}px)`;
      const dx = reading.x - reading.originX;
      const dy = reading.y - reading.originY;
      const distance = Math.hypot(dx, dy);
      const clamped = distance > 46 ? 46 / distance : 1;
      knob.style.transform = `translate(${dx * clamped}px, ${dy * clamped}px)`;
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

    dispose(): void {
      root.remove();
    },
  };
}
