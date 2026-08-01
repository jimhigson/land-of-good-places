import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';

/**
 * **Sparks off a black rail.**
 *
 * The brief asks for the track to *spark* when you power over the blackened
 * stretches, and a colour change alone does not read as one — a spark is a
 * thing that flies off and dies.
 *
 * Pooled and allocation-free, following the pattern the hop's rainbow ring, the
 * water fight's spray and `art/effects/dustPuff.ts` all use, and for the reason
 * the GC work established: a particle that allocates is a particle that stutters
 * the frame it is most needed. One `InstancedMesh`, one draw call, a fixed pool,
 * and dead sparks parked at zero scale rather than removed.
 *
 * They are `MeshBasicMaterial` and `toneMapped: false` on purpose: a spark is
 * light, not a lit surface, so it must not take the scene's shading or be pulled
 * down by tone mapping — the same call `course.ts`'s warning lamps make.
 */

/** Plenty for a shower without ever being a crowd. */
const POOL = 64;

/** Seconds a spark lives. Short: they are struck, not thrown. */
const LIFE = 0.42;

/** How fast they fly off the rail, in m/s. */
const SPEED_MIN = 2.4;
const SPEED_MAX = 6.5;

/** Sparks fall, but lightly — they are cosy sparks. */
const GRAVITY = 9;

export interface Sparks {
  readonly root: Group;
  /** Throws `count` sparks off a point on the rail. */
  emit(x: number, y: number, z: number, count: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createSparks(): Sparks {
  const root = new Group();
  root.name = 'railRace:sparks';

  const geometry = new BoxGeometry(0.09, 0.09, 0.24);
  const material = new MeshBasicMaterial({ color: PALETTE.fairyWarm, toneMapped: false });
  const mesh = new InstancedMesh(geometry, material, POOL);
  mesh.name = 'railRace:sparks-pool';
  // They are struck all round the ring; working out per-instance bounds for
  // something that lives four tenths of a second is not worth the maths.
  mesh.frustumCulled = false;
  root.add(mesh);

  const positions = new Float32Array(POOL * 3);
  const velocities = new Float32Array(POOL * 3);
  const lives = new Float32Array(POOL);
  const rng = new Rng(0x5a12c5);
  let next = 0;

  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  const colour = new Color();
  const HOT = new Color(PALETTE.blossomWhite);
  const COOL = new Color(PALETTE.fairyWarm);

  // Everything starts dead, parked at zero size.
  for (let i = 0; i < POOL; i += 1) {
    matrix.compose(position.set(0, 0, 0), rotation, scale.set(0, 0, 0));
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;

  return {
    root,

    emit(x: number, y: number, z: number, count: number): void {
      for (let n = 0; n < count; n += 1) {
        // Round-robin over the pool: the oldest spark is the one overwritten,
        // which is what keeps a long spark zone from ever running dry.
        const i = next;
        next = (next + 1) % POOL;
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        // Mostly sideways and down, the way a real one leaves a rail.
        const bearing = rng.range(0, Math.PI * 2);
        const speed = rng.range(SPEED_MIN, SPEED_MAX);
        const lift = rng.range(-0.15, 0.85);
        velocities[i * 3] = Math.cos(bearing) * speed;
        velocities[i * 3 + 1] = lift * speed;
        velocities[i * 3 + 2] = Math.sin(bearing) * speed;
        lives[i] = LIFE;
      }
    },

    update(dt: number): void {
      let anyAlive = false;
      for (let i = 0; i < POOL; i += 1) {
        const life = lives[i] ?? 0;
        if (life <= 0) continue;
        anyAlive = true;
        const remaining = Math.max(0, life - dt);
        lives[i] = remaining;

        velocities[i * 3 + 1] = (velocities[i * 3 + 1] ?? 0) - GRAVITY * dt;
        positions[i * 3] = (positions[i * 3] ?? 0) + (velocities[i * 3] ?? 0) * dt;
        positions[i * 3 + 1] = (positions[i * 3 + 1] ?? 0) + (velocities[i * 3 + 1] ?? 0) * dt;
        positions[i * 3 + 2] = (positions[i * 3 + 2] ?? 0) + (velocities[i * 3 + 2] ?? 0) * dt;

        const t = remaining / LIFE;
        position.set(positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0);
        // Stretched along the way it is flying, which is what makes a moving
        // dot read as a spark rather than as a crumb.
        rotation.setFromUnitVectors(
          FORWARD,
          scratch
            .set(velocities[i * 3] ?? 0, velocities[i * 3 + 1] ?? 0, velocities[i * 3 + 2] ?? 1)
            .normalize(),
        );
        const size = t * t;
        matrix.compose(position, rotation, scale.set(size, size, 0.6 + t * 1.6));
        mesh.setMatrixAt(i, matrix);
        // White-hot when struck, amber as it dies.
        mesh.setColorAt(i, colour.copy(COOL).lerp(HOT, t));
      }
      if (anyAlive) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    },

    dispose(): void {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}

const FORWARD = new Vector3(0, 0, 1);
const scratch = new Vector3();
