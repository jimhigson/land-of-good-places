import { Vector3 } from 'three';
import { GARDEN_PLAY_BOUNDARY, type ParkBoundary } from './boundary';

/**
 * Deliberately simple solid-object handling.
 *
 * There is no physics engine and there shouldn't be one: this is a cosy walking
 * game. Everything solid registers itself as either a circle (tree trunks, the
 * fountain, sign posts) or a thick line segment (walls and fences), and moving
 * characters get pushed back out of anything they end up inside.
 *
 * Register colliders while building scenery:
 * ```ts
 * collision.addCircle(x, z, 0.5);
 * collision.addWall(x1, z1, x2, z2, 0.35);
 * ```
 *
 * Colliders also carry a `topHeight` — how tall they are above their *own*
 * local ground, in metres. It defaults to `Infinity`, meaning "always solid,
 * however high you jump", which is exactly the old behaviour and is what every
 * caller gets for free by not passing one. Only the wooden and stone garden
 * walls pass a real number (their actual visual height), which is what lets a
 * jump clear a low wall but not a tall one — see `resolve`'s `clearance`
 * parameter.
 *
 * A collider may also opt into `autoHoppable` — see {@link
 * CollisionWorld.wouldAutoHopClear}, design feedback #30e. It defaults to
 * `false`, so every existing caller keeps its current behaviour for free:
 * only `Scenery`'s wooden and stone garden walls pass `true`. The fountain
 * rim has a finite `topHeight` too (its own jump is a deliberate feature —
 * design feedback #12), but is deliberately never `autoHoppable`, and nor is
 * anything the building registers — auto-hop must never fire for something a
 * child did not choose to jump into, which the fountain's water and a stair's
 * side rail both are.
 */

interface CircleCollider {
  x: number;
  z: number;
  radius: number;
  topHeight: number;
  autoHoppable: boolean;
}

interface WallCollider {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  halfThickness: number;
  topHeight: number;
  autoHoppable: boolean;
}

/**
 * How far below a collider's top the mover's feet may still be and count as
 * "cleared it". Without this a jump that just grazes the top of a wall would
 * still be caught by the collider, which reads as snagging rather than
 * hopping over — a little forgiveness here is what makes the jump feel good.
 */
const JUMP_CLEARANCE_GRACE = 0.15;

/**
 * "Are a mover's feet, right now at `clearance`, above something this tall?"
 *
 * A pure question about *this instant*, asked every frame by `resolve` for a
 * jump already in flight. It says nothing whatever about whether the jump will
 * get across — see {@link autoHopClears} for that, and read on, because
 * conflating the two is what caused design feedback #30h.
 */
export function clearsTop(topHeight: number, clearance: number): boolean {
  return clearance + JUMP_CLEARANCE_GRACE >= topHeight;
}

/**
 * The wall top the jump's flight is *measured* to carry a mover across, in
 * metres — the number {@link autoHopClears} enforces.
 *
 * ### Why this is measured and not derived
 *
 * `JUMP_APEX_HEIGHT` is 1.2812 m, so it is tempting (and it was, until design
 * feedback #30h) to say "the hop clears anything up to the apex, plus a little
 * grace" — 1.4312 m. Every step of that is wrong:
 *
 * 1. **The apex is never reached.** Integration is a fixed number of discrete
 *    steps, so the sampled peak is below the algebraic one, and by a
 *    frame-rate-dependent amount: 1.2538 m at 120 fps, 1.2267 at 60, 1.1733 at
 *    30, and only 1.0195 at `MAX_FRAME_DELTA`.
 * 2. **Being briefly above the top is not crossing.** `AUTO_HOP_LOOKAHEAD` is
 *    0.5 m, so the hop fires half a metre before the blocking face and she
 *    reaches that face only 0.41 m up. She is then *pinned against the near
 *    face and rises in place* — the resolver holds her there and its own
 *    velocity read-back zeroes her speed every frame — and is released only
 *    once she is above the top. She must then cross the collider's whole
 *    footprint, `2·(halfThickness + moverRadius)`, **from a standing start**,
 *    before falling back below it.
 * 3. **So the honest limit depends on the footprint**, and is far below the
 *    apex. Measured (`scripts/measure-hop-clearance.mts`, worst case over
 *    20–120 fps, walk and sprint, approach angles 0–40°, every phase of the
 *    frame clock): 1.100 m across the 0.22 m-thick wooden walls, 1.045 m
 *    across the 0.34 m stone ones, 0.879 m across a 0.60 m one. Square-on at
 *    60 fps the stone figure is 1.176 m — the low numbers are the corners, and
 *    the corners are what a route has to be planned for.
 *
 * A wall above this but below the old 1.4312 m did not merely feel bad. Either
 * the wall went solid again underneath her mid-footprint and *ejected* her out
 * the far side (up to 0.59 m in a single frame — the very shove
 * `Player.update`'s escort latch exists to refuse to bank as velocity), or,
 * from 1.34 m up, she was **never released at all**: pinned at the face,
 * landing, auto-hopping, landing, forever. The park's 1.4 m wall at
 * `[3,19]→[-4,20]` was exactly that, and `NavGrid` had started routing over it.
 *
 * 1.00 m sits below the measured limit for every wall thickness the park
 * actually uses. It keeps every low garden wall hoppable — 0.7, 0.85 and 0.95 m,
 * both materials, eight walls — and drops the four the flight never honestly
 * managed: 1.15, 1.2, 1.2 and 1.25 m. {@link
 * CollisionWorld.checkHoppableColliders} enforces at boot that no registered
 * collider escapes the margin — including one too *fat* for it, which a bare
 * height ceiling cannot see.
 */
