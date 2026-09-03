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
 */
import { Box3, Raycaster, Vector3, type Object3D, type Scene } from 'three';

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
   * Air under the lowest thing over the opening, in metres above the arch's
   * own base. `Infinity` if nothing at all overhangs the gateway — which is a
   * gate with no arch on it, and a caller should treat it as a failure rather
   * than as generous headroom.
   */
  readonly headroom: number;
  /** Where that lowest overhead thing is, for a failure message with a place in it. */
  readonly lowestOverheadAt: { readonly x: number; readonly z: number } | null;
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

export function measureGateArch(scene: Scene): GateArchMeasurement | null {
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
  const up = new Vector3(0, 1, 0);
  const from = new Vector3();
  // **Upward, from a child's toes — not downward from the sky.** A ray going
  // down hits the *top* of the sign plank and reports the plank's own
  // thickness as extra headroom; worse, our toon materials are `FrontSide`, so
  // a downward ray cannot see an underside at all. Going up, the first thing
  // hit is exactly the surface a child would knock her hat on.
  const toes = 0.05;
  let headroom = Infinity;
  let lowestOverheadAt: { x: number; z: number } | null = null;

  const reach = half * HEADROOM_RAY_REACH;
  const steps = Math.max(1, Math.round(reach / HEADROOM_RAY_SPACING));
  for (let i = -steps; i <= steps; i += 1) {
    const t = (i / steps) * reach;
    const x = alongX ? centre.x + t : centre.x;
    const z = alongX ? centre.z : centre.z + t;
    from.set(x, centre.y + toes, z);
    raycaster.set(from, up);
    // `true` — the arch's parts are children of its root, and each one's
    // outline hull is a child of that.
    const hits = raycaster.intersectObject(archNode, true);
    if (hits.length === 0) continue;
    const y = hits[0]!.point.y - centre.y;
    if (y < headroom) {
      headroom = y;
      lowestOverheadAt = { x, z };
    }
  }

  return {
    minX: box.min.x,
    maxX: box.max.x,
    minY: box.min.y,
    maxY: box.max.y,
    minZ: box.min.z,
    maxZ: box.max.z,
    centreX: centre.x,
    centreZ: centre.z,
    posts,
    headroom,
    lowestOverheadAt,
  };
}
