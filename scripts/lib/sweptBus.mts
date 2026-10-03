/**
 * **`check:swept-bus`'s measurement, as a function of a built park** — one
 * owner, asked by `scripts/check-swept-bus.mts` (one child process per pool
 * seed, which prints and gates) and by the root acceptance loop
 * (`scripts/park-attempt.mts`, which starts the park again from zero when the
 * drawn bus reaches a drawn trestle post). Why every number here is measured
 * the way it is — drawn posts not feet, the drawn bus, absolute world Y, the
 * two controls — is the script's header.
 *
 * Seeded modules are imported inside {@link measureSweptBus}, never at module
 * scope: `roadRoute.ts` builds off the seeded boundary at import, and the
 * script's parent process (which sweeps sixteen seeds through children) must
 * not pin a seed by importing this file.
 */
import { InstancedMesh, Matrix4, Vector3, type Object3D } from 'three';
import type { HeadlessPark } from '../park-harness.mts';

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
export const POST_STEP = 0.2;

/**
 * What to print when a seed reaches zero — read at the moment it is needed,
 * rather than in a handoff nobody opens.
 */
export const FINER_STEP_WARNING =
  `  A zero at POST_STEP=${POST_STEP} m is a LOWER BOUND, not a proof. The sampling can only\n` +
  '  under-count (a post grazing the bus between two of its own samples is missed).\n' +
  '  Before trusting a zero after the supports or the road have moved, re-run with\n' +
  '  POST_STEP and SWEEP_STEP cut to 0.02 m and confirm it holds — a coarse zero is how\n' +
  '  this check would come to certify a bus still clipping a post.\n';

/** How finely the bus is stepped along its run. Finer than the thinnest post. */
export const SWEEP_STEP = 0.2;

/** How far the control bus is lifted — well above anything the ride draws. */
export const CONTROL_LIFT = 200;

/** The three meshes every part of a trestle is drawn into, by `track.ts`'s `strut`. */
export const TRESTLE_MESHES = [
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
  /** Race-ring instances seen and deliberately not swept — the ring that exists only mid-race. */
  readonly excludedByDesign: Readonly<Record<string, number>>;
  /** The bus box as measured off the drawn bus, for the transcript. */
  readonly bus: {
    readonly length: number;
    readonly width: number;
    readonly bottom: number;
    readonly top: number;
    /** `CAT_BUS_TOP`, the bus's own owner of its height — must equal `top`. */
    readonly ownerTop: number;
    /** The top the sweep used: the highest vertex-precise top of the sprung body posed at full heave, full pitch, roll none or full. */
    readonly drivenTop: number;
    /** Which pose reached `drivenTop`, for the transcript. */
    readonly drivenPose: string;
    /** `CAT_BUS_DRIVEN_TOP`, the bus's own owner of its driven top — must equal `drivenTop`. */
    readonly ownerDrivenTop: number;
  };
  /**
   * The stretch of the road's arc the bus was swept along, and the road's own
   * full length beside it.
   *
   * **`roadLength` is here because a span without a whole is not coverage.** This
   * check printed `swept along the road's arc from 1.00 to -1.00 m` and headlined
   * "0 intruding posts on 14 seeds", and both sentences were true while the thing
   * a reader took from them — that the bus had been proved clear of the ride —
   * covered **2 m of a 145.7 m road, 1.4%**. That number was quoted as acceptance
   * evidence for the road merge. Nothing in the output contradicted it because
   * nothing in the output gave the reader the denominator.
   */
  readonly route: {
    readonly fromAt: number;
    readonly toAt: number;
    readonly roadLength: number;
  };
}

/**
 * Measures the bus against the posts on `park`, which must be built with the
 * arrival due (`saveFlags.arrivedByBus` false — a fresh process's default), or
 * there is no bus to sweep and this throws rather than call an empty road clear.
 *
 * **One park.** Every number below — the real sweep and both controls — comes
 * off the same built world; the controls change what is *asked*, never what was
 * built, so they cannot disagree with the measurement for a reason other than
 * the one under test.
 */
