/**
 * **What the park's front gate actually is, read off a built scene.**
 *
 * One owner, because two things ask: `test/procgen/parkFacts.ts` (feeding
 * `theParkGateArchStandsOverItsGateway`, which CI blocks the merge on) and
 * `scripts/probe-gate-pool.mts` (the same clauses across the sixteen pool
 * seeds). They used to carry the same traversal and the same box arithmetic
 * twice, which is the disease CLAUDE.md names first: a comment promising two
 * numbers agree is not a mechanism.
 *
 * Only `three` is imported here, deliberately — this must be safe for the
 * invariant suite to pull in, which rules out anything that reads the seed at
 * module load.
 *
 * ## Why headroom is raycast rather than read off a bounding box
 *
 * It used to be `box.min.y − ground`, and that was only ever right by
 * accident: the gate was a half-torus *crossbar* whose lowest point genuinely
 * was the lowest thing over the gateway, because the posts holding it up were
 * separate meshes. The authored arch is one asset whose piers come down to the
 * paving, so its box bottom is the floor and the same expression reports
 * **0.00 m of headroom under a gate you can walk through** — a check that was
 * measuring the wrong thing and would now have failed loudly for a correct
 * arch, having passed quietly for a broken one.
 *
 * So this asks the question a child asks: standing in the opening, how far up
 * is the nearest thing over my head? Rays go **down** from well above the arch
 * at points spread across the clear width, and the lowest thing any of them
 * hits is the answer. That cannot be fooled by where the piers reach, and it
 * still catches an arch hanging upside down — #480's own failure — because
 * such an arch puts geometry directly over the middle of the way in.
 *
 * ## "Up" is the planet's, not the world's
 *
 * The park is a cap of a 220 m sphere, and the gate stands 60 m out from its
 * centre, so the local up at the gate is **15.84 degrees** off world `+Y`
 * (measured, canonical seed). The arch is built standing on that local up, and
 * a ray fired along world `+Y` from the middle of the opening leans out of the
 * crossbar and out through the open air beside it: **0 of 13 rays hit any part
 * of the arch**, `lowestOverheadY` came back `Infinity`, and the
 * `headroom < TALLEST_CHILD_HEIGHT` clause underneath it could never fire.
 * Along the local up the same 13 rays all hit, at 3.55 m. That is the exact
 * disease CLAUDE.md names first — an assertion reporting success about
 * something it is not describing — and it is why the ray direction and the
 * spread of ray origins both come from {@link Geo} here rather than from a
 * world axis.
 */
import { Box3, Raycaster, Vector3, type Object3D, type Scene } from 'three';
import { Geo, PLANET_CENTRE_WORLD_Y } from '../src/world/geo/Geo.ts';

export interface GateArchMeasurement {
  /** World bounding box of the whole gate. */
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Where the arch's own origin sits — the middle of the gateway, on the ground. */
  readonly centreX: number;
  readonly centreZ: number;
  /** Where the piers stand, off the `park-gate-post-N` markers in the scene. */
  readonly posts: readonly { readonly x: number; readonly z: number }[];
  /**
   * **World Y of the lowest thing overhanging the opening** — absolute, not
   * relative to the arch.
   *
   * Deliberately not "headroom": the caller subtracts the height of the
   * **ground a child actually stands on**, which is the terrain here and the
   * road's own surface in the bus lane, and neither is knowable from this
   * module. An earlier version returned a height above the arch's own base and
   * was therefore blind to the whole arch being sunk — dropping it a metre
   * into the paving moved base and geometry together and the number never
   * budged. Proved by sinking it and watching the clause stay green.
   *
   * `Infinity` if nothing at all overhangs the gateway — a gate with no arch
   * on it, which a caller must treat as a failure rather than as generous
   * headroom.
   */
  readonly lowestOverheadY: number;
  /** Where that lowest overhead thing is, for a failure message with a place in it. */
  readonly lowestOverheadAt: { readonly x: number; readonly y: number; readonly z: number } | null;
  /**
   * **How much room a child has under the arch, in metres**, and the one owner
   * of that number.
   *
   * `Infinity` if nothing overhangs the gateway at all — a gate with no arch
   * on it, which a caller must treat as a failure rather than as generous
   * headroom.
   *
   * It used to be computed by each caller as `lowestOverheadY − groundY`, in
   * `test/procgen/parkFacts.ts` and again in `scripts/probe-gate-pool.mts` —
   * two definitions of one thing kept in step by hand, and **both** wrong on
   * the sphere, because a difference of world `y` is not a height anywhere but
   * the exact middle of the park. It is an altitude difference now: two radii
   * from the planet's centre, subtracted. The ground comes in through
   * `groundY` because only the caller knows whether a child is standing on the
   * terrain or on the road's own surface.
   */
  readonly headroom: number;
  /**
   * Which way the arch's **lettered face** looks, in world XZ — its local `+Z`
   * put through its world matrix, normalised.
   *
   * The one thing about this gate that no amount of measuring its *shape* can
   * answer. The asset is symmetric front-to-back in its bounding box (59.20 to
   * 60.80 about a gate at z = 60), so an arch installed 180 degrees out has an
   * identical box, identical piers, identical headroom, and reads LAND OF GOOD
   * PLACES to the fountain instead of to the child getting off the bus. This
   * is read off the built scene's transform because there is nowhere else it
   * could be read from.
   */
  readonly forwardX: number;
  readonly forwardZ: number;
}

/**
 * How far a world point is from the planet's centre. Altitudes here are
 * differences between two of these, which is what makes them heights.
 */
function radiusOf(x: number, y: number, z: number): number {
  return Math.hypot(x, y - PLANET_CENTRE_WORLD_Y, z);
}

