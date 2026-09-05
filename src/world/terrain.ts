import { Vector3 } from 'three';
import { GROUND_SPHERE_RADIUS, TERRAIN_HEIGHT_SCALE } from '../core/constants';

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

  // **The ground is a piece of a very large sphere (#511)** — tangent to
  // horizontal at the park's centre, curving away on every bearing.
  //
  // What was here before was a `smoothstep` rim: flat inside the boundary, then
  // a 17 m cliff just outside it, which put the park on a hilltop. Jim asked for
  // that to go — *"just not make the park on a hill. Let the land spread out in
  // all directions for a long way"* — and, when a flat apron was proposed as the
  // fix for the road-versus-ride contention outside the wall, ruled that out
  // too: *"there should be no 'flat ground' it is a sphere"*.
  //
  // **Why a sphere rather than simply deleting the rim.** The rim was not
  // decoration; it was the only thing letting any sky be seen at ground level,
  // because an orthographic camera pitched 38° never sees a horizon over a
  // plane — sky appears only where the ground *runs out*. Deleting it alone
  // gives a flat disc ending in a cut edge at eye level. A sphere restores a
  // real horizon instead of a cliff, and it is the shape a child would draw for
  // "the world". It only *reads* as a horizon under a perspective camera, which
  // is why #511's ground work and the projection change are one piece of work
  // and not two — see HANDOFF-no-hill-511.md.
  //
  // Exact spherical cap rather than the `d²/2R` paraboloid everyone writes: at
  // these distances they differ by centimetres, but the exact form cannot
  // quietly stop being a sphere far out, and one `sqrt` is nothing against the
  // three trigonometric calls above it.
  //
  // `Math.max(0, …)` guards the horizon itself: past `GROUND_SPHERE_RADIUS` the
  // cap has curved through vertical and there is no real square root. No ground
  // is authored within two orders of magnitude of that, but a NaN leaking into
  // `terrainHeight` would put every prop in the park at `NaN` height, and this
  // is one line.
  const distanceSquared = x * x + z * z;
  const fall =
    GROUND_SPHERE_RADIUS -
    Math.sqrt(Math.max(0, GROUND_SPHERE_RADIUS * GROUND_SPHERE_RADIUS - distanceSquared));
  return base - fall;
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
