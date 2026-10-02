/**
 * **`check:every-seed-builds`'s per-park clauses, one owner** — asked by the
 * script (over `check:park`'s output, one process per seed) and by the root
 * acceptance loop (`scripts/park-attempt.mts`, over the layout trace of the
 * park it just built):
 *
 * - **built** is `check:park` passing, which the loop already asks;
 * - **built well**: the layout reached decision zero no more often than
 *   `every-seed-builds-baseline.mts` records for the seed — a fault, so a park
 *   that needed more whole-layout restarts is a park to start again;
 * - **no false refusal**: when the doormat rung fired, the same park rebuilt
 *   with the rung disarmed must reach every door the rung refused. A false
 *   refusal is the rung's *instrument* being wrong, so the loop reports it as
 *   a broken measure and stops — never searches around it.
 *
 * A seed reaching decision zero *less* often than recorded (`BASELINE LOOSE`)
 * is the baseline asking to be re-taken, not a park fault, and is not asked.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DECISION_ZERO_BASELINE } from '../every-seed-builds-baseline.mts';

const run = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What the layout trace (`parkLayout.ts`'s `layout-trace:` lines) says about one park. */
export interface LayoutTraceCounts {
  /** Times the layout reached decision zero; NaN when the trace has no `solved` line. */
  readonly decisionZero: number;
  /** Refusals the doormat rung unwound on. */
  readonly rungFired: number;
}

/** Read the counts off trace lines — `check:park`'s stderr, or `LAYOUT_TRACE` in-process. */
export function layoutTraceCounts(lines: readonly string[]): LayoutTraceCounts {
  const trace = lines.map((l) => l.trim()).filter((l) => l.startsWith('layout-trace:'));
  const solved = trace.map((l) => /decision-zero-reached=(\d+)/.exec(l)).find((m) => m);
  const fired = trace.map((l) => /rung-1-fired=(\d+)/.exec(l)).find((m) => m);
  return { decisionZero: solved ? Number(solved[1]) : NaN, rungFired: fired ? Number(fired[1]) : 0 };
}

/** **Built well?** One line per way this park is worse than the baseline records. */
export function builtWellProblems(seed: number, counts: LayoutTraceCounts, unbuiltRecorded: boolean): string[] {
  const zero = DECISION_ZERO_BASELINE[seed];
  if (!Number.isFinite(counts.decisionZero)) return [`UNMEASURED: seed ${seed} built but printed no layout-trace line`];
  if (zero === undefined) {
    return unbuiltRecorded ? [] : [`UNMEASURED: seed ${seed} has no decision-zero baseline — re-take`];
  }
  if (counts.decisionZero > zero) {
    return [`WORSE: seed ${seed} reached decision zero ${counts.decisionZero} time(s), baseline ${zero}`];
  }
  return [];
}

/** A false-refusal finding, worded for both readers. */
export function falseRefusalProblem(seed: number, falseRefusals: number): string | null {
  if (falseRefusals <= 0) return null;
  return (
    `FALSE REFUSAL: seed ${seed} — the layout rung refused ${falseRefusals} door(s) the built park reaches; ` +
    'it moved a plot to satisfy a measurement error (see check:park with LGP_LAYOUT_RUNG=off)'
  );
}

/**
 * `check:park` on the same park (`seed`, `restart`) with the rung disarmed: how
 * many refusals the built park contradicts. A park build in its own process —
 * worth paying only when the rung fired.
 */
export async function falseRefusalsOf(seed: number, restart: number | string): Promise<number> {
  const args = ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', 'scripts/check-park.mts'];
  const env = { ...process.env, LGP_SEED: String(seed), LGP_PARK_RESTART: String(restart), LGP_LAYOUT_RUNG: 'off' };
  let all = '';
  try {
    const result = await run(process.execPath, args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    all = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    all = `${failed.stdout ?? ''}\n${failed.stderr ?? ''}`;
  }
  const line = all
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^layout\.falseRefusal:\s*\d+/.test(l));
  return line ? Number(/(\d+)/.exec(line)?.[1] ?? 0) : 0;
}
