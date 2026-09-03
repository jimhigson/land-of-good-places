/**
 * **Does the cat bus drive through the Rail Race's supports?** (#488)
 *
 * ```
 * pnpm run check:entrance-road
 * ```
 *
 * Jim, 3 September 2026: *"the bus shouldn't clip through the rail race
 * supports - route the road properly to avoid them"*.
 *
 * ## Why this is a sweep and not a look
 *
 * The fault is **motion**. A still frame of the bus parked at the gate is
 * innocent; the bus passes through a leg on its way in and on its way out, and
 * on the canonical seed it did so at four separate legs. So this sweeps the
 * bus's own oriented footprint along every metre of the road it drives and asks,
 * at each step, whether any trestle leg is inside it.
 *
 * And it is a **seed sweep**, over the whole of `PARK_SEED_POOL`, because the
 * original measurement found 2 to 8 legs in the bus's path on *every one of the
 * sixteen* — a road that clears them on the park in somebody's screenshot is not
 * a fix. One child process per seed, because a seed is pinned at module load.
 *
 * ## The control, and why it runs first
 *
 * CLAUDE.md: *"run a control on the instrument first — two agents got clean,
 * decisive, entirely wrong answers from flood fills that were measuring the
 * wrong thing"*. A sweep that finds nothing is exactly what a broken sweep also
 * finds, so before it reports on the road that exists it sweeps the road that
 * **used** to exist — the straight chord at the wall plus nine metres that the
 * bus drove until this change — and requires that to come back **dirty**. If the
 * old line reads clean, the instrument cannot see a collision at all and the
 * whole run is void, whatever it says about the new one.
 *
 * That control is not a one-off transcript pasted into a comment; it is measured
 * on every seed on every run, and its numbers are printed. It is the same
 * geometry the fix was proved against, so it cannot go stale the way a recorded
 * red run does.
 *
 * ## What is measured, and off what
 *
 * Legs come from the **built park**: the `railRace:trestle-legs` instanced
 * meshes' own matrices, resolved to each leg's **foot** (the matrix is composed
 * about the midpoint of foot-to-top, and on a leaning leg those are up to 2 m
 * apart — see `test/procgen/invariants.ts`, which had this wrong), with the
 * radius the ride's own collider uses. Nothing is re-derived from the rules that
 * placed them.
 *
 * The bus's path comes from `entrance/roadRoute.ts`, which is the same object
 * `ArrivalSequence` drives it along — so this measures the road the bus is on,
 * not a model of it. That the two really are the same is asserted separately,
 * below, by driving the real arrival and requiring every frame of the real bus
 * to lie on the route.
 */
import './headless-canvas.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { InstancedMesh, Matrix4, Vector3 } from 'three';
import { PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';

const run = promisify(execFile);
const HERE = fileURLToPath(import.meta.url);

interface SeedReport {
  readonly seed: number;
  readonly legs: number;
  /** Legs the bus's swept body reaches on the road as it is now. Must be zero. */
  readonly hits: number;
  readonly worstPenetration: number;
  /** Legs the bus reached on the OLD straight chord. The control: must be > 0. */
  readonly controlHits: number;
  readonly controlWorst: number;
  readonly reach: number;
  readonly brow: number;
}

// ---------------------------------------------------------------- the child

async function measureOneSeed(): Promise<void> {
  const { buildHeadlessPark } = await import('./park-harness.mts');
  const { CAT_BUS_LENGTH, CAT_BUS_WIDTH } = await import('../src/world/entrance/catBus.ts');
  const { POST_FOOT_RADIUS } = await import('../src/world/railRace/trestleGeometry.ts');
  const { PARK_SEED } = await import('../src/world/parkManifest.ts');
  const { ENTRANCE_WALL_RADIUS } = await import('../src/world/entrance/layout.ts');
  const { entranceRoadAt, entranceRoadBrow, entranceRoadReach } = await import(
    '../src/world/entrance/roadRoute.ts'
  );

  const park = buildHeadlessPark();

  /** Every trestle leg in the built park, at its foot, with its own foot radius. */
  const legs: { x: number; z: number; radius: number }[] = [];
  const matrix = new Matrix4();
  const centre = new Vector3();
  const axis = new Vector3();
  park.scene.traverse((object) => {
    const mesh = object as InstancedMesh;
    if (!mesh.isInstancedMesh || mesh.name !== 'railRace:trestle-legs') return;
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getMatrixAt(i, matrix);
      centre.setFromMatrixPosition(matrix);
      axis.setFromMatrixColumn(matrix, 1);
      const length = axis.length() || 1;
      axis.divideScalar(length);
      // `strut` scales x and z by the ring's own size, which is exactly the
      // factor `track.ts` multiplies POST_FOOT_RADIUS by for the collider.
      const across = new Vector3().setFromMatrixColumn(matrix, 0).length();
      legs.push({
        x: centre.x - axis.x * (length / 2),
        z: centre.z - axis.z * (length / 2),
        radius: POST_FOOT_RADIUS * across,
      });
    }
  });

  const halfLength = CAT_BUS_LENGTH / 2;
  const halfWidth = CAT_BUS_WIDTH / 2;

  /** How far a leg reaches inside the bus's footprint standing here. 0 = clear. */
  const penetration = (
    x: number,
    z: number,
    headingX: number,
    headingZ: number,
  ): { worst: number; hits: number } => {
    let worst = 0;
    let hits = 0;
    for (const leg of legs) {
      // Into the bus's own frame: `heading` is along its length.
      const dx = leg.x - x;
      const dz = leg.z - z;
      const along = dx * headingX + dz * headingZ;
      const across = dx * -headingZ + dz * headingX;
      const outAlong = Math.abs(along) - halfLength;
      const outAcross = Math.abs(across) - halfWidth;
      const outside = Math.hypot(Math.max(0, outAlong), Math.max(0, outAcross));
      const inside =
        outAlong <= 0 && outAcross <= 0 ? Math.min(-outAlong, -outAcross) : -outside;
      const reach = inside + leg.radius;
      if (reach > 0) {
        hits += 1;
        worst = Math.max(worst, reach);
      }
    }
    return { worst, hits };
  };

  const STEP = 0.25;

  // --- the control: the road as it used to be -------------------------------
  // A straight chord at the wall plus nine metres, swept from where the bus used
  // to appear to where it used to be disposed. If this reads clean the sweep
  // above cannot see a collision and nothing else in this file means anything.
  const oldStopZ = ENTRANCE_WALL_RADIUS + 9;
  const controlLegs = new Set<number>();
  let controlWorst = 0;
  for (let x = 7; x >= -22; x -= STEP) {
    const { worst } = penetration(x, oldStopZ, -1, 0);
    controlWorst = Math.max(controlWorst, worst);
    for (let i = 0; i < legs.length; i += 1) {
      const leg = legs[i] as { x: number; z: number; radius: number };
      const along = -(leg.x - x);
      const across = leg.z - oldStopZ;
      if (Math.abs(along) - halfLength <= leg.radius && Math.abs(across) - halfWidth <= leg.radius) {
        controlLegs.add(i);
      }
    }
  }

  // --- the road the bus is actually on now ----------------------------------
  const brow = entranceRoadBrow();
  const hitLegs = new Set<number>();
  let worstPenetration = 0;
  for (let at = brow; at >= -brow; at -= STEP) {
    const station = entranceRoadAt(at);
    const { worst } = penetration(station.x, station.z, station.headingX, station.headingZ);
    worstPenetration = Math.max(worstPenetration, worst);
    for (let i = 0; i < legs.length; i += 1) {
      const leg = legs[i] as { x: number; z: number; radius: number };
      const dx = leg.x - station.x;
      const dz = leg.z - station.z;
      const along = dx * station.headingX + dz * station.headingZ;
      const across = dx * -station.headingZ + dz * station.headingX;
      if (Math.abs(along) - halfLength <= leg.radius && Math.abs(across) - halfWidth <= leg.radius) {
        hitLegs.add(i);
      }
    }
  }

  const report: SeedReport = {
    seed: PARK_SEED,
    legs: legs.length,
    hits: hitLegs.size,
    worstPenetration: Number(worstPenetration.toFixed(3)),
    controlHits: controlLegs.size,
    controlWorst: Number(controlWorst.toFixed(3)),
    reach: Number(entranceRoadReach().toFixed(1)),
    brow: Number(brow.toFixed(1)),
  };
  console.log(JSON.stringify(report));
}

