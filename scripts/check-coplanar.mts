/**
 * **No new pair of faces may come to share a plane.**
 *
 * ```
 * pnpm run check:coplanar              # every space, every shipped seed
 * pnpm run check:coplanar -- --verbose # and print the whole ranked backlog
 * pnpm run check:coplanar -- --print-baseline > scripts/coplanar-baseline.mts
 * LGP_RATCHET=off pnpm run check:coplanar   # report the drift, do not fail
 * ```
 *
 * Two faces in one plane make the depth buffer strobe as the camera moves.
 * `ART_DIRECTION.md` §7 forbids it and its pre-commit checklist has said "no
 * two faces share a plane" for weeks — but nobody could *run* that line, so it
 * rotted, and Jim reported the same flicker three times in one week. This is
 * the command that makes it a rule again. `coplanar-sweep.mts` is the
 * measurement and `coplanar-rank.mts` the ordering; this file is only the gate.
 *
 * ## Every space, derived rather than listed
 *
 * The game is not one coordinate system: the castle's floors stand 300 m apart
 * at their own origins and the hotel's rooms 600 m from the park. They are all
 * in one `Scene` — `World` adds `building.interiorRoot` and `hotel.hotelRoot`
 * beside the park's own groups — so the sweep sees them for free, and each
 * finding is filed under whatever **`world/spaces.ts`'s `spaceAt`** says it is
 * standing in. That is the same function the lift and every doorway ask, so a
 * room added tomorrow appears in this report on the day it exists. Nothing here
 * keeps a list of rooms, because #472 asked for exactly that: *"a hand-written
 * list is how a room quietly stops being checked."*
 *
 * The seeds are derived too, off `world/parkSeedPool.ts`'s
 * `SUPPORTED_PARK_SEEDS` — every park the game ships, each at its recorded
 * restart. A seam that only shows on one seed is one that some child is
 * looking at.
 *
 * ## What varies by seed and what does not
 *
 * Interiors are authored, not generated: they are identical on every seed. So
 * the first shipped seed sweeps everything and the rest sweep only the garden,
 * which is the half that moves. Each seed is a child process because
 * `parkManifest.ts` reads `LGP_SEED` once, at import — the module registry has
 * to be fresh, which is the same reason `sweep-park-seeds.mts` shells out.
 *
 * ## A ratchet, not a cleanup
 *
 * There are hundreds of these today and there is no version of this that starts
 * by fixing them all. So `coplanar-baseline.mts` records what stands as of
 * #472 and this fails on **new entries and worse ones only** — the same shape
 * as `check-park.mts`'s `RATCHET`, and for the same reason: a gate that can be
 * satisfied today gets enforced tomorrow, and one that cannot gets deleted.
 * It is in its own file rather than inline because it is generated and long;
 * `--print-baseline` regenerates it, and the diff is the review.
 *
 * **Do not add an entry to make this pass.** An entry says "this was already
 * wrong when the gate was written". A new one says "I made a new one", and the
 * fix is `ART_DIRECTION.md`'s: delete the hidden face, never offset a surface.
 */
import './headless-canvas.mjs';
import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { promisify } from 'node:util';
import { buildHeadlessPark } from './park-harness.mts';
import { DEFAULT_TOLERANCES, sweepCoplanar } from './coplanar-sweep.mts';
import { rankSeams, type RankedSeam } from './coplanar-rank.mts';
import { COPLANAR_BASELINE } from './coplanar-baseline.mts';
import {
  coplanarRegressions,
  keyOf,
  worstPerKey,
  type RatchetWorst,
} from './lib/coplanarRatchet.mts';
import { PARK_SEED_ASKED } from '../src/world/parkManifest.ts';
import { SUPPORTED_PARK_SEEDS } from '../src/world/parkSeedPool.ts';
import { SPACE_GARDEN } from '../src/world/spaces.ts';

const verbose = process.argv.includes('--verbose');
const printBaseline = process.argv.includes('--print-baseline');
/** Set on the child processes this script spawns, one per seed. */
const isChild = process.env['LGP_COPLANAR_CHILD'] === '1';

// ------------------------------------------------------------------ the seeds

/**
 * **Every park this game ships** — `world/parkSeedPool.ts`'s
 * `SUPPORTED_PARK_SEEDS` (0..15), the one owner of the shipped set, each built
 * at the restart `acceptedRestarts.ts` recorded for it (`LGP_SEED=s` alone
 * does that, so a child process builds exactly the park the browser does).
 *
 * This was the old draw pool, and seeds 0..15 were never swept: another
 * branch's CI swept them and found sixteen seams nobody had measured. Jim's
 * ruling: every shipped seed must pass every check. Asking the owner rather
 * than keeping a list here means a seed added to it is swept the day it is.
 */
