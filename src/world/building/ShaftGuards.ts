import { BoxGeometry, Group, InstancedMesh, Matrix4, Quaternion, TorusGeometry, Vector3 } from 'three';
import { PALETTE } from '../../core/palette';
import { interiorMaterial } from './parts';
import type { CollisionWorld } from '../Collision';
import {
  BUBBLE_SHAFT,
  BUBBLE_X,
  BUBBLE_Z,
  HELTER_SHAFT,
  TRAMPOLINE_SHAFT,
  TRAMPOLINE_X,
  TRAMPOLINE_Z,
  worldX,
  worldZ,
} from './layout';

/**
 * Guard rails and colliders for the three shafts architecture review S14
 * found with no rails and no colliders at all: `TRAMPOLINE_SHAFT` and
 * `HELTER_SHAFT` (decks 1-2), and `BUBBLE_SHAFT` (decks 1-4, wherever the
 * bubble itself is not currently docked).
 *
 * Two different situations, two different treatments:
 *
 * - The helter-skelter is boarded from `HELTER_ENTRY_X`/`Z`, a stand point
 *   *outside* `HELTER_SHAFT`'s own footprint (see `interactZones.ts`) — the
 *   ride is a scripted descent, never a walk across the hole. Nobody ever
 *   legitimately needs to cross this one, so it is simply solid, floor to
 *   ceiling, all the way round — the same shape `GlassLift`'s three fixed
 *   sides take, just closed on all four here since there is no door.
 *
 * - The trampoline and the bubble are the opposite: both are boarded by
 *   walking straight onto them (`Trampoline.covers`, `Bubble.covers`), so a
 *   collider that is solid on every deck at once (collision is height-blind —
 *   `layout.ts:36`) would seal the ride shut on the one deck it is legitimate
 *   on, along with every deck it is not. A rail at real guard-rail height
 *   splits the difference exactly the way the garden's low fences already do
 *   (`Collision.ts`'s `topHeight`/`clearance`): it stops an ordinary walk
 *   into the open shaft dead, on every deck, while a deliberate jump — the
 *   same one that already clears a garden wall or hops into the fountain —
 *   carries a rider up and over it, same as before. Never `autoHoppable`:
 *   that would let tap-to-move silently hop a child into the open shafts on
 *   the decks where it is *not* legitimate, which is the exact accident this
 *   guard exists to stop.
 */

/** A believable toon guard-rail height — matches the escalator balustrade's own rail. */
const RAIL_TOP_HEIGHT = 1.05;

export function buildShaftGuards(floorGroups: readonly Group[], collision: CollisionWorld): void {
  addCircularGuard(floorGroups, [1, 2], TRAMPOLINE_X, TRAMPOLINE_Z, TRAMPOLINE_SHAFT.radius, collision);
  addCircularGuard(floorGroups, [1, 2, 3, 4], BUBBLE_X, BUBBLE_Z, BUBBLE_SHAFT.radius, collision);
  addRectangularGuard(floorGroups, [1, 2], HELTER_SHAFT, collision);
}

/** A jump-clearable rail ring, plus a matching collider, on every deck listed. */
function addCircularGuard(
  floorGroups: readonly Group[],
  decks: readonly number[],
  x: number,
  z: number,
  radius: number,
  collision: CollisionWorld,
): void {
  for (const deck of decks) {
    const floor = floorGroups[deck];
    if (floor) floor.add(buildCircularRail(x, z, radius));
  }
  collision.addCircle(worldX(x), worldZ(z), radius, RAIL_TOP_HEIGHT, false);
}

/** A solid rail loop, plus a matching always-solid collider, on every deck listed. */
function addRectangularGuard(
  floorGroups: readonly Group[],
  decks: readonly number[],
  rect: { minX: number; maxX: number; minZ: number; maxZ: number },
  collision: CollisionWorld,
): void {
  for (const deck of decks) {
    const floor = floorGroups[deck];
    if (floor) floor.add(buildRectangularRail(rect));
  }
  const cx = (rect.minX + rect.maxX) / 2;
  const cz = (rect.minZ + rect.maxZ) / 2;
  collision.addRectangle(worldX(cx), worldZ(cz), (rect.maxX - rect.minX) / 2, (rect.maxZ - rect.minZ) / 2);
}

const RAIL_POST_COUNT = 20;

/** A toon rail ring: a top torus plus a ring of stubby posts, matching the escalator's palette. */
function buildCircularRail(x: number, z: number, radius: number): Group {
  const group = new Group();
  group.name = 'shaft-guard-rail';
  group.position.set(x, 0, z);

  const top = new InstancedMesh(
    new TorusGeometry(radius, 0.07, 8, 32),
    interiorMaterial(PALETTE.buildingTrim, 0.7),
    1,
  );
  top.castShadow = false;
  top.receiveShadow = true;
  const topMatrix = new Matrix4().compose(
    new Vector3(0, RAIL_TOP_HEIGHT, 0),
    new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2),
    new Vector3(1, 1, 1),
  );
  top.setMatrixAt(0, topMatrix);
  group.add(top);

  const posts = new InstancedMesh(
    new BoxGeometry(0.1, RAIL_TOP_HEIGHT, 0.1),
    interiorMaterial(PALETTE.buildingTrimDeep, 0.75),
    RAIL_POST_COUNT,
  );
  posts.castShadow = false;
  posts.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  for (let i = 0; i < RAIL_POST_COUNT; i += 1) {
    const angle = (i / RAIL_POST_COUNT) * Math.PI * 2;
    matrix.compose(
      new Vector3(Math.cos(angle) * radius, RAIL_TOP_HEIGHT / 2, Math.sin(angle) * radius),
      rotation,
      scale,
    );
    posts.setMatrixAt(i, matrix);
  }
  posts.instanceMatrix.needsUpdate = true;
  group.add(posts);

  return group;
}

/** A solid toon rail loop round a rectangular shaft — four rail beams, one at each side. */
function buildRectangularRail(rect: { minX: number; maxX: number; minZ: number; maxZ: number }): Group {
  const group = new Group();
  group.name = 'shaft-guard-rail';

  const width = rect.maxX - rect.minX;
  const depth = rect.maxZ - rect.minZ;
  const cx = (rect.minX + rect.maxX) / 2;
  const cz = (rect.minZ + rect.maxZ) / 2;
  const beamMaterial = interiorMaterial(PALETTE.buildingTrim, 0.7);

  const northSouth = new InstancedMesh(new BoxGeometry(width, RAIL_TOP_HEIGHT, 0.14), beamMaterial, 2);
  northSouth.castShadow = false;
  northSouth.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  [rect.minZ, rect.maxZ].forEach((z, index) => {
    matrix.compose(new Vector3(cx, RAIL_TOP_HEIGHT / 2, z), rotation, scale);
    northSouth.setMatrixAt(index, matrix);
  });
  northSouth.instanceMatrix.needsUpdate = true;
  group.add(northSouth);

  const eastWest = new InstancedMesh(new BoxGeometry(0.14, RAIL_TOP_HEIGHT, depth), beamMaterial, 2);
  eastWest.castShadow = false;
  eastWest.receiveShadow = true;
  [rect.minX, rect.maxX].forEach((x, index) => {
    matrix.compose(new Vector3(x, RAIL_TOP_HEIGHT / 2, cz), rotation, scale);
    eastWest.setMatrixAt(index, matrix);
  });
  eastWest.instanceMatrix.needsUpdate = true;
  group.add(eastWest);

  return group;
}
