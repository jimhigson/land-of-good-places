import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { BUILDING_FLOOR_COUNT, BUILDING_FLOOR_HEIGHT, LIFT_SPEED } from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { castAndReceive, extrudePlan, glassMaterial, planRect, softMaterial } from './parts';
import {
  BUILDING_BASE_Y,
  LIFT_CAR_HALF,
  LIFT_CAR_X,
  LIFT_CAR_Z,
  LIFT_SHAFT,
  worldX,
  worldZ,
} from './layout';
import type { MovingPlatform } from './surfaces';
import type { CollisionWorld } from '../Collision';

/**
 * The glass lift — the car and the shaft, and nothing else.
 *
 * It hangs off the east face in its own glass shaft so that riding it really
 * does show you the park sliding past.
 *
 * **It is a piece of machinery, not a ride.** Ask it for a floor and it goes
 * there, non-stop, and stays there until it is asked again. Who asks, when the
 * character steps in, and what the panel on the wall says are all
 * {@link LiftRide}'s business (`liftRide.ts`) — which is what lets the whole
 * riding experience be rebuilt on ARCHITECTURE-DECISIONS Decision 3's
 * `floors()` / `go(n)` seam without this file caring.
 *
 * It used to run itself: up a floor, wait 3.2 s, up a floor, and back down
 * again from the top, for ever. That is why the family said the lift was too
 * hard to ride — the car you want is somewhere else, moving away from you, and
 * catching it is a game of timing. It now sits still until it is called.
 */
export class GlassLift implements MovingPlatform {
  readonly group = new Group();
  /** Height of the car floor, in world units. */
  surfaceY = BUILDING_BASE_Y;

  private readonly car = new Group();
  private floorIndex = 0;
  /** Where the car is going, or null when it is parked and waiting. */
  private target: number | null = null;

  constructor(collision: CollisionWorld) {
    this.group.name = 'glass-lift';

    const shaftHeight = BUILDING_FLOOR_COUNT * BUILDING_FLOOR_HEIGHT + 0.6;

    // The shaft: three glass walls (the fourth side is the building) and a hat.
    const walls = new Mesh(
      extrudePlan(
        [
          planRect(LIFT_SHAFT.minX, LIFT_SHAFT.maxX, LIFT_SHAFT.minZ, LIFT_SHAFT.minZ + 0.24),
          planRect(LIFT_SHAFT.minX, LIFT_SHAFT.maxX, LIFT_SHAFT.maxZ - 0.24, LIFT_SHAFT.maxZ),
          planRect(LIFT_SHAFT.maxX - 0.24, LIFT_SHAFT.maxX, LIFT_SHAFT.minZ, LIFT_SHAFT.maxZ),
        ],
        shaftHeight,
      ),
      glassMaterial(0.18),
    );
    walls.name = 'lift-shaft-glass';
    this.group.add(walls);

    const frame = buildShaftFrame(shaftHeight);
    this.group.add(frame);

    const cap = castAndReceive(
      new Mesh(
        new BoxGeometry(LIFT_SHAFT.maxX - LIFT_SHAFT.minX + 0.5, 0.4, LIFT_SHAFT.maxZ - LIFT_SHAFT.minZ + 0.5),
        softMaterial(PALETTE.liftFrame, 0.68),
      ),
    );
    cap.position.set(
      (LIFT_SHAFT.minX + LIFT_SHAFT.maxX) / 2,
      shaftHeight + 0.2,
      (LIFT_SHAFT.minZ + LIFT_SHAFT.maxZ) / 2,
    );
    this.group.add(cap);

    // The car.
    this.car.name = 'lift-car';
    this.car.position.set(LIFT_CAR_X, 0, LIFT_CAR_Z);
    this.group.add(this.car);

    const floorPlate = castAndReceive(
      new Mesh(
        new BoxGeometry(LIFT_CAR_HALF * 2, 0.22, LIFT_CAR_HALF * 2),
        softMaterial(PALETTE.liftFrame, 0.7),
      ),
    );
    floorPlate.position.y = -0.11;
    this.car.add(floorPlate);

    const roofPlate = castAndReceive(
      new Mesh(
        new BoxGeometry(LIFT_CAR_HALF * 2 + 0.2, 0.2, LIFT_CAR_HALF * 2 + 0.2),
        softMaterial(PALETTE.liftFrame, 0.7),
      ),
    );
    roofPlate.position.y = 2.5;
    this.car.add(roofPlate);

    const cabin = new Mesh(
      new BoxGeometry(LIFT_CAR_HALF * 2 - 0.1, 2.5, LIFT_CAR_HALF * 2 - 0.1),
      glassMaterial(0.16),
    );
    cabin.position.y = 1.25;
    this.car.add(cabin);

    this.car.add(buildCarPosts());

    // Solid on three sides, open where it meets the building's east door.
    const minX = worldX(LIFT_SHAFT.minX);
    const maxX = worldX(LIFT_SHAFT.maxX);
    const minZ = worldZ(LIFT_SHAFT.minZ);
    const maxZ = worldZ(LIFT_SHAFT.maxZ);
    collision.addWall(minX, minZ, maxX, minZ, 0.28);
    collision.addWall(minX, maxZ, maxX, maxZ, 0.28);
    collision.addWall(maxX, minZ, maxX, maxZ, 0.28);

    this.applyCarHeight();
  }

