/**
 * **Does the cat bus's body sweep through the Rail Race's drawn supports?**
 *
 * ```
 * pnpm run check:swept-bus                      # every seed in the pool
 * pnpm run check:swept-bus -- --verbose         # and every offending post
 * pnpm run check:swept-bus -- --print-baseline > scripts/swept-bus-baseline.mts
 * LGP_RATCHET=off pnpm run check:swept-bus      # report the drift, do not fail
 * ```
 *
 * This is stage 3's independent instrument
 * (`docs/BRIEF-stage3-step2a-swept-bus-instrument.md`). It exists **before** the
 * fix, so that it can be watched failing, and it lands as a **ratchet** because
 * `main` is red on it today. Step 2's definition of done is driving
 * `scripts/swept-bus-baseline.mts` to zero and deleting it.
 *
 * ## The bug it is written against is a bug in the previous instrument
 *
 * `check:entrance-road` headlined *"0 legs hit on all sixteen seeds"* while
 * resolving each trestle to its **foot** and asking the question only there.
 * `track.ts` stands a trestle's trunk from the *nudged* foot to a top under the
 * rails, so a nudged post **leans**: its foot can be two metres from the part of
 * it the bus actually meets. A reviewer measuring along the drawn post found
 * 8–9 posts per seed inside the bus at height, against a headline of zero.
 *
 * That is CLAUDE.md's signature failure — *a measurement taken on a convenient
 * origin rather than on the thing that gets drawn* — and it is why every number
 * below comes off the **built scene**:
 *
 * - the **posts** are the `railRace:trestle-*` instanced meshes' own matrices,
 *   sampled every {@link POST_STEP} along each strut's length, with each
 *   sample's radius interpolated from that mesh's own `CylinderGeometry` and
 *   scaled by the instance's own across-axis. Trunk *and* both generations of
 *   branch: a trestle forks below bus-roof height, so a check that swept only
 *   `-legs` would report clean about a bus driving through a fork.
 * - the **bus** is `createCatBus()`'s own drawn geometry — its bounding box in
 *   its own frame, measured, not restated from constants. Whiskers, ears,
 *   fenders and all: if it is drawn, a post inside it is clipping.
 * - the comparison is in **absolute world Y**, because both `track.ts` and
 *   `ArrivalSequence.placeBus` put their geometry at `terrainHeight(x, z)`.
 *   Nothing here converts to "height above the ground" and so nothing here can
 *   convert wrongly — which is the mistake one layer down from the foot bug.
 *
 * ## The rename hazard, and why this check cannot fall into it
 *
 * Issue **#520**: `check:coplanar`'s ratchet is keyed on **mesh names**, so a
 * rename orphans the entry and nobody hears. This check meets that hazard
 * twice, and answers it twice.
 *
 * 1. **The baseline is keyed on the seed number**, which nothing can rename. A
 *    baseline entry for a seed that is not in `PARK_SEED_POOL` is an
 *    **orphan**, and an orphan is a **failure** here rather than a printed
 *    note — the brief's own instruction, and the thing #520 asks for.
 * 2. **The meshes it measures are asserted to exist**, on every seed. This
 *    check finds posts *by name*; rename `railRace:trestle-legs` and the sweep
 *    would find nothing, report a triumphant zero, and beat the ratchet. So a
 *    named mesh that is absent, or present with no instances, fails the run and
 *    says the mesh is gone. A green line that could only be produced by
 *    measuring nothing is the disease this whole file is about.
 *
 * ## The controls, run on every seed on every run
 *
 * CLAUDE.md: *"run a control on the instrument first"*. Two run beside the real
 * measurement, from the same park, and both are printed whether or not the run
 * passes.
 *
 * - **Lifted bus** — the identical sweep with the bus box translated
 *   {@link CONTROL_LIFT} m upwards, clear of everything the ride draws. It must
 *   come back **zero**. If it does not, the sweep is not height-aware at all and
 *   is really a plan projection wearing a box, and the whole run is void.
 *
 *   The brief asked for a *flat* bus (body height 0) here. A zero-height box is
 *   a horizontal **plane**, and a post crossing that plane still legitimately
 *   intersects it, so a flat bus cannot read zero in a genuine box-to-post
 *   distance test — it would only read zero in an instrument that filters post
 *   samples by a height *band*, which is the shape this one deliberately does
 *   not have. The lifted bus asks the same question ("is this height-aware?")
 *   and can answer it.
 * - **Feet-only** — the identical sweep asking `check:entrance-road`'s original
 *   question and nothing else: the **trunks alone** (`railRace:trestle-legs`),
 *   each resolved to the single point at its **foot**. No branches, nowhere
 *   along the lean. Its count is printed beside the real one on every seed, and
 *   the two differing is the evidence that the foot was the wrong origin. The
 *   **post** count is the one the ratchet binds.
 *
 * ## What this covers, stated plainly
 *
 * Every seed in `PARK_SEED_POOL` — the sixteen parks a child can be given.
 * Nothing outside the pool. Separately, `check:park` is canonical-only and
 * `test:procgen` covers seven of the sixteen; that gap is **#510** and is not
 * this check's to close.
 *
 * One park per seed, one child process per seed, because `parkManifest.ts`
 * reads `LGP_SEED` once at import.
 */
