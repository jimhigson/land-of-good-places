import { Vector3 } from 'three';
import { TERRAIN_HEIGHT_SCALE } from '../core/constants';

/**
 * The shape of the ground, as a pure function.
 *
 * Everything that needs to sit on the grass — the player's feet, tree trunks,
 * fence posts, path ribbons — calls {@link terrainHeight} rather than
 * ray-casting against the mesh. It is a handful of sine waves, so it is cheap
 * enough to call thousands of times per frame and, being deterministic, the
 * world looks identical on every reload.
 *
 * Amplitude is deliberately tiny: the design calls for a "big flat-ish garden",
 * and steep ground would fight the fixed isometric camera.
 */
export function terrainHeight(x: number, z: number): number {
  const broad = Math.sin(x * 0.055) * Math.cos(z * 0.048) * 0.62;
  const medium = Math.sin(x * 0.108 + 1.7) * Math.sin(z * 0.094 - 0.6) * 0.3;
  const fine = Math.cos((x + z) * 0.031) * 0.34;
  return (broad + medium + fine) * TERRAIN_HEIGHT_SCALE;
}

/** Surface normal at a point, from finite differences. */
export function terrainNormal(x: number, z: number, target = new Vector3()): Vector3 {
  const e = 0.6;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return target.set(-dx, 2 * e, -dz).normalize();
}

/** Convenience: writes the ground position for an (x, z) into `target`. */
export function groundPoint(x: number, z: number, target = new Vector3()): Vector3 {
  return target.set(x, terrainHeight(x, z), z);
}
