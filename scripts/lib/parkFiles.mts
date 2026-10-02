/**
 * **Find each seed's park, write it as a park file, and prove the file is the
 * park that was accepted.** Shared by `build:parks` (every supported seed, for
 * shipping) and `check:prebuilt-park` (the canonical seed, in the check chain)
 * — see `docs/design/PREBUILT-PARKS.md`.
 *
 * ## The accept loop (Jim, Oct 2026: the restart is found automatically)
 *
 * A seed's park is the first restart `r = 0, 1, 2, …` (`src/world/parkRestart.ts`)
 * whose **shipped file** passes every acceptance measure. Per attempt:
 *
 * 1. **solve** — `scripts/park-file-probe.mts solve` at `LGP_PARK_RESTART=r`, in
 *    a fresh process: the search, the park built and digested, the file written;
 * 2. **accept as shipped** — `park-attempt.mts` under `LGP_PARK_FILE`, in a fresh
 *    process: every acceptance measure asked of the park *hydrated from that
 *    file* (the park a child's device builds), plus `hydrate`, which fails if
 *    anything was searched rather than read.
 *
 * The loop is `acceptPark` (`acceptedPark.mts`) — **the** accept loop, the
 * same one Node tooling runs on a fresh solve — with the file attempt above
 * plugged in, so the order of restarts, the log, `MAX_RESTARTS` and stopping
 * on a broken measure have one owner. Seeds run `lanes` at a time. A solve
 * that gives up is a rejected attempt (`build`); one that hangs past
 * {@link PROBE_TIMEOUT_MS} or a measure that throws is a broken instrument and
 * fails the build, and so does running out of `MAX_RESTARTS`, with the log.
 *
 * The file carries the accepted `restart` and `acceptance` — every attempt and
 * what forced it (`acceptanceMetadata`). Nothing is recorded by hand: the
 * output is keyed by the source hash (`park-source-hash.mjs`), so a change to
 * the generator or to a measure searches again on its own.
 *
 * ## The proof, on the accepted file
 *
 * **hydrate** — the file offered before anything forces the plan, the park
 * built from it and digested in a fresh process — must equal the solve's
 * digest, name the same seed and restart, take its restart from the file, and
 * have searched nothing: no driver, no world search, no World search, zero
 * pieces in every hydrated feature. The second half is not decoration: a
 * hydrate that quietly fell back to searching would build the identical park
 * and pass the first half on nothing.
 *
 * And once per run, the **control on the instrument**: the first proven file is
 * hydrated again with the Sky Cruiser raised half a metre (`perturb`), and that
 * digest must *differ*. If it does not, the comparison cannot see the file's
 * contents at all, and every "equal" above means nothing.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import type { ParkFile } from '../../src/world/prebuilt/parkFile.ts';
import { PARK_FILE_FORMAT, PREBUILT_PARKS_MANIFEST, SUPPORTED_PARK_SEEDS, type PrebuiltParksManifest } from '../../src/world/prebuilt/parkFileName.ts';
import type { AttemptVerdict } from '../park-attempt.mts';
import { acceptanceMetadata, acceptPark, attemptInFreshProcess, type AcceptanceMetadata } from './acceptedPark.mts';
import { parkSourceHash } from './park-source-hash.mjs';

const run = promisify(execFile);

/**
 * How long one probe (one seed's solve, or one hydrate) may run before it is
 * killed and the seed reported as failed: 30 minutes, against seed 6's 650 s
 * solve at its accepted restart on an uncontended M-series Mac (CI runners
 * read ~2x, so ~22 min). `LGP_PARK_TIMEOUT_MS` overrides it.
 */
const PROBE_TIMEOUT_MS = Number(process.env['LGP_PARK_TIMEOUT_MS'] ?? 30 * 60 * 1000);

export interface ProbeResult {
  readonly mode: string;
  readonly seed: number;
  readonly restart: number;
  readonly restartFrom: 'record' | 'file';
  readonly generationSeed: number;
  readonly park: string;
  readonly meshes: number;
  readonly byName: Readonly<Record<string, string>>;
  readonly hydrated: boolean;
  readonly driverRan: boolean;
  readonly worldSolverRan: boolean;
  readonly builtSearched: readonly string[];
  readonly piecesByHydratedFeature: Readonly<Record<string, number>>;
  readonly planCpuMs: number;
  readonly worldBuildMs: number;
  readonly bytes: number;
}

export interface SeedOutcome {
  readonly seed: number;
  /** The accepted restart. */
  readonly restart: number;
  readonly acceptance: AcceptanceMetadata;
  readonly file: string;
  readonly solved: ProbeResult;
  readonly hydrated: ProbeResult;
  readonly raw: number;
  readonly gzip: number;
  readonly brotli: number;
  /** Empty when the file is proven; otherwise why not. */
  readonly problems: readonly string[];
}