import './headless-canvas.mjs';
import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { InstancedMesh, Matrix4, Vector3, type Object3D } from 'three';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';
import { SWEPT_BUS_BASELINE } from './swept-bus-baseline.mts';

const run = promisify(execFile);
const HERE = fileURLToPath(import.meta.url);
const verbose = process.argv.includes('--verbose');
const printBaseline = process.argv.includes('--print-baseline');
const isChild = process.env['LGP_SWEPT_BUS_CHILD'] === '1';
const started = performance.now();

/**
 * How finely a post is sampled along its own length. Comfortably finer than the
 * bus is deep, so a post cannot slip between two samples of itself.
 */
const POST_STEP = 0.2;

/** How finely the bus is stepped along its run. Finer than the thinnest post. */
const SWEEP_STEP = 0.2;

/** How far the control bus is lifted — well above anything the ride draws. */
const CONTROL_LIFT = 200;

/** The three meshes every part of a trestle is drawn into, by `track.ts`'s `strut`. */
const TRESTLE_MESHES = [
  'railRace:trestle-legs',
  'railRace:trestle-branches-lower',
  'railRace:trestle-branches-upper',
] as const;

/** One post the bus reaches, as a person would need it described to go and look. */
export interface Intrusion {
  /** `<ring>:<part>:<instance>` — which drawn strut this is. */
  readonly post: string;
  /** How far inside the bus's body the post reaches, in metres. */
  readonly penetration: number;
  /** Where on the post that happens, in world metres. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The height of that point above the ground under it. */
  readonly up: number;
  /** Where the bus was standing when it reached that deep. */
  readonly busX: number;
}

/** What one child hands back about one seed. */
export interface SeedReport {
  readonly seed: number;
  /** Distinct drawn posts the bus's body reaches. The ratcheted number. */
  readonly posts: number;
  /** The same sweep asked only at each post's foot — the old, wrong question. */
  readonly feet: number;
  /** The same sweep with the bus lifted clear. Must be zero or the run is void. */
  readonly lifted: number;
  /** Every intrusion, worst first. */
  readonly worst: readonly Intrusion[];
  /** How many post samples the sweep had to look at — zero means it measured nothing. */
  readonly samples: number;
  /** Instances found per trestle mesh, so a rename cannot pass as a clean park. */
  readonly instances: Readonly<Record<string, number>>;
  /** The bus box as measured off the drawn bus, for the transcript. */
  readonly bus: {
    readonly length: number;
    readonly width: number;
    readonly bottom: number;
    readonly top: number;
  };
  /** The run the bus was swept along, for the transcript. */
  readonly route: { readonly fromX: number; readonly toX: number; readonly z: number };
}

// ------------------------------------------------------------------ the child

