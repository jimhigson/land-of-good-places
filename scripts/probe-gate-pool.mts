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
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { measureGateArch } from './gate-arch-measure.mts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import { GATE_POST_COLLIDER_RADIUS } from '../src/world/entrance/gateArch.ts';
import { GATE_ARCH_CLEAR_WIDTH } from '../src/art/models/gateArch.ts';
import { TALLEST_CHILD_HEIGHT } from '../src/art/models/kid.ts';
import { terrainHeight } from '../src/world/terrain.ts';

const seed = process.env.LGP_SEED ?? '(default)';
const park = quietly(() => buildHeadlessPark());

const gate = measureGateArch(park.scene);

const fouls: string[] = [];
if (!gate || gate.posts.length !== 2) {
  fouls.push(
    `seed ${seed}: no gate to measure (arch ${gate ? 'found' : 'missing'}, ${gate?.posts.length ?? 0} posts)`,
  );
} else {
  const { posts, centreX, centreZ } = gate;
  const alongX = gate.maxX - gate.minX >= gate.maxZ - gate.minZ;
  const half = Math.max(gate.maxX - gate.minX, gate.maxZ - gate.minZ) / 2;
  const along = (t: number): [number, number] =>
    alongX ? [centreX + t * half, centreZ] : [centreX, centreZ + t * half];

  const probe = new Vector3();
  const standable = (x: number, z: number): boolean => {
    probe.set(x, 0, z);
    park.world.collision.resolve(probe, PLAYER_RADIUS);
    return Math.hypot(probe.x - x, probe.z - z) < 1e-3;
  };

  const toMiddle = Math.hypot(centreX, centreZ);
  const inward: [number, number] = toMiddle > 1e-6 ? [-centreX / toMiddle, -centreZ / toMiddle] : [0, 0];

  // 1. Each end of the arch comes down on a pier marker. The tolerance is the
  // pier's own keep-out radius plus a hand's width: the bounding box overshoots
  // the pier centre by exactly that radius, by construction.
  const footTolerance = GATE_POST_COLLIDER_RADIUS + 0.3;
  for (const t of [-1, 1] as const) {
    const [x, z] = along(t);
    const nearest = Math.min(...posts.map((post) => Math.hypot(x - post.x, z - post.z)));
    if (nearest > footTolerance) {
      fouls.push(
        `seed ${seed}: arch end (${x.toFixed(2)}, ${z.toFixed(2)}) is ${nearest.toFixed(2)} m off its pier ` +
          `(tolerance ${footTolerance.toFixed(2)} m)`,
      );
    }
  }
  // 2. Open in the middle, 1.5 m inside. Probed across the clear opening only —
  // not out to the piers, which are supposed to stop her.
  //
  // **`OPEN_PROBE_MARGIN` is not slack, it is the difference between a
  // question and a coin flip.** The widest a child's centre can be from the
  // middle is `GATE_ARCH_CLEAR_WIDTH / 2 - PLAYER_RADIUS` = 2.88 m, and at
  // exactly that offset she is *tangent* to the pier's collider: the overlap
  // is zero, so whether `resolve` moves her is decided by the last bit of a
  // float. Probing there gave 5 of 16 pool seeds "blocked", asymmetrically —
  // seeds 24 and 128 on the left, 326 and 451 on the right — which is exactly
  // what a coin flip looks like and nothing at all to do with the gate. Pull
  // in by a margin and the question becomes "is there room to walk", which is
  // the one worth asking.
  const OPEN_PROBE_MARGIN = 0.2;
  const openHalf = GATE_ARCH_CLEAR_WIDTH / 2 - PLAYER_RADIUS - OPEN_PROBE_MARGIN;
  for (const frac of [-1, -0.5, 0, 0.5, 1] as const) {
    const [x, z] = along((frac * openHalf) / half);
    const px = x + inward[0] * 1.5;
    const pz = z + inward[1] * 1.5;
    if (!standable(px, pz)) fouls.push(`seed ${seed}: gateway blocked at (${px.toFixed(2)}, ${pz.toFixed(2)})`);
  }
  // 3. ...and solid at the piers, 1.0 m inside (the control).
  for (const post of posts) {
    const px = post.x + inward[0];
    const pz = post.z + inward[1];
    if (standable(px, pz)) fouls.push(`seed ${seed}: pier at (${post.x.toFixed(2)}, ${post.z.toFixed(2)}) is not solid`);
  }
  // 4. Headroom, raycast up through the opening rather than read off the
  // bounding box — see `gate-arch-measure.mts` for why that distinction is the
  // whole of this clause.
  const headroom = gate.lowestOverheadY - terrainHeight(centreX, centreZ);
  if (!(gate.lowestOverheadY < Infinity)) {
    fouls.push(`seed ${seed}: nothing at all overhangs the gateway — there is no arch over the opening`);
  } else if (headroom < TALLEST_CHILD_HEIGHT) {
    fouls.push(`seed ${seed}: only ${headroom.toFixed(2)} m of headroom under the arch`);
  }
  console.log(
    `seed ${String(seed).padStart(8)}: arch spans ${(half * 2).toFixed(2)} m along ${alongX ? 'X' : 'Z'}, ` +
      `headroom ${headroom.toFixed(2)} m (needs ${TALLEST_CHILD_HEIGHT}), ` +
      `${GATE_ARCH_CLEAR_WIDTH.toFixed(2)} m clear opening, piers solid within ` +
      `${(PLAYER_RADIUS + GATE_POST_COLLIDER_RADIUS).toFixed(2)} m — ${fouls.length === 0 ? 'PASS' : 'FAIL'}`,
  );
}

for (const foul of fouls) console.error(foul);
process.exit(fouls.length === 0 ? 0 : 1);
