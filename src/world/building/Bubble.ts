import {
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import {
  BUBBLE_DWELL,
  BUBBLE_SPEED,
  BUILDING_FLOOR_COUNT,
  BUILDING_FLOOR_HEIGHT,
} from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { castAndReceive, interiorMaterial } from './parts';
import { BUBBLE_RADIUS, BUBBLE_X, BUBBLE_Z, BUILDING_BASE_Y, worldX, worldZ } from './layout';
import type { MovingPlatform } from './surfaces';

/** Stepping-off radius while the bubble is level with a deck. */
const DOCKED_RADIUS = BUBBLE_RADIUS + 0.7;

/**
 * The floating bubble: step in, and it carries you up through the middle of the
 * building, wobbling as it goes.
 *
 * It drifts from deck to deck and pauses at each, so there is never a control to
 * find — you get in, you wait, you step out. The wobble lives entirely in the
 * skin: the pad you stand on bobs by only a few centimetres, because a lurching
 * floor makes people walk off the edge of it.
 */
export class Bubble implements MovingPlatform {
  readonly group = new Group();
  surfaceY = BUILDING_BASE_Y;

  private readonly skin: Mesh;
  /** Ride height before the bob is added — the honest position of the bubble. */
  private travel = BUILDING_BASE_Y;
  private floorIndex = 0;
  private direction = 1;
  private dwell = BUBBLE_DWELL;
  private travelling = false;

  constructor() {
    this.group.name = 'floating-bubble';
    this.group.position.set(BUBBLE_X, 0, BUBBLE_Z);

    this.skin = new Mesh(
      new SphereGeometry(BUBBLE_RADIUS + 0.3, 26, 20),
      new MeshStandardMaterial({
        color: PALETTE.bubbleSkin,
        roughness: 0.08,
        metalness: 0,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.skin.position.y = BUBBLE_RADIUS + 0.1;
    this.group.add(this.skin);

    const pad = castAndReceive(
      new Mesh(
        new CylinderGeometry(BUBBLE_RADIUS, BUBBLE_RADIUS * 0.84, 0.22, 26),
        interiorMaterial(PALETTE.markerMint, 0.6),
      ),
    );
    pad.position.y = -0.11;
    this.group.add(pad);
  }

  covers(x: number, z: number): boolean {
    const dx = x - worldX(BUBBLE_X);
    const dz = z - worldZ(BUBBLE_Z);
    const radius = this.travelling ? BUBBLE_RADIUS : DOCKED_RADIUS;
    return dx * dx + dz * dz <= radius * radius;
  }

  update(dt: number, elapsed: number): void {
    if (this.travelling) {
      const target = deckHeight(this.floorIndex + this.direction);
      const step = BUBBLE_SPEED * dt;
      const remaining = target - this.travel;
      if (Math.abs(remaining) <= step) {
        this.travel = target;
        this.floorIndex += this.direction;
        this.travelling = false;
        this.dwell = BUBBLE_DWELL;
        if (this.floorIndex >= BUILDING_FLOOR_COUNT - 1) this.direction = -1;
        else if (this.floorIndex <= 0) this.direction = 1;
      } else {
        this.travel += Math.sign(remaining) * step;
      }
    } else {
      this.dwell -= dt;
      if (this.dwell <= 0) this.travelling = true;
    }

    this.surfaceY = this.travel + Math.sin(elapsed * 1.5) * 0.05;
    this.group.position.y = this.surfaceY - BUILDING_BASE_Y;

    const wobble = Math.sin(elapsed * 2.1) * 0.06;
    this.skin.scale.set(1 + wobble, 1 - wobble * 0.9, 1 - wobble * 0.4);
    this.skin.rotation.y = elapsed * 0.25;
  }
}

function deckHeight(index: number): number {
  const clamped = Math.max(0, Math.min(BUILDING_FLOOR_COUNT - 1, index));
  return BUILDING_BASE_Y + clamped * BUILDING_FLOOR_HEIGHT;
}
