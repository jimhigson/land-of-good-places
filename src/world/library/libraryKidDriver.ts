import type { Vector3 } from 'three';
import type { Rng } from '../../core/mathUtils';
import { NPC_RADIUS } from '../../core/constants';
import { createBlinkClock, type BlinkClock } from '../../art/style/faceLife';
import { libraryCushionSize } from '../../art/models/libraryAssets';
import type { CharacterDriver, CharacterIntent, DriverContext } from '../../entities/npc/driver';
import { WaypointDriver, type Waypoint } from '../../entities/npc/waypointDriver';
import { Errand, NO_LIMIT } from '../../entities/npc/activities/errand';
import type { Activity, ActivityHost, Rejoin } from '../../entities/npc/activities/activity';
import { GUEST_PACE } from '../../entities/npc/residentLooks';
import { segmentDistance } from './props';
import {
  LIBRARY_ORIGIN_X,
  LIBRARY_ORIGIN_Z,
  LIBRARY_STORY_CHAIR,
  libraryCushion,
  libraryFacingStoryChair,
  libraryKidAisle,
  libraryKidCircuit,
  libraryKidRugRoute,
  type LibraryKidPlan,
  type LocalPoint,
} from './layout';

/**
 * **What drives one of the library's three children** (#718, plan Step 8).
 *
 * A library child is an ordinary resident of the crowd — the same
 * `NpcCharacter` body, walk cycle, collision and push-apart as a hotel guest
 * (`HotelGuests.ts`) — and, like a guest, she strolls a circuit of her own
 * aisle on a {@link WaypointDriver}. What a guest never does is **answer a
 * summons**: at story time (plan Step 9, `storyTime.ts`) the owl calls, and
 * every child walks her declared way to the rug (`layout.ts`'s
 * `LIBRARY_KID_PLANS`), sits on her own cushion through the story, and walks
 * back to her aisle afterwards. Hence a driver that owns both the stroll and
 * the errand, rather than a `WaypointDriver` somebody pokes from outside — the
 * decision layer is the one thing `driver.ts` says a kind of character gets
 * to differ in.
 *
 * ## Modes
 *
 * `stroll` → ({@link summon}) `walking` → `arrived` → ({@link markSeated})
 * `seated` → ({@link dismiss}) `returning` → `stroll`. A leg that takes too
 * long is given up: on the way to the rug that is `gaveUp` — she stands where
 * she is and listens from there, which is graceful by design (plan, "Risks")
 * — and on the way back it is straight to a fresh stroll from wherever she is.
 * Nothing here moves her body: she is walked by intent like every other
 * character, so a wall or a child in her way stops her exactly as it stops the
 * crowd, and `Errand`'s rails (a timeout, a sidestep when wedged) are what
 * save her from pushing at it for ever.
 *
 * ## The route, and who owns it
 *
 * The way to the rug is built on the first frame after a summons, from where
 * she actually stands: the aisle's nodes between her and the exit node
 * (`libraryKidAisle`), then the declared way from the exit node to her cushion
 * (`libraryKidRugRoute`). The dismissal walks the declared part back to the
 * exit node, then a **fresh** `WaypointDriver` takes up the circuit — which
 * works because every circuit starts at its exit node. Every leg she can ever
 * walk is therefore one `check:library`'s KIDS sweeps.
 *
 * ## The seat is a solid
 *
 * A story cushion is a filled disc with a top (PR #722), and the crowd never
 * climbs a solid, so her walk ends at the cushion's edge — {@link seatArrive}
 * from its middle, her own radius and a hand's breadth out from its rim — and
 * **sitting is a snap** of that much onto the cushion by whoever sits her
 * (`NpcCharacter.beginSeated`), as story time does. Where she stopped is kept
 * ({@link standingSpot}) for the way back.
 *
 * Seeded from the resident's own stream and allocating nothing per frame, like
 * every driver here.
 */

/** How briskly a summoned child walks to the rug: a fraction of the house pace — brisker than her stroll ({@link GUEST_PACE}), short of a run. */
export const KID_SUMMON_PACE = 0.7;

