/**
 * **`offAxisGround` gives one answer about one piece of painted ground,
 * whoever is carrying it.**
 *
 * Every fixture here is *real geometry*, copied verbatim out of a built park
 * and named with the seed and commit it was read off, because a red-run
 * transcript is a measurement and measurements go stale. Nothing in this file
 * builds a park: it drives the measurement directly, which is the only way to
 * hold the paving still and vary the carrier, and the only way to prove the
 * property rather than infer it from a seed that happens to pass.
 */
import { describe, it, expect } from 'vitest';
import { offAxisGround, type GroundPoint } from './gridAxes.ts';
import type { PathEdgeFact } from './parkFacts.ts';

/** No railway anywhere near these fixtures — the exemption is not what is under test. */
const noRailway = (): boolean => false;

const SPUR_HALF_WIDTH = 1.3;

const carrier = (name: string, points: readonly GroundPoint[]): PathEdgeFact => ({
  name,
  from: 'a',
  to: 'b',
  backbone: false,
  halfWidth: SPUR_HALF_WIDTH,
  points,
  paved: true,
});

/** Cut one polyline into `pieces` carriers, sharing a sample at each seam. */
const cutInto = (name: string, points: readonly GroundPoint[], pieces: number): PathEdgeFact[] => {
  const out: PathEdgeFact[] = [];
  const step = (points.length - 1) / pieces;
  for (let i = 0; i < pieces; i += 1) {
    const from = Math.round(i * step);
    const to = Math.round((i + 1) * step);
    out.push(carrier(`${name}#${i}`, points.slice(from, to + 1)));
  }
  return out;
};

/** ...or into two that overlap, the way a spur and a connector share a door lead. */
const cutOverlapping = (
  name: string,
  points: readonly GroundPoint[],
  overlap: number,
): PathEdgeFact[] => {
  const middle = Math.floor(points.length / 2);
  return [
    carrier(`${name}#head`, points.slice(0, middle + overlap)),
    carrier(`${name}#tail`, points.slice(Math.max(0, middle - overlap))),
  ];
};

const extents = (edges: readonly PathEdgeFact[]): string[] =>
  offAxisGround(edges, noRailway)
    .map((piece) => piece.extent.toFixed(2))
    .sort();

/**
 * **Seed 225, `origin/feat/grid-paths` @ `b8da4593`, at the `building` door.**
 *
 * `spur-building`'s last thirteen drawn samples, verbatim. It arrives along a
 * diagonal at off-axis fraction ~0.32, but the hop
 * `(37.86, 12.85) -> (38.35, 12.92)` measures **0.141** — a hair under the
 * 0.15 threshold — so a per-edge walk flushes the run there and calls this
 * lead two short approach runs, 1.32 m and 2.50 m.
 */
const SPUR_BUILDING_TAIL: GroundPoint[] = [
  [37.02, 15.4],
  [37.02, 14.89],
  [37.02, 14.39],
  [37.03, 13.88],
  [37.11, 13.4],
  [37.39, 13.0],
  [37.86, 12.85],
  [38.35, 12.92],
  [38.8, 13.06],
  [39.3, 13.23],
  [39.78, 13.39],
  [40.29, 13.57],
  [40.72, 13.71],
];

/**
 * **The same door, the same lead, the other carrier**, same park and same
 * commit: `connector-building-ballPit`'s drawn samples from the door to the
 * point where the railway exemption takes over (which is why this stops at
 * `(25.85, 7.06)` — beyond it the ribbon is running the railway's shape, and
 * that is a different, already-settled question).
 *
 * It retraces the lead at 0.317…0.325 with **no dip at all** and carries on
 * unbroken: one run of **15.89 m**, which is the number the shipped check
 * reported for this edge on this commit.
 */
const CONNECTOR_BUILDING_BALLPIT: GroundPoint[] = [
  [40.34, 13.58],
  [39.87, 13.43],
  [39.39, 13.27],
  [38.92, 13.11],
  [38.45, 12.95],
  [37.98, 12.78],
  [37.51, 12.61],
  [37.05, 12.43],
  [36.59, 12.24],
  [36.13, 12.05],
  [35.68, 11.84],
  [35.23, 11.64],
  [34.77, 11.43],
  [34.32, 11.22],
  [33.87, 11.01],
  [33.42, 10.8],
  [32.96, 10.6],
  [32.51, 10.39],
  [32.06, 10.18],
  [31.61, 9.97],
  [31.16, 9.76],
  [30.7, 9.55],
  [30.25, 9.34],
  [29.8, 9.13],
  [29.35, 8.93],
  [28.9, 8.72],
  [28.44, 8.51],
  [27.99, 8.31],
  [27.53, 8.1],
  [27.08, 7.89],
  [26.65, 7.65],
  [26.23, 7.38],
  [25.85, 7.06],
];

