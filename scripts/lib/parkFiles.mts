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
 * what forced it (`acceptanceMetadata`). It is written to `parks/` and its
 * manifest line stamped, for the author to commit with the change that made
 * the re-solve necessary.
 *
 * ## Checked in, and validated rather than re-solved
 *
 * The solved parks are tracked (`parks/`, `checked-in-parks.mjs`), and nothing
 * here decides to solve one because the source changed. {@link validatePark}
 * is what holds a checked-in park to the current source: it hydrates the file
 * in a fresh process and asks it **the same acceptance attempt** a freshly
 * solved file gets (`park-attempt.mts`, the one owner of the measures), told
 * only that no solve may be started to judge it; then it requires the
 * placement digest the manifest line records (`parkLayoutDigest.mts`).
 * `build:parks` re-solves exactly the seeds that fails.
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
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import type { ParkFile } from '../../src/world/prebuilt/parkFile.ts';
import { PARK_FILE_FORMAT, PREBUILT_PARKS_MANIFEST, PREBUILT_PARKS_OUT, type CheckedInPark } from '../../src/world/prebuilt/parkFileName.ts';
import type { AttemptFailure, AttemptVerdict } from '../park-attempt.mts';
import { acceptanceMetadata, acceptPark, attemptInFreshProcess, type AcceptanceMetadata, type RestartRecord } from './acceptedPark.mts';
import { checkedInParkText, parkFilePath, parkFileSha, readParksManifest, writeParksManifest, writeWhole } from './checked-in-parks.mjs';
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
  /** The placement digest (`parkLayoutDigest.mts`) of the park this probe built. */
  readonly layout: string;
  readonly layoutClaims: number;
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
  /** Wall seconds the whole accept loop took for this seed. */
  readonly seconds: number;
  readonly file: string;
  /** Whether the file was written to `parks/` and its manifest line stamped: only a proven one is. */
  readonly installed: boolean;
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
  if (solved.layout !== hydrated.layout) {
    problems.push(
      `the hydrated park's placement digest is ${hydrated.layout} (${hydrated.layoutClaims} claims), the solved park's ` +
        `${solved.layout} (${solved.layoutClaims} claims) — the file does not put things where the solve did`,
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
    cpuMs: { build: 0, invariants: 0, checks: 0, findings: 0 },
    backtracking: { plan: null, world: null },
    wallMs,
    notAsked: null,
    stageCpuMs: [],
    parkFile: null,
    layout: null,
    askedOfASolveOnly: [],
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
      const failed = buildFailed(seed, restart, last, Math.round(performance.now() - began));
      // A programming error is a bug, not a park that could not be made — the
      // same rule park-attempt applies to a build (`lib/attemptError.mts`):
      // broken, so the loop stops on it instead of restarting round it.
      const bug = /\b(TypeError|RangeError|ReferenceError|SyntaxError)\b.*$/m.exec(error.message);
      return bug ? { ...failed, broken: `solve: ${bug[0].slice(0, 300)}` } : failed;
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

/** Where solves in flight keep their files: never in `parks/`, which is tracked. */
function scratchDir(root: string): string {
  return join(root, '.cache', 'lgp-parks', 'attempts', String(process.pid));
}

/**
 * The control on both digests, on one proven file: hydrated again with the Sky
 * Cruiser raised and a tree moved (`perturb`), each digest must *differ*.
 */
async function controlProblemOf(seed: number, file: string, hydrated: ProbeResult, log: (line: string) => void): Promise<string | null> {
  const perturbed = await probe('perturb', seed, file);
  const blind: string[] = [];
  if (perturbed.park === hydrated.park) {
    blind.push(`the whole-park digest is ${perturbed.park} with the Sky Cruiser raised 0.5 m, the same as the unperturbed file`);
  }
  if (perturbed.layout === hydrated.layout) {
    blind.push(`the placement digest is ${perturbed.layout} with a tree moved 1 m, the same as the unperturbed file`);
  }
  log(
    `  control: seed ${seed} perturbed (cruiser +0.5 m, a tree +1 m) — whole-park ${perturbed.park} vs ${hydrated.park}, ` +
      `placement ${perturbed.layout} vs ${hydrated.layout} — ${blind.length > 0 ? 'BLIND' : 'both differ, as they must'}`,
  );
  return blind.length > 0 ? `CONTROL FAILED on seed ${seed}: ${blind.join('; ')} — the comparison cannot see what is in the file` : null;
}

/** Stamp (or replace) one seed's manifest line. Read-modify-write, synchronous: lanes cannot interleave inside it. */
export function stampManifestLine(root: string, seed: number, line: CheckedInPark): void {
  const manifest = readParksManifest(root);
  const seeds = manifest && manifest.format === PARK_FILE_FORMAT ? { ...manifest.seeds } : {};
  seeds[String(seed)] = line;
  writeParksManifest(root, { format: PARK_FILE_FORMAT, seeds });
}

/**
 * **Solve `seeds` again, and check each proven park in.** Each seed runs the
 * one accept loop (`acceptPark`) with {@link fileAttempt} as its attempt —
 * restart 0, 1, 2, … until the hydrated file passes every measure — `lanes`
 * seeds at a time, in a scratch directory under `.cache/`. Each accepted file
 * is then proven (hydrate digests == solve digests, nothing searched), the
 * perturbed-file control runs once, and only a proven file under a seeing
 * control is written to `parks/<seed>.json` with its manifest line.
 * `problems` per seed and `controlProblem` say what failed; a thrown error is
 * a broken instrument or a seed that exhausted `MAX_RESTARTS`.
 *
 * **This is the only thing that solves a park**, and only `build:parks` (for
 * the seeds validation rejected) calls it.
 */
export async function buildAcceptedParks(
  seeds: readonly number[],
  root: string,
  lanes: number,
  log: (line: string) => void,
  restartLanes = 1,
): Promise<{ outcomes: SeedOutcome[]; controlProblem: string | null }> {
  const scratch = scratchDir(root);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const sourceHash = parkSourceHash(root);
  const solves = new Map<string, ProbeResult>();
  const attempt = fileAttempt(scratch, solves);

  const outcomes: SeedOutcome[] = [];
  let control: Promise<string | null> | null = null;
  const queue = [...seeds].reverse();
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, lanes), seeds.length) }, async () => {
      for (let seed = queue.pop(); seed !== undefined; seed = queue.pop()) {
        const options = {
          attempt,
          lanes: restartLanes,
          onAttempt: (record: RestartRecord) =>
            log(
              `    seed ${String(seed).padStart(2)} restart ${record.restart}: ` +
                (record.accepted
                  ? `accepted as shipped (${record.measuresAsked} measures, ${(record.wallMs / 1000).toFixed(0)} s)`
                  : `rejected by ${record.forcedBy.map((f) => f.measure).join(' | ').slice(0, 240)} (${(record.wallMs / 1000).toFixed(0)} s)`),
            ),
        };
        const accepted = await acceptPark(seed, options);
        const acceptance = acceptanceMetadata(accepted);
        const winner = join(scratch, `${seed}-r${accepted.restart}.json`);
        const solved = solves.get(winner) as ProbeResult;
        const hydrated = await probe('hydrate', seed, winner);
        const parsed = JSON.parse(readFileSync(winner, 'utf8')) as ParkFile;
        const problems = compare(seed, accepted.restart, solved, hydrated, parsed);
        // `acceptance` is read by people, never by the game: added after the
        // proof, it changes nothing the proof covered.
        const shipped = checkedInParkText({ ...parsed, acceptance });
        const bytes = Buffer.from(shipped);
        let installed = false;
        if (problems.length === 0) {
          control ??= controlProblemOf(seed, winner, hydrated, log);
          if ((await control) === null) {
            writeWhole(parkFilePath(root, seed), shipped);
            stampManifestLine(root, seed, { restart: accepted.restart, file: parkFileSha(bytes), layout: hydrated.layout, solvedUnder: sourceHash });
            installed = true;
          }
        }
        outcomes.push({
          seed,
          restart: accepted.restart,
          acceptance,
          seconds: Math.round(accepted.wallMs / 1000),
          file: parkFilePath(root, seed),
          installed,
          solved,
          hydrated,
          raw: bytes.length,
          gzip: gzipSync(bytes, { level: 9 }).length,
          brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
          problems,
        });
        log(
          `  seed ${String(seed).padStart(2)}: restart ${accepted.restart} after ${accepted.attempts.length} attempt(s), ` +
            `${problems.length === 0 ? 'proven' : 'FAILED'}: digest ${solved.park}/${hydrated.park}, placement ${solved.layout}/${hydrated.layout}, ` +
            `plan ${solved.planCpuMs} ms searched -> ${hydrated.planCpuMs} ms hydrated (${(accepted.wallMs / 1000).toFixed(0)} s)` +
            (installed ? ` — written to ${PREBUILT_PARKS_OUT}/${seed}.json` : ' — NOT written'),
        );
      }
    }),
  );
  outcomes.sort((a, b) => seeds.indexOf(a.seed) - seeds.indexOf(b.seed));
  rmSync(scratch, { recursive: true, force: true });
  const controlProblem = control ? await control : 'no seed was proven, so the control had nothing to perturb';
  return { outcomes, controlProblem };
}

