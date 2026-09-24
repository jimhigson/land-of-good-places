/**
 * **The root of the ladder: start the whole park again until it passes.**
 *
 * Jim, 24 Sep 2026: *"there should be no 'fail some placement checks'
 * GUARANTEED STRUCTURALLY because ALL FEATURES SHOULD BE BACKTRACKABLE — this
 * means that even in the case of total failure, backtracking to zero will
 * work, effectively starting again."*
 *
 * The driver (`src/boot/parkSolve.ts`) backtracks within a park — retry,
 * accommodate, unwind, decision zero — against everything a builder can see
 * while it builds. What no builder can see is a property of the finished park:
 * a duck bar that slows nobody, a camera running backwards round a hairpin, a
 * welcome sign that seals a gap. Those are measured on the built `World` by the
 * acceptance measures — every procgen invariant and every `check:park` key,
 * the same functions the suite and the check assert (`scripts/park-attempt.mts`
 * asks them). This loop is the terminal rule over all of them:
 *
 * > try restart 0 (the seed's own park); while any measure complains, or the
 * > build throws, start again from zero with restart `r + 1` — a fresh
 * > generation seed (`src/world/parkRestart.ts`), so a wholly independent
 * > park under the same identity.
 *
 * **So a park this returns satisfies every measure by construction**: it is
 * the first attempt that did. What forced each restart is recorded, in order,
 * and travels with the park (the prebuilt park file's metadata), so a restart
 * is never silent.
 *
 * ## Termination
 *
 * Each restart is an independent draw from the space of parks the generator
 * makes, so if a fraction `p` of parks pass every measure, the attempts a
 * seed needs are geometric with mean `1/p` — finite for any seed whenever
 * `p > 0`, and `p` is measured, not assumed (`scripts/accept-parks.mts` sweeps
 * seeds and reports attempts per seed). {@link MAX_RESTARTS} is a bug-catcher
 * in the spirit of the driver's `MAX_UNWINDS`: far above anything a healthy
 * generator needs, and hitting it throws with the whole restart log — a
 * measure that nothing can pass is a generator (or instrument) bug.
 *
 * ## Determinism
 *
 * Attempts are tried in order, each in a fresh process whose only inputs are
 * the seed, the restart and the source — so the same seed at the same commit
 * accepts the same restart, every run, on every machine that builds the same
 * park.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { AttemptVerdict } from '../park-attempt.mts';

const run = promisify(execFile);

/** Restarts per park before the loop gives up — a bug-catcher, not a budget. */
export const MAX_RESTARTS = 200;

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One restart of the log: what that attempt measured, and why it was not accepted. */
export interface RestartRecord {
  readonly restart: number;
  readonly accepted: boolean;
  readonly built: boolean;
  /** Each failing measure with its first complaint — what forced the next restart. */
  readonly forcedBy: readonly { readonly measure: string; readonly count: number; readonly first: string }[];
  readonly measuresAsked: number;
  readonly wallMs: number;
  readonly cpuMs: number;
}

export interface AcceptedPark {
  readonly seed: number;
  /** The restart that passed — `PARK_RESTART` for the park that ships. */
  readonly restart: number;
  /** Every attempt, in order; the last is the accepted one. */
  readonly attempts: readonly RestartRecord[];
  readonly wallMs: number;
}