/** How close counts as arriving at a point on the way — `WaypointDriver`'s own arrival, so a route node is reached the way a stroll node is. */
export const KID_ROUTE_ARRIVE = 0.45;

/**
 * How much nearer than touching the cushion's rim counts as having arrived at
 * the seat: her walk ends when her body is this much short of the rim. Small,
 * because every centimetre here is a centimetre of the snap onto the cushion.
 */
export const KID_SEAT_SLACK = 0.1;

/**
 * The longest one leg of a route may take before she gives up on it — a child
 * blocked by the player standing in her way, or by a cushion the player is
 * sitting on, stands and listens from where she is rather than pushing at it
 * for the whole story.
 */
export const KID_LEG_TIMEOUT = 30;

/**
 * **How far from her cushion's middle a child's walk to it ends**: the drawn
 * cushion's radius (measured off `library.glb`), her own body's radius, and
 * {@link KID_SEAT_SLACK}. The crowd never climbs a solid, so this is as near
 * as her feet can get; the snap onto the seat is this long.
 */
export function libraryKidSeatArrive(): number {
  return libraryCushionSize().radius + NPC_RADIUS + KID_SEAT_SLACK;
}

export type LibraryKidMode = 'stroll' | 'walking' | 'arrived' | 'seated' | 'gaveUp' | 'returning';

export class LibraryKidDriver implements CharacterDriver, ActivityHost {
  readonly name = 'library-kid';
  readonly rng: Rng;
  /** `ActivityHost.pace`: what `Errand.step` walks her at on a route — the summons' pace, never the stroll's. */
  readonly pace = KID_SUMMON_PACE;
  readonly plan: LibraryKidPlan;
  /** Her cushion's middle, world metres — where `beginSeated` puts her. */
  readonly seat: Waypoint;
  /** How she faces on it, radians: at the storyteller's chair (`libraryFacingStoryChair`, the cushions' one owner of that bearing). */
  readonly seatFacing: number;
  /** How far from {@link seat} her walk to it ends ({@link libraryKidSeatArrive}). */
  readonly seatArrive: number;

  private readonly circuitWorld: readonly Waypoint[];
  /** Her aisle's distinct nodes, far end first, exit node last. */
  private readonly aisleWorld: readonly Waypoint[];
  /** The exit node, the declared way, the cushion's middle. */
  private readonly rugRouteWorld: readonly Waypoint[];
  /** The storyteller's chair, world metres — what she looks at while she waits and listens. */
  private readonly chair: Waypoint;

  private stroll: WaypointDriver;
  private readonly walk: Errand;
  private readonly toSeat: Errand;
  private readonly blink: BlinkClock;
  private blinkingNow = false;

  private modeValue: LibraryKidMode = 'stroll';
  /** The targets of the current route, in order. */
  private route: readonly Waypoint[] = [];
  /** Index in {@link route} of the exit node: the way back is `route.slice(exitIndex, …)` reversed. */
  private exitIndex = 0;
  /** Index in {@link route} of the next target; `route.length` once the last was reached. */
  private next = 0;
  private legBegun = false;
  /** A summons has been asked and the route is still to be built — it needs her position, so it waits for the next frame. */
  private routeWanted = false;
  private readonly standingSpotValue = { x: Number.NaN, z: Number.NaN };

