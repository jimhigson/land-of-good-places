/**
 * The park gate's three #480 clauses, on one seed, in one process — so a shell
 * loop can put every seed in `PARK_SEED_POOL` through them:
 *
 * ```
 * for s in $(node -e '...PARK_SEED_POOL...'); do
 *   LGP_SEED=$s node --import ./scripts/ts-extension-resolver-register.mjs scripts/probe-gate-pool.mts
 * done
 * ```
 *
 * The suite's own seed files are the canonical seed plus four *sweep* seeds,
 * and a sweep seed is not a park a child can be given — seed 18 is one, and
 * its boundary spline runs across the front of the fixed gate, shutting the
 * opening but for a 1 m slot. The sixteen pool seeds are the ones that have to
 * be good, so this is how they get asked directly.
 *
 * Exits non-zero if any clause fails, and prints the numbers either way.
 *
 * ## What each clause covers, so two scripts cannot quote different answers
 *
 * Clauses 1, 3 and 4 (feet on the posts, posts solid, headroom) are this
 * script's own and are about the **arch**. Clause 2 is about the **opening**,
 * and it does not have its own opinion: it calls `measureGatewayWalk`, the
 * same full-width flood fill `scripts/check-gateway.mts` and
 * `theWalkInFromTheGateIsWalkable` use.
 *
 * That delegation is deliberate and recent. Clause 2 used to sample five
 * points at `t ∈ ±0.4` of the arch's half-span (4.58 m) at the single depth of
 * 1.5 m — **a 3.66 m band across a 7.5 m clear width**, at one depth out of
 * the walk's whole length. Every off-centre obstruction dropped straight out
 * of it, so this script found **one** failing park where a full-width sweep
 * found **four**, and nothing in either file said why. A narrower copy of a
 * question another file already owns is worse than no copy: it disagrees, and
 * the disagreement looks like a finding.
 */
import { Box3, Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import {
  GATE_FOOT_TOLERANCE,
  GATE_POST_PROBE_INSET,
  GATE_POST_REACH,
} from '../src/world/entrance/gateArch.ts';
import { measureGatewayWalk } from '../src/world/entrance/gatewayWalk.ts';
import { TALLEST_CHILD_HEIGHT } from '../src/art/models/kid.ts';
import { terrainHeight } from '../src/world/terrain.ts';

const seed = process.env.LGP_SEED ?? '(default)';
const park = quietly(() => buildHeadlessPark());
park.scene.updateMatrixWorld(true);

let arch: import('three').Object3D | null = null;
const posts: { x: number; z: number }[] = [];
const at = new Vector3();
park.scene.traverse((object) => {
  if (object.name === 'park-gate-arch') arch = object;
  if (/^park-gate-post-\d+$/.test(object.name)) {
    object.getWorldPosition(at);
    posts.push({ x: at.x, z: at.z });
  }
});

const fouls: string[] = [];
if (!arch || posts.length !== 2) {
  fouls.push(`seed ${seed}: no gate to measure (arch ${arch ? 'found' : 'missing'}, ${posts.length} posts)`);
} else {
  const box = new Box3().setFromObject(arch);
  const centre = new Vector3();
  (arch as import('three').Object3D).getWorldPosition(centre);
  const alongX = box.max.x - box.min.x >= box.max.z - box.min.z;
  const half = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  const along = (t: number): [number, number] =>
    alongX ? [centre.x + t * half, centre.z] : [centre.x, centre.z + t * half];

  const probe = new Vector3();
  const standable = (x: number, z: number): boolean => {
    probe.set(x, 0, z);
    park.world.collision.resolve(probe, PLAYER_RADIUS);
    return Math.hypot(probe.x - x, probe.z - z) < 1e-3;
  };

  const toMiddle = Math.hypot(centre.x, centre.z);
  const inward: [number, number] = toMiddle > 1e-6 ? [-centre.x / toMiddle, -centre.z / toMiddle] : [0, 0];

  // 1. Feet on the posts.
  for (const t of [-1, 1] as const) {
    const [x, z] = along(t);
    const nearest = Math.min(...posts.map((post) => Math.hypot(x - post.x, z - post.z)));
    if (nearest > GATE_FOOT_TOLERANCE) fouls.push(`seed ${seed}: arch end (${x.toFixed(2)}, ${z.toFixed(2)}) is ${nearest.toFixed(2)} m off its post`);
  }
  // 2. A child can actually walk in — asked of `measureGatewayWalk`, which is
  // the one owner of that question (`src/world/entrance/gatewayWalk.ts`).
  //
  // **This clause used to measure the opening itself, and measured under half
  // of it.** It sampled five points at `t ∈ ±0.4` of the arch's own half-span
  // (4.58 m) at a single depth of 1.5 m: a 3.66 m band across a 7.5 m clear
  // width, so anything obstructing off-centre — which is where a boundary
  // spline crosses, and where the park stands its lamp and its welcome sign —
  // simply fell outside the probe. That is why this script reported **one**
  // failing park where a full-width sweep reports **four**, and why two
  // branches could quote different numbers at each other with nothing in
  // either file explaining the difference.
  //
  // It is no longer a narrower copy of that question: #485 landed
  // `measureGatewayWalk`, a flood fill across the full opening at every depth,
  // and `scripts/check-gateway.mts` already runs it over all sixteen pool
  // seeds. Asking it here makes the two agree by construction.
  const walk = measureGatewayWalk(standable);
  if (!walk.open) {
    fouls.push(
      `seed ${seed}: the walk in stops ${walk.reachedDepth.toFixed(1)} m inside the arch ` +
        `(${walk.standableCells} of ${walk.cells} cells have room for a child)\n${walk.map.join('\n')}`,
    );
  }
  // 3. ...and solid at the posts, 1.0 m inside (the control).
  for (const post of posts) {
    const px = post.x + inward[0] * GATE_POST_PROBE_INSET.solid;
    const pz = post.z + inward[1] * GATE_POST_PROBE_INSET.solid;
    if (standable(px, pz)) fouls.push(`seed ${seed}: post at (${post.x.toFixed(2)}, ${post.z.toFixed(2)}) is not solid`);
  }
  // 4. Headroom.
  const headroom = box.min.y - terrainHeight(centre.x, centre.z);
  if (headroom < TALLEST_CHILD_HEIGHT) {
    fouls.push(`seed ${seed}: only ${headroom.toFixed(2)} m of headroom under the arch`);
  }
  console.log(
    `seed ${String(seed).padStart(8)}: arch spans ${(half * 2).toFixed(2)} m along ${alongX ? 'X' : 'Z'}, ` +
      `headroom ${headroom.toFixed(2)} m (needs ${TALLEST_CHILD_HEIGHT}), posts solid within ` +
      `${GATE_POST_REACH.toFixed(2)} m — ${fouls.length === 0 ? 'PASS' : 'FAIL'}`,
  );
}

for (const foul of fouls) console.error(foul);
process.exit(fouls.length === 0 ? 0 : 1);