async function probe(
  mode: 'solve' | 'hydrate' | 'perturb',
  seed: number,
  file: string,
  restart?: number,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const args = [
    '--no-warnings',
    '--import',
    './scripts/ts-extension-resolver-register.mjs',
    'scripts/park-file-probe.mts',
    mode,
    file,
  ];
  let stdout: string;
  try {
    ({ stdout } = await run(process.execPath, args, {
      // Never an inherited LGP_PARK_RESTART: the solve builds the restart it
      // was asked for, and the hydrate the one its file names.
      env: {
        ...withoutRestart(process.env),
        LGP_SEED: String(seed),
        ...(restart === undefined ? {} : { LGP_PARK_RESTART: String(restart) }),
      },
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      // A seed that never finishes must fail by name, not hang the build until
      // the CI job's own cap cancels it.
      timeout: PROBE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      ...(signal ? { signal } : {}),
    }));
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string };
    const tail = `${failed.stderr ?? ''}\n${failed.stdout ?? ''}`.trim().split('\n').slice(-12).join('\n');
    const killed = (error as { killed?: boolean; signal?: string }).killed || (error as { signal?: string }).signal === 'SIGKILL';
    throw new ProbeFailed(
      killed
        ? `park-file-probe ${mode} seed ${seed} did not finish in ${PROBE_TIMEOUT_MS / 1000} s and was killed`
        : `park-file-probe ${mode} seed ${seed} failed:\n${tail || failed.message}`,
      killed,
    );
  }
  const last = stdout.trim().split('\n').at(-1) ?? '';
  return JSON.parse(last) as ProbeResult;
}

/** A probe that exited non-zero (`hung`: killed at {@link PROBE_TIMEOUT_MS}). */
class ProbeFailed extends Error {
  readonly hung: boolean;
  constructor(message: string, hung: boolean) {
    super(message);
    this.hung = hung;
  }
}

function withoutRestart(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { LGP_PARK_RESTART: _dropped, ...rest } = env;
  return rest;
}

function compare(seed: number, recorded: number, solved: ProbeResult, hydrated: ProbeResult, file: ParkFile): string[] {
  const problems: string[] = [];
  if (solved.seed !== seed || hydrated.seed !== seed || file.seed !== seed) {
    problems.push(`asked for seed ${seed}: solved ${solved.seed}, hydrated ${hydrated.seed}, file says ${file.seed}`);
  }
  if (solved.restart !== recorded || file.restart !== recorded || hydrated.restart !== recorded) {
    problems.push(
      `seed ${seed}'s accepted restart is ${String(recorded)}: solved ${solved.restart}, file says ${file.restart}, hydrated ${hydrated.restart}`,
    );
  }
  if (hydrated.restartFrom !== 'file') problems.push('the hydrate process did not take its restart from the file, as the browser does');
  if (!hydrated.hydrated) problems.push('the hydrate process did not hydrate — it solved, so its digest proves nothing');
  if (hydrated.driverRan) problems.push('the hydrate process constructed the backtracking driver — the client has none, so this is not the path that ships');
  if (hydrated.worldSolverRan) problems.push('the hydrate process searched the world phase — the client has no search, so this is not the path that ships');
  if (hydrated.builtSearched.length > 0) {
    problems.push(`the hydrate process ran the World's own searches for ${hydrated.builtSearched.join(', ')} — the client has none`);
  }
  const searched = Object.entries(hydrated.piecesByHydratedFeature).filter(([, pieces]) => pieces > 0);
  if (searched.length > 0) {
    problems.push(`hydrated features still searched: ${searched.map(([f, p]) => `${f}=${p} pieces`).join(', ')}`);
  }
  if (solved.park !== hydrated.park) {
    const moved = Object.keys({ ...solved.byName, ...hydrated.byName })
      .filter((name) => solved.byName[name] !== hydrated.byName[name])
      .sort();
    problems.push(
      `the hydrated park is not the solved park: digest ${hydrated.park} against ${solved.park}; ` +
        `${moved.length} mesh name(s) differ: ${moved.slice(0, 12).join(', ')}${moved.length > 12 ? ', …' : ''}`,
    );
  }
  return problems;
}

/** The synthetic verdict for a solve that gave up: a park that could not be made from this stream. */
function buildFailed(seed: number, restart: number, message: string, wallMs: number): AttemptVerdict {
  return {
    seed,
    restart,
    built: false,
    accepted: false,
    broken: null,
    failures: [{ measure: 'build', count: 1, first: [message.slice(0, 400)] }],
    measuresAsked: 0,
    cpuMs: { build: 0, invariants: 0, findings: 0 },
    backtracking: { plan: null, world: null },
    wallMs,
    parkFile: null,
  };
}

