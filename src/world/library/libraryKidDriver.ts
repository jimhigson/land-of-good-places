import type { Vector3 } from 'three';
import type { Rng } from '../../core/mathUtils';
import { NPC_RADIUS } from '../../core/constants';
import { createBlinkClock, type BlinkClock } from '../../art/style/faceLife';
import { libraryCushionSize } from '../../art/models/libraryAssets';
import type { CharacterDriver, CharacterIntent, DriverContext } from '../../entities/npc/driver';
import { ARRIVE_RADIUS, WaypointDriver, type Waypoint } from '../../entities/npc/waypointDriver';
import { Errand, NO_LIMIT } from '../../entities/npc/activities/errand';
import type { Activity, ActivityHost, Rejoin } from '../../entities/npc/activities/activity';
import { GUEST_PACE } from '../../entities/npc/residentLooks';
import { PLAYER_SEPARATION } from '../../entities/npc/NpcSystem';
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
 * long is given up on the way to the rug: that is `gaveUp` — she stands where
 * she is and listens from there, which is graceful by design (plan, "Risks").
 * On the way back a leg that takes too long is **begun again**: she keeps to
 * her declared way, waiting her turn behind whoever is in it (a child standing
 * still is furniture to the crowd), and never cuts across the room to her
 * aisle on a line nobody swept. A summons on the way back turns her round
 * along the same way ({@link summon}); a dismissal on it changes nothing.
 * Nothing here moves her body: she is walked by intent like every other
 * character, so a wall or a child in her way stops her exactly as it stops the
 * crowd, and `Errand`'s rails (a timeout, a sidestep when wedged) are what
 * keep her from pushing blindly at it.
 *
 * ## The route, and who owns it
 *
 * The way to the rug is built on the first frame after a summons, from where
 * she actually stands: the aisle's nodes between her and the exit node
 * (`libraryKidAisle`), then the declared way from the exit node to her cushion
 * (`libraryKidRugRoute`). The dismissal walks the declared part back to the
 * exit node, then a **fresh** `WaypointDriver` takes up the circuit — which
 * works because every circuit starts at its exit node. Given up on the way
 * there before the exit node, she is still on her own aisle, and the fresh
 * stroll walks her along it. Every leg she can ever walk is therefore one
 * `check:library`'s KIDS sweeps — and KIDS also rehearses the dismissal twice
 * over, the summons on the way back and a way back held up past the timeout.
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

/** How close counts as arriving at a point on the way — `WaypointDriver`'s own arrival (imported, one owner), so a route node is reached the way a stroll node is. */
export const KID_ROUTE_ARRIVE = ARRIVE_RADIUS;

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

/**
 * How long the player must have stood still before a child she is in the way
 * of plans a way round her — long enough that a child walking past is never
 * mistaken for one standing in the way.
 */
export const KID_HELD_AFTER = 1;

/**
 * How near the player's distance a child must have come for her to count as
 * held off a point: the crowd keeps a child `PLAYER_SEPARATION` from a player
 * standing still (she is furniture to it), and a child pressing toward a point
 * the player stands on comes to rest a little inside that.
 */
export const KID_HELD_SLACK = 0.3;

/** How far out from a still player a way round her goes: just outside the crowd's distance from her. */
export const KID_ROUND_HER = PLAYER_SEPARATION + 0.3;

/** How many places on that ring round her are tried — 15° apart, so a step between neighbours stays well outside her distance. */
const ROUND_BEARINGS = 24;

/** The body a planned line is checked for: hers and a hand's breadth — KIDS' own sweep radius. */
export const KID_LINE_BODY = NPC_RADIUS + 0.05;

/** A planned line is checked this often along it (metres). */
const LINE_STEP = 0.1;

/** The first stretch of a planned line is not asked of the world: where she stands she may be up against something. */
const LINE_GRACE = 0.3;

/** A planned line may pass this much inside the player's distance and still count as outside it: a brush, not a shove. */
const LINE_BRUSH = 0.1;

/** How often a held child asks again for a way past — the player, or another child, may have moved. */
const REPLAN_SECONDS = 1;

