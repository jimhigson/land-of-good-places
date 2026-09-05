/**
 * **How much does the kerb's inner edge move across the width of the spur?**
 *
 * The open coplanar seam (`entrance-road-gateway|entrance-road-kerb`, 5.2 m²) is
 * a straight spur edge meeting a curved kerb: across the spur's own width the
 * kerb's inner edge spans metres of `z`, so a straight join can only overlap it
 * or leave grass. That measurement was taken at the spur's old **road** width
 * (7.78 m). Jim has since asked for the spur to be an ordinary park path, which
 * is roughly 3.2 m across — so the question has to be asked again at the width
 * the spur will actually be.
 *
 * Also reports the **sagitta**: how far the kerb's own inner-edge polyline
 * departs from the straight chord between its two ends over that span. That is
 * the error a spur built as a plain straight-edged ribbon would carry, and it is
 * the number that decides whether the exact ring-following construction is
 * needed or is gold plating.
 */
import './headless-canvas.mjs';

const { buildHeadlessPark } = await import('./park-harness.mts');
const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { entranceRoadStations, entranceRoadInnerEdge, entranceRoadExtent } = await import(
  '../src/world/entrance/roadRoute.ts'
);
const { ENTRANCE_GATE_X } = await import('../src/world/entrance/layout.ts');

buildHeadlessPark();

/** Inner-edge point for every station, in station order. */
const stations = entranceRoadStations();
const { from, to } = entranceRoadExtent();
void from;
void to;
const ring = stations.map((s) => entranceRoadInnerEdge(s.at));

function report(halfWidth: number): void {
  const span = ring.filter((p) => Math.abs(p.x - ENTRANCE_GATE_X) <= halfWidth);
  if (span.length < 2) {
    console.log(`  half ${halfWidth.toFixed(2)}: only ${span.length} ring points in span`);
    return;
  }
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of span) {
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  // Sagitta of the polyline against the chord between its first and last point.
  const a = span[0]!;
  const b = span[span.length - 1]!;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  let sagitta = 0;
  for (const p of span) {
    const cross = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / len;
    if (cross > sagitta) sagitta = cross;
  }
  console.log(
    `  half ${halfWidth.toFixed(2)}: ${String(span.length).padStart(3)} ring pts, ` +
      `z ${minZ.toFixed(2)}..${maxZ.toFixed(2)} spread ${(maxZ - minZ).toFixed(3)} m, ` +
      `sagitta ${sagitta.toFixed(4)} m`,
  );
}

console.log(`seed ${PARK_SEED}  (${ring.length} stations)`);
report(3.89); // ROAD_HALF_WIDTH — the spur as it is drawn today
report(1.6); // a park path's own half width
