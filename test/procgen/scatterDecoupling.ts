import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { CANONICAL_PARK_SEED } from '../../src/world/parkSeedPool.ts';

/**
 * **Moving a path must not move scenery on the other side of the park.**
 *
 * The rest of this suite proves the park is *placed sanely*. This one proves it
 * is placed *stably*: that changing one thing changes one thing.
 *
 * ### The bug
 *
 * `Scenery`'s scatters are rejection samplers, and they used to draw from one
 * long-lived `Rng` each. A refused tree cost 2-3 draws and a planted one 10-20,
 * so the moment anything flipped a candidate from accepted to rejected, every
 * later object on that stream landed somewhere else. Pave a few extra metres of
 * lawn under one stall's spur and a garden wall lands across the *ferris wheel
 * kiosk's* line of sight, on the far side of the park, stranding its waypoint.
 *
 * It cost an engineer a sweep of all 344 legal positions for the rail-race
 * booth — every one of which stranded the same waypoint, at (20.9, 20.2) — plus
 * a rewrite of the spur router that turned out to be treating a symptom, before
 * the mechanism was found. `parkManifest.ts` carries the original note.
 *
 * ### Why this is not an ordinary invariant
 *
 * Every other check here reads one built park. This property is about the
 * *difference between two* parks, so it needs two — and `PARK_SEED` and
 * `SPUR_STRETCH` are read once at module load, so two parks means two module
 * registries, which means two processes. Hence `scripts/scatter-digest.mts`,
 * spawned rather than imported. Importing it would measure one park twice and
 * pass unconditionally, which is the same failure mode `vitest.config.ts`'s
 * `isolate: true` exists to prevent for the seed files.
 *
 * ### One file per park, every build at once
 *
 * The body lives here; each park has its own `scatterDecoupling-*.test.ts`.
 * As one file it built five parks back to back, 17-23 minutes on a CI runner,
 * which ran its procgen shard out of the 22m30s watchdog on `main` (7c8faaf0).
 * Split by park, and with a park's baseline and bowed builds spawned together
 * (each is one single-threaded process), the slowest file is one build long.
 */

const DIGEST_ARGS = [
  '--no-warnings',
  '--import',
  './scripts/ts-extension-resolver-register.mjs',
  'scripts/scatter-digest.mts',
];

interface Group {
  readonly count: number;
  readonly digest: string;
  readonly labels: readonly string[];
}

interface Digest {
  readonly seed: number;
  readonly restart: number;
  readonly plan: readonly string[];
  readonly paths: { readonly metres: number; readonly digest: string };
  readonly spur: { readonly name: string; readonly points: readonly (readonly [number, number])[] };
  readonly trees: Group;
  readonly bushes: Group;
  readonly walls: Group;
  readonly all: string;
}

function buildDigest(env: Record<string, string>): Promise<Digest> {
  return new Promise((resolve, reject) => {
    execFile(
      'node',
      DIGEST_ARGS,
      {
        cwd: new URL('../..', import.meta.url).pathname,
        encoding: 'utf8',
        env: { ...process.env, ...env },
        maxBuffer: 256 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        // The child's trace, which `execFileSync` used to pass straight through.
        process.stderr.write(stderr);
        if (error !== null) reject(error);
        else resolve(JSON.parse(stdout) as Digest);
      },
    );
  });
}

/**
 * The restart the baseline will be built at, asked of the same resolver the
 * child uses (`test/setupDeterministicMath.ts` installs it here too), so the
 * bowed park can be pinned to it without waiting for the baseline to finish.
 * The first test below still asserts the two came out equal.
 */
function acceptedRestart(env: Record<string, string>): number {
  const seed = Number(env['LGP_SEED'] ?? CANONICAL_PARK_SEED);
  const resolve = (globalThis as { __LGP_RESOLVE_RESTART__?: (seed: number) => number }).__LGP_RESOLVE_RESTART__;
  if (typeof resolve !== 'function') throw new Error('no restart resolver installed — is the vitest setup file running?');
  return resolve(seed);
}

