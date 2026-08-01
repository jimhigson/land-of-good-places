/**
 * Measures each rail ride's horizontal turning radius, and reports them in the
 * order the family asked for: **Sky Cruiser tightest, then Rail Race, then the
 * train**.
 *
 * That ordering has been stated for a while and asserted nowhere, so nobody
 * knows whether the park has ever actually had it. This prints the facts.
 *
 * Turning radius is measured on the **built curve**, by Menger curvature over
 * three points at a fixed arc spacing — never inferred from whatever radius a
 * generator was aiming for. A route's plan is a claim; the curve the riders
 * are on is the fact, and for the train and the old coaster the two were never
 * the same thing (both smooth their control points after placing them).
 *
 * Reports only. It asserts nothing and fails nothing: the family's ordering is
 * a preference, and turning a preference into a build-breaking assert is how
 * you end up weakening it later to make a seed pass.
 */
import { Vector3 } from 'three';

/** Arc spacing between the three points curvature is measured from. */
const SPACING = 2.5;

interface Sampler {
  readonly length: number;
  pointAt(distance: number, target: Vector3): Vector3;
}

/**
 * Radius of the circle through three points, in the horizontal plane.
 * Infinity where they are collinear.
 */
function mengerRadius(a: Vector3, b: Vector3, c: Vector3): number {
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  if (area < 1e-9) return Infinity;
  return (ab * bc * ca) / (4 * area);
}

function measure(sampler: Sampler, closed: boolean): { min: number; at: number } {
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let min = Infinity;
  let at = 0;
  const from = closed ? 0 : SPACING;
  const to = closed ? sampler.length : sampler.length - SPACING;
  for (let d = from; d < to; d += 1) {
    sampler.pointAt(closed ? d - SPACING : d - SPACING, a);
    sampler.pointAt(d, b);
    sampler.pointAt(closed ? d + SPACING : d + SPACING, c);
    const radius = mengerRadius(a, b, c);
    if (radius < min) {
      min = radius;
      at = d;
    }
  }
  return { min, at };
}

const rows: { name: string; radius: number; at: number; length: number; note: string }[] = [];

const { COASTER_PLANS } = await import('../src/world/coaster/plan.ts');
const cruiser = COASTER_PLANS.cruiser.route;
const cruiserMeasured = measure(cruiser, true);
rows.push({
  name: 'Sky Cruiser',
  radius: cruiserMeasured.min,
  at: cruiserMeasured.at,
  length: cruiser.length,
  note: 'solved by the rail generator',
});

const { RAIL_RACE_PLAN } = await import('../src/world/railRace/plan.ts');
const { PLAYER_LANE } = await import('../src/world/railRace/route.ts');
const raceRoute = RAIL_RACE_PLAN.route;
// The Rail Race is four lanes, so its sampler takes a lane before a distance.
// Measured on the lane the player rides — the outermost, and so the widest
// turn of the four.
const race: Sampler = {
  length: raceRoute.length,
  pointAt: (distance, target) => raceRoute.pointAt(PLAYER_LANE, distance, target),
};
const raceMeasured = measure(race, true);
rows.push({
  name: 'Rail Race',
  radius: raceMeasured.min,
  at: raceMeasured.at,
  length: raceRoute.length,
  note: 'a circle by family ruling; radius is constant',
});

const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const train = TRAIN_PLAN.route;
const trainMeasured = measure(train, true);
rows.push({
  name: 'train',
  radius: trainMeasured.min,
  at: trainMeasured.at,
  length: train.length,
  note: 'solved by its own route solver, unchanged',
});

console.log('measure:rail-radii — tightest horizontal turn on each built curve\n');
for (const row of rows) {
  console.log(
    `  ${row.name.padEnd(12)} min radius ${row.radius.toFixed(1).padStart(6)} m ` +
      `at ${row.at.toFixed(0).padStart(4)} m along  (loop ${row.length.toFixed(0)} m) — ${row.note}`,
  );
}

const cruiserRadius = rows[0]?.radius ?? 0;
const raceRadius = rows[1]?.radius ?? 0;
const trainRadius = rows[2]?.radius ?? 0;
const ordered = cruiserRadius < raceRadius && raceRadius < trainRadius;
console.log(
  `\n  family ordering (Sky Cruiser < Rail Race < train): ${ordered ? 'holds' : 'does NOT hold'}`,
);
if (!ordered) {
  console.log(
    '  Reported, not enforced. Fixing the train or the Rail Race to match is a\n' +
      '  separate question for the family, not something to bend a ride into.',
  );
}
