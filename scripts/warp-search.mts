/**
 * **The offline warp search** — find, per seed, the smallest warp vector
 * under which the park passes its gates with the level-crossing tier empty
 * (Jim, 2 Sep 2026: zero level crossings, warping preferred to
 * backtracking).
 *
 * ```
 * pnpm run warp:search -- 20260728 5 288 326       # search these seeds
 * pnpm run warp:search -- 20260728 --out results.jsonl
 * ```
 *
 * ## How it searches
 *
 * Candidates are tried cheapest-and-most-local first, exactly Jim's
 * preference order (warp before backtrack):
 *
 *  1. the empty vector (the seed may already pass);
 *  2. one-entry layout bumps — `{layout:{<id>: 1..BUMPS}}` for every
 *     manifest entry, most local first (one attraction re-draws its spot,
 *     everything else holds still);
 *  3. whole-layout re-rolls — `{layoutRestart: 1..RESTARTS}` — the
 *     structured backtrack, only reached when no local move worked.
 *
 * Each candidate is a **complete fresh out-of-process solve** (module state
 * makes in-process re-solving impossible), scored by `check:park` (the
 * level tier no longer exists to switch off — every crossing is a bridge
 * on this branch): a park scores
 * `Infinity` unless every attraction routes and there are zero illegal rail
 * crossings, otherwise its score is its stranded-waypoint count. The first
 * zero wins; the search stops there for that seed.
 *
 * The winner is NOT trusted on `check:park` alone: it is re-proved with the
 * unallowanced oracle (`vitest run` filtered to the seed's own invariant
 * file) when the seed has one. Every verdict is appended to the JSONL
 * results file the moment it is known — a search that only exists in a
 * scrollback has to be run again.
 *
 * ## Control on the instrument
 *
 * `--control` runs the scorer twice on the unwarped canonical seed
 * and asserts both runs parse to the same score
 * and that the score is 0 — proving the parser reads the real summary
 * rather than its own expectations, before any measuring is believed.
 */
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

interface WarpVector {
  readonly layout?: Record<string, number>;
  readonly layoutRestart?: number;
  readonly banCrossingsAt?: readonly number[];
}

interface Score {
  /**
   * The whole gate, exactly as `vet-seed-pool.mts` applies it to every pool
   * candidate: `check:park` exit 0 WITH the ratchet live. The first
   * canonical winner under a ratchet-off scorer ({layout:{fountain:1}})
   * strands nothing yet overbuilds waterFight's declared radius — a
   * regression only the ratchet catches. A winner must be `ok`.
   */
  readonly ok: boolean;
  /** Infinity = park invalid (attraction unrouted / illegal crossing / crash). */
  readonly stranded: number;
  readonly summary: string;
}

const BUMPS = 2;
const RESTARTS = 6;

/** Manifest entry ids, read from the layout itself so the list cannot rot. */
async function entryIds(): Promise<string[]> {
  const probe =
    'const {PARK_LAYOUT} = await import("./src/world/parkLayout.ts");' +
    'console.log([...PARK_LAYOUT.entries.keys()].join("\\n"));';
  const { stdout } = await run(
    process.execPath,
    ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', '--input-type=module', '-e', probe],
    { env: { ...process.env } },
  );
  return stdout.trim().split('\n').filter(Boolean);
}

async function score(seed: number, warp: WarpVector | null): Promise<Score> {
  // Ratchet ON (the default): the pool's own standard — `vet-seed-pool.mts`
  // rejects any seed that trips a recorded deviation, so the search must
  // score against exactly that gate or its winners are not admissible.
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    LGP_SEED: String(seed),
  };
  if (warp) env['LGP_WARP'] = JSON.stringify(warp);
  let out: string;
  let ok = false;
  try {
    const result = await run(
      process.execPath,
      ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', 'scripts/check-park.mts'],
      { env, maxBuffer: 16 * 1024 * 1024 },
    );
    out = result.stdout + result.stderr;
    ok = true;
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    out = `${e.stdout ?? ''}${e.stderr ?? ''}` || e.message;
  }
  const summary = out.split('\n').find((l) => l.startsWith('check:park:')) ?? '(no summary)';
  const attractions = /(\d+)\/(\d+) attractions route/.exec(summary);
  const crossings = /(\d+) rail crossing\(s\)/.exec(summary);
  const waypoints = /(\d+)\/(\d+) waypoints connected/.exec(summary);
  if (!attractions || !crossings || !waypoints) return { ok: false, stranded: Infinity, summary };
  if (attractions[1] !== attractions[2]) return { ok: false, stranded: Infinity, summary };
  if (crossings[1] !== '0') return { ok: false, stranded: Infinity, summary };
  return { ok, stranded: Number(waypoints[2]) - Number(waypoints[1]), summary };
}