  constructor(rng: Rng, plan: LibraryKidPlan) {
    this.rng = rng;
    this.plan = plan;
    const toWorld = (point: LocalPoint): Waypoint => ({ x: LIBRARY_ORIGIN_X + point.x, z: LIBRARY_ORIGIN_Z + point.z });
    this.circuitWorld = libraryKidCircuit(plan).map(toWorld);
    this.aisleWorld = libraryKidAisle(plan).map(toWorld);
    this.rugRouteWorld = libraryKidRugRoute(plan).map(toWorld);
    const seat = libraryCushion(plan.seat).at;
    this.seat = toWorld(seat);
    this.seatFacing = (libraryFacingStoryChair(seat) * Math.PI) / 180;
    this.seatArrive = libraryKidSeatArrive();
    this.chair = toWorld(LIBRARY_STORY_CHAIR.at);
    this.stroll = this.freshStroll();
    this.walk = new Errand({ arriveRadius: KID_ROUTE_ARRIVE, timeout: KID_LEG_TIMEOUT, abandonRadius: NO_LIMIT, unstick: true });
    this.toSeat = new Errand({ arriveRadius: this.seatArrive, timeout: KID_LEG_TIMEOUT, abandonRadius: NO_LIMIT, unstick: true });
    // Her own seeded stream, like the stroll's clock — a room of children
    // blinks the same way on every reload, and not in unison.
    this.blink = createBlinkClock(() => this.rng.unit());
  }

  get mode(): LibraryKidMode {
    return this.modeValue;
  }

  /** At the edge of her cushion, waiting to be sat. */
  get arrived(): boolean {
    return this.modeValue === 'arrived';
  }

  /** Stood somewhere on the way, listening from there. */
  get gaveUp(): boolean {
    return this.modeValue === 'gaveUp';
  }

  get seated(): boolean {
    return this.modeValue === 'seated';
  }

  /**
   * Where her walk to the rug ended — the spot she was snapped onto the cushion
   * from, world metres — for whoever stands her back up to put her down there
   * again, so the way back starts where the way there finished. NaN until she
   * has arrived once.
   */
  get standingSpot(): Readonly<{ x: number; z: number }> {
    return this.standingSpotValue;
  }

  /**
   * **Story time: come to the rug.** From her stroll only — a child already on
   * her way, waiting or sitting is left to it. The route is built on the next
   * frame, from where she stands then.
   */
  summon(): void {
    if (this.modeValue !== 'stroll') return;
    this.modeValue = 'walking';
    this.routeWanted = true;
    this.route = [];
    this.exitIndex = 0;
    this.next = 0;
    this.legBegun = false;
    // A new walk knows nothing of which way round the scenery was working.
    this.walk.clearSidestep();
    this.toSeat.clearSidestep();
  }

  /** She has been sat on her cushion (`NpcCharacter.beginSeated`): only from {@link arrived}. */
  markSeated(): void {
    if (this.modeValue !== 'arrived') return;
    this.modeValue = 'seated';
  }

  /**
   * **Story time is over: back to your aisle.** The declared way back to the
   * exit node from the furthest point she reached — all of it from her seat,
   * part of it if she gave up on the way — then a fresh stroll from the exit
   * node. Given up before the exit node, or never routed, she strolls from
   * where she is. From her stroll, nothing to do.
   */
  dismiss(): void {
    if (this.modeValue === 'stroll') return;
    const back = this.route.slice(this.exitIndex, Math.min(this.next, this.route.length - 1)).reverse();
    this.routeWanted = false;
    this.walk.clearSidestep();
    if (back.length === 0) {
      this.resumeStroll();
      return;
    }
    this.route = back;
    this.exitIndex = 0;
    this.next = 0;
    this.legBegun = false;
    this.modeValue = 'returning';
  }

  update(context: DriverContext, intent: CharacterIntent): void {
    switch (this.modeValue) {
      case 'stroll':
        this.stroll.update(context, intent);
        this.blinkingNow = intent.expression === 'blink';
        return;
      case 'walking':
      case 'returning':
        this.walkRoute(context, intent);
        return;
      default:
        this.watchTheChair(context, intent);
    }
  }

  // -------------------------------------------------------------- ActivityHost

  /** True on the frames her eyes are shut. */
  get blinking(): boolean {
    return this.blinkingNow;
  }

  /** Her only activity is the walk itself, so nothing else is ever busy. */
  othersBusy(_asking: Activity): boolean {
    return false;
  }

  /** A child on her way to story time does not stop to wave. */
  requestWave(_seconds: number): void {}

