import { STAIR_RIDE_TIME_SCALE } from '../../core/constants';
import type { StairDirection } from '../../ui/StairMenu';
import { stairRoute, TOP_DECK, worldX, worldZ } from './layout';
import type { WalkSurfaces } from './surfaces';

/**
 * The stairs, as a ride.
 *
 * *"Stairs are a ride, not a challenge"* — the family's third note, and the one
 * that changes how a floor is climbed. Choosing **Climb** or **Descend** hands
 * the character to this, which walks them along the switchback one waypoint at a
 * time while the whole world runs at {@link STAIR_RIDE_TIME_SCALE}. Nobody ever
 * has to steer a six-year-old round a half-landing again.
 *
 * The one design decision worth defending: **it is a walk, not an animation.**
 * The ride does not move the character — it feeds waypoints to the ordinary
 * tap-to-move navigator, which pushes the ordinary movement stick, which runs
 * the ordinary walk cycle over the ordinary surface sampler. So the legs move
 * properly, the ramps lift the feet properly, collision still holds, and the
 * ride cannot ever disagree with what the floor plan says the stairs are. All it
 * really owns is *the order of the corners* and *how fast the clock runs*.
 *
 * Cancelling is free for the same reason: the navigator already gives up the
 * moment a real thumb touches the stick, and it tells us so.
 */

export interface StairRideHooks {
  /** Walk to a world point; call `onArrive` there, or `onAbandon` if taken over. */
  walkTo(
    x: number,
    y: number,
    z: number,
    handlers: { onArrive(): void; onAbandon(): void },
  ): void;
  /** Multiply the world clock and every animation rate by this. */
  setTimeScale(scale: number): void;
  /** Turn the speed-lines vignette on or off. */
  setWhoosh(on: boolean): void;
  /** Where the character's feet are right now. The sampler needs a reference. */
  playerY(): number;
  /** A soft blink when the character steps out onto the new floor. */
  onArrived(deck: number): void;
}

/**
 * Give up after this much *game* time, whatever the navigator thinks.
 *
 * A backstop, not a mechanism: a flight is about seven metres of walking, which
 * is a couple of seconds at 3.5x. If something wedges the character in a corner
 * the ride must hand the controls back rather than leaving the world in
 * fast-forward with a vignette over it.
 */
const RIDE_TIMEOUT = 14;

export class StairRide {
  private points: readonly (readonly [number, number])[] = [];
  private index = 0;
  private destinationDeck = 0;
  private elapsed = 0;
  private running = false;

  private readonly surfaces: WalkSurfaces;
  private readonly hooks: StairRideHooks;

  constructor(
    surfaces: WalkSurfaces,
    hooks: StairRideHooks,
  ) {
    this.surfaces = surfaces;
    this.hooks = hooks;
  }

  get active(): boolean {
    return this.running;
  }

  /**
   * Sets off from `deck`, in `direction`. Does nothing if there are no stairs
   * that way — the menu greys those out, but a keyboard player can still ask.
   */
  start(deck: number, direction: StairDirection): boolean {
    // Both directions are walked over the *same* pair of flights: the ones
    // between the lower deck and the one above it. Going down simply reads the
    // corner list backwards, which is why there is one route function and not
    // two mirror-image ones that could drift apart.
    const flightDeck = direction === 'up' ? deck : deck - 1;
    if (flightDeck < 0 || flightDeck >= TOP_DECK) return false;

    const route = stairRoute(flightDeck);
    this.points = direction === 'up' ? route : [...route].reverse();
    this.destinationDeck = direction === 'up' ? deck + 1 : deck - 1;
    this.index = 0;
    this.elapsed = 0;
    this.running = true;

    this.hooks.setTimeScale(STAIR_RIDE_TIME_SCALE);
    this.hooks.setWhoosh(true);
    this.step();
    return true;
  }

  update(dt: number): void {
    if (!this.running) return;
    this.elapsed += dt;
    if (this.elapsed > RIDE_TIMEOUT) this.stop(false);
  }

  /** Hands the controls straight back — a manual input, or arriving. */
  stop(arrived: boolean): void {
    if (!this.running) return;
    this.running = false;
    this.points = [];
    this.hooks.setTimeScale(1);
    this.hooks.setWhoosh(false);
    if (arrived) this.hooks.onArrived(this.destinationDeck);
  }

  // -------------------------------------------------------------- internals

  private step(): void {
    const next = this.points[this.index];
    if (!next) {
      this.stop(true);
      return;
    }
    this.index += 1;

    const [localX, localZ] = next;
    const x = worldX(localX);
    const z = worldZ(localZ);
    // Ask the sampler where the floor is *from where the character currently
    // is*, exactly as a tap does — the same question gives "the flight" halfway
    // up and "the deck" at the top, with no special case for either. The height
    // only steers the marker; the seek itself is flat.
    const y = this.surfaces.sample(x, z, this.hooks.playerY());

    this.hooks.walkTo(x, y, z, {
      onArrive: () => {
        if (this.running) this.step();
      },
      onAbandon: () => this.stop(false),
    });
  }
}
