/**
 * **A built park, reduced to the facts an invariant can be stated about.**
 *
 * This is the vitest side of the philosophy `scripts/check-park.mts` is built
 * on: *a number an author writes down is a claim; a number derived from the
 * built object is a fact*. Nothing here describes what the generators are
 * supposed to do. Every field below is read back off a real `World` — the wall
 * runs `Scenery` actually stood up, the trees it actually planted, the curve
 * the train actually solved — so an invariant that passes has been proved
 * against the park, not against the rules that were meant to produce it.
 *
 * It complements `check:park` rather than replacing it. That script owns the
 * six invariants about whether the park *works* — routing, the waypoint graph,
 * rail exclusion — and holds them to a ratchet on one canonical seed. This
 * suite owns the invariants about whether the park's scattered furniture is
 * *placed sanely*, and holds them across many seeds with no allowances at all.
 */
import { Vector3 } from 'three';
import type { World } from '../../src/world/World.ts';

/** A wall run flattened to what a clearance test needs. */
export interface WallFact {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly halfWidth: number;
  /** Runs sharing this are one deliberately-joined structure (an L-piece). */
  readonly piece: number;
  readonly kind: string;
}

/**
 * A tree's true planar footprint.
 *
 * `FoliageOccluder.radius` is only the *widest single blob*, which for a
 * lollipop understates the tree: the small ball tucked beside the main canopy
 * sits `0.7 × radius` off the trunk and carries its own radius on top of that.
 * So the footprint is derived by walking every part the tree is actually built
 * from and taking the furthest that any of them reaches.
 */
export interface TreeFact {
  readonly x: number;
  readonly z: number;
  readonly footprint: number;
}

export interface PlotFact {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly boundingRadius: number;
}

