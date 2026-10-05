import { beforeAll, describe, expect, it } from 'vitest';

/**
 * **The Rail Race's plan refuses where it used to accept a failure, and its
 * world-phase builder refuses where it used to throw.** Each was a generator
 * quietly keeping a result it had just found wrong — the arch on the booth's
 * bearing with nowhere clear, the exit at its nearest unclear try — or a
 * refusal by the road turned into a crash. These hold each answer to the
 * refusal, on a real planned park (seed 12, restart 3: given explicitly, so no
 * acceptance loop runs).
 *
 * Seed 12 restart 3, not seed 15 restart 0: only the plan is solved here, and
 * seed 15 restart 0's plan redraws its layout 34 times on the way (~540 s,
 * over the 240 s hook timeout), while seed 12 restart 3's redraws it once
 * (~20 s). Every clause below asks only a solved plan — its booth, its rings,
 * its road — so any seed whose plan solves exercises the same code; this is
 * just the cheapest one measured (fix/sb-rrtest).
 */
// Seed 10 restart 0 since #708's band fix: the shipped park with the fastest
// plan (11.5 s on CI). Pinned parks go stale when the park changes — see
// `railRaceRoadBounded.test.ts` for how to re-pick one.
process.env['LGP_SEED'] = '10';
process.env['LGP_PARK_RESTART'] = '0';
// Through a variable, as the other tests reach Node-only scripts, so the test
// project's typecheck does not follow it (`test/node-env.d.ts`).
const HEADLESS_CANVAS = '../scripts/headless-canvas.mjs';
await import(/* @vite-ignore */ HEADLESS_CANVAS);
// The park is solved here, in tooling: the solver lives in procgen/ (#705).
await import('../procgen/install.ts');
const { solveParkPlanNow } = await import('../src/world/parkPlan');
const { archStation, planExit } = await import('../procgen/world/railRace/plan');
const { RAIL_RACE_PLAN } = await import('../src/world/railRace/plan');
const { barSlotWithNoSupportRoom, TrestleRefusal } = await import('../procgen/world/railRace/trestleSearch');
const { HAZARD_LAYOUT } = await import('../src/world/railRace/simulate');
const { entranceRoadClaims } = await import('../src/world/entrance/roadCorridor');
const { railRaceBuilder } = await import('../procgen/world/worldPhaseSolver');
const { GroundClaims } = await import('../src/boot/groundClaims');

beforeAll(() => {
  solveParkPlanNow();
});

describe('the finish arch', () => {
  it('stands at a clear station on the planned park (the control)', () => {
    expect(archStation('stall.railRacer', [], 0).at).not.toBeNull();
  });

  it('refuses — no station, naming who refused — when nothing on the ring is clear', () => {
    const everywhere = { x: 0, z: 0, radius: 1e5, owner: 'cruiser' };
    const arch = archStation('stall.railRacer', [everywhere], 0);
    expect(arch.at).toBeNull();
    expect(arch.decidedBy).toEqual(['layout', 'cruiser']);
  });
});

describe('the exit', () => {
  it('finds a clear spot on the planned park (the control)', () => {
    expect('exitX' in planExit()).toBe(true);
  });

  it('refuses when no spot round the booth is clear, instead of handing back an unclear one', () => {
    const exit = planExit(() => true);
    expect('refused' in exit).toBe(true);
  });
});

describe('trestle room for every duck bar', () => {
  it('is there on both rings of the planned park, the walk-past one against the real road', () => {
    const road = entranceRoadClaims().filter((claim) => claim.kind === 'corridor');
    expect(barSlotWithNoSupportRoom(RAIL_RACE_PLAN.walkPastRing, HAZARD_LAYOUT, road)).toBeNull();
    expect(barSlotWithNoSupportRoom(RAIL_RACE_PLAN.raceRing, HAZARD_LAYOUT, [])).toBeNull();
  });
});

describe("the world phase's rail race builder", () => {
  it('refuses a support refused by the road alone, naming the road, rather than throwing', () => {
    const builder = railRaceBuilder(
      null as never,
      new GroundClaims(),
      () => {},
      () => {
        throw new TrestleRefusal(['road'], [], 'no support can stand for the duck bar at slot 7');
      },
    );
    const step = builder.advance(0).next();
    expect(step.done).toBe(true);
    expect(step.value).toMatchObject({ refused: true, blockers: ['road'] });
  });

  it('still throws what is not a refusal', () => {
    const builder = railRaceBuilder(null as never, new GroundClaims(), () => {}, () => {
      throw new TypeError('a bug');
    });
    expect(() => builder.advance(0).next()).toThrow(TypeError);
  });
});