/**
 * Measures one seed, in this process, and prints the report as JSON.
 *
 * **One park.** Every number below — the real sweep and both controls — comes
 * off the same built world; the controls change what is *asked*, never what was
 * built, so they cannot disagree with the measurement for a reason other than
 * the one under test.
 */
async function measureOneSeed(): Promise<void> {
  const { buildHeadlessPark } = await import('./park-harness.mts');
  const { terrainHeight } = await import('../src/world/terrain.ts');
  const { ENTRANCE_BUS_ARRIVE_X, ENTRANCE_BUS_STOP_Z, ENTRANCE_BUS_VANISH_X } = await import(
    '../src/world/entrance/layout.ts'
  );
  const { PARK_SEED: seed } = await import('../src/world/parkManifest.ts');
  const { saveFlags } = await import('../src/state/flags.ts');
  const { Box3 } = await import('three');

  // The arrival only exists for a child who has not already arrived — the same
  // hydrate `check:cat-bus` does, and for the same reason: without it the park
  // builds no bus and this check would sweep an empty road and call it clear.
  saveFlags.hydrate({ arrivedByBus: false });

  const park = buildHeadlessPark();

  // --- the bus, as it is drawn and as it is really placed -------------------
  //
  // **The park's own bus, not one this script builds.** `ArrivalSequence`
  // constructs it and calls `placeBus`, which sets the position *and* the
  // bearing. Taking both off that object means this check cannot hold a second
  // opinion about either — no `BUS_FACING` restated here, no bus assembled with
  // different options. Both are things `check:entrance-road` would have had to
  // copy, and a copy is the bug this branch keeps finding.
  const arrival = park.world.entrance.arrival;
  if (!arrival) throw new Error('check:swept-bus: the headless park built no cat bus arrival');
  let busRoot: Object3D | null = null;
  arrival.group.traverse((object: Object3D) => {
    if (!busRoot && object.name === 'cat-bus') busRoot = object;
  });
  if (!busRoot) {
    throw new Error(
      'check:swept-bus: no node named `cat-bus` under the arrival group. This check finds ' +
        'the bus by that name, so a rename would make it sweep nothing and report clear.',
    );
  }
  const bus = busRoot as Object3D;

  /**
   * **Everything above the bus must be identity, and this says so out loud.**
   *
   * `placeBus` writes the bus's pose into its **own** transform, and everything
   * below reads that transform and then works in world coordinates. The two are
   * the same thing only while every ancestor — the arrival group, the entrance
   * group, the scene — is untransformed, which is true today and is nowhere
   * written down. Give the arrival group an offset tomorrow and every number
   * this check prints would be quietly measured in the wrong place: the "two
   * definitions of one thing kept in step by hand" fault, sitting in the
   * instrument instead of in the park.
   *
   * So it is asserted rather than assumed. Cheaper than folding the world
   * matrix in, and it fails loudly instead of drifting.
   */
  for (let node = bus.parent; node; node = node.parent) {
    const moved =
      node.position.lengthSq() > 1e-12 ||
      Math.abs(node.quaternion.w - 1) > 1e-9 ||
      Math.abs(node.scale.x - 1) > 1e-9 ||
      Math.abs(node.scale.y - 1) > 1e-9 ||
      Math.abs(node.scale.z - 1) > 1e-9;
    if (moved) {
      throw new Error(
        `check:swept-bus: \`${node.name || node.type}\`, an ancestor of the cat bus, has a ` +
          "transform of its own. This check reads the bus's pose off the bus and then " +
          'measures in world coordinates, which is only the same thing while everything ' +
          'above it is identity. Fold the ancestor transform in before trusting any ' +
          'number here.',
      );
    }
  }

  /** The bearing `placeBus` gave it. Read, never restated. */
  const facing = bus.rotation.y;
  const forwardX = Math.sin(facing);
  const forwardZ = Math.cos(facing);
  const rightX = Math.cos(facing);
  const rightZ = -Math.sin(facing);

  // The drawn extent **in the bus's own frame**: +Z along its length, +X across
  // it, y from the underside of the tyres to the tips of its ears. Taken by
  // standing the real bus at the origin unrotated for the measurement and
  // putting it straight back — nothing else has looked at it yet, and the
  // alternative is re-deriving a dozen private constants in `catBus.ts`.
  const keptPosition = bus.position.clone();
  const keptRotationY = bus.rotation.y;
  bus.position.set(0, 0, 0);
  bus.rotation.y = 0;
  bus.updateMatrixWorld(true);
  const busBox = new Box3().setFromObject(bus);
  bus.position.copy(keptPosition);
  bus.rotation.y = keptRotationY;
  bus.updateMatrixWorld(true);
  if (!Number.isFinite(busBox.min.x) || busBox.max.y <= busBox.min.y) {
    throw new Error('check:swept-bus: the drawn cat bus has no measurable body');
  }

  // --- the posts, as they are drawn ----------------------------------------
  interface Sample {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly radius: number;
    readonly post: string;
    /** Which of the three trestle meshes this came from: `legs`, `branches-*`. */
    readonly part: string;
    /** True for the sample at the strut's own start — its foot, for a trunk. */
    readonly isFoot: boolean;
  }
  const samples: Sample[] = [];
  const instances: Record<string, number> = Object.fromEntries(
    TRESTLE_MESHES.map((name) => [name, 0]),
  );
  const matrix = new Matrix4();
  const centre = new Vector3();
  const axis = new Vector3();
  const across = new Vector3();

  park.scene.traverse((object: Object3D) => {
    const mesh = object as InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    const name = mesh.name as (typeof TRESTLE_MESHES)[number];
    if (!TRESTLE_MESHES.includes(name)) return;
    instances[name] = (instances[name] ?? 0) + mesh.count;

    // Which ring, so a reader knows whether this is the one a child stands
    // beside on foot or the one she meets mid-ride.
    let ring = 'unknown';
    for (let node: Object3D | null = mesh; node; node = node.parent) {
      if (node.name.includes('walk-past')) {
        ring = 'walk-past';
        break;
      }
      if (node.name.includes('race-ring')) {
        ring = 'race';
        break;
      }
    }

    // `strut` stands a unit-height cylinder from `from` to `to`, so the
    // geometry's own bottom radius belongs to the `from` end and its top radius
    // to the `to` end. Asked of the geometry — three trestle radii written out
    // in a check would be three more copies of numbers `trestleGeometry.ts`
    // owns, which is the bug this branch exists to stop repeating.
    const parameters = (
      mesh.geometry as unknown as {
        parameters?: { radiusTop: number; radiusBottom: number };
      }
    ).parameters;
    if (!parameters) {
      throw new Error(`check:swept-bus: ${mesh.name} is not a cylinder — its radii cannot be read`);
    }
    const { radiusTop, radiusBottom } = parameters;
    const part = mesh.name.replace('railRace:trestle-', '');

    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getMatrixAt(i, matrix);
      centre.setFromMatrixPosition(matrix);
      axis.setFromMatrixColumn(matrix, 1);
      const length = axis.length();
      if (length < 1e-6) continue;
      axis.divideScalar(length);
      // x and z are scaled by the ring's own size — exactly the factor
      // `track.ts` multiplies `POST_FOOT_RADIUS` by for the collider.
      const widthScale = across.setFromMatrixColumn(matrix, 0).length();
      const footX = centre.x - axis.x * (length / 2);
      const footY = centre.y - axis.y * (length / 2);
      const footZ = centre.z - axis.z * (length / 2);
      const post = `${ring}:${part}:${i}`;
      for (let along = 0; along <= length; along += POST_STEP) {
        const t = along / length;
        samples.push({
          x: footX + axis.x * along,
          y: footY + axis.y * along,
          z: footZ + axis.z * along,
          radius: (radiusBottom + (radiusTop - radiusBottom) * t) * widthScale,
          post,
          part,
          isFoot: along === 0,
        });
      }
    }
  });

  // --- the sweep -----------------------------------------------------------
  //
  // The bus rolls in along the kerb from `ENTRANCE_BUS_ARRIVE_X`, stops, and
  // drives off past `ENTRANCE_BUS_VANISH_X` — `layout.ts` owns both ends, and
  // `ArrivalSequence.placeBus` is the one line that turns an x into a pose:
  // `position.set(x, terrainHeight(x, ENTRANCE_BUS_STOP_Z), ENTRANCE_BUS_STOP_Z)`
  // with the bearing read off the bus above. So this sweeps the same x range
  // through the same formula, and holds no separate opinion about where the
  // road goes.
  const fromX = Math.max(ENTRANCE_BUS_ARRIVE_X, ENTRANCE_BUS_VANISH_X);
  const toX = Math.min(ENTRANCE_BUS_ARRIVE_X, ENTRANCE_BUS_VANISH_X);
  const z0 = ENTRANCE_BUS_STOP_Z;

  /**
   * How far a post sample reaches inside the bus's body, standing at `busX`.
   * Zero or less is clear. The bus is an axis-aligned box once the bearing
   * above is folded in, so this is the ordinary point-to-box distance.
   */
  const reachInto = (
    sample: Sample,
    busX: number,
    busGroundY: number,
    lift: number,
  ): number => {
    // Into the bus's own frame, using the bearing read off the bus itself.
    const dx = sample.x - busX;
    const dz = sample.z - z0;
    const localZ = dx * forwardX + dz * forwardZ;
    const localX = dx * rightX + dz * rightZ;
    const localY = sample.y - busGroundY - lift;
    const outX = Math.max(busBox.min.x - localX, localX - busBox.max.x);
    const outY = Math.max(busBox.min.y - localY, localY - busBox.max.y);
    const outZ = Math.max(busBox.min.z - localZ, localZ - busBox.max.z);
    if (outX <= 0 && outY <= 0 && outZ <= 0) {
      // Inside the box: the deepest it is from any face, plus its own radius.
      return sample.radius - Math.max(outX, outY, outZ);
    }
    const outside = Math.hypot(Math.max(0, outX), Math.max(0, outY), Math.max(0, outZ));
    return sample.radius - outside;
  };

  /**
   * Sweeps the run and returns the distinct posts reached.
   *
   * `feetOnly` reproduces **exactly** the question `check:entrance-road` was
   * asking when it headlined "0 legs hit on all sixteen seeds": the trunks
   * (`railRace:trestle-legs`) alone, each resolved to the single point at its
   * **foot**. Not the branches, which that check could not see at all, and not
   * anywhere along the lean. `lift` is the control that raises the bus clear of
   * everything.
   */
  const sweep = (
    feetOnly: boolean,
    lift: number,
  ): { posts: Map<string, Intrusion> } => {
    const hit = new Map<string, Intrusion>();
    const looking = feetOnly
      ? samples.filter((sample) => sample.isFoot && sample.part === 'legs')
      : samples;
    for (let busX = fromX; busX >= toX; busX -= SWEEP_STEP) {
      const busGroundY = terrainHeight(busX, z0);
      for (const sample of looking) {
        const reach = reachInto(sample, busX, busGroundY, lift);
        if (reach <= 0) continue;
        const already = hit.get(sample.post);
        if (already && already.penetration >= reach) continue;
        hit.set(sample.post, {
          post: sample.post,
          penetration: reach,
          x: sample.x,
          y: sample.y,
          z: sample.z,
          up: sample.y - terrainHeight(sample.x, sample.z),
          busX,
        });
      }
    }
    return { posts: hit };
  };

  const real = sweep(false, 0);
  const feet = sweep(true, 0);
  const lifted = sweep(false, CONTROL_LIFT);

  const report: SeedReport = {
    seed,
    posts: real.posts.size,
    feet: feet.posts.size,
    lifted: lifted.posts.size,
    worst: [...real.posts.values()].sort((a, b) => b.penetration - a.penetration),
    samples: samples.length,
    instances,
    bus: {
      length: busBox.max.z - busBox.min.z,
      width: busBox.max.x - busBox.min.x,
      bottom: busBox.min.y,
      top: busBox.max.y,
    },
    route: { fromX, toX, z: z0 },
  };
  process.stdout.write(`\n__SWEPT_BUS__${JSON.stringify(report)}\n`);
}

