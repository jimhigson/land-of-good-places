/**
 * **Does the rail race's ring run off the edge of the ground sphere?**
 *
 * `capHeight` is `sqrt(max(0, R² - r²)) - R`. The `max(0, ...)` means that at a
 * horizontal radius of `R` or more it returns `-R` — the planet's south pole —
 * for every point, however far out. Anything placed beyond that radius is not
 * merely leaning steeply: it has fallen off the chart, and every height, every
 * up and every lean derived from it is the same wrong answer.
 *
 * Control first: `capHeight` is printed at three known radii before anything is
 * asserted about the ring, so a reader can see the cliff and the clamp for
 * themselves rather than taking the conclusion on trust.
 */
import './headless-canvas.mjs';
import { GROUND_SPHERE_RADIUS } from '../src/core/constants.ts';
import { capHeight } from '../src/world/terrain.ts';
import { PARK_BOUNDARY } from '../src/world/boundary.ts';
import { RAIL_RACE_PLAN } from '../src/world/railRace/plan.ts';
import { LANE_COUNT } from '../src/world/railRace/route.ts';

const say = (s: string) => process.stderr.write(s + '\n');
const R = GROUND_SPHERE_RADIUS;

say(`control    the ground sphere has radius ${R} m`);
for (const r of [0, R / 2, R * 0.9, R * 0.99, R, R * 1.05]) {
  const h = capHeight(r, 0);
  const slope = r >= R ? Infinity : r / Math.sqrt(R * R - r * r);
  say(
    `control    at ${r.toFixed(1)} m out the cap is ${h.toFixed(2)} m and falls ` +
      `${Number.isFinite(slope) ? slope.toFixed(2) : 'vertically'} m per metre` +
      (r >= R ? '  <- clamped: every radius past here reads the same -220' : ''),
  );
}

const measure = (name: string, radii: number[]) => {
  const lo = Math.min(...radii);
  const hi = Math.max(...radii);
  const past = radii.filter((r) => r >= R).length;
  say('');
  say(`${name.padEnd(22)} radius ${lo.toFixed(1)} .. ${hi.toFixed(1)} m  (${((hi / R) * 100).toFixed(1)}% of the sphere)`);
  say(`${''.padEnd(22)} ${past} of ${radii.length} samples are AT OR PAST the sphere's radius`);
  const steepest = Math.max(
    ...radii.map((r) => (r >= R ? Infinity : r / Math.sqrt(R * R - r * r))),
  );
  say(`${''.padEnd(22)} steepest ground under it: ${Number.isFinite(steepest) ? steepest.toFixed(2) + ' m per metre' : 'off the chart'}`);
};

const SAMPLES = 720;
measure(
  'park boundary',
  PARK_BOUNDARY.outline().map(([x, z]) => Math.hypot(x, z)),
);

for (const [name, ring] of [
  ['race ring', RAIL_RACE_PLAN.raceRing],
  ['walk-past ring', RAIL_RACE_PLAN.walkPastRing],
] as const) {
  const radii: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const s = (i / SAMPLES) * ring.path.length;
    const sample = ring.path.sampleAt(s);
    // Every lane, because the outermost is the one that leaves the planet first.
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const offset = ring.laneOffsets[lane] ?? 0;
      radii.push(
        Math.hypot(sample.x + sample.normalX * offset, sample.z + sample.normalZ * offset),
      );
    }
  }
  measure(name, radii);
}