function shippedSeeds(): number[] {
  return [...new Set(SUPPORTED_PARK_SEEDS)].sort((a, b) => a - b);
}

// ------------------------------------------------------------ one seed's sweep

/** What a child process hands back, and what the parent gates on. */
interface Finding {
  readonly key: string;
  readonly space: string;
  readonly area: number;
  readonly separation: number;
  readonly reach: number;
  readonly score: number;
  readonly occluded: boolean;
  readonly seed: number;
  /**
   * The **two objects as they are really named**, before {@link stableName}
   * folds a bridge's rail distance out of them — so the seam count below can
   * ask its question of one bridge at a time rather than of all of them at
   * once. See {@link facingsPerInstance}.
   */
  readonly instance: string;
  /**
   * The shared plane's normal. Carried because a finding is split off from its
   * neighbour by nothing more than that normal, and the seam count has to know
   * whether two findings are two facings or one surface bending. Plain numbers
   * rather than a `Vector3`: every finding crosses a process boundary as JSON.
   */
  readonly normal: readonly [number, number, number];
}


function sweepThisSeed(): Finding[] {
  const park = buildHeadlessPark();
  const result = sweepCoplanar(park.scene, DEFAULT_TOLERANCES);
  // Interiors are authored and identical on every seed, so only the first
  // seed's run reports them; the rest are here for the park, which moves.
  //
  // Dropped **before** ranking, not after. Ranking is the expensive half — a
  // sight-line ray against every mesh in the game, then a ring search for
  // somewhere to stand, per seam — and three quarters of the seams on a garden
  // run are indoors and about to be thrown away. Doing it the tidy way round
  // cost fifteen seeds' worth of raycasting for nothing, which on a two-core CI
  // runner is minutes, against a workflow whose 30-minute cap has taken this
  // project's deploy down once already.
  const gardenOnly = process.env['LGP_COPLANAR_GARDEN_ONLY'] === '1';
  const mine = gardenOnly
    ? result.pairs.filter((pair) => pair.space === SPACE_GARDEN)
    : result.pairs;
  const ranked = rankSeams(mine, {
    scene: park.scene,
    collision: park.world.collision,
    sample: park.sample,
  });
  return ranked
    .map((seam) => ({
      key: keyOf(seam),
      space: seam.space,
      area: seam.area,
      separation: seam.separation,
      reach: seam.reach,
      score: seam.score,
      occluded: seam.occluded,
      // The seed as shipped (what `?seed=` names), not the generation seed a
      // restart derives from it — a report has to name a park somebody can open.
      seed: PARK_SEED_ASKED,
      instance: `${seam.a}|${seam.b}`,
      normal: [seam.normal.x, seam.normal.y, seam.normal.z] as const,
    }));
}

