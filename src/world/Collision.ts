import { Vector3 } from 'three';
import { GARDEN_PLAY_RADIUS } from '../core/constants';

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
 */

interface CircleCollider {
  x: number;
  z: number;
  radius: number;
  topHeight: number;
}

interface WallCollider {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  halfThickness: number;
  topHeight: number;
}

/**
 * How far below a collider's top the mover's feet may still be and count as
 * "cleared it". Without this a jump that just grazes the top of a wall would
 * still be caught by the collider, which reads as snagging rather than
 * hopping over — a little forgiveness here is what makes the jump feel good.
 */
const JUMP_CLEARANCE_GRACE = 0.15;

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
 */
const MAX_DEPENETRATION_SPEED = 3;

export class CollisionWorld {
  private readonly circles: CircleCollider[] = [];
  private readonly walls: WallCollider[] = [];

  addCircle(x: number, z: number, radius: number, topHeight = Infinity): void {
    this.circles.push({ x, z, radius, topHeight });
  }

  addWall(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    halfThickness = 0.35,
    topHeight = Infinity,
  ): void {
    this.walls.push({ x1, z1, x2, z2, halfThickness, topHeight });
  }

  /** Registers the four sides of an axis-aligned rectangle as walls. */
  addRectangle(
    cx: number,
    cz: number,
    halfX: number,
    halfZ: number,
    halfThickness = 0.35,
    topHeight = Infinity,
  ): void {
    this.addWall(cx - halfX, cz - halfZ, cx + halfX, cz - halfZ, halfThickness, topHeight);
    this.addWall(cx + halfX, cz - halfZ, cx + halfX, cz + halfZ, halfThickness, topHeight);
    this.addWall(cx + halfX, cz + halfZ, cx - halfX, cz + halfZ, halfThickness, topHeight);
    this.addWall(cx - halfX, cz + halfZ, cx - halfX, cz - halfZ, halfThickness, topHeight);
  }

  get colliderCount(): number {
    return this.circles.length + this.walls.length;
  }

  clear(): void {
    this.circles.length = 0;
    this.walls.length = 0;
  }

  /**
   * Pushes `position` (mutated in place) out of every collider it overlaps and
   * keeps it inside the garden boundary. `radius` is the mover's own width.
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
   * know when to pop a little effect at the moment of clearing) and
   * `escorting` (`true` if a deep overlap was corrected this call, however
   * little of it — a mover already embedded in something, being nudged back
   * out).
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
   */
  resolve(
    position: Vector3,
    radius: number,
    clearance = 0,
    dt = Infinity,
  ): { clearedWall: boolean; escorting: boolean } {
    let clearedAny = false;
    let escorting = false;
    // Shared across every collider and both passes below, so a mover pinned
    // between two deep overlaps at once still escorts at a combined
    // MAX_DEPENETRATION_SPEED overall, rather than that much again per
    // collider that happens to touch them.
    let depenetrationBudget = MAX_DEPENETRATION_SPEED * dt;

    const applyCorrection = (correctionX: number, correctionZ: number): void => {
      const magnitude = Math.hypot(correctionX, correctionZ);
      if (magnitude < 1e-9) return;
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
        if (clearance + JUMP_CLEARANCE_GRACE >= circle.topHeight) {
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
        if (clearance + JUMP_CLEARANCE_GRACE >= wall.topHeight) {
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

      // Soft garden boundary — you can never walk out of the park.
      const fromCentre = Math.hypot(position.x, position.z);
      const limit = GARDEN_PLAY_RADIUS - radius;
      if (fromCentre > limit) {
        const scale = limit / fromCentre;
        applyCorrection(position.x * scale - position.x, position.z * scale - position.z);
        moved = true;
      }

      if (!moved) break;
    }

    return { clearedWall: clearedAny, escorting };
  }
}
