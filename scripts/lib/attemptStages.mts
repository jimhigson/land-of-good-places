/**
 * **An attempt's measures, asked cheapest stage first, stopping at the first
 * stage that rejects the park.** The unit `scripts/park-attempt.mts` runs.
 *
 * The order is a cost order and nothing else. A rejected attempt pays only up
 * to the stage that rejected it, because a park already rejected cannot be
 * accepted by asking it more. An accepted attempt has been asked every measure
 * in every stage, so the guarantee is unchanged: a park the loop accepts
 * passes them all. `test/attemptStages.test.ts` holds that line. A park that
 * fails only the last, heaviest stage is rejected, and an accepted verdict has
 * nothing in `notAsked`.
 *
 * The verdict always says what it did not ask (`notAsked`), so a log never
 * reads as though a measure passed when it never ran.
 *
 * A **void** (a measure that could not measure, or threw) is an instrument
 * fault. It marks the attempt `broken` and stops this attempt at once, in any
 * stage. The loop then stops too (`acceptedPark.mts`), because no restart can
 * fix a broken instrument.
 */

/** One failing measure, as the verdict records it. */
export interface StageFailure {
  readonly measure: string;
  readonly count: number;
  readonly first: readonly string[];
}

/** What one measure found. `failures` reject the park; `broken` names a void. */
export interface MeasureOutcome {
  readonly failures: readonly StageFailure[];
  readonly broken: string | null;
}

export interface StageMeasure {
  readonly name: string;
  /** Which CPU bucket the verdict files its time under. */
  readonly cpu: 'invariants' | 'checks' | 'findings';
  readonly run: () => MeasureOutcome | Promise<MeasureOutcome>;
}

export interface Stage {
  readonly name: string;
  readonly measures: readonly StageMeasure[];
}

/** The stages an attempt did not reach, and why. Null when every stage was asked. */
export interface NotAsked {
  /** 1-based: the stage that rejected the park (or found a void). */
  readonly rejectedAtStage: number;
  readonly reason: 'rejected' | 'broken';
  readonly measures: readonly string[];
}

export interface StagesResult {
  readonly failures: readonly StageFailure[];
  readonly broken: string | null;
  readonly measuresAsked: number;
  readonly notAsked: NotAsked | null;
  readonly cpuMs: { invariants: number; checks: number; findings: number };
  /** CPU per stage, in order, for the stages that ran. */
  readonly stageCpuMs: readonly number[];
}

const firstLine = (error: unknown): string =>
  (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).split('\n')[0]?.slice(0, 400) ?? '';

/** Thread CPU where Node has it, wall clock otherwise (a test's fake measures). */
const clock = (): number => {
  const usage = (process as { threadCpuUsage?: () => { user: number; system: number } }).threadCpuUsage?.();
  return usage ? (usage.user + usage.system) / 1000 : performance.now();
};

export async function runStages(stages: readonly Stage[]): Promise<StagesResult> {
  const failures: StageFailure[] = [];
  let broken: string | null = null;
  let measuresAsked = 0;
  const cpuMs = { invariants: 0, checks: 0, findings: 0 };
  const stageCpuMs: number[] = [];
  for (let s = 0; s < stages.length; s += 1) {
    const stage = stages[s] as Stage;
    const stageStart = clock();
    for (const measure of stage.measures) {
      measuresAsked += 1;
      const start = clock();
      try {
        const outcome = await measure.run();
        failures.push(...outcome.failures);
        broken ??= outcome.broken;
      } catch (error) {
        broken ??= `${measure.name}: ${firstLine(error)}`;
        failures.push({ measure: measure.name, count: 1, first: [`the measure threw: ${firstLine(error)}`] });
      }
      cpuMs[measure.cpu] += clock() - start;
      // A void stops the attempt where it stands: nothing after it can be trusted.
      if (broken !== null) break;
    }
    stageCpuMs.push(clock() - stageStart);
    if (broken !== null || failures.length > 0) {
      const remaining = [
        ...unaskedIn(stage, measuresAsked - asked(stages, s)),
        ...stages.slice(s + 1).flatMap((later) => later.measures.map((m) => m.name)),
      ];
      return {
        failures,
        broken,
        measuresAsked,
        notAsked:
          remaining.length > 0
            ? { rejectedAtStage: s + 1, reason: broken !== null ? 'broken' : 'rejected', measures: remaining }
            : null,
        cpuMs,
        stageCpuMs,
      };
    }
  }
  return { failures, broken, measuresAsked, notAsked: null, cpuMs, stageCpuMs };
}

/** Measures asked in the stages before `s`. */
function asked(stages: readonly Stage[], s: number): number {
  return stages.slice(0, s).reduce((sum, stage) => sum + stage.measures.length, 0);
}

/** The measures of `stage` after the first `count` were asked (a void stops mid-stage). */
function unaskedIn(stage: Stage, count: number): string[] {
  return stage.measures.slice(count).map((m) => m.name);
}

/** One line for a log: what was not asked, and why. */
export function describeNotAsked(notAsked: NotAsked | null): string {
  if (!notAsked) return 'every stage asked';
  return (
    `not asked: ${notAsked.reason} at stage ${notAsked.rejectedAtStage} — ` +
    `${notAsked.measures.length} measure(s): ${notAsked.measures.join(', ')}`
  );
}