if (isChild) {
  await measureOneSeed();
  process.exit(0);
}

// ----------------------------------------------------------------- the parent

/**
 * Every park a child can actually be given — `parkSeedPool.ts` is the one owner
 * of that question, and the canonical seed is folded in because it is the park
 * every other check measures.
 */
const seeds = [...new Set([PARK_SEED, ...PARK_SEED_POOL])].sort((a, b) => a - b);

const limit = Math.max(1, Math.min(seeds.length, cpus().length - 1));
const reports: SeedReport[] = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: limit }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const seed = seeds[index];
      if (seed === undefined) return;
      const { stdout } = await run(
        process.execPath,
        ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', HERE],
        {
          env: { ...process.env, LGP_SEED: String(seed), LGP_SWEPT_BUS_CHILD: '1' },
          maxBuffer: 64 * 1024 * 1024,
        },
      );
      const line = stdout.split('\n').find((each) => each.startsWith('__SWEPT_BUS__'));
      if (!line) throw new Error(`check:swept-bus: seed ${seed} produced no report`);
      reports.push(JSON.parse(line.slice('__SWEPT_BUS__'.length)) as SeedReport);
    }
  }),
);
reports.sort((a, b) => a.seed - b.seed);

// ----------------------------------------------------- can this measure at all

/**
 * **The guards that stop a green line meaning "I looked at nothing".**
 *
 * This check finds the ride's supports by mesh name, so a rename is all it
 * takes to turn it into a ratchet that passes because it swept an empty park.
 * That is #520's fault, one layer out, and it is caught here rather than
 * inferred later.
 */
