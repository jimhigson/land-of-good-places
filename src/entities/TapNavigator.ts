import { Raycaster, Vector2, Vector3, type Object3D } from 'three';
import type { FrameContext, GameSystem } from '../core/types';
import type { InputSystem } from '../core/input';
import type { TapPoint } from '../core/input/PointerControls';
import type { IsoCamera } from '../core/IsoCamera';
import { pickWalkablePoint } from '../world/pickWalkable';
import { MAX_LEVEL_GAP, MAX_ROUTE_WAYPOINTS, type NavGrid } from '../world/NavGrid';
import { ROUTE_PRIORITY, RouteRequest, type RouteScheduler } from '../world/routeScheduler';
import { TapMarker } from '../art/models/tapMarker';
import type { GroundSampler, Player } from './Player';
import { PLAYER_MAX_SPEED } from '../core/constants';
import { DASH_RECOVER_SECONDS, dashBoost, dashBoostNow, dashSubsteps } from './tapDash';

/**
 * Tap a place, and Eleri walks there — round whatever is in the way.
 *
 * This is the whole of the touch control scheme: no thumbstick, no d-pad, no
 * chrome over the park. It steers by pushing the ordinary movement stick on the
 * player's behalf ({@link InputSystem.setNavigationMove}), so everything
 * downstream — acceleration, collision, the walk cycle, escalators, falling off
 * a deck — behaves exactly as it does under a real thumb. There is no second
 * movement code path to keep in step with the first.
 *
 * It **used** to seek in a straight line, on the reasoning that a cosy park
 * with wide paths does not need a pathfinder and a child does not want to watch
 * her character walk a clever route round the back of a wall. Half of that was
 * right and half of it was wrong, and the family reported the wrong half: a
 * six-year-old taps where she wants to be, and a straight line at that point
 * grinds into the first tree, bench, stall or garden wall it meets. She then
 * has to work out *why*, and steer out of it by hand — which is exactly the
 * manual driving that tap-to-move exists to save her from. Getting stuck on the
 * scenery is not a rough edge on the control scheme; it is the control scheme
 * failing.
 *
 * So the destination is now **routed** — see `world/NavGrid.ts` for the map,
 * and for why it is a lattice baked out of the collision world rather than the
 * NPCs' waypoint graph. What comes back is a handful of waypoints, and this
 * class walks them one at a time with the same seek it always used. Three
 * things follow, and all three are deliberate:
 *
 * - **On open ground nothing changes at all.** A route across an empty lawn
 *   smooths down to a single waypoint — the tapped spot — so the walk is the
 *   same straight line, at the same speed, with the same easing into the
 *   marker, that it has always been.
 * - **A wall she can hop is not something to walk round.** The lattice leaves
 *   those out, so the route goes over them and `Player`'s auto-hop fires when
 *   she gets there, exactly as it does under a thumb.
 * - **A route is planned once, per tap.** Following it costs one more distance
 *   check per frame than seeking did, and allocates nothing.
 * - **She sets off the moment she is asked, before the route is found.** A far
 *   tap's A\* used to run inside the tap's own frame — 33–35 ms on an M4 Pro,
 *   four or five missed frames at 120 Hz — so in the game the route is asked
 *   of a {@link RouteScheduler} that answers it a couple of milliseconds a
 *   frame (step 1b of the 120 fps plan). Most taps are answered at the start
 *   of the very next frame, before it steers her — the frame a tap always set
 *   her off on. A long one takes a few frames, and for those frames she walks
 *   straight at the place she tapped, exactly the seek this class used before
 *   it could route, then turns onto the route the moment it lands — the same
 *   route a synchronous plan would have given. She does not dash until it has:
 *   a dash is judged on the route, and a straight line at sixty metres a
 *   second is the one guess that could carry her somewhere wrong.
 *
 * When the tapped place cannot be reached at all, the walk still happens: she
 * goes to the closest reachable point and stops there, with the marker moved to
 * where she will actually end up rather than left somewhere she can never get
 * to. See {@link planRoute}.
 */

/** Close enough to have arrived, in metres. Roughly one shoulder width. */
/**
 * Exported since #350: the park's children now walk a `NavGrid` route with the
 * same two radii the player does, rather than a copy of the numbers. Both mean
 * exactly what their comments say for a child as much as for the player — one
 * owner, so tuning how a walk flows round a corner tunes it for everybody.
 */