describe('one answer per piece of painted ground', () => {
  it('reads the seed 225 building-door lead as one diagonal, not as its carriers', () => {
    const ground = offAxisGround(
      [
        carrier('spur-building', SPUR_BUILDING_TAIL),
        carrier('connector-building-ballPit', CONNECTOR_BUILDING_BALLPIT),
      ],
      noRailway,
    );

    // The lead is one piece of ground, drawn by both ribbons. The spur's own
    // turn into the door — `(37.03, 13.88) -> (37.86, 12.85)`, 1.32 m — stays
    // separate and should: it runs 72 degrees across the lead and 1.45 m clear
    // of the connector's centre line, so it is a different bit of paving, not
    // the same one seen twice.
    expect(ground).toHaveLength(2);
    expect(ground[0]!.carriers).toEqual(['connector-building-ballPit', 'spur-building']);
    expect(ground[1]!.carriers).toEqual(['spur-building']);
    expect(ground[1]!.extent).toBeCloseTo(1.32, 1);

    // ...and it is genuinely long. The shipped per-edge check said 15.89 m of
    // it (the connector's view) or 2.50 m of it (the spur's), depending on
    // whom it asked; measured as ground it is 16.3 m and over the limit.
    expect(ground[0]!.extent).toBeGreaterThan(16);
    expect(ground[0]!.extent).toBeCloseTo(16.29, 1);
  });

  it('gives the same answer for every way that ground can be cut into carriers', () => {
    const asBuilt = extents([
      carrier('spur-building', SPUR_BUILDING_TAIL),
      carrier('connector-building-ballPit', CONNECTOR_BUILDING_BALLPIT),
    ]);

    // Not a handful of carvings that happen to occur in today's seed pool —
    // *every* carving of this paving, by construction. The merge rule is meant
    // to be cut-invariant, so a sampled agreement is the wrong claim to make
    // about it; these are the carvings themselves.
    let carvings = 0;
    const check = (how: string, edges: PathEdgeFact[]): void => {
      carvings += 1;
      expect(extents(edges), `re-cut as: ${how}`).toEqual(asBuilt);
    };

    // 1. Every single cut, at every sample of either ribbon.
    for (let at = 1; at < CONNECTOR_BUILDING_BALLPIT.length - 1; at += 1) {
      check(`connector split at sample ${at}`, [
        carrier('spur-building', SPUR_BUILDING_TAIL),
        carrier('connector#a', CONNECTOR_BUILDING_BALLPIT.slice(0, at + 1)),
        carrier('connector#b', CONNECTOR_BUILDING_BALLPIT.slice(at)),
      ]);
    }
    for (let at = 1; at < SPUR_BUILDING_TAIL.length - 1; at += 1) {
      check(`spur split at sample ${at}`, [
        carrier('spur#a', SPUR_BUILDING_TAIL.slice(0, at + 1)),
        carrier('spur#b', SPUR_BUILDING_TAIL.slice(at)),
        carrier('connector-building-ballPit', CONNECTOR_BUILDING_BALLPIT),
      ]);
    }

    // 2. Chopped into ever more carriers, both ribbons at once.
    for (let pieces = 1; pieces <= 8; pieces += 1) {
      check(`both ribbons in ${pieces}`, [
        ...cutInto('spur', SPUR_BUILDING_TAIL, Math.min(pieces, SPUR_BUILDING_TAIL.length - 1)),
        ...cutInto('connector', CONNECTOR_BUILDING_BALLPIT, pieces),
      ]);
    }

    // 3. Carriers that *overlap*, which is the real shape of the thing: a spur
    //    ending at a door and a connector leaving it share the lead's metres.
    for (let overlap = 0; overlap <= 6; overlap += 1) {
      check(`connector in two, overlapping by ${overlap} samples`, [
        carrier('spur-building', SPUR_BUILDING_TAIL),
        ...cutOverlapping('connector', CONNECTOR_BUILDING_BALLPIT, overlap),
      ]);
    }

    // 4. Ragged carvings no generator would produce, so that agreement cannot
    //    be an artefact of the tidy ones above. Deterministic, so a failure is
    //    reproducible.
    let rng = 20260903;
    const nextCut = (limit: number): number => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      return 1 + (rng % Math.max(1, limit - 1));
    };
    for (let trial = 0; trial < 200; trial += 1) {
      const edges: PathEdgeFact[] = [];
      for (const [name, points] of [
        ['spur', SPUR_BUILDING_TAIL],
        ['connector', CONNECTOR_BUILDING_BALLPIT],
      ] as const) {
        const cuts = new Set<number>();
        for (let n = nextCut(5); n > 0; n -= 1) cuts.add(nextCut(points.length - 1));
        const bounds = [0, ...[...cuts].sort((x, y) => x - y), points.length - 1];
        for (let i = 1; i < bounds.length; i += 1) {
          if (bounds[i]! <= bounds[i - 1]!) continue;
          edges.push(carrier(`${name}#${trial}.${i}`, points.slice(bounds[i - 1]!, bounds[i]! + 1)));
        }
      }
      check(`ragged carving ${trial}`, edges);
    }

    // An announcement nobody can hear is the same disease as a check that
    // cannot fail — vitest's default reporter hides console output from
    // passing tests, so this goes to stderr.
    process.stderr.write(
      `    gridAxes: one answer (${asBuilt.join(', ')} m) across ${carvings} carvings of the same paving\n`,
    );
  });

  it('does not inflate a lead by counting each carrier that retraces it', () => {
    // A 10 m diagonal, and a second ribbon drawn along it 0.4 m to one side —
    // the shape a connector leaving a door makes over a spur arriving at it.
    // Two carriers, ten metres of paving, and the answer is ten metres.
    const diagonal: GroundPoint[] = Array.from({ length: 21 }, (_, i) => [i * 0.35, i * 0.35]);
    const retrace: GroundPoint[] = diagonal.map(([x, z]) => [x + 0.3, z - 0.3] as GroundPoint).reverse();
    const ground = offAxisGround(
      [carrier('spur', diagonal), carrier('connector', retrace)],
      noRailway,
    );
    expect(ground).toHaveLength(1);
    expect(ground[0]!.extent).toBeLessThan(11);
    expect(ground[0]!.extent).toBeGreaterThan(9);
  });

  it('says nothing about paving that runs on the grid', () => {
    // 20 m east, a rounded corner, 20 m north — the ordinary shape of this
    // network. The corner is off-axis for about a metre and that is all.
    const grid: GroundPoint[] = [];
    for (let x = 0; x <= 20; x += 0.5) grid.push([x, 0]);
    grid.push([20.4, 0.1], [20.7, 0.4], [20.8, 0.8]);
    for (let z = 1; z <= 20; z += 0.5) grid.push([21, z]);
    for (const edges of [
      [carrier('street', grid)],
      cutInto('street', grid, 2),
      cutInto('street', grid, 7),
      cutOverlapping('street', grid, 4),
    ]) {
      const ground = offAxisGround(edges, noRailway);
      expect(Math.max(0, ...ground.map((piece) => piece.extent))).toBeLessThan(3);
    }
  });
});