const voids: string[] = [];
for (const report of reports) {
  for (const name of TRESTLE_MESHES) {
    if ((report.instances[name] ?? 0) === 0) {
      voids.push(
        `seed ${report.seed}: no instances of \`${name}\` in the built park. ` +
          'This check finds the ride\'s supports by that name, so a rename makes it ' +
          'measure nothing and report zero. Fix the name here, do not accept the zero.',
      );
    }
  }
  if (report.samples === 0) {
    voids.push(`seed ${report.seed}: the sweep had no post samples to look at`);
  }
  if (report.lifted !== 0) {
    voids.push(
      `seed ${report.seed}: the CONTROL sweep, with the bus lifted ${CONTROL_LIFT} m clear of ` +
        `the whole ride, still reached ${report.lifted} post(s). The sweep is not ` +
        'height-aware, so every number it reports about the real bus is void.',
    );
  }
}

// ------------------------------------------------------------- the baseline

if (printBaseline) {
  const lines = reports
    .filter((report) => report.posts > 0)
    .map((report) => `  ${report.seed}: ${report.posts},`);
  process.stdout.write(
    `/**\n` +
      ` * **What the cat bus was already driving through when \`check:swept-bus\` was written.**\n` +
      ` *\n` +
      ` * Generated by \`pnpm run check:swept-bus -- --print-baseline\`. Each entry is a\n` +
      ` * **seed number** and the count of distinct drawn trestle posts the bus's body\n` +
      ` * reaches on that seed. Keyed on the seed and nothing else, deliberately:\n` +
      ` * issue #520 is that \`check:coplanar\`'s baseline is keyed on mesh names, so a\n` +
      ` * rename silently loses the finding. A seed number cannot be renamed, and an\n` +
      ` * entry here for a seed that is not in \`PARK_SEED_POOL\` **fails the check**\n` +
      ` * rather than sitting quietly.\n` +
      ` *\n` +
      ` * A seed with no entry allows **zero**. Do not add an entry to make the check\n` +
      ` * pass — an entry means "this was already wrong when the gate was written", and\n` +
      ` * a new one means the road or the ride has just been made worse.\n` +
      ` *\n` +
      ` * Stage 3, step 2 drives this to empty and deletes the file. See\n` +
      ` * \`docs/DESIGN-round-robin-generation.md\`.\n` +
      ` */\n` +
      `export const SWEPT_BUS_BASELINE: Readonly<Record<number, number>> = {\n` +
      `${lines.join('\n')}\n};\n`,
  );
  process.exit(voids.length > 0 ? 1 : 0);
}

