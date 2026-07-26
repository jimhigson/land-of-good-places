import { Raycaster, Vector2, Vector3 } from 'three';
import type { FrameContext, GameSystem } from '../core/types';
import type { InputSystem } from '../core/input';
import type { TapPoint } from '../core/input/PointerControls';
import type { IsoCamera } from '../core/IsoCamera';
import { pickWalkablePoint } from '../world/pickWalkable';
import { pickInteractZone, type InteractZone } from '../world/interact';
import { TapMarker } from '../art/models/tapMarker';
import type { Player } from './Player';

/**
 * Tap a place, and Eleri walks there.
 *
 * This is the whole of the touch control scheme: no thumbstick, no d-pad, no
 * chrome over the park. It steers by pushing the ordinary movement stick on the
 * player's behalf ({@link InputSystem.setNavigationMove}), so everything
 * downstream — acceleration, collision, the walk cycle, escalators, falling off
 * a deck — behaves exactly as it does under a real thumb. There is no second
 * movement code path to keep in step with the first.
 *
 * Deliberately *not* a pathfinder. A cosy park with wide paths does not need
 * one, and a six-year-old does not want to watch a character walk a clever route
 * round the back of a wall. It seeks in a straight line, arrives gently, and if
 * it stops making progress — wedged against the fountain, say — it gives up
 * after a moment and drops the marker rather than grinding there forever.
 */

/** Close enough to have arrived, in metres. Roughly one shoulder width. */
const ARRIVE_RADIUS = 0.55;

/** Inside this distance the walk eases off, so nobody skids past the marker. */
const SLOW_RADIUS = 2.2;

/** Never crawl: below this fraction of top speed the walk cycle looks broken. */
const MIN_APPROACH = 0.34;

/**
 * Give up after this long without getting meaningfully closer.
 *
 * Long enough to squeeze round a tree, short enough that a child who tapped
 * something unreachable gets their character back before they lose interest.
 */
const STUCK_SECONDS = 1.8;

/** Progress smaller than this does not count as getting closer. */
const PROGRESS_EPSILON = 0.12;

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

  private active = false;
  private zone: InteractZone | null = null;
  private scripted: ScriptedWalk | null = null;
  private bestDistance = Infinity;
  private sinceProgress = 0;

  constructor(
    private readonly player: Player,
    private readonly camera: IsoCamera,
    private readonly input: InputSystem,
    private readonly zoneSource: () => readonly InteractZone[],
  ) {}

  /** The tap marker's geometry. Add it to the scene once, at construction. */
  get group(): TapMarker['root'] {
    return this.marker.root;
  }

  /**
   * Handles a tap at a screen position.
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
      this.player.position.y,
      this.hit,
    );
    if (!found) return false;
    if (this.hit.distanceTo(this.player.position) > MAX_TARGET_DISTANCE) return false;

    // Did the tap land on a *thing*? If so, walk to where you stand to use it
    // rather than to the pixel that was touched.
    const zone = pickInteractZone(this.zoneSource(), this.hit.x, this.hit.y, this.hit.z);
    this.zone = zone;
    if (zone) this.target.set(zone.standX, this.hit.y, zone.standZ);
    else this.target.copy(this.hit);

    this.active = true;
    this.bestDistance = this.planarDistance();
    this.sinceProgress = 0;
    this.marker.show(this.target.x, this.target.y, this.target.z, zone !== null);
    return true;
  }

  /**
   * Walks to a world point on somebody else's orders, with no tap involved.
   *
   * The marker still appears, because a child watching their character set off
   * on its own should be able to see where it thinks it is going.
   */
  navigateTo(x: number, y: number, z: number, scripted?: ScriptedWalk): void {
    if (this.player.riding) return;
    this.abandonScripted();
    this.zone = null;
    this.scripted = scripted ?? null;
    this.target.set(x, y, z);
    this.active = true;
    this.bestDistance = this.planarDistance();
    this.sinceProgress = 0;
    this.marker.show(x, y, z, true);
  }

  /** True while the character is walking somewhere it was told to. */
  get isNavigating(): boolean {
    return this.active;
  }

  /** Drops the current destination. Called when the player takes over. */
  cancel(): void {
    this.active = false;
    this.zone = null;
    this.abandonScripted();
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

    if (distance <= ARRIVE_RADIUS) {
      this.arrive();
      this.marker.update(dt, elapsed, false);
      return;
    }

    // --- stuck check ------------------------------------------------------
    if (distance < this.bestDistance - PROGRESS_EPSILON) {
      this.bestDistance = distance;
      this.sinceProgress = 0;
    } else {
      this.sinceProgress += dt;
      if (this.sinceProgress > STUCK_SECONDS) {
        // Wedged against something. Let go gracefully rather than shivering
        // against the wall, which is what a jittering seek looks like.
        this.cancel();
        this.input.setNavigationMove(0, 0);
        this.marker.update(dt, elapsed, false);
        return;
      }
    }

    // --- seek + arrive ----------------------------------------------------
    const dx = this.target.x - this.player.position.x;
    const dz = this.target.z - this.player.position.z;
    const inverse = 1 / Math.max(distance, 1e-4);
    const throttle =
      distance >= SLOW_RADIUS
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

    this.marker.moveTo(this.target.x, this.target.y, this.target.z);
    this.marker.update(dt, elapsed, true);
  }

  dispose(): void {
    this.marker.dispose();
  }

  // -------------------------------------------------------------- internals

  private planarDistance(): number {
    return Math.hypot(
      this.target.x - this.player.position.x,
      this.target.z - this.player.position.z,
    );
  }

  /**
   * Arrived. If the destination was a thing that wants a button press — the
   * lift, the grown-up on the top deck — fire it now, through exactly the same
   * action the E key raises.
   */
  private arrive(): void {
    if (this.zone?.pressInteract) this.input.pressVirtual('interact');
    this.input.setNavigationMove(0, 0);

    // Take the handler off first: `onArrive` is how the stair ride queues its
    // *next* waypoint, and it must not be abandoned by the cancel below.
    const scripted = this.scripted;
    this.scripted = null;
    this.active = false;
    this.zone = null;
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
