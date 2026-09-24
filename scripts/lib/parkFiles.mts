/**
 * **Solve parks into park files, and prove each file builds the park it was
 * solved from.** Shared by `build:parks` (every pool seed, for shipping) and
 * `check:prebuilt-park` (the canonical seed, in the check chain) — see
 * `docs/design/PREBUILT-PARKS.md`.
 *
 * Per seed, two processes of `scripts/park-file-probe.mts`:
 *
 * - **solve** — a fresh search, the park built, digested, and the file written;
 * - **hydrate** — the file offered before anything forces the plan, the park
 *   built from it, digested.
 *
 * A seed passes when the two digests are equal **and** the hydrate process
 * really hydrated: it says so, it never constructed the backtracking driver,
 * and every feature the file carries ran zero search pieces. The second half is not decoration: a hydrate that
 * quietly fell back to searching would build the identical park and pass the
 * first half on nothing.
 *
 * And once per run, the **control on the instrument**: the first seed's file is
 * hydrated again with the Sky Cruiser raised half a metre (`perturb`), and that
 * digest must *differ*. If it does not, the comparison cannot see the file's
 * contents at all, and every "equal" above means nothing.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const run = promisify(execFile);

export interface ProbeResult {
  readonly mode: string;
  readonly seed: number;
  readonly park: string;
  readonly meshes: number;
  readonly byName: Readonly<Record<string, string>>;
  readonly hydrated: boolean;
  readonly driverRan: boolean;
  readonly piecesByHydratedFeature: Readonly<Record<string, number>>;
  readonly planCpuMs: number;
  readonly worldBuildMs: number;
  readonly bytes: number;
}

export interface SeedOutcome {
  readonly seed: number;
  readonly file: string;
  readonly solved: ProbeResult;
  readonly hydrated: ProbeResult;
  readonly raw: number;
  readonly gzip: number;
  readonly brotli: number;
  /** Empty when the file is proven; otherwise why not. */
  readonly problems: readonly string[];
}

async function probe(mode: 'solve' | 'hydrate' | 'perturb', seed: number, file: string): Promise<ProbeResult> {
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
      env: { ...process.env, LGP_SEED: String(seed) },
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    }));
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string };
    const tail = `${failed.stderr ?? ''}\n${failed.stdout ?? ''}`.trim().split('\n').slice(-12).join('\n');
    throw new Error(`park-file-probe ${mode} seed ${seed} failed:\n${tail || failed.message}`);
  }
  const last = stdout.trim().split('\n').at(-1) ?? '';
  return JSON.parse(last) as ProbeResult;
}

function compare(solved: ProbeResult, hydrated: ProbeResult): string[] {
  const problems: string[] = [];
  if (!hydrated.hydrated) problems.push('the hydrate process did not hydrate — it solved, so its digest proves nothing');
  if (hydrated.driverRan) problems.push('the hydrate process constructed the backtracking driver — the client has none, so this is not the path that ships');
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

/** Solve, write and prove one park file per seed, `lanes` seeds at a time. */
export async function buildAndVerify(
  seeds: readonly number[],
  outDir: string,
  lanes: number,
  log: (line: string) => void,
): Promise<{ outcomes: SeedOutcome[]; controlProblem: string | null }> {
  const queue = [...seeds].reverse();
  const outcomes: SeedOutcome[] = [];
  const worker = async (): Promise<void> => {
    for (let seed = queue.pop(); seed !== undefined; seed = queue.pop()) {
      const began = performance.now();
      const file = join(outDir, `${seed}.json`);
      const solved = await probe('solve', seed, file);
      const hydrated = await probe('hydrate', seed, file);
      const bytes = readFileSync(file);
      const outcome: SeedOutcome = {
        seed,
        file,
        solved,
        hydrated,
        raw: bytes.length,
        gzip: gzipSync(bytes, { level: 9 }).length,
        brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
        problems: compare(solved, hydrated),
      };
      outcomes.push(outcome);
      log(
        `  seed ${String(seed).padStart(8)}: ${outcome.problems.length === 0 ? 'proven' : 'FAILED'} ` +
          `digest ${solved.park}/${hydrated.park}, plan ${solved.planCpuMs} ms searched -> ${hydrated.planCpuMs} ms hydrated, ` +
          `${outcome.raw} B (${((performance.now() - began) / 1000).toFixed(1)} s)`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, lanes) }, worker));
  outcomes.sort((a, b) => seeds.indexOf(a.seed) - seeds.indexOf(b.seed));

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
