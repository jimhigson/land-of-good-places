/**
 * **How much daylight stands under the park's drawn wall runs?**
 *
 * This is the instrument behind the one claim in the wall revert that had none.
 * `scripts/wall-probe.mts` answers a *different* question — how far the terrain
 * wanders from the straight chord between a run's two ends — and the revert
 * also asserted "at most 0.6 cm of daylight under any run, measured along the
 * drawn underside of all 165". Nothing measured the drawn underside. A reviewer
 * caught it, and a number with no instrument behind it is the thing this
 * project keeps being bitten by, so here is the instrument.
 *
 * ## What it measures
 *
 * Both wall builders in `Scenery.ts` stand a `BoxGeometry(length, height,
 * depth)` on `base = min(terrainHeight(end1), terrainHeight(end2))` and then
 * `standOnSphere` it. So the drawn underside is the box's **bottom face centre
 * line**, and the honest question is its **altitude above the ground beneath
 * it** — `altitudeAt`, which is `|p| − groundRadius` under `p`, never a
 * difference of world `y`. Positive is daylight a child can see under; negative
 * is buried, which is invisible and still solid.
 *
 * The line is walked in the mesh's own local space and transformed by its world
 * matrix, so whatever `standOnSphere` did to it is included rather than
 * re-derived.
 *
 * ## What it does NOT cover, on every run
 *
 * The coping stones, collars and finials on top of a stone wall, and the wooden
 * maze's corner posts: none of them is the underside, and a post deliberately
 * reaches *below* its run's base. Only the wall bodies are measured, identified
 * by their box depth — 0.55 for stone, 0.28 for wood, which is how `Scenery.ts`
 * builds them. If either number changes there and not here, this probe goes to
 * zero walls and says so rather than reporting a triumphant 0 cm.
 *
 * Run: `node --import ./scripts/ts-extension-resolver-register.mjs scripts/wall-underside-probe.mts`
 */
import './headless-canvas.mjs';
import { Vector3, type Mesh, type Object3D } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { altitudeAt } from '../src/world/terrain.ts';

/** Box depths `Scenery.ts` gives a wall body: stone 0.55, wooden maze 0.28. */
const WALL_DEPTHS = [0.55, 0.28];
/** Samples along each run's underside. */
const SAMPLES = 41;

const park = buildHeadlessPark();
park.scene.updateMatrixWorld(true);

const declared = park.world.scenery.wallRuns.length;

type Row = { depth: number; length: number; worstDaylight: number; worstBuried: number; at: Vector3 };
const rows: Row[] = [];
const local = new Vector3();

for (const groupName of ['stone-walls', 'wooden-walls']) {
  const group = park.scene.getObjectByName(groupName);
  if (!group) {
    console.log(`  NO GROUP '${groupName}' — this probe measured nothing for it`);
    continue;
  }
  group.traverse((o: Object3D) => {
    const mesh = o as Mesh & { isInstancedMesh?: boolean };
    if (!mesh.isMesh || mesh.isInstancedMesh) return;
    const p = (mesh.geometry as unknown as { parameters?: Record<string, number> }).parameters;
    if (!p || typeof p.width !== 'number' || typeof p.height !== 'number') return;
    if (!WALL_DEPTHS.some((d) => Math.abs((p.depth ?? -1) - d) < 1e-6)) return;
    const halfLength = p.width / 2;
    const bottom = -p.height / 2;
    let worstDaylight = -Infinity;
    let worstBuried = Infinity;
    const at = new Vector3();
    for (let i = 0; i < SAMPLES; i += 1) {
      const t = i / (SAMPLES - 1);
      local.set(-halfLength + t * p.width, bottom, 0);
      const world = mesh.localToWorld(local.clone());
      const a = altitudeAt(world.x, world.y, world.z);
      if (a > worstDaylight) {
        worstDaylight = a;
        at.copy(world);
      }
      worstBuried = Math.min(worstBuried, a);
    }
    rows.push({ depth: p.depth ?? 0, length: p.width, worstDaylight, worstBuried, at });
  });
}

if (rows.length === 0) {
  console.log(
    'MEASURED NOTHING: no mesh under `stone-walls`/`wooden-walls` had a box depth this probe ' +
      `recognises (${WALL_DEPTHS.join(', ')}). Scenery.ts has changed and this probe is stale — ` +
      'it is NOT reporting that the walls sit tight to the ground.',
  );
  process.exit(1);
}

rows.sort((a, b) => b.worstDaylight - a.worstDaylight);
const worst = rows[0]!;
const deepest = rows.reduce((a, b) => (b.worstBuried < a.worstBuried ? b : a));

console.log(
  `${rows.length} drawn wall bodies measured, of ${declared} runs the scenery publishes ` +
    `(the difference, if any, is runs whose body this probe did not recognise)`,
);
console.log(`${SAMPLES} samples along each underside, altitude above the ground beneath each point\n`);
for (const r of rows.slice(0, 8)) {
  console.log(
    `  ${r.length.toFixed(1).padStart(5)} m long, ${r.depth.toFixed(2)} deep   ` +
      `worst daylight ${(r.worstDaylight * 100).toFixed(2).padStart(7)} cm   ` +
      `deepest burial ${(-r.worstBuried * 100).toFixed(1).padStart(6)} cm`,
  );
}
console.log(
  `\nworst daylight anywhere: ${(worst.worstDaylight * 100).toFixed(2)} cm, under a ` +
    `${worst.length.toFixed(1)} m run at (${worst.at.x.toFixed(1)}, ${worst.at.z.toFixed(1)})`,
);
console.log(
  `runs showing more than 5 cm of daylight: ${rows.filter((r) => r.worstDaylight > 0.05).length} of ${rows.length}`,
);
console.log(
  `deepest any underside is buried: ${(-deepest.worstBuried * 100).toFixed(1)} cm — burial is ` +
    'invisible and still solid, so it is the safe direction for this datum to err in',
);
