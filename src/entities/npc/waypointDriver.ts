import type { Rng } from '../../core/mathUtils';
import { createBlinkClock, type BlinkClock } from '../../art/style/faceLife';
import { clamp01 } from '../../core/mathUtils';
import type { CharacterDriver, CharacterIntent, DriverContext } from './driver';

/**
 * A character who lives somewhere small, and strolls a circuit of it.
 *
 * The second driver the game ships with, and it exists because of the rule
 * Jim asked for after playing the hotel: *"even other children can be walked
 * through even though in the park NPCs are solid — they should be the same
 * code."* They are. A hotel guest is an ordinary {@link NpcCharacter}: the
 * same body, the same walk cycle, the same `CollisionWorld`, the same
 * `WalkSurfaces` ground, and the same push-apart from the player and from
 * each other that `NpcSystem` gives the park's twelve children. **Only the
 * decision layer is different**, which is precisely the split `driver.ts`
 * exists to make — see its header table.
 *
 * ### Why a second driver rather than the wander driver
 *
 * `WanderDriver` decides by walking a {@link PoiGraph}, and a graph is a thing
 * the *park* has: one connected place whose paths were solved against the
 * finished collision world. Every hotel room is its own disjoint space at its
 * own far-off origin (`world/hotel/layout.ts`), joined only by portals, so a
 * guest has nowhere to walk *to* — there is no graph to search because there
 * are no edges. What is left is the honest whole problem: a handful of points
 * somebody else worked out, walked between, forever.
 *
 * So this file owns *strolling a fixed circuit* and nothing else. It knows
 * nothing about hotels: give it points in a garden shed and it will pace the
 * shed. Whoever supplies the points owns whether they are sensible ones — for
 * the hotel that is `world/hotel/place.ts`'s keep-outs, registered by the same
 * call that made each prop solid.
 *
 * ### Three things it does beyond walking
 *
 * - **Dawdles.** A pause on arrival, seeded per character, or the circuit
 *   reads as a patrol.
 * - **Notices you.** Stand near one while it is pausing and it turns to look,
 *   and sometimes waves — the same gesture `NpcCharacter.animate` blends for a
 *   park child, so it looks like the same person.
 * - **Gives up.** A leg that has taken too long is abandoned for the next
 *   point. Props became solid in the same change that made these bodies real,
 *   and a guest leaning on a chair forever is the failure that buys.
 */

/** How close counts as having arrived. */
const ARRIVE_RADIUS = 0.45;

/** How long a character dawdles on arriving somewhere. */
const PAUSE_RANGE: readonly [number, number] = [0.7, 2.9];

/** Longest one leg may take before it is abandoned for the next point. */
const LEG_TIMEOUT = 9;

/** The player has to be this close before a resident notices them at all. */
const NOTICE_RANGE = 4.5;

/** How long a wave lasts, and how long before the same one waves again. */
const WAVE_DURATION = 1.6;
const WAVE_COOLDOWN = 11;

/** Chance a pause with the player stood near it turns into a wave. */
const WAVE_CHANCE = 0.5;

/** Somewhere to stand, in world metres. */
export interface Waypoint {
  readonly x: number;
  readonly z: number;
}

export interface WaypointOptions {
  /** This character's own seeded stream. Never `Math.random`. */
  readonly rng: Rng;
  /**
   * The circuit, in **world** metres — the same frame the body moves in, so
   * nothing here has to know which space the points came from.
   */
  readonly points: readonly Waypoint[];
  /**
   * Fraction of a walk. 1 is the house walking pace; below it dawdles, which
   * is what a pet's shorter legs are worth. See `CharacterIntent.moveX`.
   */
  readonly pace?: number;
}

export class WaypointDriver implements CharacterDriver {
  readonly name = 'waypoint';

  private readonly rng: Rng;
  private readonly points: readonly Waypoint[];
  private readonly pace: number;
  private readonly blink: BlinkClock;

  private target = 0;
  private pause: number;
  private legTime = 0;
  private wave = 0;
  private waveCooldown: number;

  constructor(options: WaypointOptions) {
    this.rng = options.rng;
    this.points = options.points;
    this.pace = clamp01(options.pace ?? 1);
    // Seeded from this character's own stream rather than `Math.random`, so a
    // room full of guests blinks the same way on every reload — and, because
    // each stream is salted per guest, not in unison.
    this.blink = createBlinkClock(() => this.rng.unit());
    this.pause = this.rng.range(0, PAUSE_RANGE[1]);
    this.waveCooldown = this.rng.range(0, WAVE_COOLDOWN);
    // Start walking towards the *second* point: the body is placed on the
    // first one, and a character whose first act is to arrive where it already
    // stands spends its opening second stood still for no reason.
    this.target = this.points.length > 1 ? 1 : 0;
  }

  update(context: DriverContext, intent: CharacterIntent): void {
    const { dt } = context;

    if (this.waveCooldown > 0) this.waveCooldown -= dt;

    const point = this.points[this.target];
    const dx = point ? point.x - context.position.x : 0;
    const dz = point ? point.z - context.position.z : 0;
    const distance = Math.hypot(dx, dz);

    const playerDistance = Math.hypot(
      context.playerPosition.x - context.position.x,
      context.playerPosition.z - context.position.z,
    );
    const noticing = playerDistance < NOTICE_RANGE;

    if (this.pause > 0) {
      this.pause -= dt;
      // Turn to whoever has come over. `lookAt` is ignored while moving (see
      // `CharacterIntent`), so this can only ever happen while stood still —
      // which is the only time it would read as being looked at rather than as
      // a broken walk cycle.
      if (noticing) {
        intent.lookAt = Math.atan2(
          context.playerPosition.x - context.position.x,
          context.playerPosition.z - context.position.z,
        );
        if (this.wave <= 0 && this.waveCooldown <= 0 && this.rng.chance(WAVE_CHANCE * dt)) {
          this.wave = WAVE_DURATION;
          this.waveCooldown = WAVE_COOLDOWN;
        }
      }
    } else if (!point || distance <= ARRIVE_RADIUS) {
      this.arrive();
    } else {
      this.legTime += dt;
      if (this.legTime > LEG_TIMEOUT) {
        // Something is in the way and has been for a while — a chair, another
        // guest, the player stood in a doorway. Take the next point instead of
        // leaning on it forever.
        this.arrive();
      } else {
        intent.moveX = (dx / distance) * this.pace;
        intent.moveZ = (dz / distance) * this.pace;
      }
    }

    if (this.wave > 0) this.wave -= dt;
    intent.wave = clamp01(this.wave / (WAVE_DURATION * 0.35));
    // A blink punched through whatever the mood is, exactly as every other
    // face in the park does it — happy while somebody is here, neutral alone.
    intent.expression = this.blink.expressionFor(dt, noticing ? 'happy' : 'neutral');
  }

  /** Take the next point on the circuit, after a moment stood about. */
  private arrive(): void {
    this.target = this.points.length > 0 ? (this.target + 1) % this.points.length : 0;
    this.pause = this.rng.range(PAUSE_RANGE[0], PAUSE_RANGE[1]);
    this.legTime = 0;
  }
}
