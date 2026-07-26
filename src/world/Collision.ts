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
 */

interface CircleCollider {
  x: number;
  z: number;
  radius: number;
}

interface WallCollider {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  halfThickness: number;
}

export class CollisionWorld {
  private readonly circles: CircleCollider[] = [];
  private readonly walls: WallCollider[] = [];

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
  private boundsX = 0;
  private boundsZ = 0;
  private boundsRadius = GARDEN_PLAY_RADIUS;

  /** Recentres the soft boundary. Used on every change of space. */
  setPlayBounds(centreX: number, centreZ: number, radius: number): void {
    this.boundsX = centreX;
    this.boundsZ = centreZ;
    this.boundsRadius = radius;
  }

  addCircle(x: number, z: number, radius: number): void {
    this.circles.push({ x, z, radius });
  }

  addWall(x1: number, z1: number, x2: number, z2: number, halfThickness = 0.35): void {
    this.walls.push({ x1, z1, x2, z2, halfThickness });
  }

  /** Registers the four sides of an axis-aligned rectangle as walls. */
  addRectangle(cx: number, cz: number, halfX: number, halfZ: number, halfThickness = 0.35): void {
    this.addWall(cx - halfX, cz - halfZ, cx + halfX, cz - halfZ, halfThickness);
    this.addWall(cx + halfX, cz - halfZ, cx + halfX, cz + halfZ, halfThickness);
    this.addWall(cx + halfX, cz + halfZ, cx - halfX, cz + halfZ, halfThickness);
    this.addWall(cx - halfX, cz + halfZ, cx - halfX, cz - halfZ, halfThickness);
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
   * Resolving in a couple of passes stops the player squeezing through corners
   * where two colliders meet.
   */
  resolve(position: Vector3, radius: number): void {
    for (let pass = 0; pass < 2; pass += 1) {
      let moved = false;

      for (const circle of this.circles) {
        const dx = position.x - circle.x;
        const dz = position.z - circle.z;
        const minimum = circle.radius + radius;
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared >= minimum * minimum) continue;
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
        if (distanceSquared >= minimum * minimum) continue;
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

      // Soft boundary — you can never walk out of the park, nor off the edge of
      // the building's own space.
      const offsetX = position.x - this.boundsX;
      const offsetZ = position.z - this.boundsZ;
      const fromCentre = Math.hypot(offsetX, offsetZ);
      const limit = this.boundsRadius - radius;
      if (fromCentre > limit) {
        const scale = limit / fromCentre;
        position.x = this.boundsX + offsetX * scale;
        position.z = this.boundsZ + offsetZ * scale;
        moved = true;
      }

      if (!moved) break;
    }
  }
}
