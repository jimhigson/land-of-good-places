// TEMPORARY measurement harness for issue #417. Not for commit.
import { describe, it, beforeAll, expect } from 'vitest';
import { buildParkFacts, pointToSegment, alongRun, type ParkFacts } from './parkFacts.ts';

const seed = Number(process.env.MEASURE_SEED ?? 20260728);

describe(`measure walls seed ${seed}`, () => {
  let facts: ParkFacts;
  beforeAll(async () => {
    facts = await buildParkFacts(seed);
  }, 300_000);

  it('measures', () => {
    const borderEdges = facts.pathEdges.filter((e) => !e.backbone);
    const allEdges = facts.pathEdges;
    const nearestPath = (p: readonly [number, number], edges: typeof allEdges): number => {
      let n = Infinity;
      for (const edge of edges) {
        for (let i = 1; i < edge.points.length; i += 1) {
          const d = pointToSegment(p, edge.points[i - 1]!, edge.points[i]!) - edge.halfWidth;
          if (d < n) n = d;
        }
      }
      return n;
    };
    const nearestPlot = (p: readonly [number, number]): number => {
      let n = Infinity;
      for (const plot of facts.plots) {
        const d = Math.hypot(p[0] - plot.x, p[1] - plot.z) - plot.boundingRadius;
        if (d < n) n = d;
      }
      return n;
    };

    const lines: string[] = [];
    let nearestOverall = Infinity;
    let furthestOverall = 0;
    let strandedCount = 0;
    const byKind: Record<string, number> = {};
    for (const wall of facts.walls) {
      byKind[wall.kind] = (byKind[wall.kind] ?? 0) + 1;
      let closestPath = Infinity;
      let furthestPath = 0;
      let furthestAnything = 0;
      for (const point of alongRun(wall.from, wall.to, 1)) {
        const dPathAll = nearestPath(point, allEdges);
        const dPathBorder = nearestPath(point, borderEdges);
        const dPlot = nearestPlot(point);
        closestPath = Math.min(closestPath, dPathAll);
        furthestPath = Math.max(furthestPath, dPathAll);
        furthestAnything = Math.max(furthestAnything, Math.min(dPathBorder, dPlot));
      }
      nearestOverall = Math.min(nearestOverall, closestPath);
      furthestOverall = Math.max(furthestOverall, furthestAnything);
      // "stranded": no point of the run comes within 4 m of any paved surface
      if (closestPath > 4) strandedCount += 1;
      lines.push(
        `  ${wall.kind.padEnd(5)} (${wall.from[0].toFixed(1)},${wall.from[1].toFixed(1)})->` +
          `(${wall.to[0].toFixed(1)},${wall.to[1].toFixed(1)}) ` +
          `closestPath=${closestPath.toFixed(2)} furthestPath=${furthestPath.toFixed(2)} ` +
          `furthestFromAnything=${furthestAnything.toFixed(2)}` +
          (closestPath > 4 ? '  <-- STRANDED' : ''),
      );
    }
    process.stderr.write(
      `\n=== SEED ${seed} === walls=${facts.walls.length} ` +
        `(${JSON.stringify(byKind)}) stranded(>4m from paving)=${strandedCount}\n` +
        `nearest any wall gets to paving = ${nearestOverall.toFixed(2)} m\n` +
        `furthest any wall point from path-or-plot = ${furthestOverall.toFixed(2)} m\n` +
        lines.join('\n') +
        '\n',
    );
    expect(facts.walls.length).toBeGreaterThan(0);
  });
});