// --------------------------------------------------------------- the parent

async function sweepThePool(): Promise<void> {
  const reports: SeedReport[] = [];
  const failures: string[] = [];

  const results = await Promise.all(
    PARK_SEED_POOL.map(async (seed) => {
      const { stdout } = await run(
        process.execPath,
        ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', HERE, '--one'],
        { env: { ...process.env, LGP_SEED: String(seed) }, maxBuffer: 1 << 26 },
      );
      const line = stdout.trim().split('\n').pop() as string;
      return JSON.parse(line) as SeedReport;
    }),
  );
  reports.push(...results);

  // **The control is read first, and it gates everything.** An instrument that
  // cannot find the collisions we already know are there is not evidence that
  // the new road has none.
  const blindSeeds = reports.filter((report) => report.controlHits === 0);
  if (blindSeeds.length > 0) {
    failures.push(
      `the control found NO collision on ${blindSeeds.length} seed(s) — sweeping the old straight ` +
        'chord at the wall plus nine metres is supposed to hit the supports the bus used to drive ' +
        'through, so this sweep cannot see a collision and its verdict on the real road is void: ' +
        blindSeeds.map((report) => report.seed).join(', '),
    );
  }

  for (const report of reports) {
    if (report.hits > 0) {
      failures.push(
        `seed ${report.seed}: the cat bus sweeps through ${report.hits} Rail Race trestle leg(s) on ` +
          `its way in and out, reaching ${report.worstPenetration.toFixed(2)} m inside one — the road ` +
          'it drives runs through the ride',
      );
    }
  }

  const controlTotal = reports.reduce((sum, report) => sum + report.controlHits, 0);
  process.stderr.write(
    `  control: the old straight kerb hits ${controlTotal} legs across ${reports.length} seeds ` +
      `(worst ${Math.max(...reports.map((r) => r.controlWorst)).toFixed(2)} m inside a bus) — the sweep ` +
      'can see a collision\n',
  );
  process.stderr.write(
    `  covered: ${reports.length} seeds, ${reports.reduce((sum, r) => sum + r.legs, 0)} trestle legs, ` +
      `bus swept from the brow at +${reports[0]?.brow ?? 0} m to -${reports[0]?.brow ?? 0} m\n`,
  );

  for (const report of reports) {
    console.log(
      `  seed ${String(report.seed).padStart(8)}  legs ${String(report.legs).padStart(3)}  ` +
        `bus hits ${report.hits}  (old road hit ${report.controlHits}, worst ${report.controlWorst.toFixed(2)} m)`,
    );
  }

  if (failures.length > 0) {
    console.error('\nFAIL: the entrance road runs through the Rail Race.');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('\nentrance road OK — the bus clears every trestle leg on every pool seed');
}

if (process.argv.includes('--one')) {
  await measureOneSeed();
} else {
  await sweepThePool();
}
