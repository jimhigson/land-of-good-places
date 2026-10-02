/**
 * **`check:entrance-road`'s measurement, as a function of a built park** — one
 * owner, asked by `scripts/check-entrance-road.mts` (one child per pool seed,
 * plus a corridor-off control park, printed and gated) and by the root
 * acceptance loop (`scripts/park-attempt.mts`, which starts the park again from
 * zero when the drawn road runs through the Rail Race). Why it sweeps drawn
 * posts along their lean, over the whole road, with the bus driven onto the
 * ride as a control, is the script's header.
 *
 * Seeded modules are imported inside {@link measureEntranceRoad}, never at
 * module scope, so the script's parent process pins no seed by importing this.
 */
import { createHash } from 'node:crypto';
import { InstancedMesh, Matrix4, type Object3D, Vector3 } from 'three';
import type { HeadlessPark } from '../park-harness.mts';

/**
 * How finely the bus box is stepped along the road. Finer than the thinnest
 * trestle, so a post cannot slip between two stations of the sweep. Module
 * scope so the parent's coverage note can state it rather than restate it.
 */
export const STEP = 0.25;

export interface SeedReport {
  readonly seed: number;
  readonly legs: number;
  /** Legs the bus's swept body reaches on the road as it is now. Must be zero. */
  readonly hits: number;
  /** Of {@link hits}, the ones on the ring a child stands beside — the visible fault. */
  readonly walkPastHits: number;
  readonly worstPenetration: number;
  /**
   * The clearance at the closest approach, in metres — how far the nearest post
   * stands outside the bus's swept body. Negative would mean contact, which
   * {@link hits} already reports. On a clean park this is the only number that
   * says *by how much* it is clean.
   */
  readonly clearance: number | null;
  /**
   * **The control.** The identical sweep, with every station translated so the
   * bus box is driven through the post it came closest to. Must be non-zero, or
   * this instrument cannot see a collision at all and its verdict is void.
   */
  readonly offsetControlHits: number;
  readonly offsetControlWorst: number;
  /** How far the control moved the bus, in metres — derived, never picked. */
  readonly offsetControlBy: number;
  /**
   * A digest of every sampled post position in this park. Compared between the
   * real park and the corridor-off one to say plainly whether
   * `groundIsClear`'s road clause moved a single trestle.
   */
  readonly trestleHash: string;
  /** True if this park was built with the corridor off — the control run. */
  readonly control: boolean;
  readonly reach: number;
  readonly brow: number;
  /** The stretch of the road's arc the bus box was swept along, in metres from the gate. */
  readonly sweptFrom: number;
  readonly sweptTo: number;
  /** The road's own full length, so the fraction swept can be stated rather than implied. */
  readonly roadLength: number;
  /** Where the bus is really driven to and from, for the coverage note. */
  readonly drivenFrom: number;
  readonly drivenTo: number;
  /** Road triangles drawn facing the ground rather than the sky. Must be zero. */
  readonly downFacingTriangles: number;
  readonly roadTriangles: number;
  /** Road vertices drawn outside the corridor the bus drives. Must be zero. */
  readonly strayVertices: number;
  readonly worstStray: number;
  /** Nearest the gateway spur gets to the kerb. Must be zero — they must touch. */
  readonly spurGap: number;
}

/**
 * Measures the drawn entrance road against the drawn trestle posts on `park`.
 * `control` records only how the park was built (`setEntranceCorridorHonoured`
 * off, by the script's control child); the measurement is the same either way.
 */
