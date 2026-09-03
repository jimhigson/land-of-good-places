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
 * finds, so every seed is built **twice**: once as the game builds it, and once
 * with `roadRoute.ts`'s `setEntranceCorridorHonoured(false)`, which switches off
 * the single clause in `railRace/track.ts`'s `groundIsClear` that keeps trestle
 * legs out of the road. The second park is the ride placing its supports the way
 * it did before this change — through the road — and **the identical sweep** is
 * run against it. It must come back dirty. If it does not, the instrument cannot
 * see a collision at all and the whole run is void, whatever it says about the
 * real park.
 *
 * That control is not a one-off transcript pasted into a comment; it is measured
 * on every seed on every run, and its numbers are printed.
 *
 * **It replaced a weaker one, and why matters.** The first control swept the road
 * as it *used* to be — the straight chord at the wall — against the legs as they
 * are now. That degraded as the fix worked: the ride nudging its legs clear of
 * the new road moved them off the old line too, and the count fell from 96 legs
 * across the pool to 35, as low as **one leg on seed 11**. A control one
 * placement decision away from reading zero is a control that will one day void a
 * perfectly good run, and nothing would announce that it had stopped being a
 * measurement. Generating the dirty park instead of remembering it cannot decay,
 * because it is rebuilt from whatever the ride does today.
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
  /** True if this park was built with the corridor off — the control run. */
  readonly control: boolean;
  readonly reach: number;
  readonly brow: number;
  /** Road triangles drawn facing the ground rather than the sky. Must be zero. */
  readonly downFacingTriangles: number;
  readonly roadTriangles: number;
  /** Road vertices drawn outside the corridor the bus drives. Must be zero. */
  readonly strayVertices: number;
  readonly worstStray: number;
  /** Nearest the gateway spur gets to the kerb. Must be zero — they must touch. */
  readonly spurGap: number;
}

// ---------------------------------------------------------------- the child