export const MAX_AUTO_HOP_HEIGHT = 1.0;

/**
 * The apex {@link MAX_AUTO_HOP_HEIGHT} and {@link measuredHopCeiling} were
 * measured against. If `JUMP_SPEED` or `GRAVITY` ever move, the measurement is
 * stale and the numbers above are fiction — which
 * {@link CollisionWorld.checkHoppableColliders} says out loud at boot rather
 * than leaving as a comment nobody re-reads.
 */
export const MEASURED_HOP_APEX = 1.2812;

/**
 * The measured ceiling as a function of how far a mover must travel to cross a
 * collider — `2·(halfThickness + moverRadius)`, its full footprint plus her own
 * width on both sides.
 *
 * A straight line fitted *underneath* every measured point (see the table in
 * {@link MAX_AUTO_HOP_HEIGHT}), so it is a lower bound on the truth everywhere,
 * not a best fit through it: at 1.54 m of crossing it reads 1.112 against a
 * measured 1.112, at 1.92 m it reads 0.998 against a measured 1.045, at 2.44 m
 * it reads 0.842 against a measured 0.879.
 *
 * Used only by the boot check. The predicate itself stays a flat ceiling,
 * because a route's idea of what is hoppable should not quietly change with the
 * thickness of the wall it is looking at — but that flat ceiling is blind to a
 * collider fat enough to fall below it, which is precisely what this catches.
 */
export function measuredHopCeiling(crossing: number): number {
  return 1.574 - 0.3 * crossing;
}

/**
 * "Can a hop actually *carry* a mover over something this tall?"
 *
 * The one expression, used by the two places that plan around the answer:
 * {@link CollisionWorld.wouldAutoHopClear} (for a hop about to be fired) and
 * `world/NavGrid.ts` (which leaves a wall the walker hops out of the map
 * entirely, because a route that detoured round one would be worse than the
 * straight line). They used to be able to drift apart; now they are the same
 * call, so "a wall the auto-hop fires at is exactly a wall the route hops" is
 * true by construction rather than by comment.
 *
 * Deliberately *not* the question `resolve` asks — that one is {@link
 * clearsTop}, and a jump in flight is still governed by nothing but how high
 * her feet actually are. So the manual jump button is completely untouched by
 * this ceiling: press it at a 1.25 m wall and you get exactly the behaviour you
 * got before. What changes is only that nothing *plans* on getting over one.
 *
 * Both terms matter. The apex term means weakening the jump automatically
 * makes things stop being hoppable; the measured term means strengthening it
 * does not automatically make more things hoppable, because the measurement
 * would no longer apply — and {@link CollisionWorld.checkHoppableColliders}
 * will say so.
 */
export function autoHopClears(topHeight: number, apexClearance: number): boolean {
  return clearsTop(topHeight, apexClearance) && topHeight <= MAX_AUTO_HOP_HEIGHT;
}

/**
 * Overlaps up to this deep are ordinary contact — the everyday case of
 * walking (even sprinting) straight into a wall, tree or fountain rim — and
 * get corrected fully and instantly, exactly as before. That is what keeps
 * blocking crisp.
 *
 * Set comfortably above the deepest a full-sprint step can bury a mover in a
 * single frame (well under half a metre even at 60 fps), so ordinary
 * collision never takes the gentle path below. Anything deeper than this can
 * only really happen from spawning, teleporting or stepping *inside*
 * geometry — being already-embedded, not freshly walking into something.
 */
const SHALLOW_OVERLAP = 0.5;

/**
 * The speed, in metres per second, at which a *deep* overlap (see
 * {@link SHALLOW_OVERLAP}) is allowed to resolve.
 *
 * This is the fix for design feedback #17 — "the fling": previously a deep
 * overlap (e.g. spawning inside the fountain's collider) was corrected in a
 * single frame, however large the overlap. `Player`/`NpcCharacter` derive
 * their velocity from how far `resolve` just moved them, so a multi-metre
 * one-frame correction read back as a multi-metre-per-second velocity spike
 * that barely decelerated — a launch, not a nudge. Capping the correction
 * speed here caps that derived velocity at the source, and spreads a deep
 * escort out over the handful of frames it actually takes, however deep the
 * overlap. Chosen well below the player's own walking pace so being
 * depenetrated never feels like it could be mistaken for a shove *by* the
 * game — it reads as being calmly walked back out.
 *
 * Exported so that a second, smaller piece of depenetration (see
 * {@link circleSeparation}, below — the player↔NPC push-apart) can cap
 * itself at the exact same gentle speed rather than inventing its own number.
 */
export const MAX_DEPENETRATION_SPEED = 3;

