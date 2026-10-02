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
 * The budget is tightened through the same seam (two road unwinds, then one
 * decision-zero redraw) so the test costs a few layouts rather than the
 * default's worst case; `parkSolveBounded.test.ts` proves the defaults bound
 * the same shape of failure without a park. Seed 12 restart 0, given
 * explicitly, so no acceptance loop runs.
 */
process.env['LGP_SEED'] = '12';
process.env['LGP_PARK_RESTART'] = '0';
// Through a variable, as the other tests reach Node-only scripts (`test/node-env.d.ts`).
const HEADLESS_CANVAS = '../scripts/headless-canvas.mjs';
await import(/* @vite-ignore */ HEADLESS_CANVAS);
const { setParkPlanSeams, solveParkPlanNow, parkSolveStats, parkSolveTrace } = await import('../src/world/parkPlan');
const { ParkSolveExhausted } = await import('../src/boot/parkSolve');

/** Unwinds the road may cause before its next refusal goes to decision zero. */
const ROAD_UNWINDS = 2;
/** Decision-zero redraws the road may then cause before the attempt fails. */
const ROAD_ESCALATIONS = 1;

describe('the plan solve, with no duck bar ever finding trestle room', () => {
  it('ends as a failed attempt within its budget, the road having spent its unwinds', () => {
    setParkPlanSeams({
      barSlotWithNoSupportRoom: () => 7,
      budget: { unwindsPerFeature: ROAD_UNWINDS, decisionZeroPerFeature: ROAD_ESCALATIONS },
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
    expect(stats?.exhausted).toMatch(/^decision-zero-per-feature: road still refuses/);
    // The road refused, unwound exactly its budget, and was escalated by it.
    expect(trace.some((line) => line.startsWith('refused road#0') && line.includes('consumed=railRaceBars'))).toBe(true);
    expect(stats?.unwindsByFeature['road']).toBe(ROAD_UNWINDS);
    expect(trace.some((line) => line.includes(`DECISION-ZERO (budget: road spent its ${ROAD_UNWINDS} unwinds)`))).toBe(true);
    expect(stats?.escalationsByFeature['road']).toBe(ROAD_ESCALATIONS);
  });
});
