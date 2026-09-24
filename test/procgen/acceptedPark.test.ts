/**
 * The root acceptance loop's own rules, proved with a scripted attempt runner
 * (no park is built): it accepts the first attempt with no complaint, restarts
 * on a failed build, stops on a broken measure, stops at its cap, and refuses
 * an attempt that built the wrong park. The measures themselves are the
 * invariants; this proves only the loop that asks them.
 */
import { describe, expect, it } from 'vitest';

// Through a variable, as in `invariants.ts`: the loop is Node-only code and this
// project has no `@types/node` (see `test/node-env.d.ts`).
const MODULE = '../../scripts/lib/acceptedPark.mts';

interface Verdict {
  seed: number;
  restart: number;
  built: boolean;
  accepted: boolean;
  broken: string | null;
  failures: { measure: string; count: number; first: string[] }[];
  measuresAsked: number;
  cpuMs: { build: number; invariants: number; findings: number };
  wallMs: number;
  backtracking: { plan: null; world: null };
}
interface Loop {
  acceptPark(
    seed: number,
    options: { attempt: (seed: number, restart: number) => Promise<Verdict>; maxRestarts?: number },
  ): Promise<{ restart: number; attempts: { restart: number; accepted: boolean; forcedBy: { measure: string }[] }[] }>;
}

const verdict = (seed: number, restart: number, failures: string[], extra: Partial<Verdict> = {}): Verdict => ({
  seed,
  restart,
  built: true,
  accepted: failures.length === 0,
  broken: null,
  failures: failures.map((measure) => ({ measure, count: 1, first: [`${measure} complained`] })),
  measuresAsked: 102,
  cpuMs: { build: 0, invariants: 0, findings: 0 },
  wallMs: 0,
  backtracking: { plan: null, world: null },
  ...extra,
});

describe('the root acceptance loop', () => {
  it('accepts the first restart with no complaint, and logs what forced every restart before it', async () => {
    const { acceptPark } = (await import(/* @vite-ignore */ MODULE)) as Loop;
    const script: string[][] = [['duck bar'], ['lattice', 'camera'], []];
    const accepted = await acceptPark(7, { attempt: async (seed, r) => verdict(seed, r, script[r] ?? []) });
    expect(accepted.restart).toBe(2);
    expect(accepted.attempts.map((a) => a.forcedBy.map((f) => f.measure))).toEqual([['duck bar'], ['lattice', 'camera'], []]);
  });

  it('restarts when the build itself throws', async () => {
    const { acceptPark } = (await import(/* @vite-ignore */ MODULE)) as Loop;
    const accepted = await acceptPark(7, {
      attempt: async (seed, r) =>
        r === 0 ? verdict(seed, r, ['build'], { built: false, accepted: false }) : verdict(seed, r, []),
    });
    expect(accepted.restart).toBe(1);
  });

  it('stops, rather than restarting, when a measure throws', async () => {
    const { acceptPark } = (await import(/* @vite-ignore */ MODULE)) as Loop;
    let calls = 0;
    await expect(
      acceptPark(7, {
        attempt: async (seed, r) => {
          calls += 1;
          return verdict(seed, r, ['x'], { accepted: false, broken: 'x: TypeError' });
        },
      }),
    ).rejects.toThrow(/restart 0: a measure threw \(x: TypeError\)/);
    expect(calls, 'the loop searched on past an instrument that throws').toBe(1);
  });

  it('gives up at its cap with the whole restart log', async () => {
    const { acceptPark } = (await import(/* @vite-ignore */ MODULE)) as Loop;
    await expect(
      acceptPark(7, { attempt: async (seed, r) => verdict(seed, r, ['never passes']), maxRestarts: 5 }),
    ).rejects.toThrow(/passed no attempt in 5 restarts[\s\S]*restart 4: never passes/);
  });

  it('refuses an attempt that built a different park from the one asked for', async () => {
    const { acceptPark } = (await import(/* @vite-ignore */ MODULE)) as Loop;
    await expect(acceptPark(7, { attempt: async (_seed, r) => verdict(8, r, []) })).rejects.toThrow(/built seed 8/);
  });
});