/**
 * **Seed 24, `origin/main` @ `bd818210`, at the junction west of the hotel.**
 *
 * Verbatim samples of two *different* diagonals whose off-axis stretches stop
 * 0.49 m apart with on-axis paving between them: `spur-hotel` heads away at
 * `(0.18, 0.98)`, `connector-hotel-stall.skyCruiser` at `(-0.30, 0.95)`, and
 * the line joining their ends runs `(-0.95, -0.33)` — square across both.
 *
 * A continuation rule that asked only "do the ends nearly touch, and do they
 * run roughly the same way?" joined them, and reported 21.9 m of diagonal
 * whose two real arms are 12.3 m and 5.5 m. This is the fixture that keeps
 * the collinearity clause honest: **the fix must not buy observer-independence
 * by inventing failures.**
 */
const SEED24_SPUR_HOTEL: GroundPoint[] = [
  [-36.78, -8.55],
  [-36.87, -9.04],
  [-37.03, -9.51],
  [-37.23, -9.97],
  [-37.49, -10.39],
  [-37.78, -10.79],
  [-38.1, -11.17],
  [-38.43, -11.55],
  [-38.76, -11.92],
  [-39.09, -12.29],
  [-39.42, -12.66],
  [-39.75, -13.04],
  [-40.07, -13.41],
  [-40.4, -13.79],
  [-40.73, -14.16],
  [-41.06, -14.53],
  [-41.4, -14.9],
  [-41.74, -15.27],
  [-42.08, -15.63],
  [-42.42, -15.99],
  [-42.77, -16.34],
  [-43.12, -16.69],
  [-43.47, -17.05],
  [-43.83, -17.4],
  [-44.18, -17.75],
  [-44.53, -18.1],
];

