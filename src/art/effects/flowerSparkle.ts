import { Euler, Group, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import { clamp01, smoothstep, TAU } from '../../core/mathUtils';
import { starGeometry } from '../style/shapes';
import { decal } from '../style/materials';
import { tiltFor, upFor } from '../../world/up';

/**
 * The flourish that plays when a bloomed flower is picked.
 *
 * Two fixed pools, same rules as `rainbowRing.ts` (the reference effect):
 * pigment not light (normal blending, never additive), nothing is `new`'d
 * per trigger, and everything fades on a curve rather than switching off.
 *
 *  - **The bloom itself** pops up off its stem and shrinks away towards
 *    wherever the player is *right now* — `burst()` is handed a live target
 *    getter rather than a fixed point, so the flight still looks right if the
 *    player keeps walking while it plays.
 *  - **A handful of star sparkles** scatter outward from the same spot.
 *
 * Both pools use one `MeshBasicMaterial` per slot rather than a shared one:
 * the pool is small (a child rarely picks more than one flower at once) and
 * per-mesh opacity is what makes the fade-and-shrink trivial to write.
 */

const FLYER_POOL_SIZE = 3;
const FLYER_LIFETIME = 0.5;
/** How high the picked bloom arcs on its way to the player, in metres. */
const FLYER_ARC = 0.7;

const SPARKLE_POOL_SIZE = 12;
const SPARKLES_PER_BURST = 4;
const SPARKLE_LIFETIME = 0.42;
const SPARKLE_TRAVEL = 0.55;

export interface FlowerPickEffect {
  readonly root: Group;
  /**
   * Fires the pick flourish at a world point.
   *
   * `target` is read every frame for the life of the flying bloom, so the
   * animation keeps heading for the player even if they carry on walking.
   */
  burst(x: number, y: number, z: number, colour: number, target: () => Vector3): void;
  update(dt: number): void;
  dispose(): void;
}

interface Flyer {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  readonly from: Vector3;
  /** Which way is up where the flower was picked — the arc's axis. */
  readonly up: Vector3;
  target: (() => Vector3) | null;
  age: number;
  active: boolean;
}

interface Sparkle {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  readonly origin: Vector3;
  readonly direction: Vector3;
  /** The star's own spin, in radians, kept so its quaternion can be rebuilt from scratch. */
  spin: number;
  /** The tilt onto the ground it was thrown from, so the spin is about the local up. */
  readonly tilt: Quaternion;
  age: number;
  active: boolean;
}

export function createFlowerPickEffect(): FlowerPickEffect {
  const root = new Group();
  root.name = 'flower-pick-effect';

  const flyerGeometry = new SphereGeometry(0.14, 12, 8);
  const flyers: Flyer[] = [];
  for (let i = 0; i < FLYER_POOL_SIZE; i += 1) {
    const material = new MeshBasicMaterial({ transparent: true, depthWrite: false });
    const mesh = decal(new Mesh(flyerGeometry, material));
    mesh.visible = false;
    mesh.renderOrder = 10;
    mesh.scale.set(1, 0.55, 1);
    root.add(mesh);
    flyers.push({
      mesh,
      material,
      from: new Vector3(),
      up: new Vector3(0, 1, 0),
      target: null,
      age: 0,
      active: false,
    });
  }
  let nextFlyer = 0;

  const sparkleGeometry = starGeometry(0.11, 0.02);
  const sparkles: Sparkle[] = [];
  for (let i = 0; i < SPARKLE_POOL_SIZE; i += 1) {
    const material = new MeshBasicMaterial({ transparent: true, depthWrite: false });
    const mesh = decal(new Mesh(sparkleGeometry, material));
    mesh.visible = false;
    mesh.renderOrder = 10;
    root.add(mesh);
    sparkles.push({
      mesh,
      material,
      origin: new Vector3(),
      direction: new Vector3(),
      spin: 0,
      tilt: new Quaternion(),
      age: 0,
      active: false,
    });
  }
  let nextSparkle = 0;

  const flightPoint = new Vector3();
  const _up = new Vector3();
  const _tilt = new Quaternion();
  const _spinEuler = new Euler();

  function burst(x: number, y: number, z: number, colour: number, target: () => Vector3): void {
    // The flourish is authored as "so much sideways, so much up" from the
    // flower — every number below is in the frame of the ground it grew in, and
    // outdoors that frame leans by where the flower is. One tilt serves the
    // whole burst: the flyer, its squash and all four stars start in the same
    // square metre.
    const tilt = tiltFor(x, y, z, _tilt);
    upFor(x, y, z, _up);

    const flyer = flyers[nextFlyer % flyers.length];
    nextFlyer += 1;
    if (flyer) {
      flyer.from.set(x, y, z).addScaledVector(_up, 0.1);
      flyer.up.copy(_up);
      flyer.target = target;
      flyer.age = 0;
      flyer.active = true;
      flyer.material.color.setHex(colour);
      flyer.material.opacity = 1;
      flyer.mesh.position.copy(flyer.from);
      // The bloom is a squashed sphere — 0.55 on its own Y — so the mesh has to
      // be leaned or the squash flattens it against the wrong plane.
      flyer.mesh.quaternion.copy(tilt);
      flyer.mesh.scale.set(1, 0.55, 1);
      flyer.mesh.visible = true;
    }

    for (let i = 0; i < SPARKLES_PER_BURST; i += 1) {
      const sparkle = sparkles[nextSparkle % sparkles.length];
      nextSparkle += 1;
      if (!sparkle) continue;
      const angle = (i / SPARKLES_PER_BURST) * TAU + nextSparkle * 0.37;
      sparkle.origin.set(x, y, z).addScaledVector(_up, 0.15);
      sparkle.direction.set(Math.cos(angle), 0.7, Math.sin(angle)).applyQuaternion(tilt);
      sparkle.tilt.copy(tilt);
      sparkle.spin = 0;
      sparkle.age = 0;
      sparkle.active = true;
      sparkle.material.color.setHex(colour);
      sparkle.material.opacity = 1;
      sparkle.mesh.position.copy(sparkle.origin);
      sparkle.mesh.quaternion.copy(tilt);
      sparkle.mesh.scale.setScalar(1);
      sparkle.mesh.visible = true;
    }
  }

  function update(dt: number): void {
    for (const flyer of flyers) {
      if (!flyer.active) continue;
      flyer.age += dt;
      const t = clamp01(flyer.age / FLYER_LIFETIME);
      if (t >= 1 || !flyer.target) {
        flyer.active = false;
        flyer.mesh.visible = false;
        continue;
      }
      const ease = smoothstep(0, 1, t);
      const to = flyer.target();
      // Hair height above *her*, along the up where she is standing. 1.55 m of
      // world +Y at the park's rim is 1.09 m of real height and 1.11 m
      // sideways — the bloom would sail past her ear and park in mid-air.
      upFor(to.x, to.y, to.z, _up);
      flightPoint.copy(to).addScaledVector(_up, 1.55);
      flyer.mesh.position.lerpVectors(flyer.from, flightPoint, ease);
      flyer.mesh.position.addScaledVector(flyer.up, Math.sin(t * Math.PI) * FLYER_ARC);
      // Hold at full size briefly (the "pop"), then shrink away.
      const scale = 1 - smoothstep(0.35, 1, t) * 0.97;
      flyer.mesh.scale.set(scale, scale * 0.55, scale);
      flyer.material.opacity = 1 - smoothstep(0.7, 1, t);
    }

    for (const sparkle of sparkles) {
      if (!sparkle.active) continue;
      sparkle.age += dt;
      const t = clamp01(sparkle.age / SPARKLE_LIFETIME);
      if (t >= 1) {
        sparkle.active = false;
        sparkle.mesh.visible = false;
        continue;
      }
      const ease = smoothstep(0, 1, t);
      sparkle.mesh.position.set(
        sparkle.origin.x + sparkle.direction.x * SPARKLE_TRAVEL * ease,
        sparkle.origin.y + sparkle.direction.y * SPARKLE_TRAVEL * ease,
        sparkle.origin.z + sparkle.direction.z * SPARKLE_TRAVEL * ease,
      );
      // Spun about the local up, and rebuilt from scratch every frame:
      // `rotation.y +=` would decompose the lean back into `rotation.x/z` and
      // re-apply it on top of itself, which is `world/up.ts`'s tumbling player.
      sparkle.spin += dt * 6;
      sparkle.mesh.quaternion
        .setFromEuler(_spinEuler.set(0, sparkle.spin, 0))
        .premultiply(sparkle.tilt);
      const scale = 1 - t * 0.6;
      sparkle.mesh.scale.setScalar(scale);
      // Hold bright at the start, then fall away — a linear fade reads as
      // switching off rather than dissipating.
      sparkle.material.opacity = 1 - smoothstep(0.4, 1, t);
    }
  }

  function dispose(): void {
    flyerGeometry.dispose();
    sparkleGeometry.dispose();
    for (const flyer of flyers) flyer.material.dispose();
    for (const sparkle of sparkles) sparkle.material.dispose();
  }

  return { root, burst, update, dispose };
}
