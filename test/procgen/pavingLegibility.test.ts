/**
 * **`pavingLegibility.ts` pinned on hand-built geometry.**
 *
 * That module is the one owner of both paving measures: the path graph asks
 * it at the point of decision (`paths.ts`, `parkPlan.ts`) and the invariants
 * ask it of the built park (`pathsRunOnGridAxes`, `streetsShareLatticeLines`).
 * One owner means a bug in it is invisible to both — the generator and its
 * judge would agree, wrongly. So this file asks it about ground whose answer
 * is known by construction: a few lattices that must pass and a few that must
 * fail, with each threshold straddled from both sides.
 *
 * No park is built. The ground is a 200 m disc round a plaza at the origin,
 * no plots, no railway unless a case puts one there.
 *
 * **The thresholds are written here as literals, on purpose** — 16 m of
 * diagonal, 0.9 m off a line, 8 m to be a street, 15 m of door approach.
 * Importing the module's constants would let a change to one move the test
 * with it, and the test would pin nothing. Changing a threshold is allowed;
 * it means changing this file too, knowingly.
 */
import { describe, it, expect } from 'vitest';
import type { DrawnEdge, GroundPoint } from '../../src/world/gridAxes.ts';
import {
  longDiagonals,
  offLatticeStreetRuns,
  type PavingGround,
} from '../../src/world/pavingLegibility.ts';

/** The lattice pitch the invariant passes (`streetsShareLatticeLines`). */
const PITCH = 12;

const ground = (overrides: Partial<PavingGround> = {}): PavingGround => ({
  plaza: { x: 0, z: 0 },
  plots: [],
  distanceToEdge: (x, z) => 200 - Math.hypot(x, z),
  railDistance: () => 1000,
  onBridge: () => false,
  nearBridgeStone: () => false,
  archFeet: [],
  ...overrides,
});

/** A polyline through `corners`, sampled every ~0.5 m as `drawnCentreLine` samples the built park. */
const polyline = (corners: readonly GroundPoint[]): GroundPoint[] => {
  const out: GroundPoint[] = [corners[0] as GroundPoint];
  for (let i = 1; i < corners.length; i += 1) {
    const a = corners[i - 1] as GroundPoint;
    const b = corners[i] as GroundPoint;
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
    for (let s = 1; s <= steps; s += 1) out.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
  }
  return out;
};

const edge = (name: string, corners: readonly GroundPoint[], backbone = false): DrawnEdge => ({
  name,
  backbone,
  halfWidth: 1.3,
  points: polyline(corners),
});

/** A straight diagonal of `length` metres at `degrees` off the +x axis, starting at (x, z). */
const ray = (name: string, x: number, z: number, length: number, degrees: number): DrawnEdge => {
  const r = (degrees * Math.PI) / 180;
  return edge(name, [
    [x, z],
    [x + length * Math.cos(r), z + length * Math.sin(r)],
  ]);
};

describe('longDiagonals (pathsRunOnGridAxes)', () => {
  it('passes a lattice of axis-aligned streets', () => {
    const lattice = [
      edge('a', [[-60, 24], [60, 24]]),
      edge('b', [[24, -60], [24, 60]]),
      edge('c', [[-36, -60], [-36, 12], [36, 12]]),
    ];
    expect(longDiagonals(lattice, ground())).toEqual([]);
  });

  it('passes a 14 m 45° approach (under the 16 m allowance)', () => {
    expect(longDiagonals([ray('short', 30, 30, 14, 45)], ground())).toEqual([]);
  });

  it('fails a 19 m 45° run, and reports its length', () => {
    const found = longDiagonals([ray('long', 30, 30, 19, 45)], ground());
    expect(found).toHaveLength(1);
    expect(found[0]?.carriers).toEqual(['long']);
    expect(found[0]?.extent).toBeGreaterThan(16);
    expect(found[0]?.extent).toBeLessThan(22);
  });

  it('calls a run 7° off axis on-axis, and one 12° off axis diagonal (the 15% hop rule)', () => {
    expect(longDiagonals([ray('near', 30, 30, 40, 7)], ground())).toEqual([]);
    expect(longDiagonals([ray('off', 30, 30, 40, 12)], ground())).toHaveLength(1);
  });

  it('exempts a long diagonal hugging the railway, and nothing a few metres further out', () => {
    const run = ray('fence-follow', 30, 30, 40, 45);
    // A railway running along the same diagonal, offset sideways by `offset` metres.
    const railAt = (offset: number) => (x: number, z: number) => Math.abs((z - 30 - (x - 30)) / Math.SQRT2 - offset);
    expect(longDiagonals([run], ground({ railDistance: railAt(6) }))).toEqual([]);
    expect(longDiagonals([run], ground({ railDistance: railAt(12) }))).toHaveLength(1);
  });

  it('does not exempt a hop with only one end in the rail corridor', () => {
    // One 21 m hop, drawn as a single segment, leaving a railway at x = 30:
    // its start is 1 m from the rail, its end 16 m. Railway geometry needs both.
    const leaving: DrawnEdge = { name: 'leaving', backbone: false, halfWidth: 1.3, points: [[31, 0], [46, 15]] };
    expect(longDiagonals([leaving], ground({ railDistance: (x) => Math.abs(x - 30) }))).toHaveLength(1);
  });

  it('exempts a long diagonal over a bridge footprint', () => {
    const run = ray('crossing', 30, 30, 40, 45);
    expect(longDiagonals([run], ground({ onBridge: () => true }))).toEqual([]);
  });

  it('exempts the backbone ring, which is a circle on purpose', () => {
    const corners: GroundPoint[] = [];
    for (let i = 0; i <= 64; i += 1) corners.push([18 * Math.cos((i / 64) * 2 * Math.PI), 18 * Math.sin((i / 64) * 2 * Math.PI)]);
    expect(longDiagonals([edge('ring', corners, true)], ground())).toEqual([]);
  });
});

