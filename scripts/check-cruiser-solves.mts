/**
 * Does the Sky Cruiser's route solve, on this seed?
 *
 * The generator throws rather than returning something degenerate, and it
 * throws at **module load** — `coaster/plan.ts` solves the route before any
 * scene exists, so an unsolvable seed does not produce a bad park, it produces
 * a park that will not start. That is the right failure, but it means the
 * cheapest possible check is worth having: this builds nothing but the route,
 * so it answers in milliseconds where `check:park` takes seconds.
 *
 * Run with `LGP_SEED` set, or with no seed for the canonical park. Prints the
 * solver's own report — how many stations it had to choose from, how far it
 * backtracked, and what was rejecting pieces — because when this fails those
 * numbers are the whole diagnosis.
 */
const started = Date.now();

try {
  const { COASTER_PLANS } = await import('../src/world/coaster/plan.ts');
  const route = COASTER_PLANS.cruiser.route;
  const report = route.plan.report;
  console.log(
    `check:cruiser-solves: solved in ${Date.now() - started} ms — ` +
      `${route.length.toFixed(0)} m of track, ${report.segmentCount} pieces, ` +
      `tightest turn ${route.plan.minCurvature.toFixed(1)} m, ` +
      `station ${report.startPoseIndex + 1} of ${report.startPoseCount}, ` +
      `${report.backtracks} backtracks, ${report.candidatesTried} pieces tried, ` +
      `solver ${report.elapsedMs} ms`,
  );
} catch (error) {
  console.error(`check:cruiser-solves: FAILED — ${(error as Error).message}`);
  process.exitCode = 1;
}
