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
 * bus's own oriented footprint along every metre of the **drawn road** and asks,
 * at each step, whether any trestle leg is inside it.
 *
 * ## The span it sweeps, and why it is the road rather than the bus's run
 *
 * It swept `+entranceRoadBrow()` to `-entranceRoadBrow()` — what
 * `ArrivalSequence` animates — until the sphere (#511) collapsed the brow to one
 * station spacing, leaving this sweeping **2 m of a 145.7 m road, 1.4%**, with
 * nothing in its output admitting it. The control read zero on every seed, which
 * is what a sweep that cannot see a collision reads, and the check correctly
 * declared its own verdict void.
 *
 * The question in this file's own title is about **the road**, and the road is
 * `isInEntranceRoad`'s corridor over its whole extent — the exact span
 * `railRace/track.ts` is asked to keep its legs out of. So the sweep is
 * `entranceRoadExtent()`, end to end, and the swept length is printed in metres
 * and as a fraction of the road on every run.
 *
 * **It is a harness span and nothing about the game moved.** The bus still rolls
 * in from `entranceBusArriveAt()` and away to `entranceBusVanishAt()`, which is
 * about a metre either side of the gate; `ArrivalSequence` is untouched by this
 * file. `check:swept-bus` is the check that measures the bus's **driven** run
 * and prints its own, much smaller, coverage fraction.
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
 * finds, so something known to be dirty goes through this same instrument on
 * every seed on every run, and its numbers are printed.
 *
 * The control here is **the identical sweep with the bus driven onto the ride**:
 * every station of the real run translated by one vector — the offset from the
 * closest-approach pose to the post it came closest to — so the bus box passes
 * centrally through a trestle that is genuinely there. Same park, same legs, same
 * bus, same box arithmetic, same stations and headings; only where the box stands
 * changes. It must come back non-zero, and a sweep reading the wrong meshes, the
 * wrong bus or an empty leg list reads zero here exactly as it would on the real
 * road. The offset is re-derived from whatever park was just built, so it cannot
 * decay.
 *
 * **What this control cannot catch, stated because the retired one could.** It
 * sweeps *the same span* as the real run, so it is blind to that span being
 * wrong: shrink the sweep back to the brow and the control shrinks with it,
 * finds a post anyway — the offset simply lands on whatever is nearest to those
 * two metres — and reports a healthy non-zero while the check covers 1.4% of the
 * road. The retired corridor-off control did catch that, by accident rather than
 * by design: it read zero on a two-metre span because no trestle stands within a
 * bus-length of the gate, which is what made the collapse visible at all.
 *
 * That cover is not lost, it has moved: **the coverage note is what guards the
 * span now**, printing the swept length against the road's own length on every
 * run and saying plainly when it is not the whole road. A control proves the
 * instrument can see; the coverage note proves it is pointed at the right place.
 * Neither substitutes for the other, and if you ever make this control
 * span-independent, say so here.
 *
 * **It replaced two weaker controls, and both failures are the same shape.** The
 * first swept the road as it *used* to be — the straight chord at the wall —
 * against the legs as they are now, and degraded as the fix worked: 96 legs
 * across the pool fell to 35, as low as **one leg on seed 11**.
 *
 * The second — the one this change retires — built each park twice, once with
 * `roadRoute.ts`'s `setEntranceCorridorHonoured(false)`, which switches off the
 * single clause in `railRace/track.ts`'s `groundIsClear` that keeps trestle legs
 * out of the road, on the premise that the ride would then place supports through
 * it. **Measured on this branch, it does not.** The two parks' trestle positions
 * are identical on all ten pool seeds — every strut sampled every 0.25 m and
 * hashed — and the nearest post stands 2.77 m to 3.87 m outside the bus's swept
 * corridor. Since the sphere (#511) the ride simply does not want to stand in the
 * road, so the "dirty" park is clean and the control read zero for the most
 * innocent reason there is.
 *
 * A control whose dirty input has stopped being dirty is not a control, and the
 * lesson generalises past this file: **a control built by disabling a rule is only
 * as good as the rule still being the thing that holds the result.** The second
 * park is still built and still compared, but as a *finding* — printed on every
 * run, saying how many seeds the clause actually moves a trestle on, and saying
 * "asserts nothing" when the answer is none. It is not a gate.
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
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { InstancedMesh, Matrix4, type Object3D, Vector3 } from 'three';
import { PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';

const run = promisify(execFile);

/**
 * How finely the bus box is stepped along the road. Finer than the thinnest
 * trestle, so a post cannot slip between two stations of the sweep. Module
 * scope so the parent's coverage note can state it rather than restate it.
 */
const STEP = 0.25;
const HERE = fileURLToPath(import.meta.url);

interface SeedReport {
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

// ---------------------------------------------------------------- the child

async function measureOneSeed(asControl: boolean): Promise<void> {
  const { buildHeadlessPark } = await import('./park-harness.mts');
  const { CAT_BUS_LENGTH, CAT_BUS_WIDTH, CAT_BUS_BODY_BOTTOM_Y, CAT_BUS_BODY_TOP_Y } = await import(
    '../src/world/entrance/catBus.ts'
  );
  // Each trestle mesh's radii are read from its own `CylinderGeometry` rather
  // than imported and restated — see the sweep below.
  const { terrainHeight } = await import('../src/world/terrain.ts');
  /**
   * How finely a post is sampled along its own length. Finer than the bus box
   * is deep, so a post cannot pass between two samples of itself.
   */
  const POST_STEP = 0.25;
  const { PARK_SEED } = await import('../src/world/parkManifest.ts');
  const {
    entranceRoadAt,
    entranceRoadBrow,
    entranceRoadReach,
    entranceRoadExtent,
    entranceBusArriveAt,
    entranceBusVanishAt,
    distanceToEntranceCorridor,
    setEntranceCorridorHonoured,
  } = await import('../src/world/entrance/roadRoute.ts');

  // **The control's dirty input, generated rather than remembered.** With the
  // corridor switched off the ride places its trestles exactly as it did before
  // this change — including through the road — and the identical sweep below
  // then runs against them. See `setEntranceCorridorHonoured`.
  if (asControl) setEntranceCorridorHonoured(false);

  const park = buildHeadlessPark();

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
    seed: PARK_SEED,
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
  // The dirty input is made fresh on every run and on the instrument's own side:
  // the real sweep, over the real park, with the bus box translated onto the post
  // it came closest to. See the block that computes it in the child. Anything
  // that blinds the real sweep blinds this one identically, which is the point.
  const blind = pairs.filter((pair) => pair.real.offsetControlHits === 0);
  if (blind.length > 0) {
    failures.push(
      `the CONTROL found NO collision on ${blind.length} seed(s). The control drives this exact ` +
        'sweep, over this exact park, straight through the trestle post the real run came closest ' +
        'to — so it must report that post inside the bus. Reading zero there means the sweep ' +
        'cannot see a collision at all (wrong meshes, wrong bus, empty leg list), and its verdict ' +
        'on the real road is void: ' +
        blind.map((pair) => pair.real.seed).join(', '),
    );
  }

  // **A seed whose sweep had no legs to look at measured nothing.** Mirrors
  // `check:swept-bus`'s `samples === 0` guard: this check finds the ride's
  // supports by mesh name, so a rename empties the list and every clause below
  // reads clean. Reported before the per-seed table so the diagnosis survives
  // even if a later line cannot render.
  for (const report of reports) {
    if (report.legs === 0) {
      failures.push(
        `seed ${report.seed}: the sweep had NO trestle legs to look at. This check finds the ` +
          "ride's supports by mesh name, so a rename empties the list and every verdict here " +
          'becomes vacuous. Fix the name in this check, do not accept the zero.',
      );
    }
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

  // **The control's own numbers, said out loud on every run, pass or fail.**
  const offsetTotal = reports.reduce((sum, r) => sum + r.offsetControlHits, 0);
  const offsetWorst = Math.max(...reports.map((r) => r.offsetControlWorst));
  const offsetLeast = Math.min(...reports.map((r) => r.offsetControlHits));
  process.stderr.write(
    `  CONTROL (bus driven onto the ride): the identical sweep, every station shifted by the ` +
      `offset to the nearest post, finds ${offsetTotal} post(s) inside the bus across ` +
      `${reports.length} seeds — fewest ${offsetLeast} on a seed, worst ` +
      `${offsetWorst.toFixed(2)} m in.\n` +
      // **Said conditionally, because the unconditional version was written
      // first and it lied.** Zeroing the control's offset deliberately, to watch
      // the void gate fire, produced a run whose summary still read "Non-zero
      // everywhere, so this sweep can see a collision" above a FAIL saying the
      // opposite. A sentence that asserts the control's verdict has to be
      // derived from the control's numbers, or it is exactly the assertion
      // reporting success about something it is not describing that this file
      // exists to catch.
      (offsetLeast > 0
        ? '  Non-zero on every seed, so this sweep can see a collision.\n'
        : '  ZERO on at least one seed — this sweep cannot see a collision; see the FAIL below.\n'),
  );

  // **The measurement the old control used to be, kept as a finding.**
  //
  // Until this change the control *was* a second park built with
  // `groundIsClear`'s road clause switched off, on the premise that the ride
  // would then put legs back through the road. That premise is now false and the
  // premise failing is worth knowing, so the second park is still built and the
  // two are compared — by a digest of every sampled post position, not by
  // anyone's impression. This says plainly whether the clause is load-bearing
  // today. It is **not** a gate: a clause that has stopped mattering because the
  // ride moved away from the road is not a fault, and a clause that starts
  // mattering again would show up here as a non-zero count rather than silently.
  const moved = pairs.filter((pair) => pair.real.trestleHash !== pair.control.trestleHash);
  const controlTotal = pairs.reduce((sum, pair) => sum + pair.control.hits, 0);
  process.stderr.write(
    `  corridor clause (\`isInEntranceRoad\` inside \`groundIsClear\`): switching it off moves a ` +
      `trestle on ${moved.length} of ${pairs.length} seed(s), and puts ${controlTotal} post(s) ` +
      `back in the bus's path.\n` +
      (moved.length === 0
        ? '  ASSERTS NOTHING: the clause is inert on every pool seed — the ride does not want to\n' +
          '  stand in the road with or without it, so this measurement is a statement about the\n' +
          "  ride's placement, not a control on this sweep. The control above is the one that\n" +
          '  proves the instrument works.\n'
        : '  The clause is load-bearing on those seeds.\n'),
  );
  process.stderr.write(
    `  facing: ${reports.reduce((sum, r) => sum + r.roadTriangles, 0)} road triangles checked, ` +
      `${reports.reduce((sum, r) => sum + r.downFacingTriangles, 0)} facing the ground\n`,
  );
  // **The coverage note, in metres and as a fraction, on every run.**
  //
  // CLAUDE.md: a check that stops covering something must say so on every run.
  // This one covered 2 m of a 145.7 m road — 1.4% — for as long as the brow was
  // collapsed, and said only "from the brow at +1 m to -1 m", a sentence that
  // reads like a coverage statement while giving the reader nothing to compare
  // it against. A span is only coverage when the whole is beside it.
  //
  // **Every sentence below is derived, and that was not true when it was
  // written.** The first version printed "That is the whole drawn road" and
  // "Sweeping only that drove the control to zero and made this check's verdict
  // void" as fixed strings. Both were true of the run in front of me and of no
  // other: shrink the span back to the brow and the note reads "1.4%" and
  // "That is the whole drawn road" two lines apart, and claims the control was
  // driven to zero on a run whose control read 39 and passed — because that
  // sentence describes the *retired* control, which no longer exists. A note
  // that asserts something untrue is the disease this whole file is about, one
  // layer out, and it got into the coverage note itself.
  const first = reports[0];
  if (first) {
    const swept = first.sweptFrom - first.sweptTo;
    const driven = first.drivenFrom - first.drivenTo;
    const sweptPercent = (100 * swept) / first.roadLength;
    const drivenPercent = (100 * driven) / first.roadLength;
    process.stderr.write(
      `  covered: ${pairs.length} seeds x 2 parks (real and control), ` +
        `${reports.reduce((sum, r) => sum + r.legs, 0)} trestle legs\n` +
        `  SWEPT: ${swept.toFixed(1)} m of a ${first.roadLength.toFixed(1)} m road ` +
        `(${sweptPercent.toFixed(1)}%), ` +
        `from ${first.sweptFrom.toFixed(1)} m to ${first.sweptTo.toFixed(1)} m either side of the gate, ` +
        `every ${STEP} m\n` +
        // Derived from the fraction, not asserted. `isInEntranceRoad`'s corridor
        // spans the road's whole extent, so only a ~100% sweep covers it.
        (sweptPercent >= 99.5
          ? `  That is the whole drawn road — the span \`isInEntranceRoad\` keeps trestles out of.\n`
          : `  THAT IS NOT THE WHOLE ROAD: ${(first.roadLength - swept).toFixed(1)} m ` +
            `(${(100 - sweptPercent).toFixed(1)}%) of the span \`isInEntranceRoad\` keeps trestles ` +
            `out of is NOT swept, so a leg standing there would not be found.\n`) +
        `  The bus is animated along ${driven.toFixed(1)} m of it ` +
        `(${first.drivenFrom.toFixed(1)} m to ${first.drivenTo.toFixed(1)} m, ` +
        `${drivenPercent.toFixed(1)}% of the road); \`check:swept-bus\` is the check that ` +
        `sweeps that.\n` +
        // Also derived. The control shares this span, so what it read is a fact
        // about this run and has to be read off it.
        (offsetLeast === 0
          ? `  The control read ZERO on at least one seed over this span — see the FAIL below.\n`
          : `  Over this span the control reads ${offsetLeast} at its weakest, so the span is ` +
            `wide enough to contain a collision the sweep can find.\n`),
    );
  }

  for (const pair of pairs) {
    console.log(
      `  seed ${String(pair.real.seed).padStart(8)}  legs ${String(pair.real.legs).padStart(4)}  ` +
        `posts in the bus ${pair.real.hits} (${pair.real.walkPastHits} walk-past)  ` +
        `nearest post clears by ${pair.real.clearance === null ? 'NOTHING MEASURED' : `${pair.real.clearance.toFixed(2)} m`}  ` +
        `(control: bus shifted ${pair.real.offsetControlBy.toFixed(2)} m finds ` +
        `${pair.real.offsetControlHits} post(s), worst ${pair.real.offsetControlWorst.toFixed(2)} m in; ` +
        `corridor off: ${pair.control.hits} posts, trestles ` +
        `${pair.real.trestleHash === pair.control.trestleHash ? 'unmoved' : 'MOVED'})`,
    );
  }

  if (failures.length > 0) {
    console.error('\nFAIL: the entrance road runs through the Rail Race.');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  // The tightest clearance across the pool, ignoring any seed that measured
  // nothing (which is a failure above, not a number to minimise over).
  const measured = reports.filter(
    (r): r is SeedReport & { clearance: number } => r.clearance !== null,
  );
  const tightest =
    measured.length === 0
      ? null
      : measured.reduce((a, b) => (a.clearance <= b.clearance ? a : b));
  console.log(
    `\nentrance road OK — the bus's swept body clears every trestle post along the whole ` +
      `${(reports[0]?.roadLength ?? 0).toFixed(1)} m road on all ${reports.length} pool seeds; ` +
      `the tightest anywhere is ${tightest === null ? 'not measurable' : `${tightest.clearance?.toFixed(2)} m (seed ${tightest.seed})`}`,
  );
}

if (process.argv.includes('--one')) {
  await measureOneSeed(process.argv.includes('--control'));
} else {
  await sweepThePool();
}