async function measureOneSeed(asControl: boolean): Promise<void> {
  const { buildHeadlessPark } = await import('./park-harness.mts');
  const { CAT_BUS_LENGTH, CAT_BUS_WIDTH } = await import('../src/world/entrance/catBus.ts');
  const { POST_FOOT_RADIUS } = await import('../src/world/railRace/trestleGeometry.ts');
  const { PARK_SEED } = await import('../src/world/parkManifest.ts');
  const { entranceRoadAt, entranceRoadBrow, entranceRoadReach, distanceToEntranceCorridor, setEntranceCorridorHonoured } =
    await import('../src/world/entrance/roadRoute.ts');

  // **The control's dirty input, generated rather than remembered.** With the
  // corridor switched off the ride places its trestles exactly as it did before
  // this change — including through the road — and the identical sweep below
  // then runs against them. See `setEntranceCorridorHonoured`.
  if (asControl) setEntranceCorridorHonoured(false);

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

  // --- is the road that is DRAWN the road the bus drives? -------------------
  //
  // **Without this the rest of the file can pass while fixing nothing.** The
  // sweep above asks whether the *route* clears the supports; a route is a plan.
  // If `Entrance.ts` goes on building a ribbon somewhere else — as it did for
  // the whole first half of this change — every seed reads clean while the bus
  // still drives through a leg, which is precisely CLAUDE.md's "an assertion
  // reporting success about something it is not describing".
  //
  // So: every vertex of every `entrance-road*` mesh in the built park has to lie
  // inside the corridor the sweep measured. That is the join between the plan
  // and the park, and it is the one thing that makes the numbers above mean
  // anything.
  //
  // **Scoped to the ribbon the bus drives, and only that one.** The run in
  // through the gate goes the other way — through the arch to the plaza — and
  // the bus never goes there (a bus is not a park vehicle; #195 is the whole
  // reason it stops outside). Holding it to the bus's corridor would be
  // asserting that ground the bus does not drive is inside the road the bus does
  // drive, which is false by design and would have to be weakened to pass. It
  // gets the assertion that is actually true of it instead — that it **abuts**
  // the kerb, below — so nothing here is excused, it is asked the right
  // question.
  //
  // That run is an ordinary park path since 3 September and no longer carries a
  // `entrance-road` name, which is why it is matched by its own name here. The
  // reasoning above is unchanged by the material: it is about which surface the
  // bus drives on, not what colour it is.
  let strayVertices = 0;
  let worstStray = 0;
  let spurGap = Infinity;
  // **Which way does the road face?** Position alone cannot answer it, and that
  // is not a hypothetical: every vertex of the kerb passed the corridor clause
  // below, on all sixteen seeds, while the road was **invisible** — a swept
  // ribbon inherited `PlaneGeometry`'s winding, came out facing the ground, and
  // `FrontSide` culled the lot. A road you can drive on and cannot see is
  // exactly "an assertion reporting success about something it is not
  // describing", so the facing is now asserted rather than assumed.
  let downFacingTriangles = 0;
  let roadTriangles = 0;
  {
    const { Mesh } = await import('three');
    const at = new Vector3();
    const triA = new Vector3();
    const triB = new Vector3();
    const triC = new Vector3();
    const edge1 = new Vector3();
    const edge2 = new Vector3();
    const face = new Vector3();
    /** Counts a mesh's world-space triangles, and how many point downwards. */
    const countFacing = (mesh: { geometry: import('three').BufferGeometry; matrixWorld: import('three').Matrix4 }): void => {
      const position = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex();
      const count = index ? index.count : position.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const ia = index ? index.getX(i) : i;
        const ib = index ? index.getX(i + 1) : i + 1;
        const ic = index ? index.getX(i + 2) : i + 2;
        triA.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
        triB.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
        triC.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
        edge1.subVectors(triB, triA);
        edge2.subVectors(triC, triA);
        face.crossVectors(edge1, edge2);
        roadTriangles += 1;
        if (face.y < 0) downFacingTriangles += 1;
      }
    };
    park.scene.traverse((object) => {
      const mesh = object as InstanceType<typeof Mesh>;
      if (!mesh.isMesh) return;
      if (mesh.name.startsWith('entrance-gateway-path')) {
        countFacing(mesh);
        // Continuity: the path's outermost vertex has to touch the kerb, or a
        // child walking in from the bus steps over a strip of grass between the
        // road and the paving.
        const position = mesh.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i += 1) {
          at.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(mesh.matrixWorld);
          spurGap = Math.min(spurGap, distanceToEntranceCorridor(at.x, at.z));
        }
        return;
      }
      if (!mesh.name.startsWith('entrance-road')) return;
      countFacing(mesh);
      const position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i += 1) {
        at.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(mesh.matrixWorld);
        const outside = distanceToEntranceCorridor(at.x, at.z);
        if (outside > 0.01) {
          strayVertices += 1;
          worstStray = Math.max(worstStray, outside);
        }
      }
    });
  }

  const report: SeedReport = {
    seed: PARK_SEED,
    downFacingTriangles,
    roadTriangles,
    strayVertices,
    worstStray: Number(worstStray.toFixed(2)),
    legs: legs.length,
    hits: hitLegs.size,
    worstPenetration: Number(worstPenetration.toFixed(3)),
    control: asControl,
    spurGap: Number((Number.isFinite(spurGap) ? spurGap : 999).toFixed(3)),
    reach: Number(entranceRoadReach().toFixed(1)),
    brow: Number(brow.toFixed(1)),
  };
  console.log(JSON.stringify(report));
}

// --------------------------------------------------------------- the parent