const ratchetEnforced = process.env['LGP_RATCHET'] !== 'off';
const inPool = new Set(seeds);

const regressions: string[] = [];
for (const report of reports) {
  const allowed = SWEPT_BUS_BASELINE[report.seed] ?? 0;
  if (report.posts > allowed) {
    const worst = report.worst[0];
    regressions.push(
      `WORSE: seed ${report.seed} — ${report.posts} drawn post(s) inside the bus, ` +
        `baseline allows ${allowed}` +
        (worst
          ? `\n      worst ${worst.penetration.toFixed(3)} m into the body at ` +
            `(${worst.x.toFixed(2)}, ${worst.z.toFixed(2)}), ` +
            `${worst.up.toFixed(2)} m up, post ${worst.post}, bus at x=${worst.busX.toFixed(2)}`
          : ''),
    );
  }
}

/**
 * **An orphaned entry is a failure, not a note.**
 *
 * The brief's instruction, straight out of #520: a ratchet entry that matches
 * nothing has stopped being a measurement of anything, and the one thing that
 * must never happen is for it to stop mattering quietly.
 */
const orphans = Object.keys(SWEPT_BUS_BASELINE)
  .map(Number)
  .filter((seed) => !inPool.has(seed));

/** Entries the park has grown out of — slack in the ratchet, to be taken up. */
const loose = reports.filter(
  (report) => SWEPT_BUS_BASELINE[report.seed] !== undefined &&
    report.posts < (SWEPT_BUS_BASELINE[report.seed] ?? 0),
);