/**
 * How far outside the soft play boundary that boundary still has an opinion,
 * in metres.
 *
 * The play bounds are the leash for **the space you are in** — `setPlayBounds`
 * is called on every change of space, and the garden, the castle interior and
 * each hotel room take it in turn. Nothing in the world says so, though, and
 * `resolve` below happily applied whichever leash was currently fitted to
 * *anybody* who asked, however far away they were: signed distance is negative
 * outside, so a character standing in a hotel room six hundred metres from the
 * park read as "outside the park by 754 m" and was pushed the whole way in.
 * Not gradually, either — `NpcCharacter` calls `resolve` with the default
 * `dt = Infinity`, so the escort budget is infinite and the correction lands
 * in a single frame. Measured on 7 August 2026: a body at the hotel lobby's
 * origin, with the garden bounds set, arrives at (−75, 57) after **one** call.
 *
 * That was a live bug before any of this: every park child was teleported into
 * the castle interior's own bounds circle the instant the player stepped
 * indoors, and teleported back out to the park's rim when she left. It became
 * unignorable when the hotel's guests became real NPC bodies (Jim's "they
 * should be the same code"), because they would have been dragged out of the
 * hotel and into the park the moment the player left.
 *
 * So: **something this far outside the current boundary is not outside the
 * park, it is somewhere else, and the park's edge has nothing to say about
 * it.** 100 m is chosen to be far larger than any overshoot a walker can
 * legitimately produce against a boundary they are actually stood next to (the
 * whole garden is ~110 m across, and a leashed walker is only ever their own
 * radius past the line), and far smaller than the gap between two spaces — the
 * hotel's rooms are 260 m apart and the castle interior is 848 m from the park.
 * Inside the garden, nothing about the leash changes.
 */
const BOUNDARY_LEASH_REACH = 100;

/**
 * How much of a collider's own half-footprint a single movement sub-step is
 * allowed to cover — see {@link CollisionWorld.resolveMovement}.
 *
 * `resolve` is a *point test*: it looks at where a mover has ended up, never
 * at the line she took to get there. A step longer than the thing she is
 * walking into simply lands on the far side of it, and then the resolver —
 * which pushes out of the *nearest* face, because that is the right answer
 * every other time — helpfully finishes the job and shoves her out the back.
 * That is the tunnel, and it is at any height, because a collider she is not
 * overlapping at either end of the step is a collider that never gets asked
 * about her height at all.
 *
 * Half is the margin over the number that would only just do. The step cannot
 * cross the mid-plane of the thinnest registered collider (its half-thickness
 * plus the mover's own radius) without a sample landing inside, so half of
 * that leaves a whole step's worth of slack for the case where a correction
 * has left her *already* part-way in — the tail of an escort, most of all.
 *
 * This is perpendicular-distance reasoning, so it holds at every approach
 * angle, glancing included: crossing a band of width `w` means covering `w` of
 * perpendicular distance, which needs a step of at least `w` however it is
 * pointed. It is exactly the property a swept test against a wall's centre
 * line does *not* have.
 */
const SUBSTEP_FOOTPRINT_FRACTION = 0.5;

/**
 * A ceiling on sub-steps per movement, purely as a guard against a degenerate
 * collider (a zero-radius circle registered by accident, say) turning the
 * substep count into an unbounded loop and hanging the game.
 *
 * It is not reached in play and is not meant to be: `MAX_FRAME_DELTA` (1/12 s)
 * times a full sprint (11.1 m/s) is 0.93 m, and against the park's thinnest
 * collider that is three sub-steps.
 */
const MAX_SUBSTEPS = 16;

export class CollisionWorld {
  private readonly circles: CircleCollider[] = [];
  private readonly walls: WallCollider[] = [];