export const ARRIVE_RADIUS = 0.55;

/**
 * Close enough to have passed a corner and be getting on with the next leg.
 *
 * Wider than {@link ARRIVE_RADIUS} on purpose: a waypoint in the middle of a
 * route is a hint about which side of a tree to pass, not a place to visit. Cut
 * it fine and she pecks at every corner; leave it this loose and she flows
 * round them, which is what the string-pulling in `NavGrid` is for.
 */
export const WAYPOINT_RADIUS = 0.7;

/** Inside this distance the walk eases off, so nobody skids past the marker. */
const SLOW_RADIUS = 2.2;

/** Never crawl: below this fraction of top speed the walk cycle looks broken. */
const MIN_APPROACH = 0.34;

/**
 * Give up after this long without getting meaningfully closer.
 *
 * Long enough to squeeze round a tree, short enough that a child who tapped
 * something unreachable gets their character back before they lose interest.
 * Now measured against the *current waypoint* rather than the destination,
 * which is the only honest thing to measure while walking a route: a leg that
 * heads briefly away from the destination is a route doing its job.
 */
const STUCK_SECONDS = 1.8;

/** Progress smaller than this does not count as getting closer. */
const PROGRESS_EPSILON = 0.12;

/**
 * Attempts at a fresh route before a stuck walk is abandoned.
 *
 * One, not none, because the commonest reason a good route stops working is a
 * crowd of children standing in it — they are not in the collision world, so
 * they are not in the lattice, and a re-plan from where she has actually got to
 * usually just goes round them. One, not more, because a child should have her
 * character back inside about four seconds whatever happens.
 */
const REPLAN_ATTEMPTS = 1;

/**
 * How far short of the tapped spot a route may stop and still count as going
 * there.
 *
 * The lattice is fattened by the walker's own width, so the stand point beside
 * a stall or against a shop counter often falls in a cell whose centre she
 * cannot stand in: the route stops half a metre short and the last step is the
 * ordinary seek pressing gently into the counter — which is precisely what
 * happened before, and works. Beyond this, though, the destination is genuinely
 * somewhere else, and saying so (moving the marker, dropping the interaction)
 * beats walking her at a wall.
 */
export const SHORTFALL_TOLERANCE = 1.6;

/** A destination further than this is almost certainly a mis-tap on the sky. */
const MAX_TARGET_DISTANCE = 90;

/**
 * A walk the game asked for rather than the player.
 *
 * The stair ride is the only user so far: it feeds the navigator one waypoint at
 * a time up (or down) a flight, so the character *walks* the stairs with the
 * real walk cycle, the real collision and the real surface sampler under their
 * feet — the ride only decides where to go next and how fast the world runs
 * while it happens. `onAbandon` fires the moment the player takes the controls
 * back, or the seek gives up, which is what makes "cancel on any input" free.
 *
 * A scripted walk is deliberately **never routed**. Its waypoints are somebody
 * else's route already — up a flight of stairs, through a doorway — chosen by a
 * system that knows things the lattice does not, and second-guessing them with
 * a pathfinder is how a stair ride ends up walking round the outside of the
 * stairs. The presence of a handler is the whole of the test; see
 * {@link navigateTo}.
 */
export interface ScriptedWalk {
  onArrive(): void;
  onAbandon(): void;
}

export class TapNavigator implements GameSystem {
  readonly name = 'tapNavigator';

  private readonly marker = new TapMarker();

  /**
   * The marker's root — for the warm-up behind a cover (`core/viewWarmup.ts`),
   * which compiles the things that go wherever she goes before they are shown.
   */
  get markerRoot(): Object3D {
    return this.marker.root;
  }

  /**
   * Where a tap at (x, y, z) should really walk her, when that is not where the
   * finger landed — today only "on through an interior's way out"
   * (`entities/doorwayTap.ts`), installed by `Game`. Null for an ordinary tap.
   */
  throughDoorway: ((x: number, y: number, z: number) => { readonly x: number; readonly z: number } | null) | null = null;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly hit = new Vector3();
  private readonly target = new Vector3();