/** Cheapest-first candidate vectors: nothing, then local bumps, then re-rolls. */
function candidates(ids: readonly string[]): (WarpVector | null)[] {
  const list: (WarpVector | null)[] = [null];
  for (let bump = 1; bump <= BUMPS; bump += 1) {
    for (const id of ids) list.push({ layout: { [id]: bump } });
  }
  for (let r = 1; r <= RESTARTS; r += 1) list.push({ layoutRestart: r });
  return list;
}

const INVARIANT_FILES: Record<number, string> = {
  20260728: 'test/procgen/seed-canonical.test.ts',
  5: 'test/procgen/seed-5.test.ts',
  11: 'test/procgen/seed-11.test.ts',
  24: 'test/procgen/seed-24.test.ts',
};

async function proveWithOracle(seed: number, warp: WarpVector | null): Promise<'pass' | 'fail' | 'not covered'> {
  const file = INVARIANT_FILES[seed];
  if (!file) return 'not covered';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };
  if (warp) env['LGP_WARP'] = JSON.stringify(warp);
  try {
    await run('npx', ['vitest', 'run', file], { env, maxBuffer: 64 * 1024 * 1024 });
    return 'pass';
  } catch {
    return 'fail';
  }
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const outFile = (() => {
  const i = args.indexOf('--out');
  return i >= 0 ? (args.splice(i, 2)[1] as string) : 'warp-search.jsonl';
})();

if (args.includes('--control')) {
  const a = await score(20260728, null);
  const b = await score(20260728, null);
  // The summary ends in wall-clock ms, which honestly differs run to run;
  // the park facts before it must not.
  const facts = (s: Score) => s.summary.replace(/ \d+ ms\.$/, '');
  if (!a.ok || !b.ok || a.stranded !== 0 || b.stranded !== 0 || facts(a) !== facts(b)) {
    console.error(`CONTROL FAILED:\n a=${a.stranded} ${a.summary}\n b=${b.stranded} ${b.summary}`);
    process.exit(1);
  }
  console.log(`control ok: unwarped canonical scores 0 twice, summaries identical`);
  process.exit(0);
}

const seeds = args.map(Number).filter((n) => Number.isFinite(n));
if (seeds.length === 0) throw new Error('give me seeds, or --control');

const ids = await entryIds();
console.log(`${ids.length} manifest entries; ${candidates(ids).length} candidate vectors per seed`);

for (const seed of seeds) {
  const started = Date.now();
  let winner: { warp: WarpVector | null; score: Score } | null = null;
  let best: { warp: WarpVector | null; score: Score } | null = null;
  let tried = 0;
  let oracleRejections = 0;
  let winnerOracle: 'pass' | 'not covered' | 'not run' = 'not run';
  for (const warp of candidates(ids)) {
    const s = await score(seed, warp);
    tried += 1;
    const better =
      best === null ||
      (s.ok && !best.score.ok) ||
      (s.ok === best.score.ok && s.stranded < best.score.stranded);
    if (better) best = { warp, score: s };
    if (s.ok && s.stranded === 0) {
      // The oracle sits INSIDE the acceptance loop: canonical's first two
      // check:park winners built parks the invariants reject (walls off the
      // kerb, spurs branching off nothing) — a candidate is not a winner
      // until the unallowanced oracle has nothing to say either.
      const verdict = await proveWithOracle(seed, warp);
      if (verdict === 'fail') {
        oracleRejections += 1;
        continue;
      }
      winnerOracle = verdict;
      winner = { warp, score: s };
      break;
    }
  }
  const chosen = winner ?? best;
  const oracle = winnerOracle;
  const record = {
    seed,
    solved: winner !== null,
    gate: chosen?.score.ok ? 'ratchet-on pass' : 'fails gate',
    oracleRejections,
    warp: chosen?.warp ?? null,
    stranded: chosen?.score.stranded ?? Infinity,
    oracle,
    tried,
    seconds: Math.round((Date.now() - started) / 1000),
    summary: chosen?.score.summary ?? '',
  };
  appendFileSync(outFile, `${JSON.stringify(record)}\n`);
  console.log(
    `seed ${seed}: ${record.solved ? 'SOLVED' : 'UNSOLVED'} after ${tried} candidates ` +
      `(${record.seconds}s) warp=${JSON.stringify(record.warp)} stranded=${record.stranded} oracle=${oracle}`,
  );
}
