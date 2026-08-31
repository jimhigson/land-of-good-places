/**
 * **THE GATING NUMBER: how many bridgeable crossing poses does a park offer?**
 * — #427.
 *
 *   node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/measure-crossing-poses.mts 20260728 2 5 11 18
 *
 * The railway is to be grown from a chosen crossing rather than from a rim
 * bearing, and `budgets.restarts` comes straight from `startPoses.length`.
 * Measured on `origin/main`, three of the five CI seeds need **53-61** of the
 * 96 rim poses before one solves — so the field of candidate crossings has to
 * be comparably large or the search starves.
 *
 * This counts, per seed, how many (point, heading) pairs a bridge provably
 * fits at — asked of `bridgeFit.ts`, the same probe the real crossing planner
 * uses, so a pose counted here is one the planner will also accept once a
 * route runs through it (modulo the station test, which cannot exist yet —
 * see that module's header).
 *
 * ~100 and the budget survives outright. ~10 and the success rate has to be
 * re-measured seed by seed.
 */
const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
if (seeds.length === 0) throw new Error('give me some seeds');

if (!process.env['LGP_ONE_SEED']) {
  const { execFileSync } = await import('node:child_process');
  for (const seed of seeds) {
    try {
      process.stdout.write(
        execFileSync(
          process.execPath,
          [
            '--no-warnings',
            '--import',
            './scripts/ts-extension-resolver-register.mjs',
            'scripts/measure-crossing-poses.mts',
            String(seed),
          ],
          { env: { ...process.env, LGP_ONE_SEED: '1', LGP_SEED: String(seed) }, encoding: 'utf8' },
        ),
      );
    } catch (error) {
      process.stdout.write(`seed ${seed}: FAILED — ${(error as Error).message.split('\n')[0]}\n`);
    }
  }
  process.exit(0);
}

const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { GARDEN_PLAY_BOUNDARY } = await import('../src/world/boundary.ts');
const {
  NARROW_HALF_WIDTH,
  SITE_BOUNDARY_MARGIN,
  SITE_HALF_WIDTH,
  SITE_PLOT_MARGIN,
  SITE_RAMP_FLOOR,
  SITE_RAMP_IDEAL,
  probeBridgeReach,
} = await import('../src/world/train/bridgeFit.ts');

/** Grid pitch for candidate crossing points, metres. Fine enough that a
 * usable strip of ground is not stepped over, coarse enough to sweep a whole
 * park in a second. */
const POINT_PITCH = 4;

/** Candidate path headings per point. A bridge is symmetric about its own
 * axis, so only a half-turn of headings is distinct. */
const HEADINGS = 8;

const start = Date.now();
let points = 0;
let poses = 0;
let pointsWithAny = 0;
const REACH = 90; // park half-extent to sweep, comfortably past the boundary

for (let x = -REACH; x <= REACH; x += POINT_PITCH) {
  for (let z = -REACH; z <= REACH; z += POINT_PITCH) {
    if (GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z) < SITE_BOUNDARY_MARGIN) continue;
    points += 1;
    let any = false;
    for (let h = 0; h < HEADINGS; h += 1) {
      const angle = (h / HEADINGS) * Math.PI;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      let fits = false;
      for (const halfWidth of [SITE_HALF_WIDTH, NARROW_HALF_WIDTH]) {
        const { pos, neg, deckClear } = probeBridgeReach(
          x,
          z,
          dirX,
          dirZ,
          halfWidth,
          SITE_RAMP_IDEAL,
          SITE_BOUNDARY_MARGIN,
          SITE_PLOT_MARGIN,
        );
        if (deckClear && pos >= SITE_RAMP_FLOOR && neg >= SITE_RAMP_FLOOR) {
          fits = true;
          break;
        }
      }
      if (fits) {
        poses += 1;
        any = true;
      }
    }
    if (any) pointsWithAny += 1;
  }
}

console.log(
  `seed ${PARK_SEED}: ${poses} bridgeable poses at ${pointsWithAny}/${points} points ` +
    `(${POINT_PITCH} m grid, ${HEADINGS} headings) — ${Date.now() - start} ms`,
);