/**
 * **The codec's proof on one park, without the accept loop**: solve `seed` at
 * `restart` into a file, hydrate a second process from it, compare the two
 * built parks (whole-park digest, placement digest, nothing searched on the
 * hydrated side, the file's restart), and run the perturbed-file control. What
 * `build:parks` does to every file it checks in, minus finding which restart
 * to ship — so a check that only asks "does a file build the park it was
 * solved from" (`check:prebuilt-park`) pays one solve, not a seed's whole run
 * of attempts and their measures.
 */
export async function proveParkFile(
  seed: number,
  restart: number,
  outDir: string,
  log: (line: string) => void,
): Promise<{ readonly file: string; readonly solved: ProbeResult; readonly hydrated: ProbeResult; readonly raw: number; readonly problems: string[] }> {
  const file = join(outDir, `${seed}.json`);
  const solved = await probe('solve', seed, file, restart);
  const hydrated = await probe('hydrate', seed, file);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as ParkFile;
  const problems = compare(seed, restart, solved, hydrated, parsed);
  const controlProblem = await controlProblemOf(seed, file, hydrated, log);
  if (controlProblem) problems.push(controlProblem);
  log(`  seed ${seed} restart ${restart}: solved ${solved.park} / placement ${solved.layout}, hydrated ${hydrated.park} / placement ${hydrated.layout}`);
  return { file, solved, hydrated, raw: Buffer.byteLength(readFileSync(file)), problems };
}