export async function measureSweptBus(park: HeadlessPark): Promise<SeedReport> {
  const { terrainHeight } = await import('../../src/world/terrain.ts');
  // The road is a curve now, so its own accessors replace layout.ts's three
  // straight-road constants (which this branch deleted). Dynamic, like every
  // import here: `roadRoute.ts` builds a RingPath off the seeded boundary at
  // module scope, so a static import would pin the seed.
  const {
    entranceRoadAt,
    entranceRoadFacing,
    entranceBusArriveAt,
    entranceBusVanishAt,
    entranceRoadExtent,
  } = await import('../../src/world/entrance/roadRoute.ts');
  const { PARK_SEED: seed } = await import('../../src/world/parkManifest.ts');
  const { Box3 } = await import('three');

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

  // The drawn extent **in the bus's own frame**: +Z along its length, +X across
  // it, y from the underside of the tyres to the tips of its ears. Taken by
  // standing the real bus at the origin, with its WHOLE quaternion cleared, for
  // the measurement and putting it straight back — nothing else has looked at
  // it yet, and the alternative is re-deriving a dozen private constants in
  // `catBus.ts`. The quaternion, not `rotation.y`: on the sphere `placeBus`
  // stands the bus on the road's own up (`faceOnGround`), so its orientation is
  // a lean composed with a yaw, and zeroing the Euler's `y` alone left the lean
  // in — the box of a bus tilted 15-30 degrees read 6.6-8.6 m tall against a
  // 6.04 m crown, per seed, and the owner assertion below rightly refused it.
  const keptPosition = bus.position.clone();
  const keptQuaternion = bus.quaternion.clone();
  bus.position.set(0, 0, 0);
  bus.quaternion.identity();
  bus.updateMatrixWorld(true);
  // Vertex-precise (`precise = true`): the default transforms each geometry's
  // own bounding *box*, and a tilted cone's box rises by its radius times the
  // sine of the tilt — the ears' boxes put the top at 6.15 m when no vertex
  // is above 6.04. The drawn bus is its vertices, not boxes round its parts.
  const busBox = new Box3().setFromObject(bus, true);
  // Still at the origin, unrotated: the poses below are in the bus's own frame.
  const { CAT_BUS_TOP, CAT_BUS_DRIVEN_TOP, CAT_BUS_RIDE_LIFT, CAT_BUS_MAX_HEAVE, CAT_BUS_MAX_PITCH, CAT_BUS_MAX_ROLL } =
    await import('../../src/world/entrance/catBus.ts');
  // flat-ok: the bus is at the origin, unrotated and unleant here — its own frame, where +Y is its up
  const restTop = busBox.max.y;
  // **The bus is swept as it drives, not as it rests.** The sprung body is
  // POSED — full heave, full pitch either way, roll none or full either way —
  // and the highest vertex-precise top of those poses is the envelope's top.
  // Measured off the mesh rather than added from a constant, so the parent
  // can hold `CAT_BUS_DRIVEN_TOP` to it — the guard for Jim's road rule:
  // trestle slots over the road are not built, and this proves no kept post
  // hangs where the bus drives.
  const chassis = bus.getObjectByName('chassis');
  if (!chassis) throw new Error('check:swept-bus: the drawn cat bus has no `chassis` group to pose');
  const kept = { y: chassis.position.y, rx: chassis.rotation.x, rz: chassis.rotation.z };
  let drivenTop = -Infinity;
  let drivenPose = '';
  for (const pitchSign of [1, -1]) {
    for (const rollSign of [0, 1, -1]) {
      chassis.position.y = CAT_BUS_RIDE_LIFT + CAT_BUS_MAX_HEAVE;
      chassis.rotation.x = pitchSign * CAT_BUS_MAX_PITCH;
      chassis.rotation.z = rollSign * CAT_BUS_MAX_ROLL;
      bus.updateMatrixWorld(true);
      // flat-ok: posed in the bus's own at-origin frame, not in the world — see restTop above
      const top = new Box3().setFromObject(bus, true).max.y;
      if (top > drivenTop) {
        drivenTop = top;
        drivenPose = `heave +${CAT_BUS_MAX_HEAVE}, pitch ${pitchSign > 0 ? '+' : '-'}${CAT_BUS_MAX_PITCH}, roll ${rollSign === 0 ? '0' : (rollSign > 0 ? '+' : '-') + CAT_BUS_MAX_ROLL}`;
      }
    }
  }
  chassis.position.y = kept.y;
  chassis.rotation.x = kept.rx;
  chassis.rotation.z = kept.rz;
  bus.updateMatrixWorld(true);
  busBox.max.y = drivenTop;
  bus.position.copy(keptPosition);
  bus.quaternion.copy(keptQuaternion);
  bus.updateMatrixWorld(true);
  if (!Number.isFinite(busBox.min.x) || busBox.max.y <= busBox.min.y) {
    throw new Error('check:swept-bus: the drawn cat bus has no measurable body');
  }
  // The bus's own owner of its height, carried up to the parent, which asserts
  // it equals this box's top and says so where a run's reader can hear it.

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
  /** Race-ring instances seen and NOT swept — said in the report so the exclusion is audible. */
  const excludedByDesign: Record<string, number> = {};
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

    // **The walk-past ring only, by its exact group name.** It is the ring
    // standing there while the bus drives; the ride-scale ring exists only
    // mid-race, when the bus is long gone, and by Jim's ruling (7 Sep 2026)
    // keeps every leg, road or not. Sound only because the two rings are
    // never in the world together — the same fact `RAIL_RACE_FEATURE` rests
    // on. Named rather than taken as "whichever mesh came first".
    let ring = 'unknown';
    for (let node: Object3D | null = mesh; node; node = node.parent) {
      if (node.name === 'railRace:walk-past-ring') {
        ring = 'walk-past';
        break;
      }
      if (node.name === 'railRace:race-ring') {
        ring = 'race';
        break;
      }
    }
    if (ring !== 'walk-past') {
      excludedByDesign[name] = (excludedByDesign[name] ?? 0) + mesh.count;
      return;
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
  // **The road is an arc, so the sweep is an arc.** The bus rolls in from
  // `entranceBusArriveAt()`, stops, and drives off past `entranceBusVanishAt()`,
  // and `ArrivalSequence.placeBus` is the three lines that turn a position along
  // that arc into a pose:
  //
  //     const station = entranceRoadAt(at);
  //     root.position.set(station.x, terrainHeight(station.x, station.z), station.z);
  //     root.rotation.y = entranceRoadFacing(at);
  //
  // So this asks the same three functions and holds no separate opinion about
  // where the road goes — the same rule the straight version followed.
  //
  // **This check has never measured a curved road before.** It was written
  // against a straight kerb: an x-range at a fixed z, with the bus's bearing
  // read once off the built vehicle because it never changed. On the arc the
  // bearing changes at every station, so it is read per position instead — and
  // that is the ONLY thing that changed. The post sampling, the height test,
  // `reachInto`'s box arithmetic and both controls are untouched, so a number
  // that moves here moves because the road is genuinely somewhere else.
  // A green result on geometry an instrument has just been taught is the moment
  // to be most suspicious of it, which is why both controls are re-proved below.
  const fromAt = entranceBusArriveAt();
  const toAt = entranceBusVanishAt();

  /**
   * How far a post sample reaches inside the bus's body, standing at `busX`.
   * Zero or less is clear. The bus is an axis-aligned box once the bearing
   * above is folded in, so this is the ordinary point-to-box distance.
   */
  const reachInto = (
    sample: Sample,
    pose: { readonly x: number; readonly z: number; readonly facing: number },
    busGroundY: number,
    lift: number,
  ): number => {
    // Into the bus's own frame. The bearing comes from the pose because the arc
    // turns the bus as it drives; on the straight road it was a constant read
    // once off the built vehicle, and this is the same quantity per position.
    const fx = Math.sin(pose.facing);
    const fz = Math.cos(pose.facing);
    const rx = Math.cos(pose.facing);
    const rz = -Math.sin(pose.facing);
    const dx = sample.x - pose.x;
    const dz = sample.z - pose.z;
    const localZ = dx * fx + dz * fz;
    const localX = dx * rx + dz * rz;
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
    for (let at = fromAt; at >= toAt; at -= SWEEP_STEP) {
      const station = entranceRoadAt(at);
      const pose = { x: station.x, z: station.z, facing: entranceRoadFacing(at) };
      const busGroundY = terrainHeight(station.x, station.z);
      for (const sample of looking) {
        const reach = reachInto(sample, pose, busGroundY, lift);
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
          busX: station.x,
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
    excludedByDesign,
    bus: {
      length: busBox.max.z - busBox.min.z,
      width: busBox.max.x - busBox.min.x,
      bottom: busBox.min.y,
      top: restTop,
      drivenTop,
      drivenPose,
      ownerTop: CAT_BUS_TOP,
      ownerDrivenTop: CAT_BUS_DRIVEN_TOP,
    },
    route: {
      fromAt,
      toAt,
      roadLength: entranceRoadExtent().to - entranceRoadExtent().from,
    },
  };
  return report;
}

/** Float slack between the owner and the measured top: a millimetre, not a margin. */
export const OWNER_SLACK = 1e-3;

/**
 * **The guards that stop a green line meaning "I looked at nothing".**
 *
 * This check finds the ride's supports by mesh name, so a rename is all it
 * takes to turn it into a ratchet that passes because it swept an empty park.
 * That is #520's fault, one layer out, and it is caught here rather than
 * inferred later. A void is an **instrument** fault, not a park fault: the
 * acceptance loop reports it as a broken measure and stops, never restarts.
 */
export function sweptBusVoids(report: SeedReport): string[] {
  const voids: string[] = [];
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
  // **The bus's own owner must equal the drawn top** (ruling 3, 6 Sep 2026).
  // `CAT_BUS_TOP` is what the road's corridor claim carries as headroom and what
  // the arrival's sightline keep-out reads; `bus.top` is the drawn vehicle,
  // vertex-precise. They were two definitions once — a hand-copied ear formula
  // 6.8 cm under the face's crown — and nothing compared them. Compared here on
  // every seed, and said out loud below, so the gap can never reopen silently.
  if (Math.abs(report.bus.drivenTop - report.bus.ownerDrivenTop) > OWNER_SLACK) {
    voids.push(
      `seed ${report.seed}: CAT_BUS_DRIVEN_TOP (${report.bus.ownerDrivenTop.toFixed(4)} m, the bus's own owner of its ` +
        `driven top) is not the drawn bus posed at its highest (${report.bus.drivenTop.toFixed(4)} m at ` +
        `${report.bus.drivenPose}) — off by ${(report.bus.drivenTop - report.bus.ownerDrivenTop).toFixed(4)} m. ` +
        'The road claims this as headroom: it must be the crown the mesh actually reaches, derived, never guessed.',
    );
  }
  if (Math.abs(report.bus.top - report.bus.ownerTop) > OWNER_SLACK) {
    voids.push(
      `seed ${report.seed}: CAT_BUS_TOP (${report.bus.ownerTop.toFixed(4)} m, the bus's own owner) is ` +
        `not the drawn top (${report.bus.top.toFixed(4)} m, vertex-precise Box3) — off by ` +
        `${(report.bus.top - report.bus.ownerTop).toFixed(4)} m. Two definitions of one thing: derive the ` +
        'owner from the geometry that reaches highest, never restate it.',
    );
  }
  if (report.lifted !== 0) {
    voids.push(
      `seed ${report.seed}: the CONTROL sweep, with the bus lifted ${CONTROL_LIFT} m clear of ` +
        `the whole ride, still reached ${report.lifted} post(s). The sweep is not ` +
        'height-aware, so every number it reports about the real bus is void.',
    );
  }
  return voids;
}


/**
 * **The park fault**: drawn posts inside the drawn bus, or null when none. The
 * fix is a support placement that clears, never a tolerance.
 */
export function sweptBusIntrusion(report: SeedReport): string | null {
  const worst = report.worst[0];
  if (report.posts === 0 || !worst) return null;
  return (
    `seed ${report.seed}: ${report.posts} drawn post(s) inside the bus; worst ` +
    `${worst.penetration.toFixed(3)} m into the body at (${worst.x.toFixed(2)}, ` +
    `${worst.z.toFixed(2)}), ${worst.up.toFixed(2)} m up, post ${worst.post}, ` +
    `bus at x=${worst.busX.toFixed(2)}`
  );
}
