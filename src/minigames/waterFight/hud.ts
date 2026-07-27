import { hexToCss } from '../../core/palette';

/**
 * The water fight's HUD: splash points, the score to beat, and how long is left.
 *
 * Plain DOM on the framework's overlay layer, for the same reasons the park's
 * HUD and the rail racer's are: text drawn by the browser is crisper than text
 * drawn into a texture, it reflows for a phone by itself, and it costs the
 * renderer nothing.
 *
 * **The score is the biggest thing on the screen after the children.**
 * GAME_DESIGN asks for splash points *"shown big and cheerful"*, and a
 * six-year-old counting her own splashes needs the number to be readable from
 * the other side of the sofa. Every hit pops it, and every hit throws a little
 * `+14` up beside it, because the connection between *I squirted Nell* and *the
 * number went up* is the entire scoring system as far as a child is concerned.
 *
 * **No more pop-up messages (27 July 2026 feedback).** This used to also throw
 * a big banner up the middle of the screen — a giggle when you were splashed, a
 * streak count, a rainbow announcement, even the "SPLASH!" that starts the
 * round — every one of which sat on top of the garden the family was trying to
 * watch. That feedback now lives on the portrait row instead (`portraits.ts`):
 * a splashed child's portrait goes wet, whoever landed the shot gets a brief
 * smile, the rainbow is announced by the actual rainbow in the sky rather than
 * a sentence about it, and "SPLASH!" is just the last frame of the 3-2-1
 * (`setCount`), gone before the fight has properly begun.
 *
 * One piece of housekeeping lives here too: the framework's "HOLD to go" pad is
 * hidden for the duration, because this game's button is not a go button. It is
 * hidden with a body attribute and one CSS rule — the same trick the framework
 * uses to fade the park's HUD — so nothing outside this folder is edited and the
 * pad comes straight back for the next stall.
 */

const STYLE_ID = 'lgp-waterfight-styles';