export { builtRestartOf } from './builtParks.mts';

/**
 * What {@link validatePark} found.
 *
 * - `accepted` — this source accepts the checked-in park, and hydrates it into
 *   the placements its manifest line records. Nothing to do.
 * - `restamp` — this source accepts it, but the manifest line's placement
 *   digest is missing or is not what the current code builds: the same
 *   decisions now make a (slightly) different park. No solve is needed;
 *   `build:parks` rewrites the line, and the diff says the park moved.
 * - `rejected` — a clause failed, or the file is missing or not the one the
 *   manifest records. `build:parks` solves this seed again.
 * - `broken` — a measure could not measure. A bug in an instrument or in the
 *   hydrating code; no re-solve can fix it, so nothing is solved.
 */
export interface ParkValidation {
  readonly seed: number;
  readonly status: 'accepted' | 'restamp' | 'rejected' | 'broken';
  readonly seconds: number;
  /** Read from the local "already validated at this source" cache rather than measured now. */
  readonly cached: boolean;
  readonly restart: number | null;
  /** The placement digest the current code builds from the file; null when it was never built. */
  readonly layout: string | null;
  readonly recordedLayout: string | null;
  readonly fileSha: string | null;
  readonly failures: readonly AttemptFailure[];
  readonly broken: string | null;
  readonly measuresAsked: number;
  /** Measures only a solve can be asked, so not asked here (`park-attempt.mts`). */
  readonly askedOfASolveOnly: readonly string[];
}

const validatedDir = (root: string, sourceHash: string): string => join(root, '.cache', 'lgp-parks-validated', sourceHash);

interface ValidatedRecord {
  readonly file: string;
  readonly layout: string;
  readonly restart: number;
  readonly measuresAsked: number;
  readonly askedOfASolveOnly: readonly string[];
}