async function sweepThePool(): Promise<void> {
  const failures: string[] = [];

  /** One child process per park: a seed is pinned at module load, so it cannot be reused. */
  const measure = async (seed: number, asControl: boolean): Promise<SeedReport> => {
    const argv = ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', HERE, '--one'];
    if (asControl) argv.push('--control');
    const { stdout } = await run(process.execPath, argv, {
      env: { ...process.env, LGP_SEED: String(seed) },
      maxBuffer: 1 << 26,
    });
    return JSON.parse(stdout.trim().split('\n').pop() as string) as SeedReport;
  };

  const pairs = await Promise.all(
    PARK_SEED_POOL.map(async (seed) => ({
      real: await measure(seed, false),
      control: await measure(seed, true),
    })),
  );
  const reports = pairs.map((pair) => pair.real);

  // **The control is read first, and it gates everything.** An instrument that
  // cannot find a collision is not evidence that there is none — and the shape
  // of that mistake here would be a sweep silently measuring the wrong bus, the
  // wrong legs, or nothing at all, on a run that prints "0 hits" and passes.
  //
  // The dirty park is built fresh on every run rather than remembered from a
  // transcript: same seed, same road, same sweep, with only
  // `groundIsClear`'s corridor clause switched off. Anything that blinds the
  // real sweep blinds this one identically, which is the whole point.
  const blind = pairs.filter((pair) => pair.control.hits === 0);
  if (blind.length > 0) {
    failures.push(
      `the control found NO collision on ${blind.length} seed(s) — with the road's corridor switched ` +
        'off the Rail Race puts its legs back through the road, so the bus is supposed to sweep ' +
        'through them. Reading zero there means this sweep cannot see a collision at all, and its ' +
        'verdict on the real road is void: ' +
        blind.map((pair) => pair.control.seed).join(', '),
    );
  }

  for (const report of reports) {
    if (report.downFacingTriangles > 0) {
      failures.push(
        `seed ${report.seed}: ${report.downFacingTriangles} of ${report.roadTriangles} triangles of the ` +
          'drawn entrance road face the ground rather than the sky — the material is `FrontSide`, so ' +
          'that much of the road is culled and a child looks straight through it at the grass',
      );
    }
    if (report.strayVertices > 0) {
      failures.push(
        `seed ${report.seed}: ${report.strayVertices} vertices of the drawn entrance road lie outside ` +
          `the corridor the bus drives, the furthest ${report.worstStray.toFixed(2)} m out — the road ` +
          'on screen is not the road this check measured, so its verdict below describes a plan rather ' +
          'than the park',
      );
    }
    if (report.spurGap > 0.01) {
      failures.push(
        `seed ${report.seed}: the gateway path's nearest vertex is ${report.spurGap.toFixed(2)} m from ` +
          'the kerb — the path through the arch does not meet the road the bus stops on, so there is ' +
          'grass between them where a child walks in',
      );
    }
    if (report.hits > 0) {
      failures.push(
        `seed ${report.seed}: the cat bus sweeps through ${report.hits} Rail Race trestle leg(s) on ` +
          `its way in and out, reaching ${report.worstPenetration.toFixed(2)} m inside one — the road ` +
          'it drives runs through the ride',
      );
    }
  }

  const controlTotal = pairs.reduce((sum, pair) => sum + pair.control.hits, 0);
  const controlWorst = Math.max(...pairs.map((pair) => pair.control.worstPenetration));
  process.stderr.write(
    `  control: with the corridor off the ride puts ${controlTotal} legs back in the bus's path across ` +
      `${pairs.length} seeds (worst ${controlWorst.toFixed(2)} m inside a bus) — the sweep can see a collision\n`,
  );
  process.stderr.write(
    `  facing: ${reports.reduce((sum, r) => sum + r.roadTriangles, 0)} road triangles checked, ` +
      `${reports.reduce((sum, r) => sum + r.downFacingTriangles, 0)} facing the ground\n`,
  );
  process.stderr.write(
    `  covered: ${pairs.length} seeds x 2 parks (real and control), ` +
      `${reports.reduce((sum, r) => sum + r.legs, 0)} trestle legs, ` +
      `bus swept from the brow at +${reports[0]?.brow ?? 0} m to -${reports[0]?.brow ?? 0} m\n`,
  );

  for (const pair of pairs) {
    console.log(
      `  seed ${String(pair.real.seed).padStart(8)}  legs ${String(pair.real.legs).padStart(3)}  ` +
        `bus hits ${pair.real.hits}  (corridor off: ${pair.control.hits} legs in the bus, ` +
        `worst ${pair.control.worstPenetration.toFixed(2)} m)`,
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
  await measureOneSeed(process.argv.includes('--control'));
} else {
  await sweepThePool();
}