// ------------------------------------------------------------------- report
//
// **Every run prints every seed**, pass or fail, to stderr — CLAUDE.md: a check
// that stops covering something must say so on every run, and a coverage note
// written to stdout is one nobody reads on a green run.

const intruding = reports.filter((report) => report.posts > 0);
const bus = reports[0]?.bus;
const route = reports[0]?.route;

process.stderr.write(
  `\ncheck:swept-bus — the drawn cat bus against the drawn rail-race posts, ` +
    `${reports.length} seed(s) of PARK_SEED_POOL.\n` +
    (bus && route
      ? `  bus body as drawn: ${bus.length.toFixed(2)} m long, ${bus.width.toFixed(2)} m wide, ` +
        `${bus.bottom.toFixed(2)} to ${bus.top.toFixed(2)} m above the ground it stands on\n` +
        `  swept along z=${route.z.toFixed(2)} from x=${route.fromX.toFixed(2)} to ` +
        `x=${route.toX.toFixed(2)}, every ${SWEEP_STEP} m\n`
      : '') +
    `  seed   posts  feet(control)  lifted(control)  worst penetration\n`,
);
for (const report of reports) {
  const worst = report.worst[0];
  process.stderr.write(
    `  ${String(report.seed).padStart(5)}  ${String(report.posts).padStart(5)}  ` +
      `${String(report.feet).padStart(13)}  ${String(report.lifted).padStart(15)}  ` +
      (worst
        ? `${worst.penetration.toFixed(3)} m at ${worst.up.toFixed(2)} m up (${worst.post})`
        : '—') +
      '\n',
  );
  if (verbose) {
    for (const intrusion of report.worst) {
      process.stderr.write(
        `           ${intrusion.post}  ${intrusion.penetration.toFixed(3)} m in, at ` +
          `(${intrusion.x.toFixed(2)}, ${intrusion.y.toFixed(2)}, ${intrusion.z.toFixed(2)}) ` +
          `= ${intrusion.up.toFixed(2)} m up, bus at x=${intrusion.busX.toFixed(2)}\n`,
      );
    }
  }
}

