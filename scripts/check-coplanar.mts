/**
 * **No new pair of faces may come to share a plane.**
 *
 * ```
 * pnpm run check:coplanar              # every space, every procgen seed
 * pnpm run check:coplanar -- --verbose # and print the whole ranked backlog
 * pnpm run check:coplanar -- --print-baseline > scripts/coplanar-baseline.mts
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
 * The seeds are derived too, off `test/procgen`'s own `seed-*.test.ts` files,
 * so the pool this sweeps is by construction the pool the invariants run on.
 *
 * ## What varies by seed and what does not
 *
 * Interiors are authored, not generated: they are identical on every seed. So
 * the canonical seed sweeps everything and the rest of the pool sweeps only the
 * garden, which is the half that moves. Each seed is a child process because
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
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { buildHeadlessPark } from './park-harness.mts';
import { DEFAULT_TOLERANCES, sweepCoplanar } from './coplanar-sweep.mts';
import { rankSeams, type RankedSeam } from './coplanar-rank.mts';
import { COPLANAR_BASELINE, type BaselineEntry } from './coplanar-baseline.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { SPACE_GARDEN } from '../src/world/spaces.ts';

const verbose = process.argv.includes('--verbose');
const printBaseline = process.argv.includes('--print-baseline');
/** Set on the child processes this script spawns, one per seed. */
const isChild = process.env['LGP_COPLANAR_CHILD'] === '1';

// ------------------------------------------------------------------ the seeds

/**
 * The procgen seed pool, read off `test/procgen`'s own files.
 *
 * Not typed out here: the pool is `test/procgen`'s to decide, it is being
 * widened as this lands (#463), and a second copy of it would be exactly the
 * bug `CLAUDE.md` opens with. The canonical seed is `parkManifest.ts`'s.
 */
function procgenSeeds(): number[] {
  const seeds = new Set<number>([PARK_SEED]);
  for (const file of readdirSync(new URL('../test/procgen', import.meta.url))) {
    const match = /^seed-(\d+)\.test\.ts$/.exec(file);
    if (match) seeds.add(Number(match[1]));
  }
  return [...seeds].sort((a, b) => a - b);
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
}

/**
 * The ratchet key: which space, and which two things met in it.
 *
 * Deliberately not a coordinate and not a triangle index — both move when the
 * park is regenerated, and a baseline that has to be rewritten on every seed is
 * a baseline nobody keeps. Two objects that share a plane share it on every
 * seed, so this is stable in exactly the way the geometry is.
 */
function keyOf(seam: RankedSeam): string {
  return `${seam.space}|${seam.a}|${seam.b}`;
}

function sweepThisSeed(): Finding[] {
  const park = buildHeadlessPark();
  const result = sweepCoplanar(park.scene, DEFAULT_TOLERANCES);
  const ranked = rankSeams(result.pairs, {
    scene: park.scene,
    collision: park.world.collision,
    sample: park.sample,
  });
  // Interiors are authored and identical on every seed, so only the canonical
  // run reports them; the rest of the pool is here for the park, which moves.
  const gardenOnly = process.env['LGP_COPLANAR_GARDEN_ONLY'] === '1';
  return ranked
    .filter((seam) => !gardenOnly || seam.space === SPACE_GARDEN)
    .map((seam) => ({
      key: keyOf(seam),
      space: seam.space,
      area: seam.area,
      separation: seam.separation,
      reach: seam.reach,
      score: seam.score,
      occluded: seam.occluded,
      seed: PARK_SEED,
    }));
}

if (isChild) {
  process.stdout.write(`${JSON.stringify(sweepThisSeed())}\n`);
  process.exit(0);
}

// ------------------------------------------------------------ across the pool

const started = performance.now();
const seeds = procgenSeeds();
const findings: Finding[] = [];

/** The canonical seed is swept in-process; the others need a fresh registry. */
findings.push(...sweepThisSeed());
for (const seed of seeds) {
  if (seed === PARK_SEED) continue;
  const out = execFileSync(
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
        LGP_COPLANAR_GARDEN_ONLY: '1',
      },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  findings.push(...(JSON.parse(out.trim().split('\n').at(-1) as string) as Finding[]));
}

// --------------------------------------------------------- baseline printing

const BASELINE_HEADER = `/**
 * **Every coplanar seam that already existed when #472's gate was written.**
 *
 * Generated — \`pnpm run check:coplanar -- --print-baseline\`. Do not hand-edit
 * to make a check pass: an entry here means "this was already wrong", and a
 * finding that is not here means somebody has just made a new one.
 *
 * \`area\` is the worst (largest) shared plane seen across the seed pool, in
 * square metres. \`fighting\` is true where the two faces are within 0.1 mm —
 * the depth buffer has nothing to resolve and the seam strobes now; false means
 * they are held apart by a maintained stand-off under 1 cm, which
 * \`ART_DIRECTION.md\` calls a smell in its own right.
 *
 * The way an entry leaves this table is by the seam being fixed, at which point
 * \`check:coplanar\` prints BASELINE LOOSE and asks for the line to be deleted.
 */

/** The worst a known seam has been measured at. */
export interface BaselineEntry {
  /** Square metres of shared plane, worst across the pool. */
  readonly area: number;
  /** True where the faces are within 0.1 mm of each other. */
  readonly fighting: boolean;
}

export const COPLANAR_BASELINE: Readonly<Record<string, BaselineEntry>> = {
`;