  /**
   * True if a disc at (x, z) touches nothing registered so far. A *planning*
   * query — the layout generator and the station placer ask it before
   * building somewhere — so it reads whatever has been registered at the
   * time it is called, exactly like the boot asserts do.
   */
  isClearCircle(x: number, z: number, radius: number): boolean {
    for (const circle of this.circles) {
      if (Math.hypot(x - circle.x, z - circle.z) < radius + circle.radius) return false;
    }
    for (const wall of this.walls) {
      const abx = wall.x2 - wall.x1;
      const abz = wall.z2 - wall.z1;
      const lengthSq = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((x - wall.x1) * abx + (z - wall.z1) * abz) / lengthSq));
      const cx = wall.x1 + abx * t;
      const cz = wall.z1 + abz * t;
      if (Math.hypot(x - cx, z - cz) < radius + wall.halfThickness) return false;
    }
    return true;
  }

  /**
   * The half-footprint of the *thinnest* thing registered — the narrowest band
   * a mover could hope to skip over in one frame, and therefore what sets the
   * sub-step length in {@link resolveMovement}.
   *
   * Tracked as things are added rather than scanned for per frame: it is one
   * `Math.min` per collider at build time against a scan of hundreds of
   * colliders per movement, and, more to the point, it cannot go stale. Add a
   * thinner wall to the park a year from now and the sub-step gets shorter by
   * itself, with nobody needing to remember that this number existed.
   */
  private thinnestHalfWidth = Infinity;

  /**
   * The soft boundary you can never walk out of.
   *
   * It used to be a constant round the origin, which was fine while the park was
   * the only place there was. The building is bigger on the inside now and lives
   * six hundred metres away in its own space, so whoever moves the player
   * between the two moves the boundary with them — otherwise stepping through
   * the front door drops a child outside their own park boundary and the
   * resolver drags them back across half a kilometre of nothing.
   */
  private bounds: ParkBoundary = GARDEN_PLAY_BOUNDARY;

  /**
   * Bumped whenever the set of solid things changes.
   *
   * `world/NavGrid.ts` bakes this world into a lattice and caches it. Today
   * every collider is registered while the park is being built and none is ever
   * added afterwards, so the cache would in practice never be wrong — but "in
   * practice never" is exactly the kind of invariant that quietly stops being
   * true (the railway of Decision 4 registers a great deal of exclusion wall).
   * A counter the mutators cannot avoid bumping makes the cache correct by
   * construction instead of by convention.
   */
  private revisionCounter = 0;

  get revision(): number {
    return this.revisionCounter;
  }

  /**
   * Swaps the soft boundary. Used on every change of space.
   *
   * A whole {@link ParkBoundary} rather than a centre and a radius, because the
   * garden's edge stopped being a circle (issue #115) while the castle
   * interior's genuinely still is one — `circleBoundary` says so exactly, and
   * both then answer the same question the same way.
   */
  setPlayBounds(boundary: ParkBoundary): void {
    this.bounds = boundary;
  }

  /** The soft boundary, for anything that has to map the space inside it. */
  get playBounds(): ParkBoundary {
    return this.bounds;
  }

  addCircle(x: number, z: number, radius: number, topHeight = Infinity, autoHoppable = false): void {
    this.circles.push({ x, z, radius, topHeight, autoHoppable });
    this.thinnestHalfWidth = Math.min(this.thinnestHalfWidth, radius);
    this.revisionCounter += 1;
  }

  addWall(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    halfThickness = 0.35,
    topHeight = Infinity,
    autoHoppable = false,
  ): void {
    this.walls.push({ x1, z1, x2, z2, halfThickness, topHeight, autoHoppable });
    this.thinnestHalfWidth = Math.min(this.thinnestHalfWidth, halfThickness);
    this.revisionCounter += 1;
  }

  /** Registers the four sides of an axis-aligned rectangle as walls. */
  addRectangle(
    cx: number,
    cz: number,
    halfX: number,
    halfZ: number,
    halfThickness = 0.35,
    topHeight = Infinity,
    autoHoppable = false,
  ): void {
    this.addWall(cx - halfX, cz - halfZ, cx + halfX, cz - halfZ, halfThickness, topHeight, autoHoppable);
    this.addWall(cx + halfX, cz - halfZ, cx + halfX, cz + halfZ, halfThickness, topHeight, autoHoppable);
    this.addWall(cx + halfX, cz + halfZ, cx - halfX, cz + halfZ, halfThickness, topHeight, autoHoppable);
    this.addWall(cx - halfX, cz + halfZ, cx - halfX, cz - halfZ, halfThickness, topHeight, autoHoppable);
  }

  get colliderCount(): number {
    return this.circles.length + this.walls.length;
  }

  clear(): void {
    this.circles.length = 0;
    this.walls.length = 0;
    this.thinnestHalfWidth = Infinity;
    this.revisionCounter += 1;
  }

  /**
   * Read-only walks over everything solid, for whoever needs to *map* the world
   * rather than be pushed around by it — `world/NavGrid.ts`, so far.
   *
   * Deliberately a visitor rather than an exposed array: the colliders are
   * mutable objects and handing them out would let a consumer move a tree by
   * accident. Called once per lattice build, never per frame, so the closure
   * costs nothing worth counting.
   */
  forEachCircle(
    visit: (
      x: number,
      z: number,
      radius: number,
      topHeight: number,
      autoHoppable: boolean,
    ) => void,
  ): void {
    for (const circle of this.circles) {
      visit(circle.x, circle.z, circle.radius, circle.topHeight, circle.autoHoppable);
    }
  }

  forEachWall(
    visit: (
      x1: number,
      z1: number,
      x2: number,
      z2: number,
      halfThickness: number,
      topHeight: number,
      autoHoppable: boolean,
    ) => void,
  ): void {
    for (const wall of this.walls) {
      visit(
        wall.x1,
        wall.z1,
        wall.x2,
        wall.z2,
        wall.halfThickness,
        wall.topHeight,
        wall.autoHoppable,
      );
    }
  }

  /**
   * The longest a single movement sub-step may be for a mover of this width,
   * in metres — see {@link SUBSTEP_FOOTPRINT_FRACTION}. `Infinity` while
   * nothing solid is registered, which is the honest answer: there is nothing
   * to tunnel through.
   */
  maxSafeStep(moverRadius: number): number {
    return SUBSTEP_FOOTPRINT_FRACTION * (this.thinnestHalfWidth + moverRadius);
  }

  /**
   * **Move, then resolve — in sub-steps short enough that nothing solid can be
   * stepped clean over.** This is what a mover's per-frame movement should go
   * through; {@link resolve} on its own is the point test underneath it.
   *
   * ### The bug this exists for
   *
   * `resolve` asks "where is she *now*?", never "what did she cross getting
   * here?". At `MAX_FRAME_DELTA` — 1/12 s, the clamp a phone hitting a hitch
   * actually gets — a full sprint covers 0.93 m in one frame. Step that far
   * from just outside a garden wall and you land past its middle, at which
   * point the resolver does the worst possible right thing: it pushes out of
   * the *nearest* face, which is now the far one, and walks a six-year-old
   * through a wall she cannot see how she got past. It happens **at any
   * height**, because a collider she overlaps at neither end of the step is
   * never asked about her height at all — the whole `clearsTop` /
   * `MAX_AUTO_HOP_HEIGHT` apparatus is simply skipped. A 2 m wall goes through
   * exactly as easily as a 0.7 m one.
   *
   * ### Why sub-steps and not a swept test
   *
   * A swept test would have to be a second collision routine standing beside
   * `resolve`, and would have to independently reproduce all of it: the height
   * rule, the two-pass corner handling, the shallow/deep split, the capped
   * escort, the soft boundary. Two routines that must agree about what "solid"
   * means are two routines that will one day disagree — and the measured hop
   * clearances (`scripts/measure-hop-clearance.mts`) were measured against
   * *this* resolver's exact behaviour, so any second answer would quietly
   * invalidate them. Sub-stepping calls the one resolver more often and
   * changes nothing about what it does.
   *
   * The other reason is the glancing approach. The obvious swept test — is the
   * movement segment within `halfThickness + radius` of the wall's centre line
   * — is not conservative near a wall's ends, and a fence in this park is a
   * chain of segments, so its ends are everywhere. Sub-stepping asks the real
   * point test at points along the way and inherits its geometry exactly.
   *
   * ### Cost
   *
   * One sub-step — i.e. literally the old code path, `resolve` called once —
   * at any frame rate a player normally sees: 60 fps at a full sprint is a
   * 0.185 m step against a 0.40 m limit, and even 24 fps stays inside it. The
   * count only rises on the stuttering frames, where the extra work is two
   * more collider scans on a frame that was already long, and where the
   * alternative is walking through a wall.
   *
   * `dt` is divided among the sub-steps, which is what keeps a deep overlap's
   * escort (see {@link MAX_DEPENETRATION_SPEED}) moving at the same metres per
   * *second* however many sub-steps a frame is cut into — the correction stays
   * a property of elapsed time, not of frame count, and the fling latch in
   * `Player.update` sees exactly the escort it saw before.
   *
   * The returned flags are the union over the sub-steps, which is the same
   * question asked of the whole frame: `clearedWall` if she was over something
   * she had jumped clear of at any point in it, `escorting`/`corrected` if she
   * was pushed at all. `Player`'s escort latch reads them exactly as it did
   * when there was only ever one sub-step.
   */
  resolveMovement(
    position: Vector3,
    deltaX: number,
    deltaZ: number,
    radius: number,
    clearance = 0,
    dt = Infinity,
  ): { clearedWall: boolean; escorting: boolean; corrected: boolean } {
    const distance = Math.hypot(deltaX, deltaZ);
    const limit = this.maxSafeStep(radius);

    // The overwhelmingly common case, and deliberately the *identical* code
    // path to before: one move, one resolve, no arithmetic changed.
    if (!(distance > limit)) {
      position.x += deltaX;
      position.z += deltaZ;
      return this.resolve(position, radius, clearance, dt);
    }

    const steps = Math.min(Math.ceil(distance / limit), MAX_SUBSTEPS);
    const stepX = deltaX / steps;
    const stepZ = deltaZ / steps;
    const stepDt = dt / steps;

    let clearedWall = false;
    let escorting = false;
    let corrected = false;
    for (let step = 0; step < steps; step += 1) {
      position.x += stepX;
      position.z += stepZ;
      const result = this.resolve(position, radius, clearance, stepDt);
      clearedWall = clearedWall || result.clearedWall;
      escorting = escorting || result.escorting;
      corrected = corrected || result.corrected;
    }
    return { clearedWall, escorting, corrected };
  }

  /**
   * Pushes `position` (mutated in place) out of every collider it overlaps and
   * keeps it inside the garden boundary. `radius` is the mover's own width.
   *
   * **A point test.** It knows where a mover is, not how she got there, so
   * anything moving under its own steam should go through
   * {@link resolveMovement} instead — which is this, in sub-steps short enough
   * that a long frame cannot carry her over a wall without ever overlapping
   * it. Calling `resolve` directly is right for a one-shot placement query
   * (where a body is *put*, not moved) and for the small externally-applied
   * shoves that never approach a collider's own width.
   *
   * `clearance` is how high the mover's feet currently are above their own
   * local ground — 0 while walking, positive mid-jump. A collider whose
   * `topHeight` the clearance reaches (within `JUMP_CLEARANCE_GRACE`) does not
   * push back while the mover is actually over its footprint, which is what
   * lets a jump sail over a low wall: the wall simply stops being solid for
   * the moment the jumper is above it. Leaving `clearance` at its default of 0
   * reproduces the old always-solid behaviour exactly, which is why NPCs and
   * the player's grounded movement don't need to change anything to keep
   * working.
   *
   * Resolving in a couple of passes stops the player squeezing through corners
   * where two colliders meet. Returns `true` if at least one collider was
   * skipped this call purely because the mover jumped clear over it — Player
   * uses this to know when to pop a little effect at the moment of clearing.
   *
   * `dt` is this frame's time step. It is what lets a *deep* overlap (see
   * {@link SHALLOW_OVERLAP}) be escorted out gently across several frames
   * instead of corrected in one — see {@link MAX_DEPENETRATION_SPEED}. It
   * defaults to `Infinity`, i.e. "resolve fully, right now, in one call",
   * which is exactly the old behaviour and is what one-shot placement queries
   * (parade formation, NPC waypoint clearance) want and get for free by not
   * passing it: they don't have a meaningful frame time to speak of, and
   * their overlaps are corner-cutting-small anyway, so the shallow/deep
   * distinction never bites for them either way.
   *
   * Returns `clearedWall` (`true` if at least one collider was skipped this
   * call purely because the mover jumped clear over it — Player uses this to
   * know when to pop a little effect at the moment of clearing), `escorting`
   * (`true` if a deep overlap was corrected this call, however little of it —
   * a mover already embedded in something, being nudged back out) and
   * `corrected` (`true` if the position was moved at all, by any amount, deep
   * or shallow).
   *
   * `escorting` matters to callers that derive their own velocity from how
   * far `resolve` just moved them (Player, NpcCharacter): a deep-overlap
   * correction is an *external* nudge, not something the mover did under
   * their own power, and must never be read back as velocity. Reading it
   * back as velocity is exactly how design feedback #17's "fling" happened —
   * the escort distance got banked as speed, which then carried the mover
   * further into (or through) the same overlap next frame under ordinary
   * movement integration, which escorted them again, banking still more
   * speed — a feedback loop that only stopped when something finally blocked
   * it outright. Capping the correction speed alone (this constant) slows
   * that loop down but doesn't break it; only refusing to treat escort
   * distance as velocity does.
   *
   * ### Why `corrected` exists too
   *
   * `escorting` answers "is *this frame's* correction deeper than ordinary
   * contact?", but an escort is a *process*, several frames long, and its
   * last frame or two are always shallow — the overlap is nearly gone by
   * then, which is the whole point. So a caller watching `escorting` alone
   * sees the guard switch off partway through the very escort it is there to
   * protect, and banks that final correction as velocity after all. Against
   * a wall the jump *just* clears (design feedback: "jumping over walls the
   * player sometimes gets a burst of extreme speed") the tail of the escort
   * is still ~0.4 m, which at 60 fps reads back as ~25 m/s — a fling, from
   * the guarded path, by the guarded mechanism.
   *
   * `corrected` is what lets a caller tell where the escort actually ends:
   * not when the correction goes quiet, but when it stops entirely. See
   * `Player.update`, which holds the guard on until then.
   */
  resolve(
    position: Vector3,
    radius: number,
    clearance = 0,
    dt = Infinity,
  ): { clearedWall: boolean; escorting: boolean; corrected: boolean } {
    let clearedAny = false;
    let escorting = false;
    let corrected = false;
    // Shared across every collider and both passes below, so a mover pinned
    // between two deep overlaps at once still escorts at a combined
    // MAX_DEPENETRATION_SPEED overall, rather than that much again per
    // collider that happens to touch them.
    let depenetrationBudget = MAX_DEPENETRATION_SPEED * dt;

    const applyCorrection = (correctionX: number, correctionZ: number): void => {
      const magnitude = Math.hypot(correctionX, correctionZ);
      if (magnitude < 1e-9) return;
      corrected = true;
      if (magnitude <= SHALLOW_OVERLAP) {
        // Ordinary contact — walked straight into a wall, tree or rim.
        // Correct it fully and instantly: this is what keeps blocking crisp.
        position.x += correctionX;
        position.z += correctionZ;
        return;
      }
      escorting = true;
      const allowed = Math.min(magnitude, depenetrationBudget);
      depenetrationBudget -= allowed;
      const scale = allowed / magnitude;
      position.x += correctionX * scale;
      position.z += correctionZ * scale;
    };

    for (let pass = 0; pass < 2; pass += 1) {
      let moved = false;

      for (const circle of this.circles) {
        const dx = position.x - circle.x;
        const dz = position.z - circle.z;
        const minimum = circle.radius + radius;
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared >= minimum * minimum) continue; // not overlapping at all
        if (clearsTop(circle.topHeight, clearance)) {
          clearedAny = true; // over its footprint, but jumped clear above it
          continue;
        }
        const distance = Math.sqrt(distanceSquared);
        if (distance < 1e-5) {
          // Exactly on the centre: shove in an arbitrary but stable direction.
          applyCorrection(minimum, 0);
          moved = true;
          continue;
        }
        const push = (minimum - distance) / distance;
        applyCorrection(dx * push, dz * push);
        moved = true;
      }

      for (const wall of this.walls) {
        const ax = wall.x2 - wall.x1;
        const az = wall.z2 - wall.z1;
        const lengthSquared = ax * ax + az * az;
        if (lengthSquared < 1e-8) continue;
        let t = ((position.x - wall.x1) * ax + (position.z - wall.z1) * az) / lengthSquared;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const closestX = wall.x1 + ax * t;
        const closestZ = wall.z1 + az * t;
        const dx = position.x - closestX;
        const dz = position.z - closestZ;
        const minimum = wall.halfThickness + radius;
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared >= minimum * minimum) continue; // not overlapping at all
        if (clearsTop(wall.topHeight, clearance)) {
          clearedAny = true; // over its footprint, but jumped clear above it
          continue;
        }
        const distance = Math.sqrt(distanceSquared);
        if (distance < 1e-5) {
          const invLength = 1 / Math.sqrt(lengthSquared);
          applyCorrection(-az * invLength * minimum, ax * invLength * minimum);
          moved = true;
          continue;
        }
        const push = (minimum - distance) / distance;
        applyCorrection(dx * push, dz * push);
        moved = true;
      }

      // Soft boundary — you can never walk out of the park, nor off the edge of
      // the building's own space. Only for movers actually near it, though:
      // see {@link BOUNDARY_LEASH_REACH} for why somebody in another space
      // entirely is not "outside the park".
      //
      // Pushed along the boundary's own gradient rather than straight at a
      // centre, because the park's edge is no longer a circle and "towards the
      // middle" is not the way out of it. The gradient of a signed distance
      // field points at the nearest edge, so stepping *up* it by the shortfall
      // lands exactly on the clearance line, whatever shape that line is. The
      // four extra queries only happen when the walker is actually within her
      // own radius of the edge, which is rare — everywhere else this is the one
      // `distanceToEdge` call it always was.
      const edgeGap = this.bounds.distanceToEdge(position.x, position.z);
      if (edgeGap < radius && edgeGap > -BOUNDARY_LEASH_REACH) {
        const e = 0.25;
        const gradientX =
          this.bounds.distanceToEdge(position.x + e, position.z) -
          this.bounds.distanceToEdge(position.x - e, position.z);
        const gradientZ =
          this.bounds.distanceToEdge(position.x, position.z + e) -
          this.bounds.distanceToEdge(position.x, position.z - e);
        const length = Math.hypot(gradientX, gradientZ);
        if (length > 1e-9) {
          const step = radius - edgeGap;
          applyCorrection((gradientX / length) * step, (gradientZ / length) * step);
          moved = true;
        }
      }

      if (!moved) break;
    }

    return { clearedWall: clearedAny, escorting, corrected };
  }

  /**
   * A read-only probe for the auto-hop feature (design feedback #30e — hop
   * over a low wall with no button press, especially useful for tap-to-move).
   *
   * Answers "if `position` (at `radius`) sits inside an `autoHoppable`
   * collider right now, would a jump reaching `apexClearance` above the
   * ground clear it?" — the same question `resolve`'s own `clearance`
   * parameter answers for a jump already in flight, with the same
   * {@link JUMP_CLEARANCE_GRACE}, so "would clear" means the same thing in
   * both places and a wall the manual jump clears is exactly a wall this
   * clears too.
   *
   * Deliberately separate from `resolve()`, never mutates `position`, and
   * never even looks at the soft park boundary — there is nothing to jump
   * over there. `Player` calls this with a point a little ahead of its own
   * feet, in the direction it is actually trying to go, so the hop can fire a
   * moment before contact rather than after stopping dead against the wall.
   */
  wouldAutoHopClear(position: Vector3, radius: number, apexClearance: number): boolean {
    for (const circle of this.circles) {
      if (!circle.autoHoppable || !autoHopClears(circle.topHeight, apexClearance)) continue;
      const dx = position.x - circle.x;
      const dz = position.z - circle.z;
      const minimum = circle.radius + radius;
      if (dx * dx + dz * dz < minimum * minimum) return true;
    }

    for (const wall of this.walls) {
      if (!wall.autoHoppable || !autoHopClears(wall.topHeight, apexClearance)) continue;
      const ax = wall.x2 - wall.x1;
      const az = wall.z2 - wall.z1;
      const lengthSquared = ax * ax + az * az;
      if (lengthSquared < 1e-8) continue;
      let t = ((position.x - wall.x1) * ax + (position.z - wall.z1) * az) / lengthSquared;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = position.x - (wall.x1 + ax * t);
      const dz = position.z - (wall.z1 + az * t);
      const minimum = wall.halfThickness + radius;
      if (dx * dx + dz * dz < minimum * minimum) return true;
    }

    return false;
  }

  /**
   * Boot-time check: **the sub-step budget must actually cover the longest
   * step anything can take.** Call it once, beside
   * {@link checkHoppableColliders}, after the world has finished registering
   * scenery.
   *
   * {@link resolveMovement} cuts a movement into pieces no longer than
   * {@link maxSafeStep}, but caps the count at {@link MAX_SUBSTEPS} so a
   * degenerate collider cannot hang the game. If that cap ever *binds*, the
   * pieces are silently too long again and the tunnel is back — quietly, and
   * only on stuttering frames, which is the hardest possible way to notice.
   * So: say it out loud at boot instead.
   *
   * Today the park's thinnest collider is a 0.18 m sign post, giving a 0.40 m
   * sub-step and three of them for the worst frame there is. It would take a
   * collider under 3 cm across before the cap came anywhere near binding.
   */
  checkSubstepBudget(moverRadius: number, longestStep: number): string[] {
    const limit = this.maxSafeStep(moverRadius);
    const needed = Math.ceil(longestStep / limit);
    if (needed <= MAX_SUBSTEPS) return [];
    const problem =
      `the thinnest collider is ${this.thinnestHalfWidth.toFixed(3)} m across, so a mover of ` +
      `radius ${moverRadius.toFixed(2)} m needs ${needed} sub-steps to cross ` +
      `${longestStep.toFixed(2)} m safely, but only ${MAX_SUBSTEPS} are taken — she could be ` +
      `carried straight through something on a stuttering frame`;
    console.error(`Land of Good Places: ${problem}`);
    return [problem];
  }

  /**
   * Boot-time check: **no registered collider may sit in the gap between "the
   * predicate calls this hoppable" and "the flight actually carries her over
   * it"**. Call it once, after the world has finished registering scenery.
   *
   * This is the point of the whole exercise. Fixing the park's 1.4 m wall fixes
   * one wall; this makes the *class* of bug impossible, and the codebase has
   * twice recorded (ARCHITECTURE-REVIEW.md, reviews 3 and 4) that it wants
   * invariants the code enforces over invariants a comment claims.
   *
   * It catches three distinct ways in:
   *
   * - **Too tall for its width.** {@link autoHopClears} is a flat ceiling, but
   *   the truth is a function of footprint — see {@link measuredHopCeiling}. A
   *   1.0 m wall 0.4 m thick passes the predicate and strands her.
   * - **Hoppable but endless.** An `autoHoppable` collider left at the default
   *   `Infinity` `topHeight` is a contradiction in terms; today none exists,
   *   but nothing stopped one.
   * - **A stale measurement.** Change `JUMP_SPEED` or `GRAVITY` and every
   *   number here silently becomes fiction. Compared against
   *   {@link MEASURED_HOP_APEX} so it cannot pass unnoticed.
   *
   * Offenders are reported by name and position, and then **demoted to
   * non-hoppable**, which is the one repair that cannot make things worse: a
   * wall that is merely solid is a wall the router goes round, and going round
   * is exactly what it did before hoppable walls were planned over. It does not
   * move anybody's level design — a wall in the gap may well be deliberate, and
   * the report is there to be read and decided on, not acted on automatically.
   *
   * Returns the human-readable complaints, so a caller (or a test) can assert
   * on them rather than scraping the console.
   */
  checkHoppableColliders(moverRadius: number, apexClearance: number): string[] {
    const problems: string[] = [];

    if (Math.abs(apexClearance - MEASURED_HOP_APEX) > 0.001) {
      problems.push(
        `the jump apex is now ${apexClearance.toFixed(4)} m but MAX_AUTO_HOP_HEIGHT ` +
          `and measuredHopCeiling() were measured at ${MEASURED_HOP_APEX.toFixed(4)} m — ` +
          `re-run scripts/measure-hop-clearance.mts and update Collision.ts`,
      );
    }

    const inspect = (topHeight: number, halfWidth: number, what: string): boolean => {
      if (!autoHopClears(topHeight, apexClearance)) return false;
      if (!Number.isFinite(topHeight)) {
        problems.push(`${what} is autoHoppable but has no top at all (topHeight Infinity)`);
        return true;
      }
      const crossing = 2 * (halfWidth + moverRadius);
      const ceiling = measuredHopCeiling(crossing);
      if (topHeight <= ceiling) return false;
      problems.push(
        `${what} is ${topHeight.toFixed(2)} m tall and the predicate calls it hoppable, but a ` +
          `${crossing.toFixed(2)} m crossing is only flown reliably up to ${ceiling.toFixed(2)} m — ` +
          `she would be stranded against it`,
      );
      return true;
    };

    let demoted = 0;
    for (const circle of this.circles) {
      if (!circle.autoHoppable) continue;
      const where = `the hoppable circle at [${circle.x.toFixed(1)}, ${circle.z.toFixed(1)}]`;
      if (inspect(circle.topHeight, circle.radius, where)) {
        circle.autoHoppable = false;
        demoted += 1;
      }
    }
    for (const wall of this.walls) {
      if (!wall.autoHoppable) continue;
      const where =
        `the hoppable wall [${wall.x1.toFixed(1)}, ${wall.z1.toFixed(1)}] → ` +
        `[${wall.x2.toFixed(1)}, ${wall.z2.toFixed(1)}]`;
      if (inspect(wall.topHeight, wall.halfThickness, where)) {
        wall.autoHoppable = false;
        demoted += 1;
      }
    }

    // A demotion changes the map `NavGrid` bakes, so it has to invalidate the
    // cached lattice exactly as any other mutation would.
    if (demoted > 0) this.revisionCounter += 1;

    if (problems.length > 0) {
      console.error(
        `Land of Good Places: ${problems.length} collider problem(s) — these have been made ` +
          `solid so nobody gets stranded, but the level design wants a look:\n  ` +
          problems.join('\n  '),
      );
    }

    return problems;
  }
}