const STYLES = `
/* The framework's hold pad says "HOLD to go!", which is the rail racer's
   control, not ours. Hidden by attribute so it returns intact on the way out. */
body[data-waterfight='true'] .mg-hold { display: none; }

.wf-row { display: flex; gap: 0.5rem; align-items: flex-start; flex-wrap: wrap; }

.wf-score {
  position: relative;
  padding: 0.375rem 1.125rem 0.5rem;
  border-radius: 1.375rem;
  background: #fff6eaf2;
  box-shadow: 0 0.3125rem 0 rgba(74, 58, 82, 0.18);
  text-align: center;
  min-width: 8rem;
}
.wf-score .wf-label {
  display: block;
  font-size: var(--lgp-text-min);
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  opacity: 0.62;
}
.wf-score .wf-value {
  display: block;
  font-size: 2.625rem;
  font-weight: 800;
  line-height: 1.02;
  color: #2f9fd8;
}
.wf-score[data-pop='true'] .wf-value { animation: wf-bump 320ms cubic-bezier(0.25, 1.5, 0.5, 1); }

.wf-pill {
  padding: 0.4375rem 0.9375rem;
  border-radius: 999px;
  background: #fff6eae6;
  box-shadow: 0 0.25rem 0 rgba(74, 58, 82, 0.16);
  font-size: var(--lgp-text-min);
  font-weight: 700;
  white-space: nowrap;
}
.wf-pill b { font-size: 1.1875rem; }
.wf-pill[data-hurry='true'] { background: #ffd9ecf2; }

/* The little "+14" that leaps out of the score every time you land one. */
.wf-gain {
  position: absolute;
  left: 50%;
  top: 0.125rem;
  transform: translateX(-50%);
  font-size: 1.625rem;
  font-weight: 800;
  color: #2fb98f;
  text-shadow: 0 0.125rem 0 rgba(255, 255, 255, 0.9);
  pointer-events: none;
  animation: wf-gain 780ms ease-out forwards;
}

.wf-hint {
  align-self: center;
  margin-top: auto;
  margin-bottom: 0.375rem;
  padding: 0.5rem 1.125rem;
  border-radius: 999px;
  background: #fff6eacc;
  font-size: var(--lgp-text-min);
  font-weight: 700;
  opacity: 0.85;
  text-align: center;
}

@keyframes wf-bump {
  0% { transform: scale(1); }
  40% { transform: scale(1.28); }
  100% { transform: scale(1); }
}
@keyframes wf-gain {
  0% { transform: translate(-50%, 0); opacity: 0; }
  18% { opacity: 1; }
  100% { transform: translate(-50%, -3.375rem); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .wf-score[data-pop='true'] .wf-value,
  .wf-gain { animation: none; }
}
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}

export interface WaterFightHud {
  /** The running total. Pops whenever it goes up. */
  setPoints(points: number): void;
  /** Throws a `+n` out of the score pill. */
  gain(amount: number): void;
  setBest(best: number): void;
  /** Seconds left in the round. Turns pink for the last ten. */
  setTime(seconds: number): void;
  /** Big centred text: the 3-2-1, ending in "SPLASH!". `null` clears it. */
  setCount(text: string | null): void;
  /** The line along the bottom telling you what the controls are. */
  setHint(text: string | null): void;
  showResult(title: string, line: string, hint: string): void;
  update(dt: number): void;
  dispose(): void;
}

export function createWaterFightHud(container: HTMLElement): WaterFightHud {
  ensureStyles();
  document.body.dataset.waterfight = 'true';

  const root = document.createElement('div');
  root.style.display = 'contents';

  const row = document.createElement('div');
  row.className = 'wf-row';

  const score = document.createElement('div');
  score.className = 'wf-score';
  const scoreLabel = document.createElement('span');
  scoreLabel.className = 'wf-label';
  scoreLabel.textContent = 'Splash points';
  const scoreValue = document.createElement('span');
  scoreValue.className = 'wf-value';
  scoreValue.textContent = '0';
  score.append(scoreLabel, scoreValue);

  const bestPill = document.createElement('div');
  bestPill.className = 'wf-pill';
  bestPill.innerHTML = 'Best <b>0</b>';

  const timePill = document.createElement('div');
  timePill.className = 'wf-pill';
  timePill.innerHTML = '<b>90</b>s';

  row.append(score, bestPill, timePill);

  const centre = document.createElement('div');
  centre.className = 'mg-centre';

  const bottom = document.createElement('div');
  bottom.className = 'mg-centre';
  bottom.style.justifyContent = 'flex-end';
  bottom.style.gap = '0.5rem';

  root.append(row, centre, bottom);
  container.append(root);

  let shownPoints = -1;
  let countElement: HTMLElement | null = null;
  let hintElement: HTMLElement | null = null;
  let popTimer = 0;

  return {
    setPoints(points: number): void {
      if (points === shownPoints) return;
      const rising = points > shownPoints;
      shownPoints = points;
      scoreValue.textContent = String(points);
      if (!rising) return;
      // Restarting a CSS animation needs the attribute to actually change, so
      // it is cleared for a frame by the timer in `update`.
      score.dataset.pop = 'false';
      popTimer = 0.02;
    },

    gain(amount: number): void {
      const gainElement = document.createElement('div');
      gainElement.className = 'wf-gain';
      gainElement.textContent = `+${amount}`;
      // Slight horizontal scatter so two quick hits do not stack into one
      // illegible blob.
      gainElement.style.marginLeft = `${Math.round(Math.random() * 34 - 17)}px`;
      gainElement.addEventListener('animationend', () => gainElement.remove(), { once: true });
      score.append(gainElement);
    },

    setBest(best: number): void {
      bestPill.innerHTML = `Best <b>${best}</b>`;
    },

    setTime(seconds: number): void {
      const whole = Math.max(0, Math.ceil(seconds));
      timePill.innerHTML = `<b>${whole}</b>s`;
      timePill.dataset.hurry = whole <= 10 ? 'true' : 'false';
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
        hintElement.className = 'wf-hint';
        bottom.append(hintElement);
      }
      hintElement.textContent = text;
    },

    showResult(title: string, line: string, hint: string): void {
      const card = document.createElement('div');
      card.className = 'mg-card';
      const heading = document.createElement('h2');
      heading.textContent = title;
      // The score itself is repeated inside the card in the score colour, so
      // the last thing on screen is the number, not the sentence about it.
      const paragraph = document.createElement('p');
      paragraph.innerHTML = line;
      paragraph.style.color = hexToCss(0x2f9fd8);
      paragraph.style.fontWeight = '800';
      paragraph.style.fontSize = '1.35rem';
      const small = document.createElement('p');
      small.className = 'mg-sub';
      small.textContent = hint;
      card.append(heading, paragraph, small);
      centre.append(card);
    },

    update(dt: number): void {
      if (popTimer > 0) {
        popTimer -= dt;
        if (popTimer <= 0) score.dataset.pop = 'true';
      }
    },

    dispose(): void {
      delete document.body.dataset.waterfight;
      root.remove();
    },
  };
}
