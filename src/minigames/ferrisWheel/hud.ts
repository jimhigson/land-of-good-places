/**
 * The ride's screen furniture: where you are and what to look at.
 *
 * Plain DOM on the framework's overlay layer, like every other HUD in the game.
 * One thing here is specific to a ride rather than a game:
 *
 * **The framework's hold pad is hidden.** Every other mini-game is a one-button
 * game and the pad says "HOLD to go!"; this is a ride with nothing to press for,
 * so the prompt would be pointing at nothing. It is hidden with one CSS rule
 * from this file rather than by adding an option to the framework — the overlay
 * is shared with games still to be written and none of them should have to know
 * this ride exists.
 *
 * **The way out is the framework's ✕, and only that.** A hold-anywhere gesture
 * used to leave as well; the family had it removed (28 July 2026) because the ✕
 * already does it and a child can actually see a button.
 */

const STYLE_ID = 'lgp-ferris-styles';

const STYLES = `
/* The framework's hold prompt means "go faster" everywhere else in the park.
   On this ride it would mean "go home", so it is taken off the screen. */
.mg-content:has(.fw-root) ~ .mg-hold { display: none; }

.fw-root { display: contents; }


.fw-centre {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 16vh;
  gap: 0.75rem;
  pointer-events: none;
  text-align: center;
}

.fw-shout {
  padding: 0.5625rem 1.375rem;
  border-radius: 999px;
  background: #ffd166;
  box-shadow: 0 0.3125rem 0 rgba(74, 58, 82, 0.2);
  font-size: 1.25rem;
  font-weight: 800;
  animation: fw-pop 240ms cubic-bezier(0.25, 1.4, 0.5, 1) both;
}

.fw-card {
  padding: 1.125rem 1.875rem;
  border-radius: 1.625rem;
  background: #fff6eaf2;
  box-shadow: 0 0.5rem 0 rgba(74, 58, 82, 0.18);
  animation: fw-pop 280ms cubic-bezier(0.25, 1.4, 0.5, 1) both;
}
.fw-card h2 { margin: 0 0 0.25rem; font-size: 1.75rem; }
.fw-card p { margin: 0.1875rem 0; font-size: 1.0625rem; opacity: 0.85; }
.fw-card .fw-sub { font-size: var(--lgp-text-min); opacity: 0.7; }

@keyframes fw-pop {
  from { transform: scale(0.72); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .fw-shout, .fw-card { animation: none; }
}

/* The look-around stick — the dodgems' own .dg-stick, copied rather than
   shared: two mini-games importing from each other's folders is worse than
   forty lines of identical CSS (see look.ts). */
.fw-stick {
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
.fw-stick[data-on='true'] { opacity: 1; }
.fw-stick-knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 3.25rem;
  height: 3.25rem;
  margin: -1.625rem 0 0 -1.625rem;
  border-radius: 50%;
  background: #87c9ff;
  box-shadow: 0 0.1875rem 0 rgba(74, 58, 82, 0.25);
}
`;

export interface RideHud {
  /** A short cheerful interjection. Clears itself. */
  shout(text: string, seconds?: number): void;
  /** The end-of-ride card. */
  showCard(title: string, line: string, hint: string): void;
  /** Draws the look-around stick where the finger is, or hides it with `null`. */
  setStick(
    stick: { readonly originX: number; readonly originY: number; readonly x: number; readonly y: number } | null,
  ): void;
  update(dt: number): void;
  dispose(): void;
}

export function createRideHud(container: HTMLElement): RideHud {
  ensureStyles();

  const root = document.createElement('div');
  root.className = 'fw-root';

  const centre = document.createElement('div');
  centre.className = 'fw-centre';

  const stick = document.createElement('div');
  stick.className = 'fw-stick';
  stick.dataset.on = 'false';
  const knob = document.createElement('div');
  knob.className = 'fw-stick-knob';
  stick.append(knob);

  root.append(centre, stick);
  container.append(root);

  let shoutElement: HTMLElement | null = null;
  let shoutTimer = 0;

  return {

    shout(text: string, seconds = 2.4): void {
      shoutElement?.remove();
      shoutElement = document.createElement('div');
      shoutElement.className = 'fw-shout';
      shoutElement.textContent = text;
      centre.append(shoutElement);
      shoutTimer = seconds;
    },

    showCard(cardTitle: string, line: string, hint: string): void {
      const card = document.createElement('div');
      card.className = 'fw-card';
      const cardHeading = document.createElement('h2');
      cardHeading.textContent = cardTitle;
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      const small = document.createElement('p');
      small.className = 'fw-sub';
      small.textContent = hint;
      card.append(cardHeading, paragraph, small);
      centre.append(card);
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

    update(dt: number): void {
      if (shoutTimer <= 0) return;
      shoutTimer -= dt;
      if (shoutTimer > 0) return;
      shoutElement?.remove();
      shoutElement = null;
    },

    dispose(): void {
      root.remove();
    },
  };
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}
