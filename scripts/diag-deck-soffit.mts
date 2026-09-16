/**
 * **Does the road over a bridge pass above the soffit standing over the track?**
 *
 * This is `theDrawnPathRidesOverEveryBridge`'s clause 3, re-stated as a
 * measurement instead of an assertion, plus the two things the assertion
 * cannot print: how the `deck` **marker**'s soffit compares with the **drawn**
 * arch soffit at the same plan point, and how far the crossing leans.
 *
 * The clause reads the marker through `new Box3().setFromObject(deck).min.y`,
 * which is a single world `y` — the marker is a `BoxGeometry` carrying a yaw
 * about world `+Y` and nothing else, so it is a plate lying flat in world `y`.
 * Everything else a bridge builds now leans with the planet. That is the
 * disagreement this prints.
 *
 * **Controls, and the run is void without them.** Printed first:
 *
 * 1. the innermost crossing on the seed must show a lean near zero and the
 *    marker and the drawn soffit must agree there — the park's centre is where
 *    every height conversion in this file is obliged to give the same answer,
 *    and an instrument that cannot show that is measuring something else;
 * 2. the marker's own AABB must be `BRIDGE_DECK_SLAB` tall. If it is taller,
 *    the marker has been leaned and `min.y` is the low corner of a tilted
 *    plate rather than its underside — the reading every clearance invariant
 *    in the repo takes would then be silently wrong (see the leaned-marker
 *    dead end on PR #628).
 */
import './headless-canvas.mjs';
import { Box3, Raycaster, Vector3 } from 'three';
import { buildParkFacts } from '../test/procgen/parkFacts.ts';
import { TRACK_CLEARANCE } from '../src/world/train/route.ts';
import { BRIDGE_DECK_SLAB } from '../src/world/train/clearance.ts';
import { GROUND_SPHERE_RADIUS } from '../src/core/constants.ts';

const seed = Number(process.env.LGP_SEED ?? 20260728);
const facts = await buildParkFacts(seed);
const bridges = facts.world.train.bridges;
const route = facts.world.train.route;

/** How far a plan point leans: the world-`y` fall per metre of plan run. */
const leanAt = (x: number, z: number): number => {
  const r = Math.hypot(x, z);
  return Math.tan(Math.asin(Math.min(1, r / GROUND_SPHERE_RADIUS)));
};

let controlsOk = true;
const crossings = [...facts.world.train.crossings].sort(
  (a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z),
);
process.stderr.write(`\n=== controls, seed ${seed} ===\n`);
if (crossings.length === 0) {
  process.stderr.write('  no crossings on this seed — this run asserts nothing\n');
} else {
  const inner = crossings[0]!;
  process.stderr.write(
    `  control 1: innermost crossing r=${Math.hypot(inner.x, inner.z).toFixed(1)} m, ` +
      `lean ${leanAt(inner.x, inner.z).toFixed(3)}\n`,
  );
}