/** A place a visitor must be able to stand: a doormat or a stall counter. */
export interface EntranceFact {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/** One drawn path, sampled along its centre line. */
export interface RouteFact {
  readonly name: string;
  readonly length: number;
  /** Points every ~0.5 m along the centre line. */
  readonly points: readonly (readonly [number, number])[];
}

/** A ride's dismount point (GAME_DESIGN.md's EXIT rule) — a node in `PATH_GRAPH`. */
export interface ExitFact {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/**
 * One node of the destination graph the network is grown from: somewhere a
 * child might actually be going.
 */
export interface PathNodeFact {
  readonly id: string;
  readonly kind: string;
  readonly x: number;
  readonly z: number;
  /**
   * How far the destination's own paving reaches out from that point. Zero for
   * every node but the plaza, which is a paved disc rather than a doorway, so
   * a ribbon arrives at it by touching its rim rather than its centre.
   */
  readonly reach: number;
}

/**
 * One edge of that graph, paired with the ribbon actually drawn for it.
 *
 * `from` and `to` are node ids, except for `'ring'`, which is `paths.ts`'s name
 * for the paved network itself: a spur branches off wherever the paving already
 * runs, which may be the backbone or an earlier spur.
 */
export interface PathEdgeFact {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  /** The closed backbone loop, which has no ends to arrive anywhere. */
  readonly backbone: boolean;
  readonly halfWidth: number;
  /** The drawn centre line, every ~0.5 m. */
  readonly points: readonly (readonly [number, number])[];
}

export interface ParkFacts {
  readonly seed: number;
  readonly world: World;
  /**
   * The Sky Cruiser's pass through the castle (#113), measured by the *same*
   * functions the boot assert and `check:castle-window` use.
   *
   * Measured here rather than in the invariant because those functions live in
   * `src/` and read the castle's own placement, which is seed-dependent: a
   * static import from the test file would pull in a second copy of the park at
   * the default seed and quietly measure this seed's coaster against that one's
   * castle. Everything in this suite goes through the dynamic imports below for
   * exactly that reason.
   *
   * `windows` is empty on a seed whose loop went round the castle, which is a
   * healthy park and not a skipped test.
   */
  readonly castlePass: {
    readonly windows: readonly { readonly wall: string }[];
    readonly complaints: readonly string[];
  };
  readonly walls: readonly WallFact[];
  readonly trees: readonly TreeFact[];
  readonly lamps: readonly (readonly [number, number])[];
  readonly plots: readonly PlotFact[];
  readonly entrances: readonly EntranceFact[];
  readonly routes: readonly RouteFact[];
  readonly exits: readonly ExitFact[];
  /** The destination graph `paths.ts` grows the network from. */
  readonly pathNodes: readonly PathNodeFact[];
  /** Its paved edges, each with the ribbon that was drawn for it. */
  readonly pathEdges: readonly PathEdgeFact[];
  /**
   * The ginormous slide's chute, in **world space**, sampled along what was
   * actually built — not the plan it was built from.
   *
   * Read through the scene graph rather than by adding the building's origin
   * back on by hand, so a slide parented to the wrong thing shows up here as a
   * slide in the wrong place, which is the class of bug #118 turned out to be.
   */
  readonly slideChute: readonly (readonly [number, number, number])[];
  /**
   * The castle facade's own footprint rectangle.
   *
   * Emphatically **not** the `building` plot's position: the facade is nudged
   * off its plot anchor by `BUILDING_CENTRE_NUDGE`, about 3.5 m, so the two
   * centres are metres apart. Measuring the tower at its plot's anchor puts the
   * walls in the wrong place and duly accuses an innocent slide of flying
   * through them — which is exactly what the first draft of this did.
   */
  /**
   * Where the ginormous slide's legs stand, and how tall each one is.
   *
   * A support plan that quietly places *nothing* is the failure mode worth
   * testing for here: it looks exactly like a healthy one from every angle
   * except the park's.
   */
  readonly slideLegs: readonly {
    readonly x: number;
    readonly z: number;
    readonly ground: number;
    readonly top: number;
  }[];
  readonly castleFootprint: {
    readonly x: number;
    readonly z: number;
    readonly halfX: number;
    readonly halfZ: number;
  };
  /**
   * The hole cut in the facade's south wall for the ginormous slide, in
   * **facade-local x**, alongside the half-width of the chute meant to go
   * through it.
   *
   * Read off `SLIDE_PLAN` — which is now the one place the hole is decided, and
   * the same value `Shell.ts` cuts the masonry with — rather than off the old
   * hand-written constants in `building/layout.ts`, which the search that
   * chooses the door had no say in.
   *
   * Imported dynamically with everything else here: `SLIDE_PLAN` solves at
   * module load against `PARK_SEED`, so a static import at the top of the test
   * tree would pin every seed's door to the default park's.
   */
  readonly slideDoor: {
    readonly minX: number;
    readonly maxX: number;
    readonly corridorRadius: number;
  };
  /**
   * The castle's four corner towers, as the solids of revolution they were
   * actually built as, in **world space**.
   *
   * These are the piece of the castle a footprint rectangle does not contain:
   * they stand at `(±outerX, ±outerZ)` — outside the rectangle — and bulge a
   * further ~2.45 m past it. `slide/plan.ts` re-imposes the castle as that
   * rectangle, so the towers were the one solid nothing checked, which is
   * exactly where Jim found the slide clipping through.
   *
   * Read per instance via `getMatrixAt`: `Box3.setFromObject` on an
   * `InstancedMesh` returns the union of every instance — a single park-sized
   * box that any test passes trivially.
   *
   * Bodies and roofs only. The masts and finials above them start at 15.24 m,
   * higher than the chute's own 14.84 m start, and are a 0.09 m pole and a
   * 0.26 m ball — decoration rather than mass.
   */
  readonly castleTowers: readonly {
    readonly name: string;
    readonly x: number;
    readonly z: number;
    readonly bottomY: number;
    readonly topY: number;
    readonly radiusBottom: number;
    readonly radiusTop: number;
  }[];
  /** The space the built chute occupies around its centre line. */
  readonly chuteEnvelope: {
    readonly halfWidth: number;
    readonly above: number;
    readonly below: number;
  };
  /**
   * The chute sampled **without** the scene graph, beside the same points with
   * it — `pointAt` as the ride itself reads it, and where that lands in the
   * world.
   *
   * Everything that travels along the slide — the rider's seat, the grown-up,
   * and the teleport that puts a child on it — positions itself from
   * `pointAt` and is parented alongside the chute so that the two are the same
   * coordinates. If the chute is ever reparented without converting its points,
   * every one of those lands a castle's width away from the trough while the
   * chute itself still looks perfect. These two lists are what makes that
   * visible: at park level they are identical.
   */
  readonly slideRiderFrame: {
    readonly local: readonly (readonly [number, number, number])[];
    readonly world: readonly (readonly [number, number, number])[];
  };
  /**
   * Pairs of plot ids the manifest deliberately puts close together, so the
   * overlap invariant can exempt exactly those and nothing else. See
   * `ManifestEntry.near` — "relations exist precisely to put things
   * deliberately close".
   */
  readonly nearPairs: ReadonlySet<string>;
  /** Distance from a point to the solved rail centre line. */
  readonly distanceToRail: (x: number, z: number) => number;
  /** Can a walker of `radius` stand here without being pushed out? */
  readonly isStandable: (x: number, z: number, radius?: number) => boolean;
  /**
   * Can the real nav lattice actually route a child here from where she
   * starts? The same question `scripts/check-park.mts` asks of every
   * attraction, asked here of every ride's exit.
   */
  readonly reachableFromEntrance: (x: number, z: number) => boolean;
  readonly buildMs: number;
}

/** Key for {@link ParkFacts.nearPairs}, order-independent. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Builds the park for `seed` and reads the facts back off it.
 *
 * The seed reaches `parkManifest.ts` the only way it can — through
 * `LGP_SEED`, which that file reads once at module load — so everything below
 * is imported *dynamically*, after the variable is set. That in turn means
 * **each seed needs its own module registry**, which is why the seeds are one
 * test file each and why `vitest.config.ts` keeps `isolate` on. The guard
 * below exists because getting that wrong is silent: a stale module cache
 * would hand every seed the same park and six green suites would be measuring
 * one park six times.
 */
export async function buildParkFacts(seed: number): Promise<ParkFacts> {
  process.env['LGP_SEED'] = String(seed);

  const { buildHeadlessPark } = await import('../../scripts/park-harness.mts');
  const { PARK_SEED, PARK_MANIFEST } = await import('../../src/world/parkManifest.ts');

  if (PARK_SEED !== seed) {
    throw new Error(
      `parkFacts: asked for seed ${seed} but the park built with ${PARK_SEED}. ` +
        'The module registry was reused across seeds — check that vitest is ' +
        'still isolating test files (vitest.config.ts) and that each seed has ' +
        'a file of its own.',
    );
  }

  const { world, scene, buildMs, sample } = buildHeadlessPark();

  const { PARK_LAYOUT } = await import('../../src/world/parkLayout.ts');
  const { ANCHORS } = await import('../../src/world/anchors.ts');
  const { PATH_GRAPH, PLAZA } = await import('../../src/world/paths.ts');
  const { CatmullRomCurve3 } = await import('three');
  const { NavGrid, MAX_ROUTE_WAYPOINTS } = await import('../../src/world/NavGrid.ts');
  const { PLAYER_RADIUS } = await import('../../src/core/constants.ts');
  const { CASTLE_WINDOWS, checkCastleWindows, sweptCartHits } = await import(
    '../../src/world/coaster/castleWindows.ts'
  );
  const { JUMP_APEX_HEIGHT } = await import('../../src/entities/Player.ts');
  const { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } = await import(
    '../../src/world/entrance/layout.ts'
  );

  const walls: WallFact[] = world.scenery.wallRuns.map((run) => ({
    from: run.from,
    to: run.to,
    halfWidth: run.halfWidth,
    piece: run.piece,
    kind: run.kind,
  }));

  const trees: TreeFact[] = world.scenery.foliageOccluders.map((tree) => {
    let footprint = 0;
    for (const part of tree.parts) {
      if (part.kind === 'trunk') continue;
      const offset = Math.hypot(part.position.x - tree.x, part.position.z - tree.z);
      const reach = offset + Math.max(part.scale.x, part.scale.z);
      if (reach > footprint) footprint = reach;
    }
    return { x: tree.x, z: tree.z, footprint };
  });

  const plots: PlotFact[] = [...PARK_LAYOUT.entries.values()].map((entry) => ({
    id: entry.id,
    x: entry.x,
    z: entry.z,
    boundingRadius: entry.boundingRadius,
  }));

  // The ginormous slide's chute, sampled off the built curve and pushed out
  // through the scene graph into world space.
  //
  // `updateMatrixWorld(true)` is called deliberately and is not a formality: a
  // headless park is never rendered, so nothing has otherwise composed a single
  // world matrix and every one of them is still the identity. Sampling without
  // this yields the chute's *local* coordinates while looking exactly like
  // world ones, and every clearance test built on them would quietly pass.
  const { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } = await import(
    '../../src/world/building/layout.ts'
  );
  const { BUILDING_HALF_X, BUILDING_HALF_Z } = await import('../../src/core/constants.ts');
  const castleFootprint = {
    x: BUILDING_CENTRE_X,
    z: BUILDING_CENTRE_Z,
    halfX: BUILDING_HALF_X,
    halfZ: BUILDING_HALF_Z,
  };

  const { SLIDE_PLAN } = await import('../../src/world/slide/plan.ts');
  const slideDoor = {
    minX: SLIDE_PLAN.facadeDoorMinX,
    maxX: SLIDE_PLAN.facadeDoorMaxX,
    corridorRadius: SLIDE_PLAN.facadeDoorChuteHalf,
  };

  // Every world matrix must be composed before a single one is read: a headless
  // park is never rendered, so they are all still the identity otherwise, and a
  // clearance check built on them passes for free.
  scene.updateMatrixWorld(true);

  const { InstancedMesh: InstancedMeshClass, Matrix4 } = await import('three');
  const { CHUTE_ENVELOPE } = await import('../../src/world/building/SlideRide.ts');
  const castleTowers: {
    name: string; x: number; z: number;
    bottomY: number; topY: number; radiusBottom: number; radiusTop: number;
  }[] = [];
  scene.traverse((object) => {
    if (!(object instanceof InstancedMeshClass)) return;
    if (!/^tower-(bodies|roofs)$/.test(object.name)) return;
    const params = object.geometry.parameters as {
      radiusTop?: number; radiusBottom?: number; radius?: number; height: number;
    };
    // A cone reports `radius` (its base) and tapers to a point; a cylinder
    // reports both ends. Read whichever the built geometry carries.
    const radiusBottom = params.radiusBottom ?? params.radius ?? 0;
    const radiusTop = params.radiusTop ?? 0;
    const local = new Matrix4();
    const composed = new Matrix4();
    const centre = new Vector3();
    for (let i = 0; i < object.count; i += 1) {
      object.getMatrixAt(i, local);
      composed.multiplyMatrices(object.matrixWorld, local);
      centre.setFromMatrixPosition(composed);
      castleTowers.push({
        name: `${object.name}[${i}]`,
        x: centre.x,
        z: centre.z,
        bottomY: centre.y - params.height / 2,
        topY: centre.y + params.height / 2,
        radiusBottom,
        radiusTop,
      });
    }
  });

  const slide = world.building.ginormousSlide;
  slide.group.updateMatrixWorld(true);
  if (slide.group.parent) slide.group.parent.updateMatrixWorld(true);
  const slideChute: (readonly [number, number, number])[] = [];
  {
    const probe = new Vector3();
    const steps = Math.max(96, Math.round(slide.length / 0.4));
    for (let i = 0; i <= steps; i += 1) {
      slide.pointAt(i / steps, probe);
      slide.group.localToWorld(probe);
      slideChute.push([probe.x, probe.y, probe.z]);
    }
  }

  const slideRiderLocal: (readonly [number, number, number])[] = [];
  const slideRiderWorld: (readonly [number, number, number])[] = [];
  {
    const probe = new Vector3();
    for (let i = 0; i <= 12; i += 1) {
      slide.pointAt(i / 12, probe);
      slideRiderLocal.push([probe.x, probe.y, probe.z]);
      slide.group.localToWorld(probe);
      slideRiderWorld.push([probe.x, probe.y, probe.z]);
    }
  }

  const nearPairs = new Set<string>();
  for (const entry of PARK_MANIFEST) {
    if (entry.near) nearPairs.add(pairKey(entry.id, entry.near.id));
  }

  // Stall counters are read off the **built world's interact zones** — the
  // coordinates the game actually sends a child to, computed by the booths
  // themselves — rather than off `STALL_STANDS`.
  //
  // That distinction is the whole value of the fact, and it is measured, not
  // assumed. `paths.ts` now builds its stall nodes *from* `STALL_STANDS`, so an
  // invariant comparing the graph against that same table compares a source
  // with itself. Injecting a booth into the built world that never reaches the
  // table — the exact ferris-kiosk defect — the table-based form reported 19
  // passed and saw nothing; this form fails with the booth named. The interact
  // zones are also what `MiniGameStalls` and `FacePaintStall` each compute for
  // themselves, so this polices those two against the table as well.
  const entrances: EntranceFact[] = [
    ...ANCHORS.map((anchor) => ({
      id: `anchor:${anchor.id}`,
      x: anchor.entrance[0],
      z: anchor.entrance[1],
    })),
    ...world
      .interactZones()
      .filter((zone) => zone.id.startsWith('stall:'))
      .map((zone) => ({ id: zone.id, x: zone.standX, z: zone.standZ })),
  ];

  // The drawn ribbon, not the control points it was drawn from. `paths.ts`
  // sweeps a Catmull-Rom (tension 0.4) through those controls, and the curve
  // bows away from them — so where the paving actually runs, and where it
  // actually stops, is only visible on the sampled curve.
  const drawnCentreLine = (
    route: (typeof PATH_GRAPH.edges)[number]['route'],
  ): { length: number; points: [number, number][] } => {
    const curve = new CatmullRomCurve3(
      route.points.map(([x, z]) => new Vector3(x, 0, z)),
      route.closed,
      'catmullrom',
      0.4,
    );
    const length = curve.getLength();
    const steps = Math.max(8, Math.ceil(length / 0.5));
    const points: [number, number][] = [];
    for (let i = 0; i <= steps; i += 1) {
      const point = curve.getPointAt(i / steps);
      points.push([point.x, point.z]);
    }
    return { length, points };
  };

  // Read straight off the graph's paved edges rather than off `ROUTES`, which
  // is that same filter with the node ids thrown away: keeping them is what
  // lets an invariant ask whether a ribbon reached the destination it names.
  const paved = PATH_GRAPH.edges.filter((edge) => edge.paved);
  const drawn = paved.map((edge) => drawnCentreLine(edge.route));

  const pathEdges: PathEdgeFact[] = paved.map((edge, index) => ({
    name: edge.route.name,
    from: edge.from,
    to: edge.to,
    backbone: edge.route.closed,
    halfWidth: edge.route.width / 2,
    points: drawn[index]!.points,
  }));

  const pathNodes: PathNodeFact[] = PATH_GRAPH.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    x: node.x,
    z: node.z,
    reach: node.kind === 'plaza' ? PLAZA.radius : 0,
  }));

  const routes: RouteFact[] = paved.map((edge, index) => ({
    name: edge.route.name,
    length: drawn[index]!.length,
    points: drawn[index]!.points,
  }));

  // The *solved* curve, not the control points and not the corridor Scenery
  // planned against — those are what the fix used, so measuring them would
  // only restate the fix. `world.train.route` is what the train runs on, and
  // it exists whether the route is solved inside `ParkTrain` or handed to it
  // by a plan module.
  const route = world.train.route;
  const scratch = new Vector3();
  const distanceToRail = (x: number, z: number): number => {
    const point = route.pointAt(route.distanceNear(x, z), scratch);
    return Math.hypot(point.x - x, point.z - z);
  };

  const probe = new Vector3();
  const isStandable = (x: number, z: number, radius = 0.62): boolean => {
    probe.set(x, 0, z);
    world.collision.resolve(probe, radius);
    return Math.hypot(probe.x - x, probe.z - z) < 1e-3;
  };

  // Every ride's exit, straight off `PATH_GRAPH` — the same nodes `paths.ts`
  // gives a station or a stall's doormat, read back off the built graph
  // rather than off `coaster/plan.ts`/`ferrisWheel/exit.ts` directly, so this
  // measures what the graph actually contains rather than restating the plan
  // that was meant to produce it.
  const exits: ExitFact[] = pathNodes
    .filter((node) => node.kind === 'exit')
    .map((node) => ({ id: node.id, x: node.x, z: node.z }));

  // The real nav lattice, built exactly as `scripts/check-park.mts` builds
  // one and as `Game` itself does — the walker's own radius and jump apex —
  // so "reachable" here means what it means in play.
  const navGrid = new NavGrid(world.collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT);
  const routeBuffer = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);
  const reachableFromEntrance = (x: number, z: number): boolean => {
    const count = navGrid.findRoute(
      ENTRANCE_PLAYER_X,
      ENTRANCE_PLAYER_Z,
      x,
      z,
      sample,
      0,
      routeBuffer,
    );
    if (count === 0) return false;
    const endX = routeBuffer[(count - 1) * 2] ?? Infinity;
    const endZ = routeBuffer[(count - 1) * 2 + 1] ?? Infinity;
    return Math.hypot(endX - x, endZ - z) < 1.5;
  };

  const castlePass = {
    windows: CASTLE_WINDOWS,
    complaints: [
      ...checkCastleWindows(world.coaster.route, CASTLE_WINDOWS),
      ...sweptCartHits(world.coaster.route, world.building.gardenRoot),
    ],
  };

  return {
    castlePass,
    seed,
    world,
    walls,
    trees,
    lamps: world.lampPosts.positions.map((p) => [p.x, p.z] as const),
    plots,
    entrances,
    exits,
    pathNodes,
    pathEdges,
    slideChute,
    slideRiderFrame: { local: slideRiderLocal, world: slideRiderWorld },
    slideDoor,
    castleTowers,
    chuteEnvelope: CHUTE_ENVELOPE,
    slideLegs: world.building.slideLegs,
    castleFootprint,
    reachableFromEntrance,
    routes,
    nearPairs,
    distanceToRail,
    isStandable,
    buildMs,
  };
}