  /** Where the shaft is, in world space — used by the cutaway to count you in. */
  covers(x: number, z: number): boolean {
    return (
      Math.abs(x - worldX(LIFT_CAR_X)) <= LIFT_CAR_HALF &&
      Math.abs(z - worldZ(LIFT_CAR_Z)) <= LIFT_CAR_HALF
    );
  }

  /** The floor the car is parked at. Meaningless while {@link moving}. */
  get floor(): number {
    return this.floorIndex;
  }

  /** True while the car is on its way somewhere. */
  get moving(): boolean {
    return this.target !== null;
  }

  /**
   * Go to `floor`, now, without stopping on the way.
   *
   * Called both to fetch the car for somebody waiting and to carry a rider —
   * they are the same journey and there is no reason for the machinery to know
   * which is which.
   */
  callTo(floor: number): void {
    const wanted = clampFloor(floor);
    if (wanted === this.floorIndex && this.target === null) return;
    this.target = wanted;
  }

  update(dt: number): void {
    if (this.target === null) return;

    const targetY = targetHeight(this.target);
    const step = LIFT_SPEED * dt;
    const remaining = targetY - this.surfaceY;
    if (Math.abs(remaining) <= step) {
      this.surfaceY = targetY;
      this.floorIndex = this.target;
      this.target = null;
    } else {
      this.surfaceY += Math.sign(remaining) * step;
    }
    this.applyCarHeight();
  }

  private applyCarHeight(): void {
    this.car.position.y = this.surfaceY - BUILDING_BASE_Y;
  }
}

function clampFloor(floorIndex: number): number {
  return Math.max(0, Math.min(BUILDING_FLOOR_COUNT - 1, Math.round(floorIndex)));
}

function targetHeight(floorIndex: number): number {
  return BUILDING_BASE_Y + clampFloor(floorIndex) * BUILDING_FLOOR_HEIGHT;
}

/** Four candy-coloured corner posts for the shaft. */
function buildShaftFrame(height: number): InstancedMesh {
  const posts = new InstancedMesh(
    new BoxGeometry(0.3, height, 0.3),
    softMaterial(PALETTE.liftFrame, 0.68),
    4,
  );
  posts.castShadow = false;
  posts.receiveShadow = true;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  let index = 0;
  for (const x of [LIFT_SHAFT.minX, LIFT_SHAFT.maxX]) {
    for (const z of [LIFT_SHAFT.minZ, LIFT_SHAFT.maxZ]) {
      position.set(x, height / 2, z);
      matrix.compose(position, rotation, scale);
      posts.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  posts.instanceMatrix.needsUpdate = true;
  return posts;
}

function buildCarPosts(): InstancedMesh {
  const posts = new InstancedMesh(
    new BoxGeometry(0.16, 2.5, 0.16),
    softMaterial(PALETTE.buildingTrimDeep, 0.68),
    4,
  );
  posts.castShadow = false;
  posts.receiveShadow = true;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  let index = 0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      position.set(sx * (LIFT_CAR_HALF - 0.08), 1.25, sz * (LIFT_CAR_HALF - 0.08));
      matrix.compose(position, rotation, scale);
      posts.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  posts.instanceMatrix.needsUpdate = true;
  return posts;
}