/**
 * **One attempt as the shipped file**, for `acceptPark` (`acceptedPark.mts`,
 * the one accept loop): solve restart `restart` of `seed` to a file in
 * `scratch`, then ask every acceptance measure of the park hydrated from that
 * file. A solve that gives up is a rejected attempt (`build`), as
 * `acceptPark` counts one; a hang throws. `solves` keeps each solve's probe
 * result for the proof.
 */
function fileAttempt(scratch: string, solves: Map<string, ProbeResult>) {
  return async (seed: number, restart: number, signal?: AbortSignal): Promise<AttemptVerdict> => {
    const began = performance.now();
    const file = join(scratch, `${seed}-r${restart}.json`);
    let solved: ProbeResult;
    try {
      solved = await probe('solve', seed, file, restart, signal);
    } catch (error) {
      if (!(error instanceof ProbeFailed) || error.hung) throw error;
      const last = error.message.split('\n').filter(Boolean).at(-1) ?? error.message;
      return buildFailed(seed, restart, last, Math.round(performance.now() - began));
    }
    if (solved.seed !== seed || solved.restart !== restart) {
      throw new Error(`build:parks: asked to solve seed ${seed} restart ${restart}, the probe built seed ${solved.seed} restart ${solved.restart}`);
    }
    solves.set(file, solved);
    const verdict = await attemptInFreshProcess(seed, restart, file, signal);
    if (verdict.parkFile === null) {
      throw new Error(`build:parks: the acceptance attempt for seed ${seed} restart ${restart} did not hydrate ${file}`);
    }
    return { ...verdict, wallMs: Math.round(performance.now() - began) };
  };
}

/**
 * **Every seed's accepted park, as a proven file in `outDir`.** Each seed runs
 * the one accept loop (`acceptPark`) with {@link fileAttempt} as its attempt —
 * restart 0, 1, 2, … until the hydrated file passes every measure — `lanes`
 * seeds at a time. Then each accepted file is proven (hydrate digest == solve
 * digest, nothing searched) and the perturbed-file control runs once.
 * `problems` per seed and `controlProblem` say what failed; a thrown error is
 * a broken instrument or a seed that exhausted `MAX_RESTARTS`.
 */
export async function buildAcceptedParks(
  seeds: readonly number[],
  outDir: string,
  lanes: number,
  log: (line: string) => void,
  restartLanes = 1,
): Promise<{ outcomes: SeedOutcome[]; controlProblem: string | null }> {
  const scratch = join(outDir, '.attempts');
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const sourceHash = parkSourceHash(process.cwd());
  const solves = new Map<string, ProbeResult>();
  const attempt = fileAttempt(scratch, solves);

  const outcomes: SeedOutcome[] = [];
  const queue = [...seeds].reverse();
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, lanes), seeds.length) }, async () => {
      for (let seed = queue.pop(); seed !== undefined; seed = queue.pop()) {
        const accepted = await acceptPark(seed, {
          attempt,
          lanes: restartLanes,
          onAttempt: (record) =>
            log(
              `    seed ${String(seed).padStart(2)} restart ${record.restart}: ` +
                (record.accepted
                  ? `accepted as shipped (${record.measuresAsked} measures, ${(record.wallMs / 1000).toFixed(0)} s)`
                  : `rejected by ${record.forcedBy.map((f) => f.measure).join(' | ').slice(0, 240)} (${(record.wallMs / 1000).toFixed(0)} s)`),
            ),
        });
        const acceptance = acceptanceMetadata(accepted, sourceHash);
        const winner = join(scratch, `${seed}-r${accepted.restart}.json`);
        const solved = solves.get(winner) as ProbeResult;
        const file = join(outDir, `${seed}.json`);
        renameSync(winner, file);
        const hydrated = await probe('hydrate', seed, file);
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as ParkFile;
        const problems = compare(seed, accepted.restart, solved, hydrated, parsed);
        // `acceptance` is read by people, never by the game: added after the
        // proof, it changes nothing the proof covered.
        const shipped = JSON.stringify({ ...parsed, acceptance });
        writeFileSync(file, shipped);
        const bytes = Buffer.from(shipped);
        outcomes.push({
          seed,
          restart: accepted.restart,
          acceptance,
          file,
          solved,
          hydrated,
          raw: bytes.length,
          gzip: gzipSync(bytes, { level: 9 }).length,
          brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
          problems,
        });
        log(
          `  seed ${String(seed).padStart(2)}: restart ${accepted.restart} after ${accepted.attempts.length} attempt(s), ` +
            `${problems.length === 0 ? 'proven' : 'FAILED'}: digest ${solved.park}/${hydrated.park}, ` +
            `plan ${solved.planCpuMs} ms searched -> ${hydrated.planCpuMs} ms hydrated (${(accepted.wallMs / 1000).toFixed(0)} s)`,
        );
      }
    }),
  );
  outcomes.sort((a, b) => seeds.indexOf(a.seed) - seeds.indexOf(b.seed));
  rmSync(scratch, { recursive: true, force: true });

  // The control, on the first seed that was proven.
  let controlProblem: string | null = 'no seed was proven, so the control had nothing to perturb';
  const first = outcomes.find((o) => o.problems.length === 0);
  if (first) {
    const perturbed = await probe('perturb', first.seed, first.file);
    controlProblem =
      perturbed.park === first.hydrated.park
        ? `CONTROL FAILED: seed ${first.seed}'s file with the Sky Cruiser raised 0.5 m built digest ${perturbed.park}, ` +
          'the same as the unperturbed file — the comparison cannot see what is in the file'
        : null;
    log(
      `  control: seed ${first.seed} perturbed (cruiser +0.5 m) digest ${perturbed.park} vs ${first.hydrated.park} — ` +
        (controlProblem ? 'BLIND' : 'differs, as it must'),
    );
  }
  return { outcomes, controlProblem };
}

