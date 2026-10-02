import { beforeAll, describe, expect, it } from 'vitest';

/**
 * **The Rail Race's plan refuses where it used to accept a failure, and its
 * world-phase builder refuses where it used to throw.** Each was a generator
 * quietly keeping a result it had just found wrong — the arch on the booth's
 * bearing with nowhere clear, the exit at its nearest unclear try — or a
 * refusal by the road turned into a crash. These hold each answer to the
 * refusal, on a real planned park (seed 15, restart 0: given explicitly, so no
 * acceptance loop runs).
 */
process.env['LGP_SEED'] = '15';
process.env['LGP_PARK_RESTART'] = '0';
await import('../scripts/headless-canvas.mjs');
const { solveParkPlanNow } = await import('../src/world/parkPlan');
const { archStation } = await import('../src/world/railRace/route');
const { planExit, RAIL_RACE_PLAN } = await import('../src/world/railRace/plan');
const { barSlotWithNoSupportRoom, TrestleRefusal } = await import('../src/world/railRace/track');
const { HAZARD_LAYOUT } = await import('../src/world/railRace/simulate');
const { entranceRoadClaims } = await import('../src/world/entrance/roadCorridor');
const { railRaceBuilder } = await import('../src/world/worldPhase');
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
