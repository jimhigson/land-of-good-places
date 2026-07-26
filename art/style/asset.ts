import { CapsuleGeometry, Group, Mesh, SphereGeometry, type Material } from 'three';
import { solid } from './materials';
import type { Expression } from './faces';

/**
 * The contract every asset in the park obeys. See ASSET_MANIFEST.md.
 *
 * 1 unit = 1 metre. Origin at the feet, centred on X and Z. Forward is +Z.
 * `root.scale` is left alone so gameplay can use it for squash and stretch.
 */
export interface AssetHandle {
  readonly root: Group;
  /** Total height in metres — the name label is placed at `height + 0.28`. */
  readonly height: number;
  update?(dt: number, elapsed: number): void;
  dispose?(): void;
}

export interface CreatureLimbs {
  readonly leftArm: Group;
  readonly rightArm: Group;
  readonly leftLeg: Group;
  readonly rightLeg: Group;
}

export interface CreatureHandle extends AssetHandle {
  /** Bob and squash target. Everything above the ground plane lives in here. */
  readonly body: Group;
  /** Look-at target. Rotating this must not move the body. */
  readonly head: Group;
  readonly limbs: CreatureLimbs | null;
  setExpression(name: Expression): void;
  /** `phase` is 0..1 through one stride; `speed` is 0..1 of top speed. */
  setWalkPhase(phase: number, speed: number): void;
}

/**
 * A squashed sphere — the single most-used shape in the game.
 *
 * Almost every part of every character here is one of these. Uniform spheres
 * look like beach balls; a sphere squashed 10–25% on one axis looks like it was
 * sewn and stuffed.
 */
export function blob(
  radius: number,
  material: Material,
  scale: [number, number, number] = [1, 1, 1],
  segments = 24,
): Mesh {
  const mesh = solid(new Mesh(new SphereGeometry(radius, segments, Math.round(segments * 0.75)), material));
  mesh.scale.set(scale[0], scale[1], scale[2]);
  return mesh;
}

/** A rounded limb or torso. Radius is generous — thin limbs are never cute. */
export function stub(radius: number, length: number, material: Material): Mesh {
  return solid(new Mesh(new CapsuleGeometry(radius, length, 6, 16), material));
}

/** Standard four-limb rig with pivots at shoulder and hip. */
export function makeLimbs(): CreatureLimbs {
  return {
    leftArm: new Group(),
    rightArm: new Group(),
    leftLeg: new Group(),
    rightLeg: new Group(),
  };
}

/**
 * The house walk cycle: opposed arm and leg swing plus a two-beat bob.
 *
 * Shared by every creature so the parade looks like one family of toys rather
 * than a pile of separately-animated assets.
 */
export function applyWalk(
  limbs: CreatureLimbs | null,
  body: Group,
  phase: number,
  speed: number,
  swing = 0.85,
  bob = 0.055,
): void {
  const a = phase * Math.PI * 2;
  const s = Math.sin(a) * speed;
  if (limbs) {
    limbs.leftArm.rotation.x = s * swing;
    limbs.rightArm.rotation.x = -s * swing;
    limbs.leftLeg.rotation.x = -s * swing * 0.8;
    limbs.rightLeg.rotation.x = s * swing * 0.8;
  }
  // Two bounces per stride, and a touch of squash at the bottom of each.
  const lift = Math.abs(Math.sin(a)) * bob * speed;
  body.position.y = lift;
  body.scale.y = 1 - lift * 0.5;
  body.scale.x = 1 + lift * 0.28;
  body.scale.z = 1 + lift * 0.28;
}
