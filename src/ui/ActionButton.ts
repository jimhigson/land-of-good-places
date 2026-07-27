import type { InputSystem } from '../core/input';
import type { FrameContext, GameSystem } from '../core/types';
import type { Player } from '../entities/Player';
import { isTouchDevice } from '../core/device';
import { ZONE_HEIGHT_TOLERANCE, zoneVerb, type InteractZone } from '../world/interact';

/** How close (in XZ metres) the player's own position must be to a zone's `standX/standZ`. */
const ACTION_REACH = 3;

/**
 * How much closer a *different* zone must be before it steals the button from
 * whichever one is currently showing — the hysteresis band that stops the
 * label flickering between two zones a child is standing between.
 */
const HYSTERESIS_MARGIN = 0.6;

/**
 * "Do the thing" at whatever ride, shop, stall or traversal device the player
 * is standing next to: a HUD pill button naming the action ("Ride", "Enter",
 * "Shop", "Climb", "Play", ...) when close enough, tappable on touch and
 * showing the key to press on keyboard/gamepad.
 *
 * Copies `SignReader`'s idiom on purpose (proximity gate → one pill → press
 * to act) rather than inventing a second pattern for what is, from a
 * six-year-old's point of view, the exact same idea: "stand here, then here's
 * a button that tells you what happens".
 *
 * Deliberately does **not** own any trigger logic. Every zone here is already
 * watched by whichever system registered it (`Shopping`, `TreeClimbing`, the
 * building, the mini-game stalls), each running its own proximity check and
 * its own `justPressed('interact')` — same as a keyboard player never needed
 * this class to exist. Pressing the pill therefore does exactly what
 * `TouchControls`' hop button does: it fires a virtual `interact` press and
 * leaves the actual owner to notice and act, so there is only ever one place
 * that decides what happens when you shop, climb or ride.
 *
 * Precedence with the sign "Read" pill: an interactable you can act on beats
 * a sign you can read, since the sign is passive. Implemented in `Game.ts` by
 * folding {@link active} into the `isBlocked` callback already passed to
 * `SignReader` — not by editing `SignReader` itself. Both pills share the
 * same anchored screen slot (see `.pill--action` in `style.css`), which is
 * both a nod to that precedence and what makes it impossible for the two to
 * ever visually collide: at most one of them is ever showing.
 */
export class ActionButton implements GameSystem {
  readonly name = 'actionButton';

  private readonly button: HTMLButtonElement;
  private readonly text: HTMLElement;
  private readonly keyHint: HTMLElement;

  private nearbyZone: InteractZone | null = null;

  constructor(
    container: HTMLElement,
    private readonly player: Player,
    /** Rebuilt fresh every frame, same as `TapNavigator` — some zones move (the lift, the bubble). */
    private readonly zoneSource: () => readonly InteractZone[],
    private readonly input: InputSystem,
    /** True while something else already owns the screen (shop, backpack, book, welcome panel, a ride, a mini-game, the sign overlay). */
    private readonly isBlocked: () => boolean,
  ) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'pill pill--action';
    this.button.dataset.show = 'false';

    this.text = document.createElement('span');
    // A real `<kbd>` picks up the game's existing key-hint styling for free
    // (see the global `kbd` rule in `style.css`) — the same element the
    // desktop controls hint already uses for W/A/S/D and Space.
    this.keyHint = document.createElement('kbd');
    this.keyHint.textContent = 'E';
    // Touch players have no key to press — the pill itself is the button, so
    // the hint would only ever say something they cannot do.
    if (isTouchDevice()) this.keyHint.style.display = 'none';

    this.button.append(this.text, this.keyHint);
    this.button.addEventListener('click', () => {
      this.button.blur();
      // Same trick `TouchControls` uses for hop/turn: a virtual press of the
      // real action, so whichever system owns this zone sees exactly what a
      // keyboard player's E key would have produced.
      this.input.pressVirtual('interact');
    });
    container.append(this.button);
  }

  /** True while a zone is close enough to show the button — see the precedence note above. */
  get active(): boolean {
    return this.nearbyZone !== null;
  }

  update(_context: FrameContext): void {
    if (this.isBlocked()) {
      this.setNearby(null);
      return;
    }

    const zone = this.pickZone(
      this.zoneSource(),
      this.player.position.x,
      this.player.position.y,
      this.player.position.z,
    );
    this.setNearby(zone);

    // Keyboard/gamepad players already have a real E key that every owning
    // system (Shopping, TreeClimbing, the building, the mini-game stalls)
    // listens for directly with its own proximity check — nothing to do here
    // on a keypress. This class's whole job is the pill: what it says, and
    // giving a mouse/touch player a button that produces the same virtual
    // press (see the `click` handler in the constructor).
  }

  dispose(): void {
    this.button.remove();
  }

  // -------------------------------------------------------------- internals

  private setNearby(zone: InteractZone | null): void {
    if (zone === this.nearbyZone) return;
    this.nearbyZone = zone;
    this.button.dataset.show = zone ? 'true' : 'false';
    if (zone) this.text.textContent = zoneVerb(zone);
  }

  /**
   * The nearest zone worth a button, or `null`. Two gates, then hysteresis:
   *
   * 1. **Actionable**: `pressInteract` zones only — the ones a press actually
   *    does something to. Walk-onto-it zones (the trampoline, the bubble, the
   *    slides, the front door, the train platform) trigger by arrival alone
   *    and have never had a prompt; this doesn't add one.
   * 2. **Close**: within {@link ACTION_REACH} of `standX/standZ` in the XZ
   *    plane, and within `ZONE_HEIGHT_TOLERANCE` vertically — the same
   *    tolerance `pickInteractZone` uses, so a shop one floor up never lights
   *    the button for a shop directly below it.
   *
   * The currently-shown zone is kept even when a marginally nearer one
   * appears, unless the new one wins by more than {@link HYSTERESIS_MARGIN} —
   * otherwise standing on the boundary between two stalls flickers the label
   * back and forth every frame.
   */
  private pickZone(
    zones: readonly InteractZone[],
    x: number,
    y: number,
    z: number,
  ): InteractZone | null {
    let best: InteractZone | null = null;
    let bestDistance = Infinity;
    let currentDistance = Infinity;

    for (const zone of zones) {
      if (!zone.pressInteract) continue;
      if (Math.abs(y - zone.y) > ZONE_HEIGHT_TOLERANCE) continue;
      const distance = Math.hypot(x - zone.standX, z - zone.standZ);
      if (distance > ACTION_REACH) continue;

      if (zone === this.nearbyZone) currentDistance = distance;
      if (distance < bestDistance) {
        best = zone;
        bestDistance = distance;
      }
    }

    if (
      this.nearbyZone &&
      currentDistance <= ACTION_REACH &&
      (best === this.nearbyZone || bestDistance >= currentDistance - HYSTERESIS_MARGIN)
    ) {
      return this.nearbyZone;
    }

    return best;
  }
}