describe('offLatticeStreetRuns (streetsShareLatticeLines)', () => {
  /** A north-south street at x = `x`, 60 m long, so no door-approach exemption reaches it. */
  const northSouth = (name: string, x: number): DrawnEdge => edge(name, [[x, -30], [x, 30]]);

  it('passes streets on the lattice lines through the plaza', () => {
    const lattice = [northSouth('ns', 24), edge('ew', [[-30, -36], [30, -36]])];
    expect(offLatticeStreetRuns(lattice, ground(), PITCH)).toEqual([]);
  });

  it('passes a street 0.7 m off a line (tolerance 0.9 m)', () => {
    expect(offLatticeStreetRuns([northSouth('ns', 24.7)], ground(), PITCH)).toEqual([]);
  });

  it('fails a street 1.2 m off a line, and one halfway between lines', () => {
    const near = offLatticeStreetRuns([northSouth('near', 25.2)], ground(), PITCH);
    expect(near.map((r) => r.edge)).toEqual(['near']);
    const half = offLatticeStreetRuns([northSouth('half', 30)], ground(), PITCH);
    expect(half).toHaveLength(1);
    expect(half[0]?.axis).toBe('z');
    expect(half[0]?.off).toBeCloseTo(6, 1);
    expect(half[0]?.length).toBeCloseTo(60, 0);
  });

  it('does not read a run 12° off axis as a street (the 15% hop rule)', () => {
    // 60 m from (28, -30), slanting 12° off north: its mean line would sit ~2 m
    // off x = 36 if it were counted, but no hop of it is on-axis.
    const r = (12 * Math.PI) / 180;
    const slant = edge('slant', [[28, -30], [28 + 60 * Math.sin(r), -30 + 60 * Math.cos(r)]]);
    expect(offLatticeStreetRuns([slant], ground(), PITCH)).toEqual([]);
  });

  it('fails an east-west street off its line', () => {
    const found = offLatticeStreetRuns([edge('ew', [[-30, 42], [30, 42]])], ground(), PITCH);
    expect(found.map((r) => [r.edge, r.axis])).toEqual([['ew', 'x']]);
  });

  it('excuses an off-line street when both neighbouring lines are blocked over its span', () => {
    // Plots standing on x = 24 and x = 36 over the whole span: the street at 30
    // threads ground the lattice cannot serve.
    const plots = [
      { x: 24, z: 0, halfX: 1, halfZ: 40 },
      { x: 36, z: 0, halfX: 1, halfZ: 40 },
    ];
    expect(offLatticeStreetRuns([northSouth('threads', 30)], ground({ plots }), PITCH)).toEqual([]);
    // One neighbour clear is enough to make the run a street that declined its line.
    expect(offLatticeStreetRuns([northSouth('declines', 30)], ground({ plots: [plots[0]!] }), PITCH)).toHaveLength(1);
  });

  it('ignores a 6.5 m run (under 8 m) and runs inside a door approach, and fails a 12 m one', () => {
    // A short off-line jog in the middle of an otherwise on-lattice street.
    const jog = 6.5;
    const short = edge('jog', [[24, -30], [24, -jog / 2], [30, -jog / 2], [30, jog / 2], [24, jog / 2], [24, 30]]);
    expect(offLatticeStreetRuns([short], ground(), PITCH)).toEqual([]);
    const long = edge('jog', [[24, -30], [24, -6], [30, -6], [30, 6], [24, 6], [24, 30]]);
    expect(offLatticeStreetRuns([long], ground(), PITCH).map((r) => r.edge)).toEqual(['jog']);
    // A whole edge no longer than the door reach is all approach.
    const stub = edge('stub', [[30, 0], [30, 14]]);
    expect(offLatticeStreetRuns([stub], ground(), PITCH)).toEqual([]);
  });

  it('never judges the backbone or the fountain approach', () => {
    const backbone = edge('ring', [[30, -30], [30, 30]], true);
    const fountain = edge('fountain-approach', [[30, -30], [30, 30]]);
    expect(offLatticeStreetRuns([backbone, fountain], ground(), PITCH, 0)).toEqual([]);
  });
});
