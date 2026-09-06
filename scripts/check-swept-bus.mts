/**
 * **Does the cat bus's body sweep through the Rail Race's drawn supports?**
 *
 * ```
 * pnpm run check:swept-bus                      # every seed in the pool
 * pnpm run check:swept-bus -- --verbose         # and every offending post
 * ```
 *
 * This is stage 3's independent instrument — the thing every later stage-3 step
 * is measured by. See `docs/DESIGN-round-robin-generation.md`, "Stage 3".
 *
 * Three facts about why it is shaped as it is, stated here rather than pointed
 * at, because the engineering brief they came from lives on the
 * `design/round-robin-generation` branch and a pointer to it from `main` would
 * dangle — which is this file's own subject, one level up:
 *
 * 1. **It was written before the fix**, deliberately, so that it could be
 *    watched failing. A check nobody has seen go red is not known to be able to.
 * 2. **It landed as a ratchet** (a per-seed baseline, 364 drawn posts inside
 *    the bus across the sixteen pool seeds) because the park was genuinely red
 *    on it, and green meant *no worse*.
 * 3. **Step 2 made the supports claims** — the plan projection of the drawn
 *    trunk and branches below the bus's own height, asked of the registry the
 *    road claimed its corridor in — and with that the ratchet is gone: **any
 *    drawn post inside the bus, on any pool seed, fails this check**, and so
 *    does a seed whose park cannot be built at all. There is no baseline file
 *    to add an entry to.
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
 * rename orphans the entry and nobody hears. This check has no baseline any
 * more (it had one, keyed on the seed number, until step 2 drove it to zero),
 * but it meets the same hazard one layer out and answers it: **the meshes it
 * measures are asserted to exist**, on every seed. This check finds posts *by
 * name*; rename `railRace:trestle-legs` and the sweep would find nothing and
 * report a triumphant zero. So a named mesh that is absent, or present with no
 * instances, fails the run and says the mesh is gone. A green line that could
 * only be produced by measuring nothing is the disease this whole file is
 * about.
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
 *   **post** count is the one that fails the run.
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

const run = promisify(execFile);
const HERE = fileURLToPath(import.meta.url);
const verbose = process.argv.includes('--verbose');
const isChild = process.env['LGP_SWEPT_BUS_CHILD'] === '1';
const started = performance.now();

/**
 * How finely a post is sampled along its own length. Comfortably finer than the
 * bus is deep, so a post cannot slip between two samples of itself.
 *
 * **This can only ever *under*-count, never over-count**, and that is the
 * direction that matters. A post grazing the bus between two of its own samples
 * is missed; a post that is not touching can never be invented. So every number
 * here is a **lower bound** on the intrusion — which is the safe direction while
 * the count is large and the *unsafe* one at the moment it reaches zero.
 *
 * Hence {@link FINER_STEP_WARNING}: a zero measured at this step is not proof of
 * a zero, and the check says so on the run where somebody would act on it.
 */
const POST_STEP = 0.2;

/**
 * What to print when a seed reaches zero — read at the moment it is needed,
 * rather than in a handoff nobody opens.
 */
