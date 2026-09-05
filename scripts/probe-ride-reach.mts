/**
 * **How far out does the Rail Race reach, at the heights the cat bus occupies?**
 * (#488)
 *
 * Jim, 3 September 2026: *"Ride supports on arrival road - move the arrival road
 * a few meters further out to avoid them. It doesn't have to hug the park edge."*
 *
 * That lifts the ceiling the road's outset was pinned under, and turns the
 * question into a measurement: the road's inner kerb has to clear whatever of
 * the ride stands in the bus's own height band, so **the number to find is the
 * outermost outset any part of a trestle reaches below the bus's roof.**
 *
 * Not the trunk alone. A trestle forks twice on its way to the four lanes and
 * the fork sits at the trunk's top, so the branches spread *outward* through
 * exactly that band — which is why this measures all three trestle meshes and
 * reports where each kind of part reaches furthest.
 *
 * ```
 * LGP_SEED=11 node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/probe-ride-reach.mts
 * ```
 */
import './headless-canvas.mjs';
import { InstancedMesh, Matrix4, Vector3 } from 'three';

const { buildHeadlessPark } = await import('./park-harness.mts');
const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { CAT_BUS_BODY_BOTTOM_Y, CAT_BUS_BODY_TOP_Y } = await import(
  '../src/world/entrance/catBus.ts'
);
const { ROAD_HALF_WIDTH } = await import('../src/world/entrance/road.ts');
const { entranceRoadOutsetAt, entranceRoadAt, entranceRoadExtent } = await import(
  '../src/world/entrance/roadRoute.ts'
);
const { terrainHeight } = await import('../src/world/terrain.ts');

const park = buildHeadlessPark();

/**
 * Only the stretch the road actually runs past matters. A trestle on the far
 * side of the park reaches just as far out and the bus never goes near it, so
 * taking a maximum over the whole ring would report a number about nothing.
 */
const stations: { x: number; z: number }[] = [];
{
  const { from, to } = entranceRoadExtent();
  for (let at = from; at <= to; at += 1) stations.push(entranceRoadAt(at));
}
const nearTheRoad = (x: number, z: number): boolean =>
  stations.some((station) => Math.hypot(x - station.x, z - station.z) < 30);

const TRESTLE_MESHES = [
  'railRace:trestle-legs',
  'railRace:trestle-branches-lower',
  'railRace:trestle-branches-upper',
];

const worst = new Map<string, { outset: number; up: number; x: number; z: number }>();
const matrix = new Matrix4();
const centre = new Vector3();
const axis = new Vector3();
park.scene.traverse((object) => {
  const mesh = object as InstancedMesh;
  if (!mesh.isInstancedMesh || !TRESTLE_MESHES.includes(mesh.name)) return;
  const parameters = (mesh.geometry as unknown as {
    parameters?: { radiusTop: number; radiusBottom: number };
  }).parameters;
  if (!parameters) return;
  const { radiusTop, radiusBottom } = parameters;
  const part = mesh.name.replace('railRace:trestle-', '');
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    centre.setFromMatrixPosition(matrix);
    axis.setFromMatrixColumn(matrix, 1);
    const length = axis.length() || 1;
    axis.divideScalar(length);
    const across = new Vector3().setFromMatrixColumn(matrix, 0).length();
    const footX = centre.x - axis.x * (length / 2);
    const footZ = centre.z - axis.z * (length / 2);
    const footY = centre.y - axis.y * (length / 2);
    for (let along = 0; along <= length; along += 0.1) {
      const x = footX + axis.x * along;
      const z = footZ + axis.z * along;
      const up = footY + axis.y * along - terrainHeight(x, z);
      if (up < CAT_BUS_BODY_BOTTOM_Y || up > CAT_BUS_BODY_TOP_Y) continue;
      if (!nearTheRoad(x, z)) continue;
      const t = along / length;
      // The part's own surface, not its centre line — the road has to clear the
      // wood, not the axis through it.
      const outset =
        entranceRoadOutsetAt(x, z) + (radiusBottom + (radiusTop - radiusBottom) * t) * across;
      const seen = worst.get(part);
      if (!seen || outset > seen.outset) worst.set(part, { outset, up, x, z });
    }
  }
});

process.stdout.write(
  `seed ${PARK_SEED}: bus body occupies ${CAT_BUS_BODY_BOTTOM_Y.toFixed(2)}..${CAT_BUS_BODY_TOP_Y.toFixed(2)} m\n`,
);
let overall = 0;
for (const part of TRESTLE_MESHES.map((name) => name.replace('railRace:trestle-', ''))) {
  const seen = worst.get(part);
  if (!seen) {
    process.stdout.write(`  ${part.padEnd(16)} nothing in the bus's height band near the road\n`);
    continue;
  }
  overall = Math.max(overall, seen.outset);
  process.stdout.write(
    `  ${part.padEnd(16)} reaches outset ${seen.outset.toFixed(2)} m at ${seen.up.toFixed(2)} m up\n`,
  );
}
process.stdout.write(
  `  => the ride reaches outset ${overall.toFixed(2)} in the bus's band, so a road ` +
    `centred at ${(overall + ROAD_HALF_WIDTH).toFixed(2)} + margin has its inner kerb clear\n`,
);
