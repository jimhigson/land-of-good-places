/**
 * Diagnostic: how far is each doormat from the drawn paving, and from the
 * paving that joins up with the gate's? `LGP_SEED=N [LGP_PARK_RESTART=r]`.
 * Prints one JSON line per destination.
 */
import './headless-canvas.mjs';
import { Mesh } from 'three';
import { ACCEPTED_RESTARTS } from '../src/world/acceptedRestarts.ts';
import { BUILDING_STEP_UP } from '../src/core/constants.ts';
import {
  cellOf,
  distanceToCell,
  floodPaving,
  isPaved,
  rasterisePaving,
} from '../test/procgen/pavingReach.ts';

const seed = Number(process.env['LGP_SEED'] ?? 0);
const restart = Number(process.env['LGP_PARK_RESTART'] ?? ACCEPTED_RESTARTS[seed] ?? 0);
const { buildParkFacts } = await import('../test/procgen/parkFacts.ts');
const facts = await buildParkFacts(seed, restart);

const meshes: Mesh[] = [];
facts.world.garden.group.traverse((o) => {
  if (o instanceof Mesh && (o.name === 'path-surface' || o.name === 'path-kerb')) meshes.push(o);
});
const raster = rasterisePaving(meshes);
const gate = facts.pathNodes.find((n) => n.kind === 'gate');
if (!gate) throw new Error('no gate node');
const gateCell = distanceToCell(raster, gate.x, gate.z, 5, (k) => isPaved(raster, k));
const startK = gateCell.at ? cellOf(raster, gateCell.at[0], gateCell.at[1]) : -1;
const flooded = floodPaving(raster, startK, BUILDING_STEP_UP);
let paved = 0;
let joined = 0;
for (let k = 0; k < flooded.length; k += 1) {
  if (isPaved(raster, k)) paved += 1;
  if (flooded[k] === 1) joined += 1;
}
console.log(JSON.stringify({ seed, restart, triangles: raster.triangles, paved, joined, gate: [gate.x, gate.z], gateGap: gateCell.distance }));

const destinations = [
  ...facts.entrances.map((e) => ({ id: e.id, x: e.x, z: e.z })),
  ...facts.exits.map((e) => ({ id: e.id, x: e.x, z: e.z })),
  ...facts.pathNodes.filter((n) => n.kind === 'station').map((n) => ({ id: n.id, x: n.x, z: n.z })),
];
for (const d of destinations) {
  const anyPaving = distanceToCell(raster, d.x, d.z, 25, (k) => isPaved(raster, k));
  const gatePaving = distanceToCell(raster, d.x, d.z, 25, (k) => flooded[k] === 1);
  console.log(
    JSON.stringify({
      id: d.id,
      at: [+d.x.toFixed(2), +d.z.toFixed(2)],
      toPaving: +anyPaving.distance.toFixed(2),
      toGatePaving: +gatePaving.distance.toFixed(2),
      nearestGatePaving: gatePaving.at?.map((v) => +v.toFixed(2)) ?? null,
    }),
  );
}
process.exit(0);