/**
 * **The control's own number, said out loud on every run.**
 *
 * The feet-only column is the question `check:entrance-road` was asking. If it
 * ever stops differing from the post column, either the posts have stopped
 * leaning — which is step 2's whole job and worth knowing — or this instrument
 * has quietly become the old one again.
 */
const differs = reports.filter((report) => report.feet !== report.posts).length;
process.stderr.write(
  `\n  CONTROL, feet-only vs the drawn post: the two counts differ on ${differs} of ` +
    `${reports.length} seed(s).\n` +
    (differs === 0
      ? '  They agree everywhere. Either no post leans through the bus any more, or this\n' +
        '  check has become the foot-only one it was written to replace — say which.\n'
      : '  Where they differ, the foot is the wrong origin and the post count binds.\n') +
    `  CONTROL, bus lifted ${CONTROL_LIFT} m: ` +
    `${reports.every((report) => report.lifted === 0) ? 'zero on every seed, as it must be' : 'NOT ZERO — see above'}.\n`,
);

process.stderr.write(
  `\n  ${intruding.length} seed(s) still intruding — step 2 owes these. ` +
    `${reports.reduce((sum, report) => sum + report.posts, 0)} drawn post(s) in total.\n`,
);

for (const seed of orphans) {
  process.stderr.write(
    `  BASELINE ORPHAN: seed ${seed} has a baseline entry but is not in PARK_SEED_POOL.\n`,
  );
}
for (const report of loose) {
  process.stderr.write(
    `  BASELINE LOOSE: seed ${report.seed} is down to ${report.posts} from ` +
      `${SWEPT_BUS_BASELINE[report.seed]} — tighten scripts/swept-bus-baseline.mts.\n`,
  );
}

// -------------------------------------------------------------------- verdict

if (voids.length > 0) {
  console.error(
    `\ncheck:swept-bus VOID — this run measured nothing it can be trusted about:\n`,
  );
  for (const line of voids) console.error(`  ${line}`);
  process.exit(1);
}

if (orphans.length > 0) {
  console.error(
    `\ncheck:swept-bus — ${orphans.length} orphaned baseline ` +
      `${orphans.length === 1 ? 'entry' : 'entries'}, for ` +
      `${orphans.length === 1 ? 'a seed' : 'seeds'} not in PARK_SEED_POOL: ` +
      `${orphans.join(', ')}.\n` +
      'A ratchet entry that matches no seed has stopped measuring anything, and #520 is\n' +
      'exactly what happens when that is allowed to be quiet. Delete the entry, or put\n' +
      'the seed back in PARK_SEED_POOL — do not leave it standing.',
  );
  process.exit(1);
}

if (regressions.length > 0) {
  const say = ratchetEnforced ? console.error : console.log;
  say(
    `\ncheck:swept-bus — ${regressions.length} seed(s) where the bus now reaches more of ` +
      `the ride than the baseline records` +
      `${ratchetEnforced ? '' : ' (LGP_RATCHET=off, so reported and not enforced)'}:\n`,
  );
  for (const line of regressions) say(`  ${line}`);
  if (ratchetEnforced) {
    console.error(
      '\nThe fix is a road or a support placement that clears, not a bigger baseline —\n' +
        'see docs/DESIGN-round-robin-generation.md, "Stage 3". A trestle whose foot is\n' +
        'clear can still lean through the bus at height; measure the drawn post.',
    );
    process.exit(1);
  }
}

console.log(
  `check:swept-bus OK — swept ${reports.length} seed(s); ` +
    `${intruding.length} still have the bus driving through the drawn ride ` +
    `(${reports.reduce((sum, report) => sum + report.posts, 0)} post(s)), all within the ` +
    `baseline in scripts/swept-bus-baseline.mts. ` +
    `${regressions.length === 0 ? 'None is new.' : `${regressions.length} new, listed above and NOT enforced because LGP_RATCHET=off.`} ` +
    `THIS IS NOT CLEAR — green here means "no worse", and step 2 owes the zero. ` +
    `${((performance.now() - started) / 1000).toFixed(1)} s.`,
);
