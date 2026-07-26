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
 * Confetti and sparkles — one instanced mesh, one draw call, no textures.
 *
 * Everybody gets confetti at the finish line. That is a design rule, not a
 * feature: this is a park where you cannot lose, so coming fourth still ends in
 * a shower of paper. The winner simply gets three times as much of it.
 */

const CAPACITY = 260;

const COLOURS = [
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
  spin: number;
  angle: number;
  life: number;
  ttl: number;
  size: number;
}

export interface Confetti {
  readonly root: Group;
  /** Throws `count` pieces up from a point. */
  burst(x: number, y: number, z: number, count: number, power?: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createConfetti(): Confetti {
  const root = new Group();
  root.name = 'railracer:confetti';

  const geometry = new PlaneGeometry(0.17, 0.24);
  // Double-sided: a tumbling square of paper shows its back half the time.
  const material = new MeshBasicMaterial({ toneMapped: false, side: DoubleSide });
  const mesh = new InstancedMesh(geometry, material, CAPACITY);
  mesh.frustumCulled = false;
  mesh.count = 0;
  root.add(mesh);

  const particles: Particle[] = [];
  const rng = new Rng(0xc04fe7);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const axis = new Vector3(0.3, 0.5, 0.8).normalize();
  const colour = new Color();

  return {
    root,

    burst(x: number, y: number, z: number, count: number, power = 1): void {
      for (let i = 0; i < count; i += 1) {
        if (particles.length >= CAPACITY) break;
        const angle = rng.range(0, Math.PI * 2);
        const speed = rng.range(2.5, 7.5) * power;
        particles.push({
          x,
          y,
          z: z + rng.range(-0.6, 0.6),
          vx: Math.cos(angle) * speed * 0.7 + rng.range(-1, 3),
          vy: rng.range(3.5, 9) * power,
          vz: Math.sin(angle) * speed * 0.35,
          spin: rng.range(-9, 9),
          angle: rng.range(0, Math.PI * 2),
          life: 0,
          ttl: rng.range(1.4, 2.6),
          size: rng.range(0.7, 1.4),
        });
        // Colour is per instance and never changes, so it is written once here
        // rather than every frame.
        colour.setHex(rng.pick(COLOURS));
        mesh.setColorAt(particles.length - 1, colour);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    update(dt: number): void {
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i];
        if (!p) continue;
        p.life += dt;
        if (p.life >= p.ttl) {
          // Swap-remove, and move the dead one's colour out of the way too.
          const last = particles[particles.length - 1];
          if (last && last !== p) {
            particles[i] = last;
            mesh.getColorAt(particles.length - 1, colour);
            mesh.setColorAt(i, colour);
          }
          particles.pop();
          continue;
        }
        p.vy -= 11 * dt;
        // Paper flutters: a little sideways drift that reverses as it spins.
        p.vx += Math.sin(p.angle) * 1.6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.angle += p.spin * dt;
      }

      mesh.count = particles.length;
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        if (!p) continue;
        const fade = 1 - Math.max(0, p.life / p.ttl - 0.7) / 0.3;
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
