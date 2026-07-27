/**
 * The ride's screen furniture: where you are, what to look at, and the way home.
 *
 * Plain DOM on the framework's overlay layer, like every other HUD in the game.
 * Two things here are specific to a ride rather than a game:
 *
 * **The framework's hold pad is hidden.** Every other mini-game is a one-button
 * game and the pad says "HOLD to go!"; on the ferris wheel holding means *leave*,
 * and a prompt telling a child to hold would send them home before the aliens
 * arrive. It is hidden with one CSS rule from this file rather than by adding an
 * option to the framework — the overlay is shared with games still to be written
 * and none of them should have to know this ride exists.
 *
 * **Going home has a filling ring.** A skip that happens the instant a thumb
 * rests on the glass is a skip that happens by accident. The ring fills over
 * {@link HOLD_SECONDS} and empties the moment the finger lifts, so leaving is
 * always something you chose.
 */

const STYLE_ID = 'lgp-ferris-styles';

/** How long "hold to go home" has to be held. */
export const HOLD_SECONDS = 1.4;

const STYLES = `
/* The framework's hold prompt means "go faster" everywhere else in the park.
   On this ride it would mean "go home", so it is taken off the screen. */
.mg-content:has(.fw-root) ~ .mg-hold { display: none; }

.fw-root { display: contents; }

.fw-title {
  align-self: flex-start;
  padding: 7px 16px;
  border-radius: 999px;
  background: #fff6eae6;
  box-shadow: 0 4px 0 rgba(74, 58, 82, 0.16);
  font-size: 16px;
  font-weight: 700;
  white-space: nowrap;
}
.fw-title b { font-size: 18px; }
.fw-title span { opacity: 0.72; }

.fw-centre {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 16vh;
  gap: 12px;
  pointer-events: none;
  text-align: center;
}

.fw-shout {
  padding: 9px 22px;
  border-radius: 999px;
  background: #ffd166;
  box-shadow: 0 5px 0 rgba(74, 58, 82, 0.2);
  font-size: 20px;
  font-weight: 800;
  animation: fw-pop 240ms cubic-bezier(0.25, 1.4, 0.5, 1) both;
}

.fw-card {
  padding: 18px 30px;
  border-radius: 26px;
  background: #fff6eaf2;
  box-shadow: 0 8px 0 rgba(74, 58, 82, 0.18);
  animation: fw-pop 280ms cubic-bezier(0.25, 1.4, 0.5, 1) both;
}
.fw-card h2 { margin: 0 0 4px; font-size: 28px; }
.fw-card p { margin: 3px 0; font-size: 17px; opacity: 0.85; }
.fw-card .fw-sub { font-size: 15px; opacity: 0.7; }

/* The way home. Sits low and stays quiet until a finger is actually down. */
.fw-home {
  position: absolute;
  left: 50%;
  bottom: calc(18px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 18px;
  border-radius: 999px;
  background: #fff6ead9;
  box-shadow: 0 5px 0 rgba(74, 58, 82, 0.16);
  font-size: 15px;
  font-weight: 700;
  pointer-events: none;
  opacity: 0.55;
  transition: opacity 160ms ease, transform 120ms ease;
}
.fw-home[data-holding='true'] { opacity: 1; transform: translateX(-50%) translateY(3px); }
.fw-home[data-hidden='true'] { opacity: 0; }

.fw-ring {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: conic-gradient(#ff7fb6 var(--fw-fill, 0turn), #ffe3f1 0);
  box-shadow: inset 0 0 0 3px #fff6ea;
}

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
  width: 116px;
  height: 116px;
  margin: -58px 0 0 -58px;
  border-radius: 50%;
  border: 4px solid #fff6eacc;
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
  width: 52px;
  height: 52px;
  margin: -26px 0 0 -26px;
  border-radius: 50%;
  background: #87c9ff;
  box-shadow: 0 3px 0 rgba(74, 58, 82, 0.25);
}
`;

export interface RideHud {
  /** The little line under the ride's name: "Through the clouds…". */
  setCaption(text: string): void;
  /** A short cheerful interjection. Clears itself. */
  shout(text: string, seconds?: number): void;
  /** 0..1 of the way to going home. Below zero hides the pill entirely. */
  setHomeHold(progress: number, holding: boolean): void;
  /** The end-of-ride card. */
  showCard(title: string, line: string, hint: string): void;
  /** Draws the look-around stick where the finger is, or hides it with `null`. */
  setStick(
    stick: { readonly originX: number; readonly originY: number; readonly x: number; readonly y: number } | null,
  ): void;
  update(dt: number): void;
  dispose(): void;
}

export function createRideHud(container: HTMLElement, touch: boolean): RideHud {
  ensureStyles();

  const root = document.createElement('div');
  root.className = 'fw-root';

  const title = document.createElement('div');
  title.className = 'fw-title';
  const caption = document.createElement('span');
  caption.textContent = 'all aboard!';
  const heading = document.createElement('b');
  heading.textContent = '🎡 Space Ferris Wheel ';
  title.append(heading, caption);

  const centre = document.createElement('div');
  centre.className = 'fw-centre';

  const home = document.createElement('div');
  home.className = 'fw-home';
  const ring = document.createElement('span');
  ring.className = 'fw-ring';
  const homeText = document.createElement('span');
  // "Hold anywhere" would now also describe dragging to look around — say
  // "hold still" instead, so the two gestures read as different things.
  homeText.textContent = touch ? 'Hold still to go home' : 'Hold Space to go home';
  home.append(ring, homeText);

  const stick = document.createElement('div');
  stick.className = 'fw-stick';
  stick.dataset.on = 'false';
  const knob = document.createElement('div');
  knob.className = 'fw-stick-knob';
  stick.append(knob);

  root.append(title, centre, home, stick);
  container.append(root);

  let shoutElement: HTMLElement | null = null;
  let shoutTimer = 0;

  return {
    setCaption(text: string): void {
      if (caption.textContent === text) return;
      caption.textContent = text;
    },

    shout(text: string, seconds = 2.4): void {
      shoutElement?.remove();
      shoutElement = document.createElement('div');
      shoutElement.className = 'fw-shout';
      shoutElement.textContent = text;
      centre.append(shoutElement);
      shoutTimer = seconds;
    },

    setHomeHold(progress: number, holding: boolean): void {
      home.dataset.holding = holding ? 'true' : 'false';
      home.dataset.hidden = progress < 0 ? 'true' : 'false';
      ring.style.setProperty('--fw-fill', `${Math.max(0, Math.min(1, progress))}turn`);
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
