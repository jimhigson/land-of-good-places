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
 * Sparks on every bump, and confetti at the end.
 *
 * One pool, one draw call, two ways of throwing from it — a spark is simply a
 * short-lived, fast, small piece and a confetto is a slow, big, tumbling one.
 * Keeping them in one system means the whole game's particle budget is a single
 * number that cannot be exceeded, which matters when a six-year-old discovers
 * that ramming the tree over and over is the best bit.
 *
 * Blending is normal, never additive (ART_DIRECTION.md §5): in a park made of
 * painted things, an effect is paint.
 */

const CAPACITY = 300;

const SPARK_COLOURS = [
  PALETTE.fairyWarm,
  PALETTE.markerLemon,
  PALETTE.blossomWhite,
  PALETTE.buildingWindowWarm,
];

const CONFETTI_COLOURS = [
  PALETTE.markerPink,
  PALETTE.markerLemon,
  PALETTE.markerMint,
  PALETTE.markerSky,
  PALETTE.markerLilac,
  PALETTE.blossomWhite,
];

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  angle: number;
  spin: number;
  life: number;
  ttl: number;
  size: number;
  gravity: number;
}

export interface Sparks {
  readonly root: Group;
  /** A shower of hot little sparks at a bump. */
  spark(x: number, y: number, z: number, count: number, power?: number): void;
  /** Big slow tumbling paper. */
  confetti(x: number, y: number, z: number, count: number, power?: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createSparks(): Sparks {
  const root = new Group();
  root.name = 'dodgems:sparks';

  const geometry = new PlaneGeometry(0.16, 0.22);
  const material = new MeshBasicMaterial({ toneMapped: false, side: DoubleSide });
  const mesh = new InstancedMesh(geometry, material, CAPACITY);
  mesh.frustumCulled = false;
  mesh.count = 0;
  root.add(mesh);

  const particles: Particle[] = [];
  const rng = new Rng(0x5a4c17);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const axis = new Vector3(0.35, 0.6, 0.72).normalize();
  const colour = new Color();

  function emit(particle: Particle, hex: number): void {
    if (particles.length >= CAPACITY) return;
    particles.push(particle);
    colour.setHex(hex);
    mesh.setColorAt(particles.length - 1, colour);
  }

  return {
    root,

    spark(x: number, y: number, z: number, count: number, power = 1): void {
      for (let i = 0; i < count; i += 1) {
        const angle = rng.range(0, Math.PI * 2);
        const speed = rng.range(2.4, 7) * power;
        emit(
          {
            x,
            y,
            z,
            vx: Math.cos(angle) * speed,
            vy: rng.range(1.6, 5.4) * power,
            vz: Math.sin(angle) * speed,
            angle: rng.range(0, Math.PI * 2),
            spin: rng.range(-16, 16),
            life: 0,
            ttl: rng.range(0.3, 0.62),
            size: rng.range(0.4, 0.85),
            gravity: 13,
          },
          rng.pick(SPARK_COLOURS),
        );
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    confetti(x: number, y: number, z: number, count: number, power = 1): void {
      for (let i = 0; i < count; i += 1) {
        const angle = rng.range(0, Math.PI * 2);
        const speed = rng.range(1.4, 5) * power;
        emit(
          {
            x,
            y,
            z,
            vx: Math.cos(angle) * speed,
            vy: rng.range(4, 9.5) * power,
            vz: Math.sin(angle) * speed,
            angle: rng.range(0, Math.PI * 2),
            spin: rng.range(-8, 8),
            life: 0,
            ttl: rng.range(1.7, 3.2),
            size: rng.range(0.9, 1.7),
            gravity: 9,
          },
          rng.pick(CONFETTI_COLOURS),
        );
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    update(dt: number): void {
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i];
        if (!p) continue;
        p.life += dt;
        if (p.life >= p.ttl) {
          // Swap-remove, taking the moved particle's colour with it.
          const last = particles[particles.length - 1];
          if (last && last !== p) {
            particles[i] = last;
            mesh.getColorAt(particles.length - 1, colour);
            mesh.setColorAt(i, colour);
          }
          particles.pop();
          continue;
        }
        p.vy -= p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.angle += p.spin * dt;
      }

      mesh.count = particles.length;
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        if (!p) continue;
        // Hold, then fade on a curve.
        const fade = 1 - Math.max(0, p.life / p.ttl - 0.65) / 0.35;
        position.set(p.x, p.y, p.z);
        quaternion.setFromAxisAngle(axis, p.angle);
        scale.setScalar(p.size * fade);
        matrix.compose(position, quaternion, scale);
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
