import type { Rng } from '../../../core/mathUtils';
import { NPC_PAINT_DESIGNS, type FacePaintDesign } from '../../../art/style/faces';
import type { CharacterIntent, DriverContext } from '../driver';
import type { Activity, ActivityHold, ActivityHost } from './activity';
import { Errand, NO_LIMIT } from './errand';

/**
 * Getting your face painted at the stall (see ART_DIRECTION.md's face patch
 * section and `world/FacePaintStall.ts`).
 *
 * The shape of a visit: notice you have not been painted yet, walk over to the
 * spot in front of the stall, stand politely still while the painter works,
 * then wander off wearing it for the rest of the session.
 *
 * A visit never learns where the stall is by being told: the stall registers
 * its own position here once, at construction ({@link registerFacePaintStall}),
 * and every child — spawned before or after that call — reads the same
 * module-level target. Painted state is likewise read back out through a
 * module-level registry ({@link paintedNpcFaces}) rather than a field threaded
 * through `NpcSystem`. That is the house style for this kind of feature
 * (`trainService()` is the same idea) and it moved here unchanged.
 *
 * **This is the block that dropped the safety rails**, and this is the change
 * that puts them back (ARCHITECTURE-REVIEW review 2, C1 — P1). It was
 * copy-adapted from the train trip and lost both of the train's guards — the
 * walk timeout and the stuck-sidestep — with the result that a child wedged
 * behind a bush on the way to the stall pushed at it for ever, *and* held one
 * of the four concurrent visit slots for ever with it, so four unlucky
 * children quietly switched face painting off for the rest of the session,
 * with nothing on screen to say why.
 *
 * The walk below now carries the train's own two guards, and the give-up path
 * hands the slot back — see {@link spokenFor}, which is the slot: a child who
 * gave up is neither painted nor visiting, so the next child may go.
 */
export class FacePaintVisit implements Activity {
  readonly name = 'facePaintVisit';
  readonly hold: ActivityHold = 'steering';

  /** `none` = ordinary wandering; anything else overrides movement for a frame. */
  private visit: 'none' | 'walking' | 'pausing' = 'none';
  /** The design worn home, or `null` before a first (successful) visit. */
  private design: FacePaintDesign | null = null;
  private cooldown: number;
  private pauseRemaining = 0;

  /** Approximate head-tracking, updated every frame regardless of state. */
  private faceX = 0;
  private faceZ = 0;
  private faceYaw = 0;

  /**
   * The walk to the stall — off the validated waypoint graph, through whatever
   * the garden has grown in the way, so both of `Errand`'s rails are on.
   *
   * `WALK_TIMEOUT` is the train's sixty seconds, deliberately: this is a walk
   * of the same kind and the same length across the same park, and two
   * different numbers for the same question would only be another thing to
   * drift apart. `abandonRadius` stays `NO_LIMIT` because, unlike the player a
   * chat is chasing, a stall does not walk off.
   */
  private readonly walk = new Errand({
    arriveRadius: ARRIVE_RADIUS,
    timeout: WALK_TIMEOUT,
    abandonRadius: NO_LIMIT,
    unstick: true,
  });

  constructor(rng: Rng, startX: number, startZ: number) {
    // Stagger the first roll so the whole park does not queue at once.
    this.cooldown = rng.range(12, 40);
    // Start tracking the head at whatever waypoint this child spawned on.
    this.faceX = startX;
    this.faceZ = startZ;
    facePaintVisits.add(this);
  }

  /** True from deciding to go until walking away painted. */
  get busy(): boolean {
    return this.visit !== 'none';
  }

  /** Counts towards the whole-park cap: mid-visit, or already wearing one. */
  get spokenFor(): boolean {
    return this.design !== null || this.visit !== 'none';
  }

  get paintDesign(): FacePaintDesign | null {
    return this.design;
  }
  get headX(): number {
    return this.faceX;
  }
  get headZ(): number {
    return this.faceZ;
  }
  get headYaw(): number {
    return this.faceYaw;
  }

