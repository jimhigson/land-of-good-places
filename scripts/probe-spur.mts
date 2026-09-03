/**
 * **What does the gateway spur actually meet?**
 *
 * Jim, 3 September 2026: *"the small run of path from the road into the park
 * should be just a normal path"*. Before drawing it as one, measure the gap it
 * has to cover and the paving at the far end of it — the spur's width wants an
 * owner, and the honest candidate is the path it joins.
 *
 * ```
 * LGP_SEED=<n> node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/probe-spur.mts
 * ```
 */
import './headless-canvas.mjs';

const { buildHeadlessPark } = await import('./park-harness.mts');
const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { entranceRoadInnerEdge } = await import('../src/world/entrance/roadRoute.ts');
const { ENTRANCE_GATE_X, ENTRANCE_GATE_Z, ENTRANCE_STOP_Z } = await import(
  '../src/world/entrance/layout.ts'
);
const { forEachPavedDisc } = await import('../src/world/paving.ts');

buildHeadlessPark();

const start = entranceRoadInnerEdge(0);
console.log(`seed ${PARK_SEED}`);
console.log(`gate            x ${ENTRANCE_GATE_X.toFixed(2)} z ${ENTRANCE_GATE_Z.toFixed(2)}`);
console.log(`spur starts at  x ${start.x.toFixed(2)} z ${start.z.toFixed(2)}`);

// Walk in from the kerb's inner edge exactly as `spurReach()` does, and report
// the first disc that covers the axis, with its radius.
let reachZ: number | null = null;
let reachRadius: number | null = null;
let reachAt: { x: number; z: number } | null = null;
for (let z = start.z; z >= ENTRANCE_STOP_Z; z -= 0.05) {
  let bestRadius: number | null = null;
  let bestAt: { x: number; z: number } | null = null;
  forEachPavedDisc((x, discZ, radius) => {
    if (Math.hypot(ENTRANCE_GATE_X - x, z - discZ) < radius) {
      if (bestRadius === null || radius < bestRadius) {
        bestRadius = radius;
        bestAt = { x, z: discZ };
      }
    }
  });
  if (bestRadius !== null) {
    reachZ = z;
    reachRadius = bestRadius;
    reachAt = bestAt;
    break;
  }
}

if (reachZ === null) {
  console.log(`no paving between the kerb and z ${ENTRANCE_STOP_Z.toFixed(2)}`);
} else {
  const at = reachAt as unknown as { x: number; z: number };
  console.log(
    `paving reaches z ${reachZ.toFixed(2)} — run ${(start.z - reachZ).toFixed(2)} m, ` +
      `narrowest disc there r ${(reachRadius as unknown as number).toFixed(2)} ` +
      `(centre ${at.x.toFixed(2)}, ${at.z.toFixed(2)})`,
  );
}

// Every disc within 12 m of the gate, so the shape of what is nearby is visible
// rather than inferred from the single hit above.
const near: { x: number; z: number; r: number; d: number }[] = [];
forEachPavedDisc((x, z, radius) => {
  const d = Math.hypot(x - ENTRANCE_GATE_X, z - ENTRANCE_GATE_Z);
  if (d < 12) near.push({ x, z, r: radius, d });
});
near.sort((a, b) => a.d - b.d);
console.log(`discs within 12 m of the gate: ${near.length}`);
for (const disc of near.slice(0, 12)) {
  console.log(
    `   d ${disc.d.toFixed(2).padStart(6)}  r ${disc.r.toFixed(2).padStart(5)}  at ${disc.x.toFixed(2).padStart(7)}, ${disc.z.toFixed(2).padStart(7)}`,
  );
}
const radii = new Set(near.map((d) => d.r.toFixed(2)));
console.log(`radii present near the gate: ${[...radii].join(', ')}`);