/**
 * How far from the perturbed paving a change is still allowed to be.
 *
 * Not a tolerance to be widened when a seed complains — it is the reach of the
 * one cascade that survives index-locking, and it is derived rather than tuned.
 * Refusing a candidate can legitimately let a *different* candidate take its
 * place, because the samplers keep sequential conflict state. The longest that
 * reaches is in the wall maze: `MAZE_PIECE_GAP + 12` = 19 m separates corners,
 * so refusing one corner can free another 19 m away, and that corner's arms run
 * up to 8.5 m further. 30 m rounds that up with a little room.
 *
 * It has real teeth at that size: the park is only ~55 m in radius, and on
 * `origin/main` this same 2 m perturbation moved trees **62.5 m** away — five
 * of the nine changed trees sat 53 m or further from the spur that moved. A
 * limit of 30 m fails that park comfortably.
 */
const LOCALITY_LIMIT = 30;

/** The bow, in metres. Small on purpose — see the assertion on `paths`. */
const BOW = 2;

function distanceToSpur(
  point: readonly [number, number],
  ribbons: readonly (readonly (readonly [number, number])[])[],
): number {
  let best = Infinity;
  for (const points of ribbons) {
    for (let i = 0; i < points.length - 1; i += 1) {
      const [ax, az] = points[i]!;
      const [bx, bz] = points[i + 1]!;
      const dx = bx - ax;
      const dz = bz - az;
      const lengthSq = dx * dx + dz * dz;
      const t =
        lengthSq > 0
          ? Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - az) * dz) / lengthSq))
          : 0;
      best = Math.min(best, Math.hypot(point[0] - (ax + dx * t), point[1] - (az + dz * t)));
    }
  }
  return best;
}

/** Pulls the planar position back out of a digest label. */
function positionOf(label: string): readonly [number, number] {
  const parts = label.split(' ');
  if (parts[0] === 'wall') {
    return [
      (Number(parts[2]) + Number(parts[4])) / 2,
      (Number(parts[3]) + Number(parts[5])) / 2,
    ];
  }
  return [Number(parts[1]), Number(parts[2])];
}

/**
 * A park the property is proved on. Two are, each by its own test file
 * (`scatterDecoupling-canonical.test.ts`, `scatterDecoupling-seed12.test.ts`). The canonical seed, because it is the
 * park everyone looks at; and seed 12, because it is the one that caught the
 * last coupling: the scatter planted to a park-wide count of 72 trees, so the
 * three trees its bowed spur cost were replaced 31 m and 43.6 m away. The
 * canonical seed happens to lose no tree to the bow and could not see that. A
 * property proved on one seed is a property of that seed. Seed 12 also builds
 * in a fraction of the canonical seed's time.
 */
export interface ScatterPark {
  readonly label: string;
  readonly env: Record<string, string>;
}

/**
 * Builds `park` twice — as accepted, and with one spur bowed — and registers
 * the locality tests on the pair. With `control`, also builds a different
 * seed's park and registers the test that the digest can tell them apart.
 * Await it at a test file's top level: the builds run at collection, where no
 * hook timeout applies, exactly as the single file's `execFileSync` did.
 */