if (isChild) {
  // Exit only once the write has been flushed. stdout is a PIPE here, and on
  // POSIX a pipe write is asynchronous: `process.exit()` straight after a
  // 100–150 KB write can drop it, so the parent reads an EMPTY stdout from a
  // child that exited 0 and dies in `JSON.parse('')` — which Node prints as
  // `<anonymous_script>:1` and nothing else. That is what the CI run on the
  // procgen-on-sphere branch showed, twice, while every child ran clean
  // locally: timing, not geometry.
  process.stdout.write(`${JSON.stringify(sweepThisSeed())}\n`, () => process.exit(0));
} else {


// ------------------------------------------------------------ across the pool

const started = performance.now();
const seeds = shippedSeeds();
const findings: Finding[] = [];

/**
 * Every seed in a child of its own, several at a time — including the first.
 *
 * `parkManifest.ts` reads `LGP_SEED` once, at import, so this process's own
 * registry is whatever park Node builds with nothing pinned, which is not a
 * shipped one; sweeping it in-process would measure a park no child is given.
 * The first shipped seed's child sweeps every space, since interiors are the
 * same on every seed; the others sweep only the garden.
 *
 * Each child is a whole park built and swept in a process of its own, so they
 * are independent by construction — nothing is shared but the baseline they
 * are all compared against afterwards.
 *
 * **Never fewer than two lanes**, whatever the machine says. This was
 * `floor(cores / 2)`, which is fine on a laptop and collapses to a single lane
 * on a two-core CI runner — sixteen parks in a row, inside a workflow whose
 * 30-minute cap has taken this project's deploy down once already. Capped at
 * six because each child peaks around a quarter of a gigabyte holding the
 * park's triangles, and a machine that starts swapping would be slower than
 * doing them in a row.
 */
const lanes = Math.max(2, Math.min(6, cpus().length));
const everySpaceSeed = seeds[0];
// Popped from the end, so reversed: the every-space seed, the longest job, starts first.
const queue = [...seeds].reverse();
const run = promisify(execFile);
await Promise.all(
  Array.from({ length: lanes }, async () => {
    for (let seed = queue.pop(); seed !== undefined; seed = queue.pop()) {
      const { stdout } = await run(
        process.execPath,
        [
          '--no-warnings',
          '--import',
          './scripts/ts-extension-resolver-register.mjs',
          'scripts/check-coplanar.mts',
        ],
        {
          env: {
            ...process.env,
            LGP_SEED: String(seed),
            LGP_COPLANAR_CHILD: '1',
            LGP_COPLANAR_GARDEN_ONLY: seed === everySpaceSeed ? '0' : '1',
          },
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        },
      );
      const last = stdout.trim().split('\n').at(-1) ?? '';
      let parsed: Finding[];
      try {
        parsed = JSON.parse(last) as Finding[];
      } catch (error) {
        throw new Error(
          `check:coplanar: seed ${seed}'s sweep child exited 0 but its last stdout line is not JSON ` +
            `(${stdout.length} bytes of stdout, last line ${last.length} bytes: ${JSON.stringify(last.slice(0, 120))}) — ` +
            `${(error as Error).message}`,
        );
      }
      findings.push(...parsed);
    }
  }),
);

// --------------------------------------------------------- baseline printing

const BASELINE_HEADER = `/**
 * **Every coplanar seam that already existed when #472's gate was written.**
 *
 * Generated — \`pnpm run check:coplanar -- --print-baseline\`. Do not hand-edit
 * to make a check pass: an entry here means "this was already wrong", and a
 * finding that is not here means somebody has just made a new one.
 *
 * \`area\` is the worst shared plane seen across the seed pool, in square
 * metres. Where two objects meet in two *parallel* planes those fold into one
 * entry and this is their sum, so a second seam between the same two things
 * shows up here as growth.
 *
 * \`seams\` is how many distinct **facings** the two share on the worst single
 * seed, and on the worst single pair of real objects folded into the key. Two
 * objects can meet pointing more than one way, and two different objects can
 * share a path — \`hotel.wall\` appears twice below, because both meshes are
 * called that — so without a count a third wall joining an existing key would
 * pass in silence. Facings 15° or less apart are one facing: a surface that
 * bends is not two ways of meeting. A model the park builds twice is not two
 * either.
 *
 * \`fighting\` is true where the two faces are within 0.1 mm — the depth buffer
 * has nothing to resolve and the seam strobes now; false means they are held
 * apart by a maintained stand-off under 1 cm, which \`ART_DIRECTION.md\` calls a
 * smell in its own right.
 *
 * The way an entry leaves this table is by the seam being fixed, at which point
 * \`check:coplanar\` prints BASELINE LOOSE and asks for the line to be deleted.
 */

/** The worst a known seam has been measured at. */
export interface BaselineEntry {
  /** Square metres of shared plane, worst across the pool. */
  readonly area: number;
  /** Distinct facings these two shared, on the worst single seed. */
  readonly seams: number;
  /** True where the faces are within 0.1 mm of each other. */
  readonly fighting: boolean;
}

export const COPLANAR_BASELINE: Readonly<Record<string, BaselineEntry>> = {
`;

const BASELINE_FOOTER = `
};
`;

/**
 * Seed order, restored.
 *
 * The children finish in whatever order the machine gets round to them, and
 * two seeds can produce the same seam at exactly the same area — the entrance
 * road is the entrance road on every seed. Which of those two identical
 * findings is kept as the report's example then depends on which child
 * returned first, and the "buried where no camera can reach them" count moved
 * by one between a serial run and a parallel one because of it. Nothing the
 * gate decides depended on the order; the summary did, and a number that moves
 * on its own is a number nobody can act on.
 */
findings.sort((a, b) => a.seed - b.seed || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

// ------------------------------------------------------------------ the gate


/** Worst seen per key across the pool (`worstPerKey`), with the seed that shows each off worst. */
const worst = new Map<string, RatchetWorst & { best: Finding }>();
{
  const bestOf = new Map<string, Finding>();
  for (const finding of findings) {
    const previous = bestOf.get(finding.key);
    // `findings` is in seed order, so `>` rather than `>=` keeps the lowest
    // seed of any tie and the report cannot wobble.
    if (!previous || finding.score > previous.score) bestOf.set(finding.key, finding);
  }
  for (const [key, entry] of worstPerKey(findings)) worst.set(key, { ...entry, best: bestOf.get(key) as Finding });
}

if (printBaseline) {
  const lines: string[] = [];
  // Biggest first, and the key breaks the ties: a great many of these are the
  // same fitting repeated in every room, so without a tie-break the file's line
  // order would depend on which child process happened to answer first and the
  // diff — which is the whole review — would be noise.
  const ordered = [...worst.entries()].sort(
    (a, b) => b[1].area - a[1].area || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  for (const [key, entry] of ordered) {
    lines.push(
      `  ${JSON.stringify(key)}: { area: ${entry.area.toFixed(4)}, seams: ${entry.seams}, ` +
        `fighting: ${entry.separation <= DEFAULT_TOLERANCES.fighting} },`,
    );
  }
  process.stdout.write(BASELINE_HEADER + lines.join('\n') + BASELINE_FOOTER);
  process.exit(0);
}

/**
 * `LGP_RATCHET=off` — report the drift, do not fail on it.
 *
 * The same switch `check-park.mts` honours, spelled the same way, because a
 * second shape for "the recorded allowances are not the point of this run"
 * would be one more thing to remember. It exists for the same job: somebody
 * vetting a *candidate* seed (`vet-seed-pool.mts`) wants to know what a park
 * built from it looks like, and failing them for seams the pool inherited from
 * the modelling would tell them nothing about the seed.
 *
 * The canonical run never sets it, CI never sets it, and it can only ever make
 * this print more and exit 0 — it cannot hide a finding, because every
 * regression is still listed, just not fatal.
 */
const ratchetEnforced = process.env['LGP_RATCHET'] !== 'off';

const regressions: string[] = coplanarRegressions(worst, (key) => worst.get(key)?.best.seed ?? -1);

const loose: string[] = [];
for (const key of Object.keys(COPLANAR_BASELINE)) {
  if (!worst.has(key)) loose.push(key);
}

// ------------------------------------------------------------------- report

const ranked = [...worst.entries()]
  .filter(([, entry]) => !entry.best.occluded)
  .sort((a, b) => b[1].best.score - a[1].best.score);
const fightingCount = [...worst.values()].filter(
  (entry) => entry.separation <= DEFAULT_TOLERANCES.fighting,
).length;
const occluded = [...worst.values()].filter((entry) => entry.best.occluded).length;

if (verbose || regressions.length > 0) {
  console.log('\nranked backlog — visible area ÷ how close a child gets:\n');
  for (const [key, entry] of ranked.slice(0, verbose ? ranked.length : 12)) {
    console.log(
      `  ${entry.best.score.toFixed(2).padStart(8)}  ${entry.area.toFixed(2)} m²  ` +
        `${entry.best.reach.toFixed(1)} m away  ${entry.separation.toExponential(1)} m apart\n` +
        `            ${key.split('|').slice(1).join('\n            ')}`,
    );
  }
  console.log('');
}

for (const key of loose) {
  console.log(
    `BASELINE LOOSE: ${key} is gone — delete its entry from scripts/coplanar-baseline.mts.`,
  );
}

if (regressions.length > 0) {
  const say = ratchetEnforced ? console.error : console.log;
  say(
    `check:coplanar — ${regressions.length} new or worse coplanar seam(s)` +
      `${ratchetEnforced ? '' : ' (LGP_RATCHET=off, so reported and not enforced)'}:\n`,
  );
  for (const line of regressions) say(`  ${line}`);
  if (ratchetEnforced) {
    console.error(
      '\nART_DIRECTION.md §7: delete the hidden face, do not offset a surface. An' +
        '\noffset is a number somebody has to maintain and it goes stale the moment' +
        '\neither surface moves. Do not silence this by editing coplanar-baseline.mts.',
    );
    process.exit(1);
  }
}

console.log(
  `check:coplanar OK — ${worst.size} same-facing coplanar seam(s) across ${seeds.length} seed(s) ` +
    `and ${new Set([...worst.values()].map((e) => e.best.space)).size} space(s): ` +
    `${fightingCount} fighting at ${DEFAULT_TOLERANCES.fighting * 1000} mm, ` +
    `${worst.size - fightingCount} more held apart by a stand-off under ` +
    `${DEFAULT_TOLERANCES.near * 100} cm, of which ${occluded} are buried where no camera can ` +
    // The one line anybody reads has to be true on the run where the gate was
    // switched off, or `LGP_RATCHET=off` becomes a way to get a green summary
    // over a red result — which is this repo's own commonest instrument bug,
    // built in on purpose.
    `reach them. ${
      regressions.length === 0
        ? 'All of them are in the baseline; none is new.'
        : `${regressions.length} new or worse, listed above and NOT enforced because LGP_RATCHET=off.`
    } ${((performance.now() - started) / 1000).toFixed(1)} s.`,
);
}
