import { Vector3 } from 'three';
const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const { GARDEN_PLAY_BOUNDARY } = await import('../src/world/boundary.ts');
const { clearOfPlots } = await import('../src/world/parkLayout.ts');
const { STATION_GAP, CROSSING_STATION_STRUCTURE_CLEARANCE } = await import('../src/world/train/clearance.ts');
const { DECK_HALF_LENGTH } = await import('../src/world/train/bridgeFootprint.ts');
const { SITE_BOUNDARY_MARGIN, SITE_PLOT_MARGIN } = await import('../src/world/train/bridgeFit.ts');
const { chosenCrossingCorridor, stationCrossingConflict, crossingSurvivesStationAt } =
  await import('../src/world/train/crossingKeepOut.ts');
const { STATION_SEEDS, STATION_SEED_RADIUS } = await import('../src/world/train/stationSeeds.ts');

const r = TRAIN_PLAN.route;
console.log(`seed ${PARK_SEED}: length ${r.length.toFixed(1)}  report ${JSON.stringify({
  idx: r.solveReport.startPoseIndex, restarts: r.solveReport.restarts,
  satisfyRejects: r.solveReport.satisfyRejects, satisfied: r.solveReport.satisfied })}`);

const centre = r.pointAt(0, new Vector3());
const tangent = r.tangentAt(0, new Vector3());
const corridor = chosenCrossingCorridor(centre, tangent);
const flat = (d: number) => r.flatPointAt(d, { x: 0, z: 0 });

for (const s of TRAIN_PLAN.stations) {
  const c = stationCrossingConflict(s.distance, r.length, corridor, flat);
  console.log(`station ${s.name} d=${s.distance.toFixed(1)} conflict alongLoop=${c.alongLoop} inSpace=${c.inSpace}`);
}
for (const seed of STATION_SEEDS) {
  const target = r.distanceNear(seed.bearingX * STATION_SEED_RADIUS, seed.bearingZ * STATION_SEED_RADIUS);
  const ok = crossingSurvivesStationAt(target, r.length, corridor, flat);
  console.log(`seed ${seed.name}: target d=${target.toFixed(1)} window has a clear candidate: ${ok}`);
}

// Which gate blocks the deck at d=0?
const stationWindowPoints: [number, number][] = [];
const p = new Vector3();
for (const st of TRAIN_PLAN.stations)
  for (let d = -STATION_GAP; d <= STATION_GAP; d += 2) {
    r.pointAt(r.wrap(st.distance + d), p);
    stationWindowPoints.push([p.x, p.z]);
  }
const nearStation = (x: number, z: number) =>
  stationWindowPoints.some(([px, pz]) => Math.hypot(x - px, z - pz) < CROSSING_STATION_STRUCTURE_CLEARANCE);

const dirX = tangent.z, dirZ = -tangent.x;
const acrossX = -dirZ, acrossZ = dirX;
let boundaryBad = 0, plotBad = 0, stationBad = 0, ok = 0;
for (const along of [0, DECK_HALF_LENGTH, -DECK_HALF_LENGTH])
  for (const t of [-1, -0.5, 0, 0.5, 1]) {
    const x = centre.x + dirX * along + acrossX * 5.0 * t;
    const z = centre.z + dirZ * along + acrossZ * 5.0 * t;
    if (GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z) < SITE_BOUNDARY_MARGIN) boundaryBad++;
    else if (!clearOfPlots(x, z, SITE_PLOT_MARGIN)) plotBad++;
    else if (nearStation(x, z)) stationBad++;
    else ok++;
  }
console.log(`deck samples at d=0: boundary ${boundaryBad}, plots ${plotBad}, station ${stationBad}, ok ${ok}`);