export async function proveScatterDecoupled(park: ScatterPark, options: { readonly control: boolean }): Promise<void> {
  // **The same restart as the baseline, pinned.** LGP_SPUR_STRETCH is a
  // park-changing switch, so with the restart unset the resolver builds
  // restart 0 while the baseline is the accepted restart: two different
  // parks. On #705's CI seed 12 (accepted restart 2) failed exactly so:
  // layout attempt 5 against 4, trees "moved" 100 m.
  const restart = acceptedRestart(park.env);
  const seed = Number(park.env['LGP_SEED'] ?? CANONICAL_PARK_SEED);
  // Seed 10 restart 0 since #708's band fix: the shipped park with the
  // fastest plan (11.5 s on CI). A pinned restart goes stale when the park
  // changes; re-pick from the Parks job's "plan N ms searched" lines.
  const otherSeed = seed === 10 ? 11 : 10;
  const [baseline, bowed, other] = await Promise.all([
    buildDigest(park.env),
    buildDigest({ ...park.env, LGP_PARK_RESTART: String(restart), LGP_SPUR_STRETCH: String(BOW) }),
    // An explicit restart: the control needs *a* different park, not that
    // seed's accepted one, and leaving the restart unset made the resolver run
    // the whole acceptance loop for it (442 s on #705's CI, over the 240 s
    // timeout), measuring nothing this test asks about.
    options.control ? buildDigest({ LGP_SEED: String(otherSeed), LGP_PARK_RESTART: '0' }) : Promise.resolve(null),
  ]);

  describe('scenery scatter is decoupled from the paths', () => {
    describe(park.label, () => {
      it('built the bowed park at the baseline park\'s restart', () => {
        expect(bowed.restart).toBe(baseline.restart);
      });

      it('perturbed the park for real — otherwise everything below is vacuous', () => {
        // The load-bearing assertion. A knob that silently does nothing would make
        // every "unchanged" check below pass for the worst possible reason, and
        // that is not hypothetical: the first version of this hook extended the
        // ribbon backwards from its branch point onto ground that was already
        // paved, and moved nothing on `origin/main` at 1, 2, 3, 4, 6, 8, 10, 14, 18
        // or 24 m. A perturbation that cannot break the broken version cannot
        // validate the fixed one.
        expect(baseline.paths.digest).not.toBe(bowed.paths.digest);
        expect(baseline.spur.points.length).toBeGreaterThan(1);
        expect(Number.isFinite(baseline.paths.metres)).toBe(true);
        expect(Number.isFinite(bowed.paths.metres)).toBe(true);
        expect(bowed.paths.metres).not.toBeCloseTo(baseline.paths.metres, 3);
      });

      it('bowed one spur of the same park — the plan settled on the same decisions', () => {
        // Without this, the test below compares two different parks. On seed 5 a
        // whole-segment bow read as a street off the lattice, the plan refused the
        // paths and unwound to another layout, and "the scatter moved 52 m away"
        // was the castle, the walls and the fairy chains all being somewhere else.
        expect(baseline.plan.length).toBeGreaterThan(0);
        expect(
          bowed.plan,
          `bowing ${baseline.spur.name} by ${BOW} m changed the plan's decisions, so the two parks differ ` +
            `upstream of the scatter and the locality check below would measure that, not the scatter`,
        ).toEqual(baseline.plan);
      });

      it('measured a real park on both sides', () => {
        for (const park of [baseline, bowed]) {
          expect(park.trees.count).toBeGreaterThan(24);
          expect(park.bushes.count).toBeGreaterThan(107);
          expect(park.walls.count).toBeGreaterThan(0);
        }
      });

      it('leaves every tree, bush and wall away from the change exactly where it was', () => {
        const ribbons = [baseline.spur.points, bowed.spur.points];
        const strays: string[] = [];
        for (const kind of ['trees', 'bushes', 'walls'] as const) {
          const before = new Set(baseline[kind].labels);
          const after = new Set(bowed[kind].labels);
          const changed = [
            ...[...before].filter((label) => !after.has(label)).map((l) => `gone: ${l}`),
            ...[...after].filter((label) => !before.has(label)).map((l) => `new:  ${l}`),
          ];
          for (const entry of changed) {
            const distance = distanceToSpur(positionOf(entry.slice(6)), ribbons);
            if (distance > LOCALITY_LIMIT) {
              strays.push(`${entry} — ${distance.toFixed(1)} m from the spur that moved`);
            }
          }
        }
        expect(
          strays,
          `bowing ${baseline.spur.name} by ${BOW} m changed scenery more than ` +
            `${LOCALITY_LIMIT} m away, so the scatter is still coupled to the paths:\n` +
            strays.join('\n'),
        ).toHaveLength(0);
      });
    });

    if (other !== null) {
      it('can tell two parks apart at all', () => {
        // The control. Everything above is an assertion that digests *match*, and a
        // digest that always matched — one hashing a constant, say — would sail
        // through all of it. A different seed must produce a different scatter.
        //
        // Seed 5, not the seed 2 this control used since it was written: the
        // property is "two different parks differ", agnostic to WHICH other
        // park, and seed 2 cannot build a park at all since 2 Sep 2026 — it
        // proves zero bridge sites, which now fails the build loudly rather
        // than falling back to level crossings (it was retired from the sweep
        // for exactly this pathology, #429/seed-24.test.ts's header). Any pool
        // seed serves; 5 is the one the sweep already builds everywhere else.
        // Any supported seed other than the baseline's: the canonical seed became
        // 5 when the pool became 0..15, and a control that builds the baseline's
        // own park again cannot tell two parks apart.
        expect(other.seed).toBe(otherSeed);
        expect(other.all).not.toBe(baseline.all);
        expect(other.trees.digest).not.toBe(baseline.trees.digest);
        expect(other.bushes.digest).not.toBe(baseline.bushes.digest);
      });
    }
  });
}