/**
 * **Does the current source still accept seed `seed`'s checked-in park?**
 * Never solves. In order:
 *
 * 1. the file is there, parses, and is this seed at this format; when the
 *    manifest has a line for it, the file is the one the line records (sha256)
 *    at the restart it records;
 * 2. hydrated in a fresh process, it passes **the acceptance attempt** — every
 *    invariant, every check measure, `check:park`, the simulated checks and
 *    `check:rail-race`, with nothing searched (`hydrate`) and nothing broken.
 *    The one owner of that list is `park-attempt.mts`; this passes
 *    `solveBacked: false`, so the measures that need a live search are named
 *    in `askedOfASolveOnly` rather than asked;
 * 3. the placement digest of the park it built is the manifest line's.
 *
 * `fresh: false` may answer from `.cache/lgp-parks-validated/<source hash>/`:
 * the same file already accepted at byte-identical source. Never in CI.
 */
export async function validatePark(root: string, seed: number, options: { readonly fresh?: boolean } = {}): Promise<ParkValidation> {
  const began = performance.now();
  const seconds = (): number => Math.round((performance.now() - began) / 100) / 10;
  const base = { seed, cached: false, restart: null, layout: null, recordedLayout: null, fileSha: null, broken: null, measuresAsked: 0, askedOfASolveOnly: [] };
  const refused = (measure: string, why: string): ParkValidation => ({
    ...base,
    status: 'rejected',
    seconds: seconds(),
    failures: [{ measure, count: 1, first: [why] }],
  });

  const manifest = readParksManifest(root);
  if (manifest && manifest.format !== PARK_FILE_FORMAT) {
    return refused('format', `${PREBUILT_PARKS_OUT}/${PREBUILT_PARKS_MANIFEST} is format ${manifest.format}, this source reads ${PARK_FILE_FORMAT}`);
  }
  const path = parkFilePath(root, seed);
  if (!existsSync(path)) return refused('checked-in file', `there is no ${PREBUILT_PARKS_OUT}/${seed}.json`);
  const bytes = readFileSync(path);
  const fileSha = parkFileSha(bytes);
  let file: ParkFile;
  try {
    file = JSON.parse(bytes.toString('utf8')) as ParkFile;
  } catch (error) {
    return refused('checked-in file', `${PREBUILT_PARKS_OUT}/${seed}.json does not parse (${String(error).slice(0, 120)})`);
  }
  if (file.seed !== seed || file.format !== PARK_FILE_FORMAT || !Number.isInteger(file.restart)) {
    return refused('checked-in file', `${PREBUILT_PARKS_OUT}/${seed}.json says seed ${file.seed}, format ${file.format}, restart ${file.restart}`);
  }
  const entry = manifest?.seeds[String(seed)] ?? null;
  if (entry && (entry.file !== fileSha || entry.restart !== file.restart)) {
    return refused(
      'checked-in file',
      `${PREBUILT_PARKS_OUT}/${seed}.json (sha256 ${fileSha.slice(0, 12)}, restart ${file.restart}) is not the file its manifest line records ` +
        `(${String(entry.file).slice(0, 12)}, restart ${entry.restart}) — it was changed by something other than build:parks`,
    );
  }
  const recordedLayout = entry?.layout || null;
  const verdictOf = (layout: string): 'accepted' | 'restamp' => (recordedLayout !== null && layout === recordedLayout ? 'accepted' : 'restamp');

  const sourceHash = parkSourceHash(root);
  const record = join(validatedDir(root, sourceHash), `${seed}.json`);
  const mayCache = !options.fresh && process.env['CI'] !== 'true';
  if (mayCache && existsSync(record)) {
    const known = JSON.parse(readFileSync(record, 'utf8')) as ValidatedRecord;
    if (known.file === fileSha && known.restart === file.restart) {
      return {
        ...base,
        status: verdictOf(known.layout),
        seconds: seconds(),
        cached: true,
        restart: file.restart,
        layout: known.layout,
        recordedLayout,
        fileSha,
        failures: [],
        measuresAsked: known.measuresAsked,
        askedOfASolveOnly: known.askedOfASolveOnly,
      };
    }
  }

  const verdict = await attemptInFreshProcess(seed, file.restart, path, undefined, { solveBacked: false });
  const measured = {
    ...base,
    seconds: seconds(),
    restart: file.restart,
    layout: verdict.layout,
    recordedLayout,
    fileSha,
    failures: verdict.failures,
    broken: verdict.broken,
    measuresAsked: verdict.measuresAsked,
    askedOfASolveOnly: verdict.askedOfASolveOnly,
  };
  if (verdict.parkFile === null) {
    return { ...measured, status: 'broken', broken: `the acceptance attempt did not hydrate ${PREBUILT_PARKS_OUT}/${seed}.json — it measured some other park` };
  }
  if (verdict.broken !== null) return { ...measured, status: 'broken' };
  if (!verdict.accepted || verdict.layout === null) return { ...measured, status: 'rejected' };
  // A verdict is about exactly the source it was measured at: remembered only
  // if nothing changed underneath it, and only outside CI.
  if (process.env['CI'] !== 'true' && parkSourceHash(root) === sourceHash) {
    const known: ValidatedRecord = {
      file: fileSha,
      layout: verdict.layout,
      restart: file.restart,
      measuresAsked: verdict.measuresAsked,
      askedOfASolveOnly: verdict.askedOfASolveOnly,
    };
    writeWhole(record, `${JSON.stringify(known)}\n`);
  }
  return { ...measured, status: verdictOf(verdict.layout) };
}