/** The manifest for `outcomes`, built from `sourceHash`. */
export function parksManifest(sourceHash: string, outcomes: readonly SeedOutcome[]): PrebuiltParksManifest {
  return {
    format: PARK_FILE_FORMAT,
    sourceHash,
    seeds: outcomes.map((o) => o.seed),
    restarts: Object.fromEntries(outcomes.map((o) => [String(o.seed), o.restart])),
    digests: Object.fromEntries(outcomes.map((o) => [String(o.seed), o.solved.park])),
  };
}

export { builtRestartOf } from './builtParks.mts';

/**
 * **Is `dir` this tree's parks, as they were proven?** For parks built by
 * another workflow run (CI reuses them across branches by source hash): the
 * manifest must be this tree's source and format and cover every supported
 * seed, and each file, hydrated in a fresh process exactly as the proof
 * hydrates it, must build the digest and restart the manifest records with
 * nothing searched. Returns the problems; empty means trust it.
 */
export async function verifyParks(
  dir: string,
  lanes: number,
  log: (line: string) => void,
): Promise<string[]> {
  const problems: string[] = [];
  const path = join(dir, PREBUILT_PARKS_MANIFEST);
  if (!existsSync(path)) return [`${dir}: no manifest`];
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PrebuiltParksManifest;
  const sourceHash = parkSourceHash(process.cwd());
  if (manifest.format !== PARK_FILE_FORMAT) problems.push(`format ${manifest.format}, this tree reads ${PARK_FILE_FORMAT}`);
  if (manifest.sourceHash !== sourceHash) problems.push(`source ${manifest.sourceHash.slice(0, 12)}, this tree is ${sourceHash.slice(0, 12)}`);
  for (const seed of SUPPORTED_PARK_SEEDS) if (!manifest.seeds.includes(seed)) problems.push(`seed ${seed} missing`);
  if (problems.length > 0) return problems;
  const queue = [...manifest.seeds].reverse();
  await Promise.all(
    Array.from({ length: Math.max(1, lanes) }, async () => {
      for (let seed = queue.pop(); seed !== undefined; seed = queue.pop()) {
        const file = join(dir, `${seed}.json`);
        if (!existsSync(file)) {
          problems.push(`seed ${seed}: no file`);
          continue;
        }
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as ParkFile;
        const hydrated = await probe('hydrate', seed, file);
        const want = { digest: manifest.digests[String(seed)], restart: manifest.restarts[String(seed)] };
        const wrong: string[] = [];
        if (hydrated.park !== want.digest) wrong.push(`digest ${hydrated.park}, manifest says ${want.digest}`);
        if (hydrated.restart !== want.restart || parsed.restart !== want.restart) {
          wrong.push(`restart ${hydrated.restart} (file ${parsed.restart}), manifest says ${want.restart}`);
        }
        if (!hydrated.hydrated || hydrated.driverRan || hydrated.worldSolverRan || hydrated.builtSearched.length > 0) {
          wrong.push('it was searched, not hydrated');
        }
        for (const w of wrong) problems.push(`seed ${seed}: ${w}`);
        log(`  seed ${String(seed).padStart(2)}: ${wrong.length === 0 ? 'verified' : 'WRONG'} — digest ${hydrated.park}, restart ${hydrated.restart}`);
      }
    }),
  );
  return problems;
}