export async function measureEntranceRoad(park: HeadlessPark, asControl = false): Promise<SeedReport> {
  const { CAT_BUS_LENGTH, CAT_BUS_WIDTH, CAT_BUS_BODY_BOTTOM_Y, CAT_BUS_BODY_TOP_Y } = await import(
    '../../src/world/entrance/catBus.ts'
  );
  // Each trestle mesh's radii are read from its own `CylinderGeometry` rather
  // than imported and restated — see the sweep below.
  const { terrainHeight } = await import('../../src/world/terrain.ts');
  /**
   * How finely a post is sampled along its own length. Finer than the bus box
   * is deep, so a post cannot pass between two samples of itself.
   */
  const POST_STEP = 0.25;
  const { PARK_SEED_ASKED } = await import('../../src/world/parkManifest.ts');
  const {
    entranceRoadAt,
    entranceRoadBrow,
    entranceRoadReach,
    entranceRoadExtent,
    entranceBusArriveAt,
    entranceBusVanishAt,
    distanceToEntranceCorridor,
  } = await import('../../src/world/entrance/roadRoute.ts');

  // **The control's dirty input, generated rather than remembered.** With the
  // corridor switched off the ride places its trestles exactly as it did before
  // this change — including through the road — and the identical sweep below
  // then runs against them. See `setEntranceCorridorHonoured`.

  /**
   * **Every trestle post, sampled along its lean — not resolved to its foot.**
   *
   * This used to take each leg's foot and sweep the bus against that one point,
   * and its own docblock noted in passing that foot and top are up to 2 m apart
   * on a leaning leg. That was honest when it was written, because nothing made
   * legs lean: `RADIAL_NUDGES` never fired, every post stood straight, and "at
   * the foot" and "along the post" were the same question.
   *
   * **This branch is what makes them lean.** Adding `isInEntranceRoad` to
   * `groundIsClear` is what fires the nudges, and a nudged post keeps its top
   * under the rails while its foot moves — so a post can stand its *foot*
   * clear of the road and still pass through the bus at head height. Asked
   * only at the foot the check reported 0 hits while posts stood in the bus.
   *
   * So a post contributes a sample every {@link POST_STEP} of its length, and
   * only over the heights the **bodywork** actually occupies
   * ({@link CAT_BUS_BODY_BOTTOM_Y} to {@link CAT_BUS_BODY_TOP_Y}, asked of the
   * bus rather than restated here) — a post is only a collision where there is
   * bus to collide with, and the parts of it below the chassis or above the
   * roof are not.
   *
   * ## The whole tree, not only the trunk
   *
   * This swept `railRace:trestle-legs` **and nothing else** until a reviewer
   * noticed. A trestle is a trunk that forks twice to reach the four lanes, and
   * the fork sits at the trunk's *top* — measured at the entrance, **3.00 m
   * above ground on two of the three rings, against a bus roof at 3.99 m**. So
   * the branches spread outward through exactly the height band the bus
   * occupies, and the check that exists to ask "does the bus hit the ride"
   * could not see them. It did not bite only because the slots beside the road
   * happened to be empty; the moment a trestle stands there again it would have
   * reported clean about a bus driving through a fork.
   *
   * Every part of the tree is placed by one `strut` helper, so all three meshes
   * are read the same way — and the **radii are asked of each mesh's own
   * `CylinderGeometry`** rather than restated here. Three trestle radii written
   * out in a check is three more copies of a number `trestleGeometry.ts` owns,
   * which is the bug this whole branch keeps finding.
   */
  const legs: { x: number; z: number; radius: number; up: number; ring: string; post: string }[] = [];
  const trestleHash = createHash('sha256');
  const matrix = new Matrix4();
  const centre = new Vector3();
  const axis = new Vector3();
  const TRESTLE_MESHES = [
    'railRace:trestle-legs',
    'railRace:trestle-branches-lower',
    'railRace:trestle-branches-upper',
  ];
  park.scene.traverse((object) => {
    const mesh = object as InstancedMesh;
    if (!mesh.isInstancedMesh || !TRESTLE_MESHES.includes(mesh.name)) return;
    // Which ring this is matters to a reader: only the walk-past one is the
    // ride a child stands beside, so a post of its in the bus is the visible
    // fault, and the race ring's is the same fault seen mid-ride.
    let ring = 'unknown';
    for (let node: Object3D | null = mesh; node; node = node.parent) {
      if (node.name.includes('walk-past')) { ring = 'walk-past'; break; }
      if (node.name.includes('race-ring')) { ring = 'race'; break; }
    }
    // `strut` stands a unit-height cylinder from `from` to `to`, so the
    // geometry's own bottom radius is the `from` end and its top radius the
    // `to` end. Asked of the geometry, never restated.
    const parameters = (mesh.geometry as unknown as {
      parameters?: { radiusTop: number; radiusBottom: number };
    }).parameters;
    if (!parameters) throw new Error(`${mesh.name} is not a cylinder — its radii cannot be read`);
    const { radiusTop, radiusBottom } = parameters;
    const part = mesh.name.replace('railRace:trestle-', '');
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getMatrixAt(i, matrix);
      centre.setFromMatrixPosition(matrix);
      axis.setFromMatrixColumn(matrix, 1);
      const length = axis.length() || 1;
      axis.divideScalar(length);
      // `strut` scales x and z by the ring's own size, which is exactly the
      // factor `track.ts` multiplies POST_FOOT_RADIUS by for the collider.
      const across = new Vector3().setFromMatrixColumn(matrix, 0).length();
      const footX = centre.x - axis.x * (length / 2);
      const footZ = centre.z - axis.z * (length / 2);
      const footY = centre.y - axis.y * (length / 2);
      for (let along = 0; along <= length; along += POST_STEP) {
        const x = footX + axis.x * along;
        const z = footZ + axis.z * along;
        // **Height above the ground, not above the strut's own start.** A leg
        // begins on the terrain, so for a leg the two are the same and the
        // difference never showed. A *branch* begins at the trunk's top, metres
        // up — measured from its own foot it would read as knee height and be
        // compared against a bus roof it is nowhere near. The bus's own
        // `CAT_BUS_BODY_*_Y` are heights above the ground it stands on, so this
        // has to be too.
        const up = footY + axis.y * along - terrainHeight(x, z);
        if (up < CAT_BUS_BODY_BOTTOM_Y || up > CAT_BUS_BODY_TOP_Y) continue;
        const t = along / length;
        legs.push({
          x,
          z,
          radius: (radiusBottom + (radiusTop - radiusBottom) * t) * across,
          up,
          ring,
          post: `${ring}:${part}:${i}`,
        });
        // **Where every sampled post stands, hashed.** This is what makes the
        // "did the corridor clause move anything?" measurement below possible:
        // the real park and the corridor-off park are compared by this digest
        // rather than by anybody's impression of them.
        trestleHash.update(`${x.toFixed(4)},${z.toFixed(4)};`);
      }
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
  ): {
    worst: number;
    hits: number;
    posts: Set<string>;
    walkPast: Set<string>;
    /**
     * The **closest** any post gets, signed, whether or not it touches — positive
     * is inside the body, negative is the clearance in metres. `worst` above only
     * ever reports contact, so on a clean park it is 0 on every seed and says
     * nothing about whether the road missed the ride by a metre or by a
     * millimetre. This is the number that makes a green run informative.
     */
    nearestReach: number;
    /** The offset from this pose to the nearest post's centre — see the offset control. */
    nearestDx: number;
    nearestDz: number;
  } => {
    let worst = 0;
    let nearestReach = -Infinity;
    let nearestDx = 0;
    let nearestDz = 0;
    // **Distinct posts, not samples.** Each post contributes a sample every
    // POST_STEP of its length, so counting raw hits counts one post many times
    // and reports a number nobody can act on.
    const posts = new Set<string>();
    const walkPast = new Set<string>();
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
      if (reach > nearestReach) {
        nearestReach = reach;
        nearestDx = dx;
        nearestDz = dz;
      }
      if (reach > 0) {
        posts.add(leg.post);
        if (leg.ring === 'walk-past') walkPast.add(leg.post);
        worst = Math.max(worst, reach);
      }
    }
    return { worst, hits: posts.size, posts, walkPast, nearestReach, nearestDx, nearestDz };
  };

  // --- the road the bus is actually on now ----------------------------------
  //
  // **The whole drawn road, not the two metres the bus is driven along.**
  //
  // This used to sweep `+brow` to `-brow`, which is what `ArrivalSequence`
  // drives. Since the sphere (#511) removed the ceiling that crushed the road
  // inboard of the ride, `entranceRoadBrow()`'s predicate — outset past
  // `RIM_OUTSET_START` — is true at the **first** station, so the brow collapsed
  // to one station spacing and the sweep shrank to **2 m of a 145.7 m road,
  // 1.4%**. Nothing in the output said so, and the control read zero on all ten
  // seeds, so the check correctly declared its own verdict void.
  //
  // The question this check's own name asks is **"does the entrance road run
  // through the Rail Race"** — a question about the *road*, which is
  // `isInEntranceRoad`'s corridor over its whole extent, not about the short
  // stretch the arrival animation happens to animate today. So the sweep is the
  // road's own extent, `entranceRoadExtent()`, which is the same span
  // `corridorSamples()` builds the corridor from and therefore the exact span
  // `railRace/track.ts` was asked to keep clear.
  //
  // **This is a harness decision and changes nothing a child sees.** The bus
  // still rolls in from `entranceBusArriveAt()` — 1 m — exactly as before;
  // `ArrivalSequence` is untouched. Only where this script stands the bus box
  // while asking its question has changed.
  const brow = entranceRoadBrow();
  const extent = entranceRoadExtent();
  const sweptFrom = extent.to;
  const sweptTo = extent.from;
  const roadLength = extent.to - extent.from;
  // **Distinct posts over the whole run, not samples and not per-station.**
  // A post is sampled every POST_STEP of its length and the bus is inside it
  // for many consecutive stations, so counting either would report one post
  // dozens of times. The union is keyed on the post's own identity.
  const hitPosts = new Set<string>();
  const hitWalkPast = new Set<string>();
  let worstPenetration = 0;
  /** The closest approach anywhere on the run, and the pose it happened at. */
  let closestReach = -Infinity;
  let closestOffsetX = 0;
  let closestOffsetZ = 0;
  for (let at = sweptFrom; at >= sweptTo; at -= STEP) {
    const station = entranceRoadAt(at);
    const { worst, posts, walkPast, nearestReach, nearestDx, nearestDz } = penetration(
      station.x,
      station.z,
      station.headingX,
      station.headingZ,
    );
    worstPenetration = Math.max(worstPenetration, worst);
    if (nearestReach > closestReach) {
      closestReach = nearestReach;
      closestOffsetX = nearestDx;
      closestOffsetZ = nearestDz;
    }
    for (const post of posts) hitPosts.add(post);
    for (const post of walkPast) hitWalkPast.add(post);
  }
  const hitLegs = hitPosts;

  // --- THE CONTROL: the identical sweep, driven onto the ride ---------------
  //
  // **What a control has to do here, and why the old one stopped doing it.**
  //
  // CLAUDE.md: *"run a control on the instrument first — two agents got clean,
  // decisive, entirely wrong answers from flood fills that were measuring the
  // wrong thing"*. A sweep that finds nothing is exactly what a **broken** sweep
  // also finds, so something known to be dirty must go through this same
  // instrument on every run.
  //
  // The old control built a second park with `setEntranceCorridorHonoured(false)`
  // — the switch that turns off `groundIsClear`'s road clause — on the premise
  // that the ride would then put its legs back through the road. **Measured on
  // this branch, that premise is false.** The trestle positions of the two parks
  // are byte-identical on all ten pool seeds (sampled every 0.25 m along every
  // strut and hashed — see `trestleHash` below), and the nearest post stands
  // between 2.77 m and 3.87 m *outside* the bus's swept corridor. The ride does
  // not want to stand in the road any more, with or without the clause, so
  // switching the clause off produces a **clean** park and a control that reads
  // zero for the most innocent reason there is. A control whose dirty input has
  // stopped being dirty is not a control.
  //
  // **So the dirty input is made on the instrument's side instead: the bus is
  // driven onto the ride.** Every station of the real sweep is translated by one
  // vector — the offset from the closest-approach pose to the post it came
  // closest to — so the bus box passes centrally through a post that is really
  // there. Everything else is the real measurement: the same legs off the same
  // built park, the same bus dimensions, the same box arithmetic, the same
  // stations and headings. Only *where* the box stands changes.
  //
  // It cannot go stale, because the offset is re-derived from whichever post is
  // nearest on whatever park was just built; and it cannot be satisfied by a
  // blind instrument, because a sweep reading the wrong meshes, the wrong bus or
  // an empty leg list reads zero here exactly as it would on the real road.
  const offsetHitPosts = new Set<string>();
  let offsetWorst = 0;
  for (let at = sweptFrom; at >= sweptTo; at -= STEP) {
    const station = entranceRoadAt(at);
    const { worst, posts } = penetration(
      station.x + closestOffsetX,
      station.z + closestOffsetZ,
      station.headingX,
      station.headingZ,
    );
    offsetWorst = Math.max(offsetWorst, worst);
    for (const post of posts) offsetHitPosts.add(post);
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
    seed: PARK_SEED_ASKED,
    downFacingTriangles,
    roadTriangles,
    strayVertices,
    worstStray: Number(worstStray.toFixed(2)),
    legs: legs.length,
    hits: hitLegs.size,
    walkPastHits: hitWalkPast.size,
    worstPenetration: Number(worstPenetration.toFixed(3)),
    // **`null`, not `Infinity`, when nothing was measured.** `closestReach`
    // starts at `-Infinity`, so an empty leg list made this `Infinity`, which
    // `JSON.stringify` writes as `null` — and the parent then called
    // `.toFixed()` on it and died with a `TypeError` in the per-seed table,
    // *before* printing the `FAIL:` block its own stderr line had just told the
    // operator to read. The exit code still held, so the gate was sound, but
    // the diagnosis was lost at exactly the moment somebody needed it. Typed
    // honestly here and handled at both readers below.
    clearance: Number.isFinite(closestReach) ? Number((-closestReach).toFixed(3)) : null,
    offsetControlHits: offsetHitPosts.size,
    offsetControlWorst: Number(offsetWorst.toFixed(3)),
    offsetControlBy: Number(Math.hypot(closestOffsetX, closestOffsetZ).toFixed(3)),
    trestleHash: trestleHash.digest('hex').slice(0, 16),
    control: asControl,
    spurGap: Number((Number.isFinite(spurGap) ? spurGap : 999).toFixed(3)),
    reach: Number(entranceRoadReach().toFixed(1)),
    brow: Number(brow.toFixed(3)),
    sweptFrom: Number(sweptFrom.toFixed(2)),
    sweptTo: Number(sweptTo.toFixed(2)),
    roadLength: Number(roadLength.toFixed(2)),
    drivenFrom: Number(entranceBusArriveAt().toFixed(3)),
    drivenTo: Number(entranceBusVanishAt().toFixed(3)),
  };
  return report;
}