const rows: string[] = [];
for (const crossing of crossings) {
  const name = `bridge-${crossing.railDistance.toFixed(1)}`;
  const deckMesh = facts.world.train.group.getObjectByName(name)?.getObjectByName('deck');
  const bridge = bridges.find((b) => b.deckCovers(crossing.x, crossing.z));
  if (!deckMesh || !bridge) continue;
  const box = new Box3().setFromObject(deckMesh);
  const markerHeight = box.max.y - box.min.y;
  if (Math.abs(markerHeight - BRIDGE_DECK_SLAB) > 1e-6) {
    controlsOk = false;
    process.stderr.write(
      `  control 2 FAILED on ${name}: marker AABB is ${markerHeight.toFixed(3)} m tall, ` +
        `not the ${BRIDGE_DECK_SLAB.toFixed(3)} m slab — it has been leaned, and every ` +
        'clearance invariant reading min.y off it is measuring a corner, not a soffit\n',
    );
  }
  const soffit = box.min.y;

  // Clause 3's own question: the worst drawn-path vertex within the train's
  // swept half-width of the rail centreline.
  let worstDrop = 0;
  let worstAt: [number, number] = [0, 0];
  let worstY = 0;
  let judged = 0;
  const railPoint = { x: 0, z: 0 };
  facts.world.garden.group.traverse((object) => {
    const mesh = object as unknown as { isMesh?: boolean; name: string; geometry?: any };
    if (!mesh.isMesh) return;
    if (mesh.name !== 'path-surface' && mesh.name !== 'path-kerb') return;
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      if (bridge.pavingHeightAt(x, z) === null) continue;
      route.flatPointAt(route.distanceNear(x, z), railPoint);
      if (Math.hypot(x - railPoint.x, z - railPoint.z) > TRACK_CLEARANCE) continue;
      judged += 1;
      const drop = position.getY(i) - soffit;
      if (drop < worstDrop) {
        worstDrop = drop;
        worstAt = [x, z];
        worstY = position.getY(i);
      }
    }
  });

  // **The decisive comparison.** At the very plan point the clause complains
  // about, how high is the *drawn* stone the train would actually hit? Cast
  // straight down onto the bridge group from above the road, ignoring the
  // marker by name exactly as every other raycast in this repo does, and take
  // the lowest drawn surface in that column below the road.
  let drawnSoffit: number | null = null;
  let overhead = '';
  if (worstDrop < 0) {
    const group = facts.world.train.group.getObjectByName(name);
    if (group) {
      const caster = new Raycaster(
        new Vector3(worstAt[0], worstY - 40, worstAt[1]),
        new Vector3(0, 1, 0),
      );
      caster.far = 80;
      const hit = caster
        .intersectObject(group, true)
        .find((c) => c.object.name !== 'deck');
      if (hit) drawnSoffit = hit.point.y;
      // And the question the clause is actually asking: is this vertex INSIDE
      // a tunnel — is there drawn bridge stone standing over it?
      const above = new Raycaster(
        new Vector3(worstAt[0], worstY + 0.02, worstAt[1]),
        new Vector3(0, 1, 0),
      );
      above.far = 40;
      const over = above
        .intersectObject(group, true)
        .find((c) => c.object.name !== 'deck');
      overhead = over ? `${over.object.name} at ${over.point.y.toFixed(3)} (${(over.point.y - worstY).toFixed(3)} m over the road)` : 'NOTHING — open sky, so this vertex is on top of the bridge, not in its tunnel';
    }
  }

  const r = Math.hypot(crossing.x, crossing.z);
  rows.push(
    `${name.padEnd(14)} (${crossing.x.toFixed(1)}, ${crossing.z.toFixed(1)})`.padEnd(38) +
      `r=${r.toFixed(0).padStart(4)} m  lean ${leanAt(crossing.x, crossing.z).toFixed(3)}  ` +
      `marker soffit ${soffit.toFixed(3).padStart(9)}  ` +
      (judged === 0
        ? 'ASSERTS NOTHING — no path vertex judged'
        : worstDrop < 0
          ? `WORST ${worstDrop.toFixed(3)} m BELOW at (${worstAt[0].toFixed(1)}, ${worstAt[1].toFixed(1)}), ${judged} judged`
          : `passes (${judged} judged)`) +
      (drawnSoffit === null
        ? ''
        : `\n${' '.repeat(38)}   ...but the DRAWN stone in that column is at ${drawnSoffit.toFixed(3)}, ` +
          `so the road clears the stone by ${(worstY - drawnSoffit).toFixed(3)} m` +
          `\n${' '.repeat(38)}   overhead: ${overhead}`),
  );
}

process.stderr.write(controlsOk ? '  control 2: every marker AABB is one slab thick\n' : '');
console.log(`\n=== seed ${seed} — road vs the marker soffit over the track ===`);
for (const row of rows) console.log(row);
if (!controlsOk) {
  console.log('\n!! CONTROLS FAILED — every number above is void');
  process.exit(2);
}
process.exit(rows.some((r) => r.includes('BELOW')) ? 1 : 0);
