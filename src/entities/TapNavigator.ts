import { Raycaster, Vector2, Vector3 } from 'three';
import type { FrameContext, GameSystem } from '../core/types';
import type { InputSystem } from '../core/input';
import type { TapPoint } from '../core/input/PointerControls';
import type { IsoCamera } from '../core/IsoCamera';
import { pickWalkablePoint } from '../world/pickWalkable';
import { MAX_LEVEL_GAP, MAX_ROUTE_WAYPOINTS, type NavGrid } from '../world/NavGrid';
import { TapMarker } from '../art/models/tapMarker';
import type { GroundSampler, Player } from './Player';

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

  private active = false;
  private scripted: ScriptedWalk | null = null;
  private bestDistance = Infinity;
  private sinceProgress = 0;
  /** Set by a double-tap. Holds the `sprint` action for as long as we seek. */
  private running = false;

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
  ) {
    this.player = player;
    this.camera = camera;
    this.input = input;
    this.navGrid = navGrid;
    this.visibleCeiling = visibleCeiling;
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

    this.active = true;
    this.running = point.doubleTap;
    this.replansLeft = REPLAN_ATTEMPTS;
    // Planned before the marker is shown, because an unreachable destination
    // moves the target — and therefore the marker — to where she can get to.
    this.planRoute(sampler);
    this.beginLeg();
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
    const sampler = this.player.groundSampler;
    if (!scripted && sampler) this.planRoute(sampler);

    this.beginLeg();
    this.marker.show(this.target.x, this.target.y, this.target.z, true);
  }

  /** True while the character is walking somewhere it was told to. */
  get isNavigating(): boolean {
    return this.active;
  }

  /** Drops the current destination. Called when the player takes over. */
  cancel(): void {
    this.active = false;
    this.running = false;
    this.routeLength = 0;
    this.routeIndex = 0;
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
      this.marker.update(dt, elapsed, false);
      return;
    }

    const distance = this.planarDistance();

    // Arrived means arrived **on the destination's level**: standing on the
    // deck directly above a tapped floor spot is planar-zero and three metres
    // wrong, and calling that "arrived" is exactly the shipped bug where the
    // marker jumped to the child's own feet. An unrouted walk (no lattice —
    // the pre-routing fallback) keeps the old planar-only rule, because its
    // target's level is wherever she already is.
    const levelGap = Math.abs(this.player.position.y - this.target.y);
    if (distance <= ARRIVE_RADIUS && (this.routeLength === 0 || levelGap <= MAX_LEVEL_GAP)) {
      this.arrive();
      this.marker.update(dt, elapsed, false);
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
        this.marker.update(dt, elapsed, false);
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

    this.marker.moveTo(this.target.x, this.target.y, this.target.z);
    this.marker.update(dt, elapsed, true);
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
   */
  private planRoute(sampler: GroundSampler): void {
    this.routeIndex = 0;
    this.routeLength = this.navGrid.findRoute(
      this.player.position.x,
      this.player.position.z,
      this.player.position.y,
      this.target.x,
      this.target.z,
      this.target.y,
      sampler,
      this.route,
    );
    if (this.routeLength === 0) return;
    if (this.navGrid.lastRouteReachedGoal) {
      // Stand the destination on the level the route actually ends on — the
      // pick already put it there for a tap, and for a caller that passed a
      // guessed `y` (the park map passes the terrain's), this is what makes
      // the arrival check compare against the real floor.
      this.target.y = this.navGrid.lastRouteEndY;
      return;
    }

    const endX = this.route[(this.routeLength - 1) * 2] ?? this.target.x;
    const endZ = this.route[(this.routeLength - 1) * 2 + 1] ?? this.target.z;
    // A shortfall is only "the stand point beside the stall" when it is short
    // on the **same level**. Ending nearby on another level — the deck edge
    // above a tapped floor spot — is a genuinely different place, and the
    // destination honestly becomes where she can actually get to.
    if (
      Math.hypot(endX - this.target.x, endZ - this.target.z) <= SHORTFALL_TOLERANCE &&
      Math.abs(this.navGrid.lastRouteEndY - this.target.y) <= MAX_LEVEL_GAP
    ) {
      return;
    }

    this.target.set(endX, this.navGrid.lastRouteEndY, endZ);
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
    return this.routeLength > 0;
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

    // Take the handler off first: `onArrive` is how the stair ride queues its
    // *next* waypoint, and it must not be abandoned by the cancel below.
    const scripted = this.scripted;
    this.scripted = null;
    this.active = false;
    this.routeLength = 0;
    this.routeIndex = 0;
    scripted?.onArrive();
  }

  /** Tells a scripted walk it has been taken over, once and once only. */
  private abandonScripted(): void {
    const scripted = this.scripted;
    if (!scripted) return;
    this.scripted = null;
    scripted.onAbandon();
  }
}