/**
 * The push-apart for two moving circles that must not overlap — the player
 * standing on a child, or a child standing on another child — as opposed to a
 * mover and a piece of static scenery (see {@link CollisionWorld.resolve} for
 * that). Deliberately outside `CollisionWorld`: neither side here is one of
 * its registered colliders, and there is nothing to register them as without
 * turning every child into a wall the others grind against (see
 * `NpcCharacter.separateFrom`, which already does exactly this for child↔child
 * and is the pattern this mirrors for player↔child).
 *
 * Splits the correction evenly and returns it rather than applying it, so the
 * caller decides how to move each side — `Player.nudge` for the player half,
 * a direct position write for an NPC, same as its own neighbours already get.
 * Returns `null` when the circles do not overlap at all.
 *
 * This never needs `SHALLOW_OVERLAP`'s instant/escorted split the way
 * `resolve` does: it is driven every frame while two circles overlap, so it
 * never has the chance to build up the kind of deep, spawned-inside overlap
 * that caused design feedback #17's fling in the first place. The caller
 * still caps how far it is willing to move something in one frame — see
 * `NpcSystem.separateFromPlayer`'s use of {@link MAX_DEPENETRATION_SPEED} —
 * as a second line of defence should two characters ever end up teleported
 * on top of each other.
 */
export function circleSeparation(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  minimum: number,
): { readonly dx: number; readonly dz: number } | null {
  const dx = bx - ax;
  const dz = bz - az;
  const distanceSquared = dx * dx + dz * dz;
  if (distanceSquared >= minimum * minimum || distanceSquared < 1e-8) return null;
  const distance = Math.sqrt(distanceSquared);
  const push = (minimum - distance) * 0.5;
  return { dx: (dx / distance) * push, dz: (dz / distance) * push };
}
