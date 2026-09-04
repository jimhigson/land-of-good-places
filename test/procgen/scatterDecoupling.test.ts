import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

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
  readonly paths: { readonly metres: number; readonly digest: string };
  readonly spur: { readonly name: string; readonly points: readonly (readonly [number, number])[] };
  readonly trees: Group;
  readonly bushes: Group;
  readonly walls: Group;
  readonly all: string;
}

function buildDigest(env: Record<string, string>): Digest {
  const out = execFileSync('node', DIGEST_ARGS, {
    cwd: new URL('../..', import.meta.url).pathname,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out) as Digest;
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

describe('scenery scatter is decoupled from the paths', () => {
  const baseline = buildDigest({});
  const bowed = buildDigest({ LGP_SPUR_STRETCH: String(BOW) });

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
    const other = buildDigest({ LGP_SEED: '5' });
    expect(other.seed).toBe(5);
    expect(other.all).not.toBe(baseline.all);
    expect(other.trees.digest).not.toBe(baseline.trees.digest);
    expect(other.bushes.digest).not.toBe(baseline.bushes.digest);
  });
});