/**
 * **Instrument faults**: a sweep with no posts to look at, or whose control —
 * the bus driven straight through the nearest post — finds nothing. Either
 * makes every other verdict about this park vacuous, so the acceptance loop
 * reports it as a broken measure and stops rather than restart.
 */
export function entranceRoadVoids(report: SeedReport): string[] {
  const voids: string[] = [];
  if (report.legs === 0) {
    voids.push(
      `seed ${report.seed}: the sweep had NO trestle legs to look at. This check finds the ` +
        "ride's supports by mesh name, so a rename empties the list and every verdict here " +
        'becomes vacuous. Fix the name in this check, do not accept the zero.',
    );
  }
  if (report.offsetControlHits === 0) {
    voids.push(
      `seed ${report.seed}: the CONTROL found NO collision. The control drives this exact sweep, ` +
        'over this exact park, straight through the trestle post the real run came closest to — so ' +
        'it must report that post inside the bus. Reading zero there means the sweep cannot see a ' +
        'collision at all (wrong meshes, wrong bus, empty leg list), and its verdict on the real road is void',
    );
  }
  return voids;
}

/** **Park faults**: what is wrong with this park's road, one line each. */
export function entranceRoadFaults(report: SeedReport): string[] {
  const faults: string[] = [];
  if (report.downFacingTriangles > 0) {
    faults.push(
      `seed ${report.seed}: ${report.downFacingTriangles} of ${report.roadTriangles} triangles of the ` +
        'drawn entrance road face the ground rather than the sky — the material is `FrontSide`, so ' +
        'that much of the road is culled and a child looks straight through it at the grass',
    );
  }
  if (report.strayVertices > 0) {
    faults.push(
      `seed ${report.seed}: ${report.strayVertices} vertices of the drawn entrance road lie outside ` +
        `the corridor the bus drives, the furthest ${report.worstStray.toFixed(2)} m out — the road ` +
        'on screen is not the road this check measured, so its verdict below describes a plan rather ' +
        'than the park',
    );
  }
  if (report.spurGap > 0.01) {
    faults.push(
      `seed ${report.seed}: the gateway path's nearest vertex is ${report.spurGap.toFixed(2)} m from ` +
        'the kerb — the path through the arch does not meet the road the bus stops on, so there is ' +
        'grass between them where a child walks in',
    );
  }
  if (report.hits > 0) {
    faults.push(
      `seed ${report.seed}: the cat bus sweeps through ${report.hits} Rail Race trestle leg(s) on ` +
        `its way in and out, reaching ${report.worstPenetration.toFixed(2)} m inside one — the road ` +
        'it drives runs through the ride',
    );
  }
  return faults;
}