const BASELINE_FOOTER = `
};
`;

// ------------------------------------------------------------------ the gate

/** Worst seen per key across the whole pool — the number the baseline records. */
const worst = new Map<string, { area: number; separation: number; seams: number; sample: Finding }>();
for (const finding of findings) {
  const previous = worst.get(finding.key);
  if (!previous) {
    worst.set(finding.key, {
      area: finding.area,
      separation: finding.separation,
      seams: 1,
      sample: finding,
    });
    continue;
  }
  previous.seams += 1;
  if (finding.area > previous.area) {
    previous.area = finding.area;
    previous.sample = finding;
  }
  if (finding.separation < previous.separation) previous.separation = finding.separation;
}

if (printBaseline) {
  const lines: string[] = [];
  for (const [key, entry] of [...worst.entries()].sort((a, b) => b[1].area - a[1].area)) {
    lines.push(
      `  ${JSON.stringify(key)}: { area: ${entry.area.toFixed(4)}, fighting: ` +
        `${entry.separation <= DEFAULT_TOLERANCES.fighting} },`,
    );
  }
  process.stdout.write(BASELINE_HEADER + lines.join('\n') + BASELINE_FOOTER);
  process.exit(0);
}

const regressions: string[] = [];
for (const [key, entry] of worst) {
  const recorded: BaselineEntry | undefined = COPLANAR_BASELINE[key];
  const fighting = entry.separation <= DEFAULT_TOLERANCES.fighting;
  if (!recorded) {
    regressions.push(
      `NEW: ${key}\n      ${entry.area.toFixed(3)} m² of shared plane, ` +
        `${entry.separation <= DEFAULT_TOLERANCES.fighting ? 'fighting now' : 'a maintained stand-off'} ` +
        `at ${entry.separation.toExponential(1)} m, seen on seed ${entry.sample.seed}`,
    );
    continue;
  }
  // A tenth of a square metre of slack, because the park is regenerated and a
  // seam's *extent* moves with the geometry under it even when the seam itself
  // is the same modelling mistake. Its existence is what is ratcheted; its
  // exact size is not something a builder controls.
  if (entry.area > recorded.area + 0.1) {
    regressions.push(
      `WORSE: ${key}\n      ${entry.area.toFixed(3)} m², recorded at ${recorded.area.toFixed(3)} m²`,
    );
  }
  if (fighting && !recorded.fighting) {
    regressions.push(
      `TIGHTER: ${key}\n      now fighting at ${entry.separation.toExponential(1)} m; ` +
        `it was a stand-off when the baseline was taken`,
    );
  }
}

const loose: string[] = [];
for (const key of Object.keys(COPLANAR_BASELINE)) {
  if (!worst.has(key)) loose.push(key);
}

// ------------------------------------------------------------------- report

const ranked = [...worst.entries()]
  .filter(([, entry]) => !entry.sample.occluded)
  .sort((a, b) => b[1].sample.score - a[1].sample.score);
const fightingCount = [...worst.values()].filter(
  (entry) => entry.separation <= DEFAULT_TOLERANCES.fighting,
).length;
const occluded = [...worst.values()].filter((entry) => entry.sample.occluded).length;

if (verbose || regressions.length > 0) {
  console.log('\nranked backlog — visible area ÷ how close a child gets:\n');
  for (const [key, entry] of ranked.slice(0, verbose ? ranked.length : 12)) {
    console.log(
      `  ${entry.sample.score.toFixed(2).padStart(8)}  ${entry.area.toFixed(2)} m²  ` +
        `${entry.sample.reach.toFixed(1)} m away  ${entry.separation.toExponential(1)} m apart\n` +
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
  console.error(`check:coplanar — ${regressions.length} new or worse coplanar seam(s):\n`);
  for (const line of regressions) console.error(`  ${line}`);
  console.error(
    '\nART_DIRECTION.md §7: delete the hidden face, do not offset a surface. An' +
      '\noffset is a number somebody has to maintain and it goes stale the moment' +
      '\neither surface moves. Do not silence this by editing coplanar-baseline.mts.',
  );
  process.exit(1);
}

console.log(
  `check:coplanar OK — ${worst.size} same-facing coplanar seam(s) across ${seeds.length} seed(s) ` +
    `and ${new Set([...worst.values()].map((e) => e.sample.space)).size} space(s): ` +
    `${fightingCount} fighting at ${DEFAULT_TOLERANCES.fighting * 1000} mm, ` +
    `${worst.size - fightingCount} more held apart by a stand-off under ` +
    `${DEFAULT_TOLERANCES.near * 100} cm, of which ${occluded} are buried where no camera can ` +
    `reach them. All of them are in the baseline; none is new. ` +
    `${((performance.now() - started) / 1000).toFixed(1)} s.`,
);