/**
 * Asks the real world whether a body of `radius` at world `(x, z)` meets no
 * solid: `CollisionWorld.isClearCircle`, handed in by whoever builds the
 * children (`Library`), so every line a child plans for herself is checked
 * against what is really there — the same world KIDS sweeps her declared legs
 * against.
 */
export type ClearAt = (x: number, z: number, radius: number) => boolean;

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

  /** The real world's clearance, for the lines she plans round a player standing in her way; null plans none. */
  private readonly clearAt: ClearAt | null;
  /** A way round a still player: ring places to walk, in order, before the point she is held off counts as passed. */
  private readonly roundPath = new Int32Array(ROUND_BEARINGS);
  private roundLength = 0;
  private roundIndex = 0;
  private replanIn = 0;
  /** The planner's scratch, allocated once: the ring round her, and Dijkstra's tables over it and two ends. */
  private readonly ringX = new Float64Array(ROUND_BEARINGS);
  private readonly ringZ = new Float64Array(ROUND_BEARINGS);
  private readonly ringClear = new Uint8Array(ROUND_BEARINGS);
  private readonly cost = new Float64Array(ROUND_BEARINGS + 2);
  private readonly from = new Int32Array(ROUND_BEARINGS + 2);
  private readonly done = new Uint8Array(ROUND_BEARINGS + 2);

  constructor(rng: Rng, plan: LibraryKidPlan, clearAt: ClearAt | null = null) {
    this.rng = rng;
    this.plan = plan;
    this.clearAt = clearAt;
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
   * **Story time: come to the rug.** From her stroll — the route is built on
   * the next frame, from where she stands then — or on her way back from the
   * last story, when she turns round where she is and walks the same declared
   * way back to her cushion ({@link turnBack}). A child already on her way,
   * waiting or sitting is left to it.
   */
  summon(): void {
    if (this.modeValue === 'returning') {
      this.turnBack();
      return;
    }
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
   * where she is (her own aisle). From her stroll, or already on her way back,
   * nothing to do: a second dismissal must never turn her way back round
   * (story time's `abort` dismisses whoever is in the room, whatever she is
   * doing).
   */
  dismiss(): void {
    if (this.modeValue === 'stroll' || this.modeValue === 'returning') return;
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

  /**
   * One frame along the current route: the next target, through its errand —
   * or, when a player standing still is in the way of it, the way round her
   * ({@link wayRoundHer}).
   */
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
    const toTheSeat = this.modeValue === 'walking' && this.next === this.route.length - 1;
    const errand = toTheSeat ? this.toSeat : this.walk;
    if (!this.legBegun) {
      errand.begin(context);
      this.legBegun = true;
      this.roundLength = 0;
      this.replanIn = 0;
    }
    if (this.roundLength === 0) {
      this.replanIn -= context.dt;
      if (this.replanIn <= 0 && this.heldOff(context, target, toTheSeat ? this.seatArrive : KID_ROUTE_ARRIVE)) {
        this.replanIn = REPLAN_SECONDS;
        // Her own cushion with the player stood on it: she listens from here.
        if (toTheSeat) {
          this.modeValue = 'gaveUp';
          this.watchTheChair(context, intent);
          return;
        }
        this.wayRoundHer(context);
        if (this.roundLength < 0) {
          // The straight way on is clear: the point she is held off counts as passed.
          this.passHeldPoint(context);
          this.watchTheChair(context, intent);
          return;
        }
      }
    }
    const rounding = this.roundLength > 0;
    const ring = rounding ? this.roundPath[this.roundIndex]! : -1;
    const goalX = rounding ? this.ringX[ring]! : target.x;
    const goalZ = rounding ? this.ringZ[ring]! : target.z;
    intent.moveX = 0;
    intent.moveZ = 0;
    const outcome = (rounding ? this.walk : errand).step(this, context, intent, goalX, goalZ);
    intent.hop = false;
    intent.interact = false;
    intent.lookAt = null;
    intent.wave = 0;
    intent.expression = this.blink.expressionFor(context.dt, 'neutral');
    this.blinkingNow = intent.expression === 'blink';
    if (outcome === 'walking') return;
    if (rounding) {
      if (outcome === 'arrived') {
        this.roundIndex += 1;
        if (this.roundIndex >= this.roundLength) this.passHeldPoint(context);
      } else {
        // The way round gave out too: back to the point itself, on its own clock.
        this.roundLength = 0;
        this.legBegun = false;
      }
      return;
    }
    if (outcome === 'arrived') {
      this.next += 1;
      this.legBegun = false;
      if (this.next >= this.route.length) this.endRoute(context);
      return;
    }
    // Given up: on the way there she stands and listens from here. On the way
    // back she begins the same leg again — her declared way is the only way
    // she walks — keeping whichever way round the sidestep was working.
    if (this.modeValue === 'walking') this.modeValue = 'gaveUp';
    else this.legBegun = false;
  }

  /** The point she was held off counts as passed: on to the next, or — the last of the way back — her stroll. */
  private passHeldPoint(context: DriverContext): void {
    this.roundLength = 0;
    this.next += 1;
    this.legBegun = false;
    if (this.next >= this.route.length) this.endRoute(context);
  }

  /**
   * **A player standing still where she cannot come near enough to `target`**:
   * the crowd keeps a child `PLAYER_SEPARATION` from a player standing still,
   * so a point whose whole arrival disc lies within that (and a little) of the
   * player cannot be reached — and the child is up against the player's
   * distance, as near as she is let come. Not a player walking past (she must
   * have stood still {@link KID_HELD_AFTER}).
   */
  private heldOff(context: DriverContext, target: Waypoint, arrive: number): boolean {
    if (context.playerStationaryFor < KID_HELD_AFTER) return false;
    const player = context.playerPosition;
    if (Math.hypot(target.x - player.x, target.z - player.z) + arrive > PLAYER_SEPARATION + KID_HELD_SLACK) return false;
    return Math.hypot(context.position.x - player.x, context.position.z - player.z) <= PLAYER_SEPARATION + KID_HELD_SLACK;
  }

  /**
   * **The way round a player standing still on a point of her way** (the
   * review of Step 8: two children gave up after 30 s against a player stood
   * on the central aisle's junction, and the last story was held up waiting
   * for them). Where the point she is held off leads on to — the next point
   * of her way, her cushion's edge, or (the last of the way back) where her
   * stroll begins — she walks either straight, if that line is clear, or round
   * the player by places on a ring just outside the crowd's distance from her
   * (Dijkstra over 24 places and the two ends, steps between neighbours only).
   * **Every line is asked of the real world** ({@link ClearAt}, a body of
   * {@link KID_LINE_BODY}) and kept outside the player's distance, so a way
   * round her never runs into the furniture KIDS swept her declared legs
   * clear of. Sets {@link roundLength}: −1 for straight on, 0 for no way past
   * (she waits on the point's own clock), else the ring places to walk.
   */
  private wayRoundHer(context: DriverContext): void {
    this.roundLength = 0;
    this.roundIndex = 0;
    const onward = this.route[this.next + 1] ?? (this.modeValue === 'returning' ? (this.circuitWorld[1] ?? this.circuitWorld[0]) : undefined);
    const clearAt = this.clearAt;
    if (!onward || !clearAt) return;
    // Toward her cushion the line stops at the edge her walk ends at.
    const shortOf = this.modeValue === 'walking' && this.next + 1 === this.route.length - 1 ? this.seatArrive : 0;
    const player = context.playerPosition;
    const hereX = context.position.x;
    const hereZ = context.position.z;
    if (this.lineClear(hereX, hereZ, onward.x, onward.z, 0, shortOf, player)) {
      this.roundLength = -1;
      return;
    }
    const n = ROUND_BEARINGS;
    for (let k = 0; k < n; k += 1) {
      const angle = (k / n) * Math.PI * 2;
      this.ringX[k] = player.x + Math.sin(angle) * KID_ROUND_HER;
      this.ringZ[k] = player.z + Math.cos(angle) * KID_ROUND_HER;
      this.ringClear[k] = clearAt(this.ringX[k]!, this.ringZ[k]!, KID_LINE_BODY) ? 1 : 0;
    }
    // Nodes 0..n−1 the ring, n her, n+1 the way on.
    const START = n;
    const END = n + 1;
    this.cost.fill(Infinity);
    this.from.fill(-1);
    this.done.fill(0);
    this.cost[START] = 0;
    for (let round = 0; round < n + 2; round += 1) {
      let u = -1;
      for (let v = 0; v < n + 2; v += 1) if (!this.done[v] && this.cost[v]! < Infinity && (u < 0 || this.cost[v]! < this.cost[u]!)) u = v;
      if (u < 0 || u === END) break;
      this.done[u] = 1;
      const ux = u === START ? hereX : this.ringX[u]!;
      const uz = u === START ? hereZ : this.ringZ[u]!;
      if (u === START) {
        for (let k = 0; k < n; k += 1) if (this.ringClear[k]) this.relax(u, ux, uz, k, this.ringX[k]!, this.ringZ[k]!, LINE_GRACE, 0, player);
        continue;
      }
      const ahead = (u + 1) % n;
      const behind = (u + n - 1) % n;
      if (this.ringClear[ahead]) this.relax(u, ux, uz, ahead, this.ringX[ahead]!, this.ringZ[ahead]!, 0, 0, player);
      if (this.ringClear[behind]) this.relax(u, ux, uz, behind, this.ringX[behind]!, this.ringZ[behind]!, 0, 0, player);
      this.relax(u, ux, uz, END, onward.x, onward.z, 0, shortOf, player);
    }
    if (this.from[END]! < 0) return;
    // Walk the chain back from the way on to her, then lay it out forwards.
    let length = 0;
    for (let v = this.from[END]!; v !== START && v >= 0; v = this.from[v]!) length += 1;
    if (length === 0 || length > n) return;
    let at = length;
    for (let v = this.from[END]!; v !== START && v >= 0; v = this.from[v]!) this.roundPath[--at] = v;
    this.roundLength = length;
  }

  /** One edge of {@link wayRoundHer}'s search: `u` to `v`, kept if it is shorter and its line is clear. */
  private relax(u: number, ux: number, uz: number, v: number, vx: number, vz: number, grace: number, shortOf: number, player: Readonly<Vector3>): void {
    if (this.done[v]) return;
    const length = Math.hypot(vx - ux, vz - uz);
    if (this.cost[u]! + length >= this.cost[v]!) return;
    if (!this.lineClear(ux, uz, vx, vz, grace, shortOf, player)) return;
    this.cost[v] = this.cost[u]! + length;
    this.from[v] = u;
  }

  /**
   * The straight line from `(ax, az)` to `(bx, bz)` — skipping its first
   * `grace` and stopping `shortOf` before its end — is clear for her body in
   * the real world, and stays outside a still player's distance (less a
   * brush). Allocates nothing.
   */
  private lineClear(ax: number, az: number, bx: number, bz: number, grace: number, shortOf: number, player: Readonly<Vector3>): boolean {
    const clearAt = this.clearAt;
    if (!clearAt) return false;
    const length = Math.hypot(bx - ax, bz - az);
    const until = length - shortOf;
    for (let s = Math.min(grace, Math.max(0, until)); s <= until + 1e-9; s += LINE_STEP) {
      const t = length === 0 ? 0 : s / length;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (!clearAt(x, z, KID_LINE_BODY)) return false;
      if (Math.hypot(x - player.x, z - player.z) < PLAYER_SEPARATION - LINE_BRUSH) return false;
    }
    return true;
  }

  /**
   * **Summoned on her way back: round she turns.** Her way back is the
   * declared rug route walked backwards, so the point she last passed is on it
   * and every point from there to her cushion is a leg KIDS sweeps: she walks
   * to that point and on to the seat, on the whole rug route (exit node first,
   * so a dismissal from there walks back all the way to the exit node again).
   */
  private turnBack(): void {
    const rug = this.rugRouteWorld;
    // On the way back, `route[i]` is `rug[route.length − 1 − i]`; heading for
    // `route[next]`, she last passed `rug[route.length − next]` — or, before the
    // first target, she is between it and the seat (`rug[route.length]`).
    const from = Math.min(rug.length - 1, Math.max(0, this.route.length - this.next));
    this.route = rug;
    this.exitIndex = 0;
    this.next = from;
    this.legBegun = false;
    this.routeWanted = false;
    this.roundLength = 0;
    this.walk.clearSidestep();
    this.toSeat.clearSidestep();
    this.modeValue = 'walking';
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
    this.roundLength = 0;
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