const FINER_STEP_WARNING =
  `  A zero at POST_STEP=${POST_STEP} m is a LOWER BOUND, not a proof. The sampling can only\n` +
  '  under-count (a post grazing the bus between two of its own samples is missed).\n' +
  '  Before trusting a zero after the supports or the road have moved, re-run with\n' +
  '  POST_STEP and SWEEP_STEP cut to 0.02 m and confirm it holds — a coarse zero is how\n' +
  '  this check would come to certify a bus still clipping a post.\n';

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
  /** Distinct drawn posts the bus's body reaches. Any but zero fails the run. */
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
  // Vertex-precise (`precise = true`): the default transforms each geometry's
  // own bounding *box*, and a tilted cone's box rises by its radius times the
  // sine of the tilt — the ears' boxes put the top at 6.15 m when no vertex
  // is above 6.04. The drawn bus is its vertices, not boxes round its parts.
  const busBox = new Box3().setFromObject(bus, true);
  bus.position.copy(keptPosition);
  bus.rotation.y = keptRotationY;
  bus.updateMatrixWorld(true);
  if (!Number.isFinite(busBox.min.x) || busBox.max.y <= busBox.min.y) {
    throw new Error('check:swept-bus: the drawn cat bus has no measurable body');
  }
  // **The bus's own owner must equal the drawn top** (ruling 3, 6 Sep 2026).
  // `CAT_BUS_TOP` is what the road's corridor claim carries as headroom and
  // what the arrival's sightline keep-out reads; this box is the drawn
  // vehicle. They were two definitions once — a hand-copied ear formula 6.8 cm
  // under the face's crown — and nothing compared them. Measured independently
  // here, on every run, so the gap can never reopen silently.
  const { CAT_BUS_TOP } = await import('../src/world/entrance/catBus.ts');
  const ownerGap = busBox.max.y - CAT_BUS_TOP;
  if (Math.abs(ownerGap) > 1e-3) {
    throw new Error(
      `check:swept-bus: CAT_BUS_TOP (${CAT_BUS_TOP.toFixed(4)} m, the bus's own owner) is not the drawn ` +
        `top (${busBox.max.y.toFixed(4)} m, vertex-precise Box3) — off by ${ownerGap.toFixed(4)} m. ` +
        'Two definitions of one thing: derive the owner from the geometry that reaches highest, never restate it.',
    );
  }
  process.stdout.write(
    `  owner check: CAT_BUS_TOP ${CAT_BUS_TOP.toFixed(4)} m equals the drawn top ${busBox.max.y.toFixed(4)} m ` +
      `(off by ${ownerGap.toFixed(4)} m, slack 0.001)\n`,
  );

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
      // Stepped by a whole number of intervals rather than by adding
      // {@link POST_STEP} until it overshoots, so **both ends are always
      // sampled** and the spacing is never coarser than asked for. Walking a
      // float up to `<= length` drops the top of a strut whenever the length is
      // not a multiple of the step — and the top of a trunk is exactly where
      // the fork the bus meets is.
      const steps = Math.max(1, Math.ceil(length / POST_STEP));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const along = t * length;
        samples.push({
          x: footX + axis.x * along,
          y: footY + axis.y * along,
          z: footZ + axis.z * along,
          radius: (radiusBottom + (radiusTop - radiusBottom) * t) * widthScale,
          post,
          part,
          isFoot: step === 0,
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
/** Seeds whose park threw before the bus could be swept, with the thrown reason. */
const unbuilt: { seed: number; reason: string }[] = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: limit }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const seed = seeds[index];
      if (seed === undefined) return;
      let stdout = '';
      try {
        ({ stdout } = await run(
          process.execPath,
          ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', HERE],
          {
            env: { ...process.env, LGP_SEED: String(seed), LGP_SWEPT_BUS_CHILD: '1' },
            maxBuffer: 64 * 1024 * 1024,
          },
        ));
      } catch (error) {
        // **A park that cannot be built is a failed seed, said in one line.**
        // The Rail Race refuses a duck bar's slot with a thrown Error when no
        // support can stand (track.ts, `trestleSpots`); the child dies with it,
        // and the reason belongs in this report beside the seeds that did build,
        // not as a stack trace that hides the other fifteen.
        const stderr = (error as { stderr?: string }).stderr ?? String(error);
        const reason =
          stderr.split('\n').find((each) => each.startsWith('Error: '))?.slice('Error: '.length) ??
          stderr.trim().split('\n').slice(-1)[0] ?? 'unknown';
        unbuilt.push({ seed, reason });
        continue;
      }
      const line = stdout.split('\n').find((each) => each.startsWith('__SWEPT_BUS__'));
      if (!line) {
        unbuilt.push({ seed, reason: 'the child produced no report' });
        continue;
      }
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
    `${reports.length} of ${seeds.length} seed(s) of PARK_SEED_POOL built.\n` +
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
for (const { seed, reason } of unbuilt) {
  process.stderr.write(`  ${String(seed).padStart(5)}  NOT BUILT — ${reason}\n`);
}

/**
 * **The control's own number, said out loud on every run.**
 *
 * The feet-only column is the question `check:entrance-road` was asking. Step 2
 * of stage 3 is the reason the two columns should now agree at zero: a support
 * is claimed as the plan projection of the drawn trunk and branches, so a foot
 * that is clear means a post that is clear. The moment they disagree again, a
 * post is leaning through the bus with its foot outside the road — the exact
 * bug this instrument was written to see, and the claim has stopped
 * describing the drawn geometry.
 */
const differs = reports.filter((report) => report.feet !== report.posts).length;
process.stderr.write(
  `\n  CONTROL, feet-only vs the drawn post: the two counts differ on ${differs} of ` +
    `${reports.length} built seed(s).\n` +
    `  CONTROL, bus lifted ${CONTROL_LIFT} m: ` +
    `${reports.every((report) => report.lifted === 0) ? 'zero on every seed, as it must be' : 'NOT ZERO — see above'}.\n`,
);

// **Said on the run where somebody would act on it, not in a handoff.** A zero
// here is where the under-counting in POST_STEP stops being the safe direction.
if (intruding.length < reports.length) {
  process.stderr.write(
    `\n  ${reports.length - intruding.length} seed(s) read ZERO.\n` + FINER_STEP_WARNING,
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

if (unbuilt.length > 0) {
  console.error(
    `\ncheck:swept-bus — ${unbuilt.length} seed(s) could not be built, so the bus was not ` +
      'swept on them:\n',
  );
  for (const { seed, reason } of unbuilt) console.error(`  seed ${seed}: ${reason}`);
  console.error(
    '\nA park that does not build is not a clear park. If the Rail Race refused a support,\n' +
      'the placer needs a different decision (a second support shape) or the blocker must\n' +
      'move — see docs/DESIGN-round-robin-generation.md, "Stage 3, ruled".',
  );
  process.exit(1);
}

if (intruding.length > 0) {
  console.error(
    `\ncheck:swept-bus — the bus drives through the drawn ride on ${intruding.length} seed(s):\n`,
  );
  for (const report of intruding) {
    const worst = report.worst[0] as Intrusion;
    console.error(
      `  seed ${report.seed}: ${report.posts} drawn post(s) inside the bus; worst ` +
        `${worst.penetration.toFixed(3)} m into the body at (${worst.x.toFixed(2)}, ` +
        `${worst.z.toFixed(2)}), ${worst.up.toFixed(2)} m up, post ${worst.post}, ` +
        `bus at x=${worst.busX.toFixed(2)}`,
    );
  }
  console.error(
    '\nThe fix is a support placement that clears, never a tolerance — the trestle placer\n' +
      'claims the plan projection of everything it draws below the bus (track.ts,\n' +
      '`trestleClaims`), so a post in the bus means a claim that stopped describing the\n' +
      'drawn geometry, or a road whose corridor claim is narrower than the bus it carries.',
  );
  process.exit(1);
}

console.log(
  `check:swept-bus OK — swept ${reports.length} seed(s); the drawn bus reaches no drawn ` +
    `trestle post on any of them (both controls held). ` +
    `${((performance.now() - started) / 1000).toFixed(1)} s.`,
);