  /** Hands her back to her stroll, wherever she stands. */
  rejoinGraph(_context: DriverContext, _how: Rejoin): void {
    this.resumeStroll();
  }

  // ------------------------------------------------------------------ internals

  /** One frame along the current route: the next target, through its errand. */
  private walkRoute(context: DriverContext, intent: CharacterIntent): void {
    if (this.routeWanted) {
      this.route = this.routeToTheRug(context.position);
      this.exitIndex = this.route.length - this.rugRouteWorld.length;
      this.next = 0;
      this.legBegun = false;
      this.routeWanted = false;
    }
    const target = this.route[this.next];
    if (!target) {
      this.endRoute(context);
      this.watchTheChair(context, intent);
      return;
    }
    const lastLeg = this.next === this.route.length - 1;
    const errand = this.modeValue === 'walking' && lastLeg ? this.toSeat : this.walk;
    if (!this.legBegun) {
      errand.begin(context);
      this.legBegun = true;
    }
    intent.moveX = 0;
    intent.moveZ = 0;
    const outcome = errand.step(this, context, intent, target.x, target.z);
    intent.hop = false;
    intent.interact = false;
    intent.lookAt = null;
    intent.wave = 0;
    intent.expression = this.blink.expressionFor(context.dt, 'neutral');
    this.blinkingNow = intent.expression === 'blink';
    if (outcome === 'walking') return;
    if (outcome === 'arrived') {
      this.next += 1;
      this.legBegun = false;
      if (this.next >= this.route.length) this.endRoute(context);
      return;
    }
    // Given up: on the way there she stands and listens from here; on the way
    // back she strolls from here.
    if (this.modeValue === 'walking') this.modeValue = 'gaveUp';
    else this.resumeStroll();
  }

  /** Stood still, looking at the storyteller's chair, happy. */
  private watchTheChair(context: DriverContext, intent: CharacterIntent): void {
    intent.moveX = 0;
    intent.moveZ = 0;
    intent.hop = false;
    intent.interact = false;
    intent.wave = 0;
    intent.lookAt = Math.atan2(this.chair.x - context.position.x, this.chair.z - context.position.z);
    intent.expression = this.blink.expressionFor(context.dt, 'happy');
    this.blinkingNow = intent.expression === 'blink';
  }

  /** The last target reached: at the seat's edge on the way there, back on the aisle on the way back. */
  private endRoute(context: DriverContext): void {
    if (this.modeValue === 'walking') {
      this.standingSpotValue.x = context.position.x;
      this.standingSpotValue.z = context.position.z;
      this.modeValue = 'arrived';
      return;
    }
    this.resumeStroll();
  }

  private resumeStroll(): void {
    this.stroll = this.freshStroll();
    this.route = [];
    this.exitIndex = 0;
    this.next = 0;
    this.legBegun = false;
    this.routeWanted = false;
    this.modeValue = 'stroll';
  }

  /** A stroll of her circuit — fresh each time, which works because every circuit starts at its exit node. */
  private freshStroll(): WaypointDriver {
    return new WaypointDriver({ rng: this.rng, points: this.circuitWorld, pace: GUEST_PACE });
  }

  /**
   * Her way to the rug from where she stands: the aisle's nodes from the exit
   * side of the leg she is nearest, through the exit node, then the declared
   * way and the cushion. On the exit node already (or past it), just the exit
   * node and on.
   */
  private routeToTheRug(position: Readonly<Vector3>): Waypoint[] {
    const aisle = this.aisleWorld;
    let nearest = Math.max(0, aisle.length - 2);
    let best = Infinity;
    for (let s = 0; s + 1 < aisle.length; s += 1) {
      const distance = segmentDistance(aisle[s]!, aisle[s + 1]!, position);
      if (distance < best) {
        best = distance;
        nearest = s;
      }
    }
    const nodes = aisle.length > 1 ? aisle.slice(nearest + 1) : aisle.slice();
    return [...nodes, ...this.rugRouteWorld.slice(1)];
  }
}