  /**
   * Where this child's head is, for the stall to hang their paint decal near.
   *
   * Called by the wander core **before** any activity is offered the frame, and
   * so on every frame of the child's life. That is the whole of
   * ARCHITECTURE-REVIEW C2: this used to live at the top of {@link update},
   * which sounds like the same thing and is not, because `update` is only
   * reached if no activity ahead of this one took the frame. A painted child
   * who climbed a tree or boarded the train stopped being tracked the instant
   * the climb or the trip claimed them — and left their paint decal hanging in
   * the air at the foot of the tree, or on the platform, for the whole ride.
   *
   * Not part of {@link Activity}: it is not an activity's business to run when
   * an activity is not running, and one named call from the core is clearer
   * than a hook on the interface with exactly one implementer.
   */
  trackHead(context: DriverContext): void {
    this.faceX = context.position.x;
    this.faceZ = context.position.z;
  }

  /**
   * One frame of "on the way to, or being painted at, the face-painting
   * stall".
   *
   * Every early `return false` leaves every field it touched back where the
   * wander core expects it, so a child who never gets picked for a visit costs
   * this method nothing at all.
   */
  update(host: ActivityHost, context: DriverContext, intent: CharacterIntent): boolean {
    const { dt } = context;

    if (this.visit === 'none') {
      if (this.design !== null) return false; // one coat is plenty
      this.cooldown -= dt;
      if (this.cooldown > 0) return false;

      if (!facePaintStallTarget || paintedOrVisitingCount() >= MAX_CONCURRENT_PAINTED) {
        // No stall yet, or every decal slot is spoken for — try again soon
        // rather than queuing, since there is nowhere to queue.
        this.cooldown = host.rng.range(6, 16);
        return false;
      }
      if (!host.rng.chance(PAINT_VISIT_CHANCE)) {
        this.cooldown = host.rng.range(15, 40);
        return false;
      }
      this.visit = 'walking';
      this.walk.begin(context);
    }

    const stall = facePaintStallTarget;
    if (!stall) {
      // The stall vanished from under a child already on the way — cannot
      // happen in practice (it is built once and never disposed while the
      // park is up), but bail cleanly rather than walking towards nothing.
      this.visit = 'none';
      return false;
    }

    if (this.visit === 'walking') {
      const step = this.walk.step(host, context, intent, stall.standX, stall.standZ);

      if (step === 'givenUp') {
        // A minute of pushing at whatever is in the way, sidesteps included,
        // and the stall is still not reached. Give up the way the train does:
        // drop the visit — which is what gives the slot back, since
        // `spokenFor` is false again the moment `visit` is `'none'` and no
        // design was ever earned — forget which way round the scenery was
        // working, and rejoin the graph from wherever the child got wedged.
        this.visit = 'none';
        this.walk.clearSidestep();
        this.cooldown = host.rng.range(15, 40);
        host.rejoinGraph(context, 'legacy');
        return false;
      }

      if (step === 'arrived') {
        this.visit = 'pausing';
        this.pauseRemaining = host.rng.range(1.6, 2.4);
        this.faceYaw = Math.atan2(stall.x - context.position.x, stall.z - context.position.z);
        intent.lookAt = this.faceYaw;
        return true;
      }

      this.faceYaw = Math.atan2(this.walk.dx, this.walk.dz);
      return true;
    }

    // `pausing`: stand and face the painter. `FacePaintStall` drives the
    // actual painter-leans-in-and-sparkles cutscene visuals on its own clock;
    // this only has to keep the child politely still for roughly as long.
    this.pauseRemaining -= dt;
    intent.lookAt = this.faceYaw;
    if (this.pauseRemaining > 0) return true;

    this.design = host.rng.pick(NPC_PAINT_DESIGNS);
    this.visit = 'none';

    // Back into the ordinary graph from wherever the stall turned out to be —
    // the nearest waypoint becomes "current" so the next leg has somewhere
    // sane to carry on from, exactly as the `LEG_TIMEOUT` rescue re-route does.
    host.rejoinGraph(context, 'legacy');
    return false;
  }
}