/** The command that puts one seed right, for a failure message. */
const fixCommand = (seed: number): string => `LGP_SEEDS=${seed} pnpm run build:parks`;

/**
 * One validation as the line(s) a person reads — on stderr, per seed, from
 * both `validate:parks` and `build:parks`. A rejection names the clause and
 * says exactly what to run.
 */
export function describeValidation(v: ParkValidation): string {
  const how = v.cached ? 'already accepted at this exact source (cached)' : `in ${v.seconds.toFixed(0)} s`;
  if (v.status === 'accepted') {
    return `seed ${v.seed} accepted ${how} — restart ${v.restart}, ${v.measuresAsked} measures, placement ${v.layout}`;
  }
  if (v.status === 'restamp') {
    return (
      `seed ${v.seed} PLACEMENT MOVED: accepted ${how} (${v.measuresAsked} measures), but this source builds placement digest ${v.layout} from ` +
      `${PREBUILT_PARKS_OUT}/${v.seed}.json where its manifest line records ${v.recordedLayout ?? '(none — never stamped)'}. The same decisions now make a ` +
      `different park. If you meant that, re-stamp it — no solve needed: run \`${fixCommand(v.seed)}\` and commit ${PREBUILT_PARKS_OUT}/${PREBUILT_PARKS_MANIFEST}. ` +
      'If you did not, your change moved the park.'
    );
  }
  if (v.status === 'broken') {
    return (
      `seed ${v.seed} COULD NOT BE MEASURED (${v.seconds.toFixed(0)} s): ${v.broken}. That is a bug in a measure or in the code that ` +
      'hydrates a park, which no re-solve can fix — nothing will be solved for it. Fix the cause.'
    );
  }
  const clauses = v.failures.map((f) => `${f.measure} x${f.count}: ${(f.first[0] ?? '').split('\n').join(' ').slice(0, 300)}`);
  return (
    `seed ${v.seed} REJECTED by ${clauses[0] ?? '(no clause named)'}` +
    (clauses.length > 1 ? ` [and ${clauses.length - 1} more: ${clauses.slice(1).map((c) => c.split(':')[0]).join(', ')}]` : '') +
    ` (${v.seconds.toFixed(0)} s). This source no longer accepts the checked-in park. If you meant to change park geometry, a footprint or a ` +
    `measure, run \`${fixCommand(v.seed)}\` (it re-solves only this seed) and commit ${PREBUILT_PARKS_OUT}/${v.seed}.json and ` +
    `${PREBUILT_PARKS_OUT}/${PREBUILT_PARKS_MANIFEST} with your change. If you did not, your change broke the park.`
  );
}

/** {@link validatePark} over `seeds`, `lanes` at a time, each verdict said on stderr as it lands. In seed order. */
export async function validateParks(
  root: string,
  seeds: readonly number[],
  lanes: number,
  options: { readonly fresh?: boolean; readonly label: string },
): Promise<ParkValidation[]> {
  const found: ParkValidation[] = [];
  const queue = [...seeds].reverse();
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, lanes), seeds.length) }, async () => {
      for (let seed = queue.pop(); seed !== undefined; seed = queue.pop()) {
        const validation = await validatePark(root, seed, options);
        process.stderr.write(`${options.label}: ${describeValidation(validation)}\n`);
        found.push(validation);
      }
    }),
  );
  return found.sort((a, b) => seeds.indexOf(a.seed) - seeds.indexOf(b.seed));
}
