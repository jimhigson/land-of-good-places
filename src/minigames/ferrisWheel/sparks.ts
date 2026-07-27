import {
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';

/**
 * Confetti sparks — what happens when you wave at somebody out of the window.
 *
 * The park's rule for effects (ART_DIRECTION.md) is **pigment, not light**:
 * normal blending, never additive, because everything in this park is painted.
 * That holds even in space, where additive would have been the obvious cheat —
 * a blown-out white halo against a dark sky is exactly the sort of thing that
 * stops looking hand-made.
 *
 * One instanced mesh, one fixed pool, no textures and no allocation after
 * construction: a six-year-old will tap the alien forty times in a row.
 */

const CAPACITY = 180;

const COLOURS = [
  PALETTE.markerPink,
  PALETTE.markerLemon,
  PALETTE.markerMint,
  PALETTE.markerSky,
  PALETTE.markerLilac,
  PALETTE.blossomWhite,
];

interface Spark {
  readonly at: Vector3;
  readonly velocity: Vector3;
  spin: number;
  angle: number;
  life: number;
  ttl: number;
  size: number;
}

export interface Sparks {
  readonly root: Group;
  /** Throws `count` sparks out from a point, in metres. */
  burst(at: Vector3, count: number, spread?: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createSparks(): Sparks {
  const root = new Group();
  root.name = 'ferris:sparks';

  const geometry = new PlaneGeometry(0.16, 0.22);
  const material = new MeshBasicMaterial({ toneMapped: false, side: DoubleSide });
  const mesh = new InstancedMesh(geometry, material, CAPACITY);
  mesh.frustumCulled = false;
  mesh.count = 0;
  root.add(mesh);

  const sparks: Spark[] = [];
  const pool: Spark[] = [];
  for (let i = 0; i < CAPACITY; i += 1) {
    pool.push({
      at: new Vector3(),
      velocity: new Vector3(),
      spin: 0,
      angle: 0,
      life: 0,
      ttl: 1,
      size: 1,
    });
  }

  const rng = new Rng(0x5aacef);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const axis = new Vector3(0.35, 0.6, 0.72).normalize();
  const colour = new Color();

  return {
    root,

    burst(at: Vector3, count: number, spread = 1): void {
      for (let i = 0; i < count; i += 1) {
        const spark = pool.pop();
        if (!spark) break;
        // A spherical spray rather than a fountain: out here there is no down
        // for the paper to come back to.
        const theta = rng.range(0, Math.PI * 2);
        const phi = Math.acos(rng.range(-1, 1));
        const speed = rng.range(0.8, 3.4) * spread;
        spark.at.copy(at);
        spark.velocity.set(
          Math.sin(phi) * Math.cos(theta) * speed,
          Math.cos(phi) * speed,
          Math.sin(phi) * Math.sin(theta) * speed * 0.6,
        );
        spark.spin = rng.range(-7, 7);
        spark.angle = rng.range(0, Math.PI * 2);
        spark.life = 0;
        spark.ttl = rng.range(1.1, 2.2);
        spark.size = rng.range(0.75, 1.6) * spread;
        sparks.push(spark);
        colour.setHex(rng.pick(COLOURS));
        mesh.setColorAt(sparks.length - 1, colour);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    update(dt: number): void {
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const spark = sparks[i];
        if (!spark) continue;
        spark.life += dt;
        if (spark.life >= spark.ttl) {
          // Swap-remove, carrying the surviving spark's colour back with it.
          const last = sparks[sparks.length - 1];
          if (last && last !== spark) {
            sparks[i] = last;
            mesh.getColorAt(sparks.length - 1, colour);
            mesh.setColorAt(i, colour);
          }
          sparks.pop();
          pool.push(spark);
          continue;
        }
        // Drag only. They slow, drift and wink out where they were thrown.
        spark.velocity.multiplyScalar(1 - Math.min(0.9, dt * 1.1));
        spark.at.addScaledVector(spark.velocity, dt);
        spark.angle += spark.spin * dt;
      }

      mesh.count = sparks.length;
      for (let i = 0; i < sparks.length; i += 1) {
        const spark = sparks[i];
        if (!spark) continue;
        // Hold, then fall away on a curve: a linear fade reads as the effect
        // being switched off rather than dissipating.
        const t = spark.life / spark.ttl;
        const fade = t < 0.55 ? 1 : 1 - ((t - 0.55) / 0.45) ** 1.6;
        quaternion.setFromAxisAngle(axis, spark.angle);
        scale.setScalar(spark.size * fade);
        matrix.compose(spark.at, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    dispose(): void {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
