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
   */
  resolve(position: Vector3, radius: number, clearance = 0): boolean {
    let clearedAny = false;

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
          position.x = circle.x + minimum;
          moved = true;
          continue;
        }
        const push = (minimum - distance) / distance;
        position.x += dx * push;
        position.z += dz * push;
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
          position.x += (-az / Math.sqrt(lengthSquared)) * minimum;
          position.z += (ax / Math.sqrt(lengthSquared)) * minimum;
          moved = true;
          continue;
        }
        const push = (minimum - distance) / distance;
        position.x += dx * push;
        position.z += dz * push;
        moved = true;
      }

      // Soft garden boundary — you can never walk out of the park.
      const fromCentre = Math.hypot(position.x, position.z);
      const limit = GARDEN_PLAY_RADIUS - radius;
      if (fromCentre > limit) {
        const scale = limit / fromCentre;
        position.x *= scale;
        position.z *= scale;
        moved = true;
      }

      if (!moved) break;
    }

    return clearedAny;
  }
}
