import { CylinderGeometry, Group, Mesh, TorusGeometry } from 'three';
import { TRAMPOLINE_MAX_LAUNCH, TRAMPOLINE_MIN_LAUNCH } from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { castAndReceive, interiorMaterial } from './parts';

/** Decoration that takes light but does not cast. */
function receiveOnly(mesh: Mesh): Mesh {
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}
import {
  BUILDING_BASE_Y,
  TRAMPOLINE_RADIUS,
  TRAMPOLINE_X,
  TRAMPOLINE_Z,
  worldX,
  worldZ,
} from './layout';

/** How long after a bounce a second one still counts as "again!". */
const COMBO_WINDOW = 2.6;

/**
 * The trampoline, on the ground floor under a shaft that runs up to deck two.
 *
 * Bounce again the moment you land and you go higher — three good bounces clear
 * two whole storeys. The pad squashes as you hit it and springs back past its
 * rest size, which is most of what makes it feel bouncy.
 */
export class Trampoline {
  readonly group = new Group();

  private readonly pad: Mesh;
  private squash = 0;
  private squashVelocity = 0;
  private comboTimer = 0;
  private combo = 0;

  constructor() {
    this.group.name = 'trampoline';
    this.group.position.set(TRAMPOLINE_X, 0, TRAMPOLINE_Z);

    this.pad = castAndReceive(
      new Mesh(
        new CylinderGeometry(TRAMPOLINE_RADIUS, TRAMPOLINE_RADIUS, 0.16, 28),
        interiorMaterial(PALETTE.trampolinePad, 0.55),
      ),
    );
    this.pad.position.y = 0.24;
    this.group.add(this.pad);

    const rim = receiveOnly(
      new Mesh(
        new TorusGeometry(TRAMPOLINE_RADIUS + 0.06, 0.22, 10, 30),
        interiorMaterial(PALETTE.trampolineRim, 0.55),
      ),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.24;
    this.group.add(rim);

    const skirt = receiveOnly(
      new Mesh(
        new CylinderGeometry(TRAMPOLINE_RADIUS + 0.06, TRAMPOLINE_RADIUS + 0.3, 0.3, 24),
        interiorMaterial(PALETTE.buildingTrimDeep, 0.75),
      ),
    );
    skirt.position.y = 0.09;
    this.group.add(skirt);
  }

  /** World height of the springy surface. */
  get surfaceY(): number {
    return BUILDING_BASE_Y + 0.32;
  }

  /** True if this world point is over the pad. */
  covers(x: number, z: number): boolean {
    const dx = x - worldX(TRAMPOLINE_X);
    const dz = z - worldZ(TRAMPOLINE_Z);
    return dx * dx + dz * dz <= TRAMPOLINE_RADIUS * TRAMPOLINE_RADIUS;
  }

  /**
   * Call when a walker touches down on the pad. Returns the launch speed, or
   * zero if they were not really on it.
   */
  bounce(): number {
    this.combo = this.comboTimer > 0 ? Math.min(this.combo + 1, 2) : 0;
    this.comboTimer = COMBO_WINDOW;
    this.squash = 0.55;
    this.squashVelocity = 0;
    const t = this.combo / 2;
    return TRAMPOLINE_MIN_LAUNCH + (TRAMPOLINE_MAX_LAUNCH - TRAMPOLINE_MIN_LAUNCH) * t;
  }

  update(dt: number): void {
    if (this.comboTimer > 0) this.comboTimer -= dt;

    // A critically-under-damped spring: overshoots once, then settles.
    this.squashVelocity += (-this.squash * 190 - this.squashVelocity * 12) * dt;
    this.squash += this.squashVelocity * dt;

    const scaleY = 1 - this.squash;
    this.pad.scale.set(1 + this.squash * 0.14, Math.max(0.15, scaleY), 1 + this.squash * 0.14);
    this.pad.position.y = 0.24 - this.squash * 0.16;
  }
}
