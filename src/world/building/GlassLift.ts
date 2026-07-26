import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import {
  BUILDING_FLOOR_COUNT,
  BUILDING_FLOOR_HEIGHT,
  LIFT_DWELL,
  LIFT_SPEED,
} from '../../core/constants';
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
 * The glass lift.
 *
 * It hangs off the east face in its own glass shaft so that riding it really
 * does show you the park sliding past. It runs itself — up a floor, wait, up a
 * floor, and back down again from the top — which means a six-year-old only has
 * to walk in and stand still. Pressing the interact key while inside sends it on
 * straight away rather than waiting out the dwell.
 */
export class GlassLift implements MovingPlatform {
  readonly group = new Group();
  /** Height of the car floor, in world units. */
  surfaceY = BUILDING_BASE_Y;

  private readonly car = new Group();
  private floorIndex = 0;
  private direction = 1;
  private dwellTimer = LIFT_DWELL;
  private travelling = false;
  /** Floor somebody is waiting on. Overrides the idle up-and-down cycle. */
  private called: number | null = null;

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

  /**
   * Somebody is standing at the doors on `floor`. Fetches the car, unless it is
   * already moving or already there.
   */
  callTo(floor: number): void {
    if (this.travelling || floor === this.floorIndex) return;
    this.called = floor;
    this.dwellTimer = 0;
  }

  update(dt: number, riderAboard: boolean, interactPressed: boolean): void {
    if (this.travelling) {
      const target = targetHeight(this.floorIndex + this.direction);
      const step = LIFT_SPEED * dt;
      const remaining = target - this.surfaceY;
      if (Math.abs(remaining) <= step) {
        this.surfaceY = target;
        this.floorIndex += this.direction;
        this.travelling = false;
        this.dwellTimer = LIFT_DWELL;
        if (this.called === this.floorIndex) this.called = null;
        if (this.floorIndex >= BUILDING_FLOOR_COUNT - 1) this.direction = -1;
        else if (this.floorIndex <= 0) this.direction = 1;
      } else {
        this.surfaceY += Math.sign(remaining) * step;
      }
    } else {
      this.dwellTimer -= dt;
      // Riding and impatient: go now rather than waiting out the dwell.
      if (riderAboard && interactPressed) this.dwellTimer = 0;
      if (this.dwellTimer <= 0) {
        if (this.called !== null && this.called !== this.floorIndex) {
          this.direction = Math.sign(this.called - this.floorIndex);
        }
        this.travelling = true;
      }
    }
    this.applyCarHeight();
  }

  private applyCarHeight(): void {
    this.car.position.y = this.surfaceY - BUILDING_BASE_Y;
  }
}

function targetHeight(floorIndex: number): number {
  const clamped = Math.max(0, Math.min(BUILDING_FLOOR_COUNT - 1, floorIndex));
  return BUILDING_BASE_Y + clamped * BUILDING_FLOOR_HEIGHT;
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
