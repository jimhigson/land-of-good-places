/**
 * The shape of the water-fight garden, as data.
 *
 * Geometry (`garden.ts`), the children's steering (`WaterFight.ts`) and the
 * camera framing all read this one table, so a hedge you can see and a hedge you
 * bump into can never drift apart — the same rule `world/building/layout.ts`
 * lives by.
 *
 * **The garden is deliberately small.** Sixteen metres by twelve sounds cramped
 * for six children, and that is the point: everyone is always in range of
 * everyone else, so the fight never has a lull and a six-year-old never has to
 * go looking for someone to splash. It also keeps the whole arena on screen at
 * once (see the framing note in `WaterFight.resize`), which is what lets you
 * tap any child at any time without a camera to chase.
 */

/** Half-extents of the lawn, in metres. The fence stands on this line. */
export const ARENA_HALF_X = 8;
export const ARENA_HALF_Z = 6;

/** How far inside the fence anybody can actually walk. */
export const WALK_HALF_X = ARENA_HALF_X - 0.8;
export const WALK_HALF_Z = ARENA_HALF_Z - 0.8;

/**
 * How tall a child is with their arms up, in metres.
 *
 * `WaterFight.resize` fits the walkable lawn *plus this*, so a child standing on
 * the far edge of the garden is never cut off at the neck by the top of the
 * frame.
 */
export const CHILD_TOP = 2.6;

/** A chunky toon hedge: something to duck behind, and something to bump into. */
export interface Hedge {
  readonly x: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfZ: number;
  readonly height: number;
}

/**
 * Five hedges, placed to break the lawn up without ever walling anyone off.
 *
 * Every gap between a hedge and the fence — and between any two hedges — is at
 * least 2 m, which is three times a child's collision radius. A garden a child
 * can get stuck in is a garden that stops being fun in about four seconds.
 */
export const HEDGES: readonly Hedge[] = [
  { x: -4.4, z: -2.1, halfX: 1.5, halfZ: 0.5, height: 1.15 },
  { x: 4.6, z: -2.4, halfX: 1.3, halfZ: 0.5, height: 1.0 },
  { x: 0, z: 0.4, halfX: 0.55, halfZ: 1.35, height: 1.25 },
  { x: -3.9, z: 3.1, halfX: 1.2, halfZ: 0.5, height: 0.95 },
  { x: 4.2, z: 2.9, halfX: 1.4, halfZ: 0.5, height: 1.1 },
];

/** A paddling pool: shallow, splashy, and free to walk through. */
export interface Pool {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly rim: number;
}

export const POOLS: readonly Pool[] = [
  { x: -6.2, z: 1.3, radius: 1.7, rim: 0xff8fc0 },
  { x: 6.4, z: 0.6, radius: 1.4, rim: 0xffdf7a },
  { x: 0.4, z: -4.0, radius: 1.5, rim: 0x87c9ff },
];

/** Where the sprinklers stand. They hiss away all round, wetting the air. */
export const SPRINKLERS: readonly (readonly [number, number])[] = [
  [-7.0, -4.4],
  [7.0, 4.4],
  [-1.8, 4.8],
];

/** How fat a child is, for bumping into hedges and each other. */
export const CHILD_RADIUS = 0.42;

/**
 * Pushes a circle out of the hedges and back inside the fence.
 *
 * Written as a mutating helper on a plain `{x, z}` so the caller can keep its
 * position in whatever it likes and nothing is allocated per child per frame.
 */
export function keepInGarden(position: { x: number; z: number }, radius = CHILD_RADIUS): void {
  const limitX = WALK_HALF_X - radius;
  const limitZ = WALK_HALF_Z - radius;
  if (position.x < -limitX) position.x = -limitX;
  if (position.x > limitX) position.x = limitX;
  if (position.z < -limitZ) position.z = -limitZ;
  if (position.z > limitZ) position.z = limitZ;

  for (const hedge of HEDGES) {
    // Closest point on the hedge box to the circle centre; if it is closer than
    // the radius, push straight out along the shallower axis. Same minimum
    // translation vector idea the ball pit uses, minus the momentum.
    const dx = position.x - hedge.x;
    const dz = position.z - hedge.z;
    const overlapX = hedge.halfX + radius - Math.abs(dx);
    const overlapZ = hedge.halfZ + radius - Math.abs(dz);
    if (overlapX <= 0 || overlapZ <= 0) continue;
    if (overlapX < overlapZ) position.x += dx >= 0 ? overlapX : -overlapX;
    else position.z += dz >= 0 ? overlapZ : -overlapZ;
  }
}

/** True when a point is inside a paddling pool — used for the splashy footsteps. */
export function poolAt(x: number, z: number): Pool | null {
  for (const pool of POOLS) {
    if (Math.hypot(x - pool.x, z - pool.z) < pool.radius) return pool;
  }
  return null;
}
