import { Vector3 } from 'three';
import { RIM_DROP, RIM_OUTSET_END, RIM_OUTSET_START, TERRAIN_HEIGHT_SCALE } from '../core/constants';
import { smoothstep } from '../core/mathUtils';
import { PARK_BOUNDARY } from './boundary';

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
  const base = (broad + medium + fine) * TERRAIN_HEIGHT_SCALE;

  // Outside the boundary wall the ground falls away steeply, putting the park
  // on top of a hill. This is what makes the sky visible: the drop is steeper
  // than the camera's 38° pitch, so everything past the crest is hidden and the
  // horizon appears just above the wall. Without it an endless flat plane fills
  // the screen and the whole day/night cycle goes unseen.
  // Measured outward from the park's own edge, not from the origin. The
  // boundary is 57 m out on one bearing and 110 m on another, so a crest at a
  // fixed radius would slice through the park on one side and leave a plain
  // outside it on the other. `distanceToEdge` is positive inside, so negating
  // it gives metres *beyond* the edge, and the hill is the same hill wherever
  // you walk out of the park.
  const beyondEdge = -PARK_BOUNDARY.distanceToEdge(x, z);
  return base - smoothstep(RIM_OUTSET_START, RIM_OUTSET_END, beyondEdge) * RIM_DROP;
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
