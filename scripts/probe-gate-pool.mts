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
 */
import { Box3, Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import {
  GATE_FOOT_TOLERANCE,
  GATE_POST_COLLIDER_RADIUS,
  GATE_PROBE_INSET,
} from '../src/world/entrance/gateArch.ts';
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
  // 2. Open in the middle, 1.5 m inside.
  for (const t of [-0.4, -0.2, 0, 0.2, 0.4] as const) {
    const [x, z] = along(t);
    const px = x + inward[0] * GATE_PROBE_INSET.open;
    const pz = z + inward[1] * GATE_PROBE_INSET.open;
    if (!standable(px, pz)) fouls.push(`seed ${seed}: gateway blocked at (${px.toFixed(2)}, ${pz.toFixed(2)})`);
  }
  // 3. ...and solid at the posts, 1.0 m inside (the control).
  for (const post of posts) {
    const px = post.x + inward[0] * GATE_PROBE_INSET.solid;
    const pz = post.z + inward[1] * GATE_PROBE_INSET.solid;
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
      `${(PLAYER_RADIUS + GATE_POST_COLLIDER_RADIUS).toFixed(2)} m — ${fouls.length === 0 ? 'PASS' : 'FAIL'}`,
  );
}

for (const foul of fouls) console.error(foul);
process.exit(fouls.length === 0 ? 0 : 1);