/** How far apart the headroom rays are, across the opening. */
const HEADROOM_RAY_SPACING = 0.5;

/**
 * How far out from the middle the rays go, as a fraction of the gate's own
 * half-span.
 *
 * Not all the way to the ends: the piers *are* the ends, and a ray dropped on
 * one hits the top of a pier and reports its height as the headroom. 0.6 of
 * the half-span is comfortably inside the clear opening
 * (`GATE_ARCH_CLEAR_WIDTH` is 7.00 m of a 10.20 m span, so the piers begin at
 * 0.686) and comfortably wider than a child.
 */
const HEADROOM_RAY_REACH = 0.6;

/**
 * @param groundY the world height of the ground a child stands on, at an
 * `(x, z)` in the gateway. The terrain, for the park's own gate. Passed in
 * rather than imported so this module stays free of anything that reads the
 * seed at load — see the head of the file.
 */
export function measureGateArch(
  scene: Scene,
  groundY: (x: number, z: number) => number,
): GateArchMeasurement | null {
  scene.updateMatrixWorld(true);

  let arch: Object3D | null = null;
  const posts: { x: number; z: number }[] = [];
  const at = new Vector3();
  scene.traverse((object) => {
    if (object.name === 'park-gate-arch' && !arch) arch = object;
    if (/^park-gate-post-\d+$/.test(object.name)) {
      object.getWorldPosition(at);
      posts.push({ x: at.x, z: at.z });
    }
  });
  if (!arch) return null;
  const archNode: Object3D = arch;

  const box = new Box3().setFromObject(archNode);
  const centre = new Vector3();
  archNode.getWorldPosition(centre);

  // The axis the gate spans: its longer horizontal extent, taken from the
  // built mesh rather than from the gateway's design, so an arch turned out of
  // the gate plane takes this with it and is caught rather than accommodated.
  const spanX = box.max.x - box.min.x;
  const spanZ = box.max.z - box.min.z;
  const alongX = spanX >= spanZ;
  const half = Math.max(spanX, spanZ) / 2;

  // --- headroom -------------------------------------------------------------
  const raycaster = new Raycaster();
  // **The planet's up at the gate, not the world's.** See the module docblock:
  // world `+Y` is 15.84 degrees out here and every ray missed the arch.
  const up = Geo.fromWorld(centre.x, centre.y, centre.z).up(new Vector3());
  // The gate spans *across* the opening, and that span is tangent to the
  // planet at the gate — so the ray origins are spread along the arch's own
  // span axis projected into the tangent plane, never along a world axis.
  const spread = new Vector3(alongX ? 1 : 0, 0, alongX ? 0 : 1);
  spread.addScaledVector(up, -spread.dot(up)).normalize();
  const from = new Vector3();
  // **Upward, from a child's toes — not downward from the sky.** A ray going
  // down hits the *top* of the sign plank and reports the plank's own
  // thickness as extra headroom; worse, our toon materials are `FrontSide`, so
  // a downward ray cannot see an underside at all. Going up, the first thing
  // hit is exactly the surface a child would knock her hat on.
  const toes = 0.05;
  let lowestOverheadRadius = Infinity;
  let lowestOverheadY = Infinity;
  let lowestOverheadAt: { x: number; y: number; z: number } | null = null;

  const reach = half * HEADROOM_RAY_REACH;
  const steps = Math.max(1, Math.round(reach / HEADROOM_RAY_SPACING));
  for (let i = -steps; i <= steps; i += 1) {
    const t = (i / steps) * reach;
    from.copy(centre).addScaledVector(spread, t).addScaledVector(up, toes);
    raycaster.set(from, up);
    // `true` — the arch's parts are children of its root, and each one's
    // outline hull is a child of that.
    const hits = raycaster.intersectObject(archNode, true);
    if (hits.length === 0) continue;
    const hit = hits[0]!.point;
    // Lowest by **altitude off the planet**, not by world Y: two points across
    // a 6 m opening on a 220 m sphere differ in world Y by more than the
    // centimetres that separate one part of a crossbar from another, so a `y`
    // comparison here would pick the wrong point on a tilted gate.
    const radius = radiusOf(hit.x, hit.y, hit.z);
    if (radius < lowestOverheadRadius) {
      lowestOverheadRadius = radius;
      lowestOverheadY = hit.y;
      lowestOverheadAt = { x: hit.x, y: hit.y, z: hit.z };
    }
  }

  // **Headroom is an altitude difference, not a `y` difference.** The radius of
  // the lowest overhead point, less the radius of the ground a child stands on
  // in the middle of the opening. Against the *terrain*, never against the
  // arch's own base: an arch sunk into the paving takes its base down with it
  // and a base-relative number cannot see that. Proved by sinking it.
  const standingRadius = radiusOf(centre.x, groundY(centre.x, centre.z), centre.z);
  const headroom =
    lowestOverheadRadius < Infinity ? lowestOverheadRadius - standingRadius : Infinity;

  const forward = new Vector3(0, 0, 1).transformDirection(archNode.matrixWorld);
  const flat = Math.hypot(forward.x, forward.z);

  return {
    headroom,
    forwardX: flat > 1e-6 ? forward.x / flat : 0,
    forwardZ: flat > 1e-6 ? forward.z / flat : 0,
    minX: box.min.x,
    maxX: box.max.x,
    minY: box.min.y,
    maxY: box.max.y,
    minZ: box.min.z,
    maxZ: box.max.z,
    centreX: centre.x,
    centreZ: centre.z,
    posts,
    lowestOverheadY,
    lowestOverheadAt,
  };
}