/** Run one attempt in a fresh process. The default attempt runner. */
export async function attemptInFreshProcess(seed: number, restart: number): Promise<AttemptVerdict> {
  const env = { ...process.env, LGP_SEED: String(seed), LGP_PARK_RESTART: String(restart) };
  let out = '';
  let err = '';
  let code = 0;
  try {
    const result = await run(
      process.execPath,
      ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', 'scripts/park-attempt.mts'],
      { cwd: REPO, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
    out = result.stdout;
    err = result.stderr;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number };
    out = failed.stdout ?? '';
    err = failed.stderr ?? '';
    code = failed.code ?? 1;
  }
  const line = out.split('\n').find((l) => l.startsWith('park-attempt: '));
  if (!line) {
    // The attempt script itself broke (not the park: a park that fails is a
    // verdict). That is a bug in the loop, never a reason to restart — a
    // restart could not fix it, and looping on it would hide it.
    const tail = `${out}\n${err}`.trim().split('\n').slice(-12).join('\n');
    throw new Error(`accepted park: attempt ${restart} of seed ${seed} gave no verdict (exit ${code}):\n${tail}`);
  }
  return JSON.parse(line.slice('park-attempt: '.length)) as AttemptVerdict;
}

/**
 * Start seed `seed`'s park again from zero until an attempt passes every
 * acceptance measure. `onAttempt` hears each attempt as it lands (for a live
 * log); `from` starts the count later, for measuring the loop itself.
 */
export async function acceptPark(
  seed: number,
  options: {
    readonly onAttempt?: (record: RestartRecord) => void;
    readonly attempt?: (seed: number, restart: number) => Promise<AttemptVerdict>;
    readonly maxRestarts?: number;
  } = {},
): Promise<AcceptedPark> {
  const began = performance.now();
  const attempt = options.attempt ?? attemptInFreshProcess;
  const cap = options.maxRestarts ?? MAX_RESTARTS;
  const attempts: RestartRecord[] = [];
  for (let restart = 0; restart < cap; restart += 1) {
    const verdict = await attempt(seed, restart);
    if (verdict.seed !== seed || verdict.restart !== restart) {
      throw new Error(
        `accepted park: asked for seed ${seed} restart ${restart}, the attempt built seed ${verdict.seed} restart ${verdict.restart}`,
      );
    }
    if (verdict.broken !== null) {
      throw new Error(
        `accepted park: seed ${seed} restart ${restart}: a measure threw (${verdict.broken}) — an instrument bug, ` +
          'which no restart can fix, so the loop stops here rather than search around it',
      );
    }
    const record: RestartRecord = {
      restart,
      accepted: verdict.accepted,
      built: verdict.built,
      forcedBy: verdict.failures.map((f) => ({ measure: f.measure, count: f.count, first: f.first[0] ?? '' })),
      measuresAsked: verdict.measuresAsked,
      wallMs: verdict.wallMs,
      cpuMs: verdict.cpuMs.build + verdict.cpuMs.invariants + verdict.cpuMs.findings,
    };
    attempts.push(record);
    options.onAttempt?.(record);
    if (verdict.accepted) {
      return { seed, restart, attempts, wallMs: Math.round(performance.now() - began) };
    }
  }
  const log = attempts
    .map((a) => `  restart ${a.restart}: ${a.forcedBy.map((f) => `${f.measure} (${f.count})`).join('; ')}`)
    .join('\n');
  throw new Error(
    `accepted park: seed ${seed} passed no attempt in ${cap} restarts — a measure nothing passes is a generator or ` +
      `instrument bug. Restarts:\n${log}`,
  );
}

/**
 * **Everything an acceptance verdict depends on**, hashed: the generator
 * (`src/`), the measures (`test/procgen/`, `scripts/` — the harness, the
 * attempt, `parkFindings`), and the toolchain (`package.json`,
 * `pnpm-lock.yaml`). A verdict is a fact about exactly this; change any of it
 * and the verdict must be taken again. The one owner of that question — the
 * prebuilt park build keys its files on it too.
 */
export function acceptanceSourceHash(): string {
  const hash = createHash('sha256');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  for (const dir of ['src', 'test/procgen', 'scripts']) walk(join(REPO, dir));
  files.push(join(REPO, 'package.json'), join(REPO, 'pnpm-lock.yaml'));
  for (const file of files) {
    hash.update(relative(REPO, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 20);
}

const CACHE_DIR = join(REPO, '.cache', 'lgp-accepted');

/**
 * The accepted park for `seed` at this source, from the cache if a previous
 * run already took the verdict, otherwise by running the loop and caching it.
 * A cached verdict is only ever reused for byte-identical inputs
 * ({@link acceptanceSourceHash}), so it is the same answer the loop would give.
 */
export async function acceptParkCached(
  seed: number,
  options: Parameters<typeof acceptPark>[1] = {},
): Promise<AcceptedPark & { readonly cached: boolean; readonly sourceHash: string }> {
  const sourceHash = acceptanceSourceHash();
  const file = join(CACHE_DIR, sourceHash, `${seed}.json`);
  if (existsSync(file)) {
    return { ...(JSON.parse(readFileSync(file, 'utf8')) as AcceptedPark), cached: true, sourceHash };
  }
  const accepted = await acceptPark(seed, options);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(accepted)}\n`);
  return { ...accepted, cached: false, sourceHash };
}

/** One line per restart, for a log or the park file's metadata. */
export function describeRestarts(accepted: AcceptedPark): string[] {
  return accepted.attempts.map((a) =>
    a.accepted
      ? `restart ${a.restart}: accepted (${a.measuresAsked} measures, ${(a.wallMs / 1000).toFixed(1)} s)`
      : `restart ${a.restart}: rejected by ${a.forcedBy.map((f) => `${f.measure} x${f.count} — ${f.first}`).join(' | ')}`,
  );
}