// ------------------------------------------------------------------ geometry

/** Closest approach between two segments. Zero if they cross. */
export function segmentDistance(
  a1: readonly [number, number],
  a2: readonly [number, number],
  b1: readonly [number, number],
  b2: readonly [number, number],
): number {
  if (segmentsCross(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointToSegment(a1, b1, b2),
    pointToSegment(a2, b1, b2),
    pointToSegment(b1, a1, a2),
    pointToSegment(b2, a1, a2),
  );
}

function segmentsCross(
  a1: readonly [number, number],
  a2: readonly [number, number],
  b1: readonly [number, number],
  b2: readonly [number, number],
): boolean {
  const side = (
    p: readonly [number, number],
    q: readonly [number, number],
    r: readonly [number, number],
  ): number => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return (
    side(b1, b2, a1) !== side(b1, b2, a2) && side(a1, a2, b1) !== side(a1, a2, b2)
  );
}

export function pointToSegment(
  p: readonly [number, number],
  s1: readonly [number, number],
  s2: readonly [number, number],
): number {
  const dx = s2[0] - s1[0];
  const dz = s2[1] - s1[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-12) return Math.hypot(p[0] - s1[0], p[1] - s1[1]);
  let t = ((p[0] - s1[0]) * dx + (p[1] - s1[1]) * dz) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - (s1[0] + dx * t), p[1] - (s1[1] + dz * t));
}

/** Samples along a run, for tests that need distance-to-a-curve. */
export function alongRun(
  from: readonly [number, number],
  to: readonly [number, number],
  spacing = 0.4,
): (readonly [number, number])[] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(2, Math.ceil(length / spacing));
  const points: (readonly [number, number])[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
  return points;
}