const SEED24_CONNECTOR_OTHER_ARM: GroundPoint[] = [
  [-37.24, -8.71],
  [-37.39, -8.24],
  [-37.59, -7.79],
  [-37.8, -7.35],
  [-38.01, -6.91],
  [-38.22, -6.47],
  [-38.43, -6.02],
  [-38.64, -5.57],
  [-38.86, -5.13],
  [-39.08, -4.7],
];

/**
 * **Pins a known limitation rather than a desired behaviour.**
 *
 * Rule 1 of `samePaintedGround` — the two share a drawn sample — has no
 * direction clause, so it welds two stretches however sharply they meet. These
 * two arms are 9.90 m each, cross at a **right angle**, and share exactly one
 * sample at the origin; the module reports them as **one 14.00 m piece**, which
 * is the same shape the dogleg fixture below rejects, arriving through the
 * other rule.
 *
 * This asserts the number the shipped module actually produces, so that anyone
 * changing the merge rules has to come here and decide deliberately. **It is
 * not a claim that 14.00 m is right.** The right answer is two 9.90 m pieces.
 *
 * Why it is not simply fixed: rule 1 cannot take a collinearity clause, because
 * the spur into seed 225's building door turns 37 degrees between the hops
 * either side of a seam (`SPUR_BUILDING_TAIL`, samples 3-6 against 6-8). Any
 * angle test tight enough to reject this right angle also tears that genuine
 * stretch in two — and tearing a stretch according to where a carrier happened
 * to end it is the carrier-dependence this whole module exists to remove.
 *
 * Measured impact on the real pool, so the bound is known rather than feared:
 * nine stretch pairs across the sixteen seeds are welded by rule 1 where rule 2
 * would have refused, at angles from 17.0 to 83.6 degrees. Seven inflate the
 * piece by nothing (the shorter arm lies inside the longer one's span); the
 * worst inflation anywhere is 0.44 m, and the tightest a welded piece comes to
 * `MAX_DIAGONAL_APPROACH` is 3.64 m of headroom (seed 288, 12.36 m against 16).
 * No seed's verdict turns on it today.
 */
it('welds a right-angle junction through rule 1 — a known limitation, pinned', () => {
  // Two 9.90 m arms at 45 degrees to the world axes, so every hop is off-axis,
  // meeting at 90 degrees on the shared sample (0, 0).
  const SHARED: GroundPoint = [0, 0];
  const west: GroundPoint[] = [];
  const east: GroundPoint[] = [];
  for (let i = 14; i >= 1; i -= 1) west.push([-i * 0.5, -i * 0.5]);
  west.push(SHARED);
  east.push(SHARED);
  for (let i = 1; i <= 14; i += 1) east.push([i * 0.5, -i * 0.5]);

  const length = (points: readonly GroundPoint[]): number =>
    Math.hypot(
      points[points.length - 1]![0] - points[0]![0],
      points[points.length - 1]![1] - points[0]![1],
    );
  expect(length(west)).toBeCloseTo(9.9, 1);
  expect(length(east)).toBeCloseTo(9.9, 1);
  // They meet at a right angle, on a sample they genuinely share.
  expect(west[west.length - 1]).toBe(SHARED);
  expect(east[0]).toBe(SHARED);
  // ...and the arms really are perpendicular: (1,1)/sqrt2 against (1,-1)/sqrt2.
  expect(
    (west[1]![0] - west[0]![0]) * (east[1]![0] - east[0]![0]) +
      (west[1]![1] - west[0]![1]) * (east[1]![1] - east[0]![1]),
  ).toBeCloseTo(0, 9);

  const ground = offAxisGround([carrier('arm-west', west), carrier('arm-east', east)], noRailway);

  expect(ground).toHaveLength(1);
  expect(ground[0]!.extent).toBeCloseTo(14.0, 1);
  process.stderr.write(
    `    gridAxes: KNOWN LIMITATION — rule 1 welds a 90 degree junction; two 9.90 m arms ` +
      `report as one ${ground[0]!.extent.toFixed(2)} m piece. Pinned, not endorsed.\n`,
  );
});

it('does not weld two arms of a junction dogleg into one long diagonal', () => {
  const ground = offAxisGround(
    [
      carrier('spur-hotel', SEED24_SPUR_HOTEL),
      carrier('connector-hotel-stall.skyCruiser', SEED24_CONNECTOR_OTHER_ARM),
    ],
    noRailway,
  );
  expect(ground).toHaveLength(2);
  expect(Math.max(...ground.map((piece) => piece.extent))).toBeLessThan(13);
});