/** Where a child stands to be painted, and how close counts as "there". */
export interface FacePaintStallTarget {
  readonly x: number;
  readonly z: number;
  readonly standX: number;
  readonly standZ: number;
}

/** Set once by `FacePaintStall` after it places itself in the garden. */
let facePaintStallTarget: FacePaintStallTarget | null = null;

/** Called by `world/FacePaintStall.ts` once, when the stall is built. */
export function registerFacePaintStall(x: number, z: number, standX: number, standZ: number): void {
  facePaintStallTarget = { x, z, standX, standZ };
}

/** Every child's visit, so a painted face can be found without a new registry
 *  in `NpcSystem`. */
const facePaintVisits = new Set<FacePaintVisit>();

export interface PaintedNpcFace {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly design: FacePaintDesign;
}

/**
 * Every currently-painted child's approximate head position, for
 * `FacePaintStall` to plant a small floating paint decal near.
 *
 * "Approximate" is the operative word: a driver only ever knows its own
 * character's *feet* position (`DriverContext.position`) and an inferred
 * facing, never the real head transform inside the instanced crowd's skeleton
 * (see `kidCrowd.ts` / `InstancedCrowd.ts`) — reaching into either is exactly
 * what this activity is written not to do. The decal's own head-height offset
 * is applied by the caller.
 *
 * **The returned array is reused, and is only valid until the next call.**
 * Copy anything you need to keep. `FacePaintStall.updateNpcDecals` calls this
 * unconditionally every frame, so building a fresh array and four fresh object
 * literals here was 60 arrays and up to 240 objects a second, for ever, for a
 * fixed pool of four decals — the one confirmed per-frame allocation on the
 * whole update path (ARCHITECTURE-REVIEW §4a, which asked for exactly this).
 *
 * The pool only ever grows, because a painted child never becomes unpainted and
 * no visit ever leaves {@link facePaintVisits} — so in a running park this
 * allocates at most four times ever, on the frames the first four children come
 * away painted.
 */
export function paintedNpcFaces(): readonly PaintedNpcFace[] {
  let count = 0;
  for (const visit of facePaintVisits) {
    const design = visit.paintDesign;
    if (!design) continue;

    let face = facePool[count];
    if (!face) {
      face = { x: 0, z: 0, yaw: 0, design };
      facePool.push(face);
    }
    face.x = visit.headX;
    face.z = visit.headZ;
    face.yaw = visit.headYaw;
    face.design = design;
    count += 1;
  }
  facePool.length = count;
  return facePool;
}

/** The reused backing for {@link paintedNpcFaces}. Mutable in here, handed out
 *  as `readonly PaintedNpcFace[]`. */
const facePool: { x: number; z: number; yaw: number; design: FacePaintDesign }[] = [];

function paintedOrVisitingCount(): number {
  let count = 0;
  for (const visit of facePaintVisits) {
    if (visit.spokenFor) count += 1;
  }
  return count;
}

/**
 * How many children may be mid-visit or freshly painted at once.
 *
 * Matches `FacePaintStall`'s own decal pool size (see the comment there) — a
 * child who is painted but has no decal slot free would just be an invisible
 * design, which is worse than not offering them a turn yet.
 */
export const MAX_CONCURRENT_PAINTED = 4;

/** Chance a child who has reached the front of the queue actually goes in. */
const PAINT_VISIT_CHANCE = 0.4;

/** How close counts as having arrived — the wander core's own arrive radius. */
const ARRIVE_RADIUS = 0.9;

/** Longest a child spends walking to the stall. The train's number, on purpose
 *  — see the `walk` field. */
const WALK_TIMEOUT = 60;
