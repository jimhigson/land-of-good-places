import { describe, expect, it } from 'vitest';

/**
 * **A road refusal nothing can answer ends the plan solve — red, named, and
 * soon — instead of hanging it.**
 *
 * The mutation: `barSlotWithNoSupportRoom` never finds room (it always names
 * slot 7), injected through `parkPlan.ts`'s test seam rather than by editing
 * `track.ts`. The road builder then refuses on every layout, naming
 * `railRaceBars`, and no redraw can answer it. Before the driver's budgets
 * that solve walked the product of every decision's supply: seed 15 restart 0
 * spent 480 s on 38 layout redraws and 18 identical road refusals and was
 * nowhere near an end (fix/sb-bounded handoff). This test is the red proof
 * `railRaceRefusals.test.ts` lacked: the same mutation, and the solve must
 * finish as a `ParkSolveExhausted` — a failed attempt the root loop restarts.
 *
 * The road's budget alone is tightened through the same seam — two unwinds,
 * then no decision-zero redraw — so the test costs one layout's refusals
 * (21 s measured) rather than the default's worst case; every other feature
 * keeps the defaults, so the organic redraws this park makes on its own are
 * untouched and the failure is the road's. With one escalation allowed the
 * same run redraws the layout for the road (`DECISION-ZERO (budget: road
 * spent its 2 unwinds)`), then nine more times organically before the road
 * refuses again and ends it: 128 s, measured, too dear for the suite; that
 * rung is proved without a park in `parkSolveBounded.test.ts`, which also
 * proves the defaults bound this shape of failure.
 *
 * Red, measured (fix/sb-bounded): this file with the budget replaced by the
 * old driver's semantics (no per-feature or decision-zero cap) was still
 * solving at 436 s, past vitest's 240 s timeout — which cannot interrupt a
 * synchronous solve, so it had to be killed by hand. With the budget: 21 s,
 * 43 turns, 3 road refusals. Seed 12 restart 3 (one
 * organic decision-zero redraw before the road is asked), given explicitly,
 * so no acceptance loop runs.
 */
process.env['LGP_SEED'] = '12';
process.env['LGP_PARK_RESTART'] = '3';
// Through a variable, as the other tests reach Node-only scripts (`test/node-env.d.ts`).
const HEADLESS_CANVAS = '../scripts/headless-canvas.mjs';
await import(/* @vite-ignore */ HEADLESS_CANVAS);
// The park is solved here, in tooling: the solver and its seams live in procgen/ (#705).
await import('../procgen/install.ts');
const { solveParkPlanNow } = await import('../src/world/parkPlan');
const { setParkPlanSeams, parkSolveStats, parkSolveTrace } = await import('../procgen/world/planSolver');
const { ParkSolveExhausted } = await import('../procgen/boot/parkSolve');

/** Unwinds the road may cause before its next refusal goes to decision zero. */
const ROAD_UNWINDS = 2;
/** Decision-zero redraws the road may then cause before the attempt fails. */
const ROAD_ESCALATIONS = 0;

describe('the plan solve, with no duck bar ever finding trestle room', () => {
  it('ends as a failed attempt within its budget, the road having spent its unwinds', () => {
    setParkPlanSeams({
      barSlotWithNoSupportRoom: () => 7,
      budget: { byFeature: { road: { unwindsPerFeature: ROAD_UNWINDS, decisionZeroPerFeature: ROAD_ESCALATIONS } } },
    });
    let thrown: unknown = null;
    try {
      solveParkPlanNow();
    } catch (error) {
      thrown = error;
    } finally {
      setParkPlanSeams(undefined);
    }
    const stats = parkSolveStats();
    const trace = parkSolveTrace();
    process.stderr.write(
      `railRaceRoadBounded: exhausted=${stats?.exhausted?.split(' — ')[0] ?? 'null'} turns=${stats?.turns} ` +
        `unwinds=${stats?.unwinds} decision-zero=${stats?.decisionZero} road-unwinds=${stats?.unwindsByFeature['road']} ` +
        `road-refusals=${trace.filter((line) => line.startsWith('refused road#')).length}\n`,
    );

    // Red, not hung and not a crash: the driver's own exhaustion, in the cause chain.
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).cause).toBeInstanceOf(ParkSolveExhausted);
    expect(stats?.exhausted).toMatch(
      new RegExp(`^decision-zero-per-feature: road still refuses after its ${ROAD_UNWINDS} unwinds and ${ROAD_ESCALATIONS} decision-zero redraws`),
    );
    // The road refused naming the bars, unwound them exactly its budget, and its next refusal ended the attempt.
    const roadRefusals = trace.filter((line) => line.startsWith('refused road#0') && line.includes('consumed=railRaceBars'));
    expect(roadRefusals.length).toBe(ROAD_UNWINDS + ROAD_ESCALATIONS + 1);
    expect(stats?.unwindsByFeature['road']).toBe(ROAD_UNWINDS);
    expect(trace.filter((line) => line.startsWith('unwind to railRaceBars#0') && line.includes('for road:')).length).toBe(ROAD_UNWINDS);
  });
});