  /**
   * The current route, as `x, z` pairs. Allocated once and overwritten in
   * place — planning a walk must not make garbage, and neither must walking it.
   */
  private readonly route = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);
  private routeLength = 0;
  private routeIndex = 0;
  private replansLeft = 0;
  /**
   * Her route, asked of {@link routes} and written into {@link route} when it
   * is answered. While it is {@link RouteRequest.pending} the route is empty
   * and she walks straight at the target — see the file comment.
   */
  private readonly request = new RouteRequest(ROUTE_PRIORITY.player, this.route);

  private active = false;
  private scripted: ScriptedWalk | null = null;
  private bestDistance = Infinity;
  private sinceProgress = 0;
  /** Set by a double-tap. Holds the `sprint` action for as long as we seek. */
  private running = false;
  /**
   * **A long journey is a dash** (`tapDash.ts`, which owns the curve). The
   * multiple of the walk this journey cruises at, judged once on the whole
   * route when it is planned — 1 for a journey of 1.5 s or less at a walk, and
   * for every scripted walk, which keeps its own pace.
   */
  private cruiseBoost = 1;
  /**
   * The boost actually being run at this frame: {@link cruiseBoost}, eased
   * down to the walk over the last couple of metres (`dashBoostNow`). Handed to
   * `Player.setTravelBoost` every frame the navigator steers.
   */
  private boost = 1;
  /**
   * Seconds left of walking after a dash ran into something. A dash that is
   * blocked (`Player.blocked`) walks — a walk's speed, a walk's grip — for
   * {@link DASH_RECOVER_SECONDS} after the last stride that met anything, so
   * the contact is exactly the contact a walk has: she grinds along the face
   * and finds her way round as she always has, instead of a 60 m/s slide
   * carrying her metres along it into a pocket she cannot leave (#745 on main,
   * seed 9). Clear of it, she dashes again.
   */
  private recovering = 0;

  private readonly player: Player;
  private readonly camera: IsoCamera;
  private readonly input: InputSystem;
  private readonly navGrid: NavGrid;
  /**
   * The height above which surfaces are hidden from the player — the castle
   * cutaway's fact, `Infinity` everywhere everything is on show. The pick
   * tests the ray against the topmost surface *below* this, so a tap lands
   * on what the child can see and never on a floor the fade has removed.
   */
  private readonly visibleCeiling: () => number;
  /**
   * Who answers her routes a slice a frame — `Game`'s, so no frame spends more
   * than its budget finding her way. `null` plans synchronously, exactly as
   * this class always did: what a check driving the navigator on its own gets.
   */
  private readonly routes: RouteScheduler | null;

  constructor(
    player: Player,
    camera: IsoCamera,
    input: InputSystem,
    navGrid: NavGrid,
    /**
     * The height above which surfaces are hidden from the player — the castle
     * cutaway's fact, `Infinity` everywhere everything is on show. The pick
     * tests the ray against the topmost surface *below* this, so a tap lands
     * on what the child can see and never on a floor the fade has removed.
     */
    visibleCeiling: () => number = () => Infinity,
    /** See {@link routes}. */
    routes: RouteScheduler | null = null,
  ) {
    this.player = player;
    this.camera = camera;
    this.input = input;
    this.navGrid = navGrid;
    this.visibleCeiling = visibleCeiling;
    this.routes = routes;
  }

  /** True while her route has been asked for and not yet answered. */
  get routePending(): boolean {
    return this.request.pending;
  }

  /** The tap marker's geometry. Add it to the scene once, at construction. */
  get group(): TapMarker['root'] {
    return this.marker.root;
  }

  /**
   * Handles a tap at a screen position.
   *
   * A double-tap (`point.doubleTap`) runs there instead of walking — same
   * destination logic, same route, same arrive, just with `sprint` held for the
   * duration (see {@link update}). A plain second tap that misses the
   * double-tap window still retargets the walk exactly as it always has, which
   * now also means re-planning from wherever she has got to.
   *
   * Returns true if it found somewhere to go — the caller does not currently
   * care, but a "nope" sound will want to know one day.
   */
  handleTap(point: TapPoint): boolean {
    if (this.player.riding) return false;

    // A finger on the park always beats a scripted walk: tapping somewhere while
    // the stairs are carrying you is exactly the "cancel" gesture.
    this.abandonScripted();

    this.ndc.set(point.ndcX, point.ndcY);
    this.raycaster.setFromCamera(this.ndc, this.camera.camera);

    const sampler = this.player.groundSampler;
    if (!sampler) return false;

    const found = pickWalkablePoint(
      this.raycaster.ray,
      sampler,
      this.visibleCeiling(),
      this.hit,
    );
    if (!found) return false;
    if (this.hit.distanceTo(this.player.position) > MAX_TARGET_DISTANCE) return false;

    // A tap that landed on a *thing* never reaches here: GAME_DESIGN.md's
    // SELECTION RULE gives `world/Selection.ts` first refusal, and a tap on
    // something selects it without walking anywhere (`Game`'s tap handler). So
    // by the time this runs, the tap is a place, and a place is walked to.
    this.target.copy(this.hit);
    // A tap in an interior's way out walks her on through it
    // (`entities/doorwayTap.ts`): the trigger band, not the tapped floor, is
    // where the walk has to end.
    const through = this.throughDoorway?.(this.hit.x, this.hit.y, this.hit.z) ?? null;
    if (through) this.target.set(through.x, this.hit.y, through.z);

    this.active = true;
    this.running = point.doubleTap;
    this.replansLeft = REPLAN_ATTEMPTS;
    // Planned before the marker is shown, because an unreachable destination
    // moves the target — and therefore the marker — to where she can get to.
    this.planRoute(sampler);
    this.beginLeg();
    this.planDash(false);
    this.marker.show(this.target.x, this.target.y, this.target.z, false, this.running);
    return true;
  }

  /**
   * Walks to a world point on somebody else's orders, with no tap involved.
   *
   * The marker still appears, because a child watching their character set off
   * on its own should be able to see where it thinks it is going.
   *
   * Routed when nobody is scripting it — which is what makes pressing a place
   * on the park map (`ui/ParkMap.ts`) walk round the scenery for free, on the
   * same code path a tap uses. A `scripted` walk is left alone; see
   * {@link ScriptedWalk}.
   */
  navigateTo(x: number, y: number, z: number, scripted?: ScriptedWalk): void {
    if (this.player.riding) return;
    this.abandonScripted();
    this.scripted = scripted ?? null;
    this.target.set(x, y, z);
    this.active = true;
    this.replansLeft = REPLAN_ATTEMPTS;

    this.routeLength = 0;
    this.routeIndex = 0;
    // Whatever was being asked for the last destination is not wanted now.
    this.forgetRoute();
    const sampler = this.player.groundSampler;
    if (!scripted && sampler) this.planRoute(sampler);

    this.beginLeg();
    this.planDash(scripted !== undefined);
    this.marker.show(this.target.x, this.target.y, this.target.z, true);
  }

  /**
   * False on a stride whose marker animation nobody will see — set by
   * `FrameStrides` while a dash cuts a frame into strides, so the marker is
   * animated once a frame. The skipped strides' time is carried over.
   */
  drawThisUpdate = true;
  private markerSeconds = 0;

  private drawMarker(dt: number, elapsed: number, walking: boolean): void {
    this.markerSeconds += dt;
    if (!this.drawThisUpdate) return;
    this.marker.update(this.markerSeconds, elapsed, walking);
    this.markerSeconds = 0;
  }

  /** True while the character is walking somewhere it was told to. */
  get isNavigating(): boolean {
    return this.active;
  }

  /** True while the current journey is running faster than a walk. */
  get dashing(): boolean {
    return this.active && this.cruiseBoost > 1;
  }

  /**
   * How many strides `Game.tick` should split a frame of `dt` seconds into:
   * 1 unless a dash is running, and then enough that no stride is longer than
   * `DASH_STRIDE`. See `tapDash.ts`'s `dashSubsteps`.
   */
  stridesFor(dt: number): number {
    // The journey's cruise, not this frame's boost: the boost can rise back to
    // the cruise inside this very frame (a dash recovering from a bump, the
    // first frame of a tap), and the strides must already be short enough.
    return this.dashing ? dashSubsteps(this.cruiseBoost * PLAYER_MAX_SPEED, dt) : 1;
  }

  /** Drops the current destination. Called when the player takes over. */
  cancel(): void {
    this.active = false;
    this.running = false;
    this.routeLength = 0;
    this.routeIndex = 0;
    this.forgetRoute();
    this.endDash();
    this.abandonScripted();
    this.input.setNavigationSprint(false);
  }

  update(context: FrameContext): void {
    const { dt, elapsed } = context;

    if (this.active) {
      // Hands on the controls always win, and a ride owns the character
      // outright — either way the destination is forgotten immediately.
      if (this.input.manualMoveActive || this.player.riding) this.cancel();
    }

    if (!this.active) {
      this.input.setNavigationMove(0, 0);
      this.endDash();
      this.drawMarker(dt, elapsed, false);
      return;
    }

    // Her route has been answered since the last frame: turn onto it here,
    // from wherever the straight walk has got her to.
    if (this.request.status === 'done') this.routeLanded();

    const distance = this.planarDistance();

    // Arrived means arrived **on the destination's level**: standing on the
    // deck directly above a tapped floor spot is planar-zero and three metres
    // wrong, and calling that "arrived" is exactly the shipped bug where the
    // marker jumped to the child's own feet. An unrouted walk (no lattice —
    // the pre-routing fallback) keeps the old planar-only rule, because its
    // target's level is wherever she already is. A walk whose route has not
    // been answered yet is a routed walk, so it is held to the level too.
    const levelGap = Math.abs(this.player.position.y - this.target.y);
    if (distance <= ARRIVE_RADIUS && ((this.routeLength === 0 && !this.request.pending) || levelGap <= MAX_LEVEL_GAP)) {
      this.arrive();
      this.drawMarker(dt, elapsed, false);
      return;
    }

    // --- corners ----------------------------------------------------------
    // Retire every waypoint already reached before deciding anything else, so a
    // route whose next two corners sit close together does not spend a frame
    // steering at one she is already standing on.
    while (this.routeIndex < this.routeLength - 1 && this.legDistance() <= WAYPOINT_RADIUS) {
      this.routeIndex += 1;
      this.beginLeg();
    }

    const onFinalLeg = this.routeIndex >= this.routeLength - 1;

    // --- stuck check ------------------------------------------------------
    const legDistance = this.legDistance();
    if (legDistance < this.bestDistance - PROGRESS_EPSILON) {
      this.bestDistance = legDistance;
      this.sinceProgress = 0;
    } else {
      this.sinceProgress += dt;
      if (this.sinceProgress > STUCK_SECONDS && !this.rescue()) {
        // Wedged against something no route gets round. Let go gracefully
        // rather than shivering against the wall, which is what a jittering
        // seek looks like.
        this.cancel();
        this.input.setNavigationMove(0, 0);
        this.drawMarker(dt, elapsed, false);
        return;
      }
    }

    // --- seek + arrive ----------------------------------------------------
    const dx = this.legX() - this.player.position.x;
    const dz = this.legZ() - this.player.position.z;
    const inverse = 1 / Math.max(this.legDistance(), 1e-4);
    // Ease off for the destination only. Slowing for a corner she is merely
    // passing through reads as hesitation, and the corners have already been
    // smoothed down to the ones a person would actually turn at.
    const throttle =
      !onFinalLeg || distance >= SLOW_RADIUS
        ? 1
        : MIN_APPROACH + (1 - MIN_APPROACH) * (distance / SLOW_RADIUS);

    // The stick is camera-relative, so project the world-space direction back
    // onto the camera's ground basis. Player.update turns it straight round
    // again — which is the point: it goes through the identical code path a
    // thumb on the stick does.
    const worldX = dx * inverse * throttle;
    const worldZ = dz * inverse * throttle;
    this.input.setNavigationMove(
      worldX * this.camera.right.x + worldZ * this.camera.right.z,
      worldX * this.camera.forward.x + worldZ * this.camera.forward.z,
    );
    this.input.setNavigationSprint(this.running);
    // Eased off over the last stretch, so the dash hands over to the walk's
    // own easing into the marker (`DASH_BRAKE_SECONDS`) — and a walk for the
    // rest of any leg on which it ran into something (`walkingLeg`).
    if (this.cruiseBoost > 1 && this.player.blocked) this.recovering = DASH_RECOVER_SECONDS;
    else this.recovering = Math.max(0, this.recovering - dt);
    this.boost = this.recovering > 0 ? 1 : dashBoostNow(this.cruiseBoost, this.remainingRoute());
    this.player.setTravelBoost(this.boost);

    this.marker.moveTo(this.target.x, this.target.y, this.target.z);
    this.drawMarker(dt, elapsed, true);
  }

  dispose(): void {
    this.marker.dispose();
  }

  // -------------------------------------------------------------- internals

  /**
   * Asks `NavGrid` for a way to {@link target}, and deals with not getting one.
   *
   * Three outcomes, in the order they are handled:
   *
   * - **A route to the target.** Walk it.
   * - **No route, and no map either** — she is somewhere the lattice does not
   *   cover, which today means outside the current space's play bounds
   *   altogether. The route is left empty and every method below falls back to
   *   steering straight at the target: exactly the behaviour this class had
   *   before it could route at all, so never worse than before.
   * - **A route that stops short**, because the target cannot be reached from
   *   here. It ends at the closest place she can stand. If that is within
   *   {@link SHORTFALL_TOLERANCE} the target is kept as it was — the stand
   *   point beside a stall is meant to be walked into. Otherwise the
   *   destination *becomes* that closest point: the marker moves there, so a
   *   child can see where her character is really going, and the interaction is
   *   dropped, because arriving somewhere else must never press the button on a
   *   thing she never reached.
   *
   * With a scheduler ({@link routes}) the question is asked, and taken at once
   * if it is answered there and then (asked inside a frame, with budget left).
   * Otherwise the route stays empty, so every method below steers straight at
   * the target, until {@link update} finds it answered ({@link routeLanded}) —
   * for a tap, which arrives between frames, usually the very next frame.
   */
  private planRoute(sampler: GroundSampler): void {
    this.routeIndex = 0;
    this.routeLength = 0;
    const { x, y, z } = this.player.position;
    if (this.routes) {
      this.routes.ask(this.request, this.navGrid, sampler, x, z, y, this.target.x, this.target.z, this.target.y);
      if (this.request.status === 'done') {
        this.request.status = 'idle';
        this.takeRoute(this.request.count, this.request.reachedGoal, this.request.endY);
      }
      return;
    }
    const count = this.navGrid.findRoute(x, z, y, this.target.x, this.target.z, this.target.y, sampler, this.route);
    this.takeRoute(count, this.navGrid.lastRouteReachedGoal, this.navGrid.lastRouteEndY);
  }

  /**
   * A route has come back — `count` waypoints in {@link route}, whether they
   * reach the target, and the height they end at: walk it, and move the
   * destination when it ends somewhere else. The three outcomes are
   * {@link planRoute}'s.
   */
  private takeRoute(count: number, reachedGoal: boolean, endY: number): void {
    this.routeIndex = 0;
    this.routeLength = count;
    if (count === 0) return;
    if (reachedGoal) {
      // Stand the destination on the level the route actually ends on — the
      // pick already put it there for a tap, and for a caller that passed a
      // guessed `y` (the park map passes the terrain's), this is what makes
      // the arrival check compare against the real floor.
      this.target.y = endY;
      return;
    }

    const endX = this.route[(count - 1) * 2] ?? this.target.x;
    const endZ = this.route[(count - 1) * 2 + 1] ?? this.target.z;
    // A shortfall is only "the stand point beside the stall" when it is short
    // on the **same level**. Ending nearby on another level — the deck edge
    // above a tapped floor spot — is a genuinely different place, and the
    // destination honestly becomes where she can actually get to.
    if (
      Math.hypot(endX - this.target.x, endZ - this.target.z) <= SHORTFALL_TOLERANCE &&
      Math.abs(endY - this.target.y) <= MAX_LEVEL_GAP
    ) {
      return;
    }

    this.target.set(endX, endY, endZ);
  }

  /**
   * Her route, asked for on an earlier frame, has been answered: take it, and
   * start the leg and the journey's pace over from where she now stands. The
   * dash is judged here, on the route, never on the straight walk before it.
   */
  private routeLanded(): void {
    this.request.status = 'idle';
    this.takeRoute(this.request.count, this.request.reachedGoal, this.request.endY);
    this.beginLeg();
    this.planDash(this.scripted !== null);
  }

  /** Forgets a route asked for and not yet answered — the walk it was for is over. */
  private forgetRoute(): void {
    if (this.routes) this.routes.cancel(this.request);
    else this.request.status = 'idle';
  }

  /**
   * One more try at a route, from wherever the stuck walk has ended up.
   *
   * Returns false when there is nothing left to try, which is the caller's cue
   * to give the character back to the child.
   */
  private rescue(): boolean {
    if (this.replansLeft <= 0) return false;
    const sampler = this.player.groundSampler;
    if (!sampler) return false;

    this.replansLeft -= 1;
    this.planRoute(sampler);
    this.beginLeg();
    // Asked and not answered yet is a route on its way, not no route.
    return this.routeLength > 0 || this.request.pending;
  }

  /** Starts the stuck timer over for whichever waypoint is now being walked to. */
  private beginLeg(): void {
    this.bestDistance = this.legDistance();
    this.sinceProgress = 0;
  }

  /**
   * The point currently being walked *at* — the next unretired waypoint, or the
   * destination itself when there is no route (see {@link planRoute}).
   */
  private legX(): number {
    if (this.routeLength === 0) return this.target.x;
    return this.route[this.routeIndex * 2] ?? this.target.x;
  }

  private legZ(): number {
    if (this.routeLength === 0) return this.target.z;
    return this.route[this.routeIndex * 2 + 1] ?? this.target.z;
  }

  private legDistance(): number {
    return Math.hypot(
      this.legX() - this.player.position.x,
      this.legZ() - this.player.position.z,
    );
  }

  private planarDistance(): number {
    return Math.hypot(
      this.target.x - this.player.position.x,
      this.target.z - this.player.position.z,
    );
  }

  /**
   * Arrived.
   *
   * Nothing is fired on arrival any more. Walking somewhere used to press the
   * button on whatever you had tapped, which is half of what the SELECTION RULE
   * came to stop; a walk that ends in an action is now one a chip explicitly
   * asked for, and `world/Selection.ts` runs it (see its `commit`).
   */
  private arrive(): void {
    this.input.setNavigationMove(0, 0);
    this.endDash();

    // Take the handler off first: `onArrive` is how the stair ride queues its
    // *next* waypoint, and it must not be abandoned by the cancel below.
    const scripted = this.scripted;
    this.scripted = null;
    this.active = false;
    this.routeLength = 0;
    this.routeIndex = 0;
    this.forgetRoute();
    scripted?.onArrive();
  }

  /**
   * Judges the journey just planned: how fast it cruises (`dashBoost`) on the
   * length of the whole route from where she stands. A scripted walk never
   * dashes — a stair ride's pace is the ride's — and nor does a walk whose
   * route has not been answered yet: she walks until it has.
   */
  private planDash(scripted: boolean): void {
    this.recovering = 0;
    this.cruiseBoost = scripted || this.request.pending ? 1 : dashBoost(this.remainingRoute());
    this.boost = dashBoostNow(this.cruiseBoost, this.remainingRoute());
  }

  /** No dash any more, and she is told so — see `Player.setTravelBoost`. */
  private endDash(): void {
    this.cruiseBoost = 1;
    this.boost = 1;
    this.player.setTravelBoost(1);
  }

  /**
   * Metres still to go along the route: to the next waypoint, along every leg
   * after it, and from the last waypoint to the destination (a route that
   * stops just short of a stand point). Straight to the target with no route.
   * At most `MAX_ROUTE_WAYPOINTS` additions; allocates nothing.
   */
  private remainingRoute(): number {
    if (this.routeLength === 0) return this.planarDistance();
    let total = this.legDistance();
    const route = this.route;
    for (let index = this.routeIndex; index < this.routeLength - 1; index += 1) {
      total += Math.hypot(
        (route[index * 2 + 2] ?? 0) - (route[index * 2] ?? 0),
        (route[index * 2 + 3] ?? 0) - (route[index * 2 + 1] ?? 0),
      );
    }
    const last = (this.routeLength - 1) * 2;
    total += Math.hypot(this.target.x - (route[last] ?? this.target.x), this.target.z - (route[last + 1] ?? this.target.z));
    return total;
  }

  /** Tells a scripted walk it has been taken over, once and once only. */
  private abandonScripted(): void {
    const scripted = this.scripted;
    if (!scripted) return;
    this.scripted = null;
    scripted.onAbandon();
  }
}
