/**
 * **The measures `check:park` makes, as a function of a built park** — one
 * owner, asked by `scripts/check-park.mts` (which prints and exits) and by
 * the root acceptance loop (`scripts/lib/acceptedPark.mts`, which starts the
 * park again from zero when any hard finding fires). The six invariants, the
 * ratchet and why each key exists are documented in `check-park.mts`'s header.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { quietly, type HeadlessPark } from '../park-harness.mts';
import { NavGrid, MAX_ROUTE_WAYPOINTS, TOP_REFERENCE } from '../../src/world/NavGrid.ts';
import { PLAYER_LONGEST_STEP, PLAYER_RADIUS, WALKABLE_GAP } from '../../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../../src/entities/Player.ts';
import { ANCHORS, anchorGroupName } from '../../src/world/anchors.ts';
import { NUDGE_REACH, PoiGraph, SEEDS } from '../../src/entities/npc/poiGraph.ts';
import { SPACE_GARDEN, spaceAt } from '../../src/world/spaces.ts';
import { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../../src/world/entrance/layout.ts';
import { SHORTFALL_TOLERANCE } from '../../src/entities/TapNavigator.ts';
import { TRACK_CLEARANCE } from '../../src/world/train/route.ts';
import { STATION_GAP } from '../../src/world/train/fence.ts';
import { BRIDGE_RISE } from '../../src/world/train/clearance.ts';
import { bridgeHeightAt } from '../../src/world/train/bridges.ts';
import type { InteractZone } from '../../src/world/interact.ts';
import { distanceToPath } from '../../src/world/pathGraph.ts';
import { unplaceFromSphere } from '../../src/world/terrain.ts';
import { LAYOUT_REFUSALS_IGNORED } from '../../src/world/parkLayout.ts';


// ---------------------------------------------------------------- the ratchet

/** A deviation the hand-authored park was already carrying. Recorded, not accepted. */
export interface Recorded {
  /**
   * How bad it was allowed to be on the day this landed. Units are the
   * invariant's own — a count of unroutable attractions, of crossings, of
   * stranded waypoints, of metres of unflanked track.
   */
  readonly worst: number;
  /** What is actually going on, and what closes it. Every entry needs one. */
  readonly why: string;
}

/**
 * What the park measured on 28 July 2026, before the generator.
 *
 * **Do not add to this table to make a build pass.** Every entry below is a
 * thing Decision 5 explicitly plans to close tonight, with the layer that
 * closes it named. A violation introduced by a generator step is a bug in that
 * step, and it gets no allowance.
 */
export const RATCHET: Readonly<Record<string, Recorded>> = {
  // Re-baselined 28 July at the Decision 5 switchover: the layout is now
  // generated, and these residuals moved with it. Each entry says why its
  // number is what it is; a *class* fix deletes the entry rather than
  // loosening it. Historical note worth keeping: the generated park routes
  // strictly better than the hand-authored one did — route.unreachable,
  // poi.nospot and poi.stranded all went to zero and their entries were
  // DELETED, not relaxed.
  // `rail.exclusion` (21) and `rail.walkable` (30) were DELETED 7 Aug 2026
  // (issue #241): both now measure only track OUTSIDE the declared open
  // stretches (each crossing's own halfGap, each platform's STATION_GAP), so
  // "how many open metres is normal" stopped being a number that scales with
  // the loop and became zero everywhere the fence did not declare a gap. The
  // platform far-side fence closed the last undeclared way across.
  'anchor.reach:building': {
    worst: 0,
    why:
      'Held at zero. The castle declared a typed 19.3 m while its turrets ' +
      'reached 20.13-20.69 m on all 16 seeds, unseen because this measured mesh ' +
      'centres; it now measures every drawn vertex in the plan frame, and the ' +
      'declaration is derived (`CASTLE_PLOT_REACH`, 21.31 m: nudge + turret ' +
      'corner + turret radius). Kept rather than deleted so any overrun fails ' +
      'instead of re-opening an allowance.',
  },
  'anchor.reach:waterFight': {
    worst: 0,
    why:
      'Held at zero. The overrun that used to fire here (0.1 to 1.1 m past ' +
      'the declared 19 m, varying per park) was the water-gun rack standing at ' +
      'a world offset from a per-park door, outside the plot; it now stands ' +
      'inside the rectangle by construction. Kept rather than deleted so any ' +
      'overrun fails instead of re-opening an allowance.',
  },
  // `anchor.reach:dodgems` (1.7) and `anchor.reach:waterFight` (2.3) were
  // DELETED 7 Aug 2026: the manifest now declares each ride's MEASURED
  // build-out (19 / 16.5) rather than its plot rectangle, so paths and spurs
  // plan around the real edge and the doormats stopped falling short.
};

// --------------------------------------------------------------- the findings

export interface Finding {
  /** Which invariant, 1–6. */
  readonly invariant: number;
  /** Ratchet key. A finding whose key is absent from {@link RATCHET} fails. */
  readonly key: string;
  /** How bad, in the invariant's own units. */
  readonly measured: number;
  /** One line a person can act on. */
  readonly detail: string;
}

/** Everything `check:park` measured on one park, and its verdict. */
export interface ParkFindings {
  readonly findings: readonly Finding[];
  /** Lines printed under `--verbose`, or whenever something fails. */
  readonly table: readonly string[];
  /** Hard failures: a key with no allowance, or one worse than recorded. Empty means the park passes. */
  readonly regressions: readonly string[];
  /** Keys measured under their recorded worst — their RATCHET entry should be deleted. */
  readonly loose: readonly string[];
  /** Keys whose drift was reported but not enforced (`ratchetEnforced` false). */
  readonly drift: readonly string[];
  readonly measured: ReadonlyMap<string, number>;
  readonly worst: { readonly key: string; readonly share: number; readonly count: number; readonly amount: number };
  readonly worstDetail: string;
  readonly summary: string;
  readonly elapsedMs: number;
}

/**
 * Measure `park` against the six invariants.
 *
 * `ratchetEnforced` false is the old seed-sweep mode (`LGP_RATCHET=off`): only
 * the hard keys fail. The acceptance loop always enforces. `verbose` adds the
 * per-destination route table to `table`.
 */
export function measureParkFindings(park: HeadlessPark, ratchetEnforced: boolean, verbose = false): ParkFindings {
  const findings: Finding[] = [];
  /** Lines printed under `--verbose`, or whenever something fails. */
  const table: string[] = [];
  function report(finding: Finding): void {
    findings.push(finding);
  }

  // ------------------------------------------------------------------ the park

  const started = performance.now();
  const world = park.world;
  const collision = world.collision;

  // ------------------------------------------- 5. the existing boot asserts
  //
  // First, and in `Game`'s own order: `checkHoppableColliders` *demotes* a
  // collider it does not trust and bumps the collision revision, which changes
  // the map every route below is planned on. Running it after the lattice was
  // built would plan on a park the game never has.

  // Both shout at the console themselves, which is exactly right at boot and
  // merely duplicate here: they hand back the same complaints as strings, and
  // those become findings below.
  const hoppable = quietly(() => collision.checkHoppableColliders(PLAYER_RADIUS, JUMP_APEX_HEIGHT));
  const substep = quietly(() => collision.checkSubstepBudget(PLAYER_RADIUS, PLAYER_LONGEST_STEP));
  for (const problem of [...hoppable, ...substep]) {
    report({ invariant: 5, key: 'boot.asserts', measured: 1, detail: problem });
  }

  // ------------------------------------------ 1 & 2. routes from the entrance

  /**
   * Where a child starts.
   *
   * Decision 5's third ruling: *"Everything moves except the entrance."* So this
   * is the one coordinate in the park a check may depend on, and it is taken from
   * `world/entrance/layout.ts` rather than typed here — the spot beside the bus
   * stop where a child is put down, well inside `GARDEN_PLAY_RADIUS`.
   */
  const ENTRANCE_X = ENTRANCE_PLAYER_X;
  const ENTRANCE_Z = ENTRANCE_PLAYER_Z;

  /**
   * The lattice a finger is routed on, built exactly as `Game` builds it — the
   * player's own radius and her own jump apex, so a wall this says she can hop is
   * one she hops.
   */
  const navGrid = new NavGrid(
    collision,
    PLAYER_RADIUS,
    JUMP_APEX_HEIGHT,
    undefined,
    // Every railway bridge's deck and ramps (issue #116, Decision 8) — see
    // NavGrid's own `bridgeCovers` header.
    (x, z) => world.train.bridges.some((bridge) => bridge.covers(x, z)),
  );
  const route = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);

  /** A place a child has to be able to get to, and what to call it if she cannot. */
  interface Destination {
    readonly label: string;
    readonly x: number;
    readonly z: number;
  }

  /**
   * Every attraction's stand point.
   *
   * Two sources, because neither alone is the park:
   *
   * - **the interact zones**, which are the tap targets the game itself offers —
   *   the stalls, the front door, both train stations. `standX/standZ` is
   *   literally where tap-to-move walks a child, so it is the exact point the
   *   invariant is about.
   * - **the anchors' `entrance` points**, where each plot's path spur arrives and
   *   its sign stands. A plot whose ride is not built yet has no interact zone at
   *   all, and "the ferris wheel is unreachable" must not become true silently on
   *   the day somebody builds it.
   *
   * Two kinds are left out, and both deliberately. **Pickable flowers** (400 of
   * them) are scatter, not attractions — a bloom in a hedge is a bloom in a
   * hedge. **Anything in another space** — the whole building interior, six
   * hundred metres away — is reached through a portal rather than by walking, and
   * `NavGrid` cannot route across one by construction.
   */
  function destinations(): Destination[] {
    const out: Destination[] = [];
    const zones: readonly InteractZone[] = world.interactZones();
    let flowers = 0;
    let elsewhere = 0;

    for (const zone of zones) {
      if (zone.id.startsWith('flower:')) {
        flowers += 1;
        continue;
      }
      if (spaceAt(zone.standX, zone.standZ) !== SPACE_GARDEN) {
        elsewhere += 1;
        continue;
      }
      out.push({ label: zone.id, x: zone.standX, z: zone.standZ });
    }

    for (const anchor of ANCHORS) {
      const [x, z] = anchor.entrance;
      out.push({ label: `anchor:${anchor.id}`, x, z });
    }

    table.push(
      `destinations: ${out.length} checked ` +
        `(${flowers} flowers and ${elsewhere} zones in other spaces are out of scope)`,
    );
    return out;
  }

  /** Would a player-width character be pushed out of somewhere? */
  /** Can the lattice route a child from the entrance to (x, z)? */
  const reachScratch = new Float64Array(MAX_ROUTE_WAYPOINTS * 2);
  function walkReachable(x: number, z: number): boolean {
    const count = navGrid.findRoute(
      ENTRANCE_X,
      ENTRANCE_Z,
      park.sample(ENTRANCE_X, ENTRANCE_Z, 0),
      x,
      z,
      park.sample(x, z, 0),
      park.sample,
      reachScratch,
    );
    if (count === 0) return false;
    const endX = reachScratch[(count - 1) * 2] ?? Infinity;
    const endZ = reachScratch[(count - 1) * 2 + 1] ?? Infinity;
    return Math.hypot(endX - x, endZ - z) < 1.5;
  }

  function isStandable(x: number, z: number, radius = PLAYER_RADIUS): boolean {
    // Probed at the ground, not at y = 0. On the sphere the ground is metres
    // below y = 0 over most of the park, and `resolve` clears a wall whose
    // absolute top is below the probe — so a probe at 0 walked straight through
    // every fence seam under a bridge deck and called the rail beside it
    // standable (`rail.walkable: 1` on seeds 4, 6, 9; 3 after the seam was
    // fixed). `walkReachable` below already stands at `park.sample`.
    const probe = new Vector3(x, park.sample(x, z, 0), z);
    collision.resolve(probe, radius);
    const dx = probe.x - x;
    const dz = probe.z - z;
    return dx * dx + dz * dz < 1e-6;
  }

  /**
   * The solved train loop as a polyline, in metres-ish steps.
   *
   * Sampled off `TrainRoute.curve` — the *solved* curve, not the control points
   * it was built from, because a Catmull-Rom through 72 points is not the polygon
   * joining them and the gap is where a crossing would hide.
   */
  const TRACK_SAMPLES = Math.max(64, Math.round(world.train.route.length));
  const trackX = new Float64Array(TRACK_SAMPLES + 1);
  const trackZ = new Float64Array(TRACK_SAMPLES + 1);
  const trackY = new Float64Array(TRACK_SAMPLES + 1);
  {
    const point = new Vector3();
    for (let i = 0; i <= TRACK_SAMPLES; i += 1) {
      world.train.route.pointAt((i / TRACK_SAMPLES) * world.train.route.length, point);
      trackX[i] = point.x;
      trackZ[i] = point.z;
      trackY[i] = point.y;
    }
  }

  /**
   * How far a walkable surface must stand above the ground under the track
   * before a route passing over it counts as a **bridge**.
   *
   * Imported from `train/clearance.ts` rather than derived here — the single
   * owner both `world/train/bridges.ts` (which builds every deck to stand
   * exactly this high) and this checker (which judges it) read from, so a
   * retune of the train, the rider or the deck's own thickness moves both
   * sides together. See that module for the full derivation.
   *
   * ### The datum
   *
   * Both sides are measured from the **terrain under the track**. `crossesTrack`
   * returns that as a field it calls `rail` (a misnomer — it is the ground, not
   * the rail head), and a locomotive's origin is the sleeper top, which is placed
   * at exactly that same terrain height. So `deck - hit.rail >= BRIDGE_RISE`
   * compares like with like. `RAIL_HEIGHT` is deliberately absent: it is rail
   * sitting *on* the datum, not part of it.
   *
   * ### There is no level-crossing escape any more
   *
   * Between issues #317/#319 and 2 Sep 2026 this invariant carried a scoped
   * escape for `ParkTrain.fallbackCrossings` — crossings the bridge search
   * had genuinely given up on. That machinery is deleted (Jim: every
   * crossing is a bridge, and the ability to create a level crossing must
   * not exist), so the invariant is back to its strongest form: a route
   * meeting the rail anywhere must clear `BRIDGE_RISE` over a real deck,
   * unconditionally.
   */

  /** Do segments a→b and c→d cross? Proper crossing only; touching does not count. */
  function segmentsCross(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    dx: number,
    dz: number,
  ): boolean {
    const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number): number =>
      (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
    const d1 = side(ax, az, bx, bz, cx, cz);
    const d2 = side(ax, az, bx, bz, dx, dz);
    const d3 = side(cx, cz, dx, dz, ax, az);
    const d4 = side(cx, cz, dx, dz, bx, bz);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }

  /**
   * Where a route leg crosses the track, or null.
   *
   * Returns the crossing point and the index of the track segment, so the caller
   * can ask how high the ground is there and how high the rail is.
   */
  function crossesTrack(
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ): { x: number; z: number; rail: number } | null {
    for (let i = 0; i < TRACK_SAMPLES; i += 1) {
      const cx = trackX[i] ?? 0;
      const cz = trackZ[i] ?? 0;
      const dx = trackX[i + 1] ?? 0;
      const dz = trackZ[i + 1] ?? 0;
      if (!segmentsCross(ax, az, bx, bz, cx, cz, dx, dz)) continue;
      // Where, along the track segment — good enough to sample the ground at.
      const denominator = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
      const t =
        Math.abs(denominator) < 1e-9
          ? 0.5
          : ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / denominator;
      return {
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        rail: ((trackY[i] ?? 0) + (trackY[i + 1] ?? 0)) / 2,
      };
    }
    return null;
  }

  const targets = destinations();
  let routed = 0;
  let crossingsTotal = 0;

  for (const target of targets) {
    const points = navGrid.findRoute(
      ENTRANCE_X,
      ENTRANCE_Z,
      park.sample(ENTRANCE_X, ENTRANCE_Z, 0),
      target.x,
      target.z,
      park.sample(target.x, target.z, 0),
      park.sample,
      route,
    );

    // How close the walk actually gets. `NavGrid` returns the nearest reachable
    // point when the goal itself is blocked, and the game accepts that: the last
    // step of a real walk is the ordinary seek pressing gently into a counter, a
    // stall front or — as five of the anchors do — the sign post standing on the
    // very spot the spur arrives at. `TapNavigator`'s own tolerance is imported
    // rather than repeated, so the two can never disagree about "she got there".
    const endX = points > 0 ? (route[(points - 1) * 2] ?? target.x) : ENTRANCE_X;
    const endZ = points > 0 ? (route[(points - 1) * 2 + 1] ?? target.z) : ENTRANCE_Z;
    const shortfall = Math.hypot(endX - target.x, endZ - target.z);
    const arrived = points > 0 && (navGrid.lastRouteReachedGoal || shortfall <= SHORTFALL_TOLERANCE);

    if (arrived) routed += 1;
    if (!arrived) {
      const why =
        points === 0
          ? 'there is no lattice covering the entrance — the park boundary has moved'
          : isStandable(target.x, target.z)
            ? `the walk stops ${shortfall.toFixed(1)} m short; the lattice has no way through`
            : `its stand point is inside something solid, and the nearest place a ` +
              `child fits is ${shortfall.toFixed(1)} m away`;
      report({
        invariant: 1,
        key: 'route.unreachable',
        measured: 1,
        detail:
          `${target.label} at (${target.x.toFixed(1)}, ${target.z.toFixed(1)}) ` +
          `cannot be walked to from the entrance — ${why}`,
      });
    }

    // --- 2. and it may cross the railway only over a bridge deck --------------
    // The train dives through the park (Decision 4), and every place a path
    // meets it now has a real bridge (issue #116, Decision 8) — so the only
    // legal way to cross is a walkable surface at least `BRIDGE_RISE` above
    // the ground under the track at that point. Sampled from `TOP_REFERENCE`
    // down, the same "what's the topmost surface here" NavGrid itself asks —
    // a deck stands several metres up, and a ground-level sample would never
    // find it. Anywhere else is a bug.
    let crossings = 0;
    let fromX = ENTRANCE_X;
    let fromZ = ENTRANCE_Z;
    for (let i = 0; i < points; i += 1) {
      const toX = route[i * 2] ?? fromX;
      const toZ = route[i * 2 + 1] ?? fromZ;
      const hit = crossesTrack(fromX, fromZ, toX, toZ);
      if (hit) {
        const deck = park.sample(hit.x, hit.z, TOP_REFERENCE);
        const overBridge = deck - hit.rail >= BRIDGE_RISE;
        if (!overBridge) {
          crossings += 1;
          report({
            invariant: 2,
            key: 'route.crossesRail',
            measured: 1,
            detail:
              `the walk to ${target.label} crosses the railway at ` +
              `(${hit.x.toFixed(1)}, ${hit.z.toFixed(1)}) ${(deck - hit.rail).toFixed(2)} m above ` +
              `the rail, short of the ${BRIDGE_RISE.toFixed(2)} m a bridge deck needs`,
          });
        }
      }
      fromX = toX;
      fromZ = toZ;
    }
    crossingsTotal += crossings;

    if (verbose) {
      table.push(
        `  ${target.label.padEnd(28)} ${arrived ? 'routed' : 'NO ROUTE'} ` +
          `in ${String(points).padStart(2)} waypoint(s), ` +
          `${shortfall.toFixed(2)} m short, ${crossings} rail crossing(s)`,
      );
    }
  }

  // ------------------------------------------- 3. one connected waypoint graph
  //
  // `poiGraph` already checks two of the three things that must be true of a
  // waypoint: that a character fits there, and that the straight line to each
  // neighbour is walkable. It computes components too — but only to keep the
  // biggest one per space and *drop* the rest with a console warning, which is
  // the right run-time behaviour (a child's afternoon must not end because a
  // waypoint drifted into a bush) and no check at all. This is the missing half:
  // the graph must be **one** component with every seed in it.
  //
  // Its own file comment says why it matters: "a pocket of waypoints nobody can
  // walk to is a child standing in a bush however many of them there are".

  // Built here rather than borrowed from `NpcSystem`, which keeps its copy
  // private. Forty-odd nodes, so the edge validation costs a few milliseconds —
  // and it is the same constructor the game runs, which is the point.
  // The same grid the attractions were just routed on — one instrument, so a
  // waypoint this calls stranded is one the children's own planner cannot reach.
  const graph = quietly(() => new PoiGraph({ grid: navGrid, sample: park.sample }));

  const dropped = SEEDS.length - graph.nodes.length;
  if (dropped > 0) {
    report({
      invariant: 3,
      key: 'poi.nospot',
      measured: dropped,
      detail:
        `${dropped} waypoint seed(s) had nowhere within ${NUDGE_REACH} m a child can stand — ` +
        'poiGraph discarded them before the graph was even built: ' +
        graph.noSpot.map((seed) => `(${seed.x.toFixed(1)}, ${seed.z.toFixed(1)})`).join(' '),
    });
  }

  // -------------------------------------------- 3b. no false layout refusal
  //
  // Under `LGP_LAYOUT_RUNG=off` the layout probes every doormat but never
  // unwinds, and exports what it would have refused. The rung's one failure
  // mode is refusing a door the built park accepts (it then moves a plot to
  // satisfy a measurement error — seed 1, 6 Sep 2026, the castle's door inside
  // the walkable ball pit), so each ignored refusal is proved here against the
  // park that was actually built, on the same grid the children walk: a
  // standable, reachable spot within the waypoint reach of that door means the
  // refusal was false. With the rung armed there is nothing to prove and this
  // says so.
  {
    const entranceY = park.sample(ENTRANCE_X, ENTRANCE_Z, 0);
    const reachable = navGrid.reachableFrom(ENTRANCE_X, ENTRANCE_Z, entranceY, park.sample);
    if (LAYOUT_REFUSALS_IGNORED.length === 0) {
      // Said on every run, on stderr, so it can be heard on a green one: with
      // the rung armed (or nothing refused) this guard iterates an empty list
      // and asserts nothing. `check:every-seed-builds` is what exercises it,
      // by re-running this with LGP_LAYOUT_RUNG=off on any seed whose trace
      // fired. A reviewer nearly filed the guard as broken after a canonical
      // run that exited 0 for exactly this reason.
      console.error(
        'check:park layout.falseRefusal: 0 refusals to test on this seed — the guard asserted nothing ' +
          '(the rung was armed, or refused nothing; check:every-seed-builds exercises it with LGP_LAYOUT_RUNG=off)',
      );
      table.push('layout refusals: none to prove (the rung was armed, or refused nothing)');
    }
    for (const refusal of LAYOUT_REFUSALS_IGNORED) {
      const y = park.sample(refusal.at.x, refusal.at.z, TOP_REFERENCE);
      const spot = reachable
        ? navGrid.nearestStandable(refusal.at.x, refusal.at.z, y, park.sample, NUDGE_REACH, reachable)
        : null;
      const contradicted = spot !== null && reachable !== null && reachable(spot.x, spot.z, spot.y);
      table.push(
        `layout refusal ${refusal.kind} '${refusal.entry}' at (${refusal.at.x.toFixed(1)}, ${refusal.at.z.toFixed(1)}) ` +
          `blockers=[${refusal.blockers.join(',')}]: built park ${contradicted ? 'REACHES it — FALSE refusal' : 'agrees'}`,
      );
      if (contradicted) {
        report({
          invariant: 3,
          key: 'layout.falseRefusal',
          measured: 1,
          detail:
            `the layout probe refused '${refusal.entry}' (${refusal.kind}, blockers [${refusal.blockers.join(',')}]) ` +
            `at (${refusal.at.x.toFixed(1)}, ${refusal.at.z.toFixed(1)}), but the built park has a standable, reachable ` +
            `spot ${Math.hypot((spot as { x: number }).x - refusal.at.x, (spot as { z: number }).z - refusal.at.z).toFixed(2)} m ` +
            'from it — a rung armed on this would move a plot to satisfy a measurement error',
        });
      }
    }
  }

  const stranded = graph.nodes.filter((node) => !node.reachable);
  for (const node of stranded) {
    report({
      invariant: 3,
      key: 'poi.stranded',
      measured: 1,
      detail:
        `waypoint (${node.x.toFixed(1)}, ${node.z.toFixed(1)})${node.interesting ? ' (interesting)' : ''} ` +
        `cannot be reached from the entrance by the children's own NavGrid — the drawn paving ` +
        'there is inside something solid',
    });
  }

  table.push(
    `poiGraph: ${graph.nodes.length}/${SEEDS.length} seeds placed, ` +
      `${graph.nodes.length - stranded.length} in the main component`,
  );

  // ------------------------------------------------ 4. the rail is fenced off
  //
  // Decision 4 §6, "keeping feet off the rails without fencing the park in": the
  // railway is kept walkable-around by a continuous pair of invisible walls
  // flanking the track, rather than by a visible fence round the whole loop. Two
  // halves, measured from opposite sides, because either alone can look fine:
  //
  //  - **the wall's side** — walk the solved curve and ask whether there is
  //    something solid to left and to right of every metre of it. A gap of even a
  //    few metres is a doorway onto the track, and a six-year-old will find it.
  //  - **the walker's side** — stand a player-width probe on the centre line and
  //    ask whether anything pushes her off. This is the invariant as a child
  //    experiences it, and it is the one that cannot be satisfied by accident.

  /** How far to either side of the centre line a flanking wall may stand. */
  const FLANK_REACH = TRACK_CLEARANCE + 1;

  /** Distance from a point to a wall segment. */
  function distanceToSegment(
    x: number,
    z: number,
    x1: number,
    z1: number,
    x2: number,
    z2: number,
  ): number {
    const ax = x2 - x1;
    const az = z2 - z1;
    const lengthSquared = ax * ax + az * az;
    let t = lengthSquared < 1e-9 ? 0 : ((x - x1) * ax + (z - z1) * az) / lengthSquared;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(x - (x1 + ax * t), z - (z1 + az * t));
  }

  /** Is there something solid within {@link FLANK_REACH} of this point? */
  function somethingSolidNear(x: number, z: number): boolean {
    let found = false;
    collision.forEachWall((x1, z1, x2, z2, halfThickness) => {
      if (found) return;
      if (distanceToSegment(x, z, x1, z1, x2, z2) - halfThickness <= FLANK_REACH) found = true;
    });
    if (found) return true;
    collision.forEachCircle((cx, cz, radius) => {
      if (found) return;
      if (Math.hypot(x - cx, z - cz) - radius <= FLANK_REACH) found = true;
    });
    return found;
  }

  {
    const step = world.train.route.length / TRACK_SAMPLES;
    let unflanked = 0;
    let standable = 0;
    let firstGapAt = -1;
    let firstStandableAt = -1;

    // The stretches deliberately left open — the boarding gap at each
    // platform, and nothing else (the fallback crossing's fence gap died
    // with the level tier, 2 Sep 2026). Measured
    // *against the declarations* rather than against a recorded total (issue
    // #241): the loop's length changes with the layout, so "how many open
    // metres is normal" is not a stable number — but "no hole we did not
    // declare" is, and it is the invariant a child actually experiences.
    // Anything open outside this span is a defect at any length. An ordinary,
    // bridged crossing no longer opens one of these (issue #116, Decision 8):
    // the fence runs on underneath every bridge instead of gapping for it, so
    // `somethingSolidNear` below finds it exactly like any other stretch of
    // closed track — which is the point of building it that way rather than
    // leaving invariant 4 unable to see a bridge at all.
    const declaredOpen = (distance: number): boolean => {
      const along = (target: number, halfGap: number): boolean => {
        const wrapped = world.train.route.wrap(distance - target + world.train.route.length / 2);
        return Math.abs(wrapped - world.train.route.length / 2) <= halfGap + step;
      };
      for (const station of world.train.stations) {
        if (along(station.distance, STATION_GAP)) return true;
      }
      return false;
    };

    for (let i = 0; i < TRACK_SAMPLES; i += 1) {
      const x = trackX[i] ?? 0;
      const z = trackZ[i] ?? 0;
      if (declaredOpen(i * step)) continue;
      const next = (i + 1) % TRACK_SAMPLES;
      // The way the track is heading here, so "left" and "right" mean the two
      // sides of the rail rather than two compass directions.
      const tx = (trackX[next] ?? 0) - x;
      const tz = (trackZ[next] ?? 0) - z;
      const length = Math.hypot(tx, tz) || 1;
      const nx = -tz / length;
      const nz = tx / length;

      const left = somethingSolidNear(x + nx * TRACK_CLEARANCE, z + nz * TRACK_CLEARANCE);
      const right = somethingSolidNear(x - nx * TRACK_CLEARANCE, z - nz * TRACK_CLEARANCE);
      if (!left || !right) {
        unflanked += 1;
        if (firstGapAt < 0) firstGapAt = i;
      }
      // Standable AND reachable: the fence cannot stop a teleported probe, so
      // since §6 built it, the honest question is whether a child can *walk*
      // onto the track — anywhere the declarations above did not invite her.
      // `isStandable`/`walkReachable` both probe at (or route to) whatever
      // surface's *reachable* at this (x, z) — a bridge deck included, since
      // that is now genuinely the highest, genuinely reachable thing here, and
      // `isStandable`'s own ground-level probe was never in range of the
      // fence to begin with (it sits `FENCE_OFFSET` away in the crossing
      // direction, not athwart the rail — its job is only to catch a *ground*
      // level foothold the fence failed to block). So a bridge (which is
      // never at ground level) needs its own exemption here, the same as
      // invariant 2's own `overBridge` test.
      const onBridge = world.train.bridges.some((bridge) => bridge.covers(x, z));
      if (!onBridge && isStandable(x, z) && walkReachable(x, z)) {
        standable += 1;
        if (firstStandableAt < 0) firstStandableAt = i;
      }
    }

    if (unflanked > 0) {
      const at = firstGapAt;
      report({
        invariant: 4,
        key: 'rail.exclusion',
        measured: Number((unflanked * step).toFixed(1)),
        detail:
          `${(unflanked * step).toFixed(0)} m of the ${world.train.route.length.toFixed(0)} m loop ` +
          'has no invisible wall on one or both sides — the first gap is at ' +
          `(${(trackX[at] ?? 0).toFixed(1)}, ${(trackZ[at] ?? 0).toFixed(1)})`,
      });
    }
    if (standable > 0) {
      const at = firstStandableAt;
      report({
        invariant: 4,
        key: 'rail.walkable',
        measured: standable,
        detail:
          `${standable} of ${TRACK_SAMPLES} points on the track centre line are places a ` +
          `child can simply stand — the first at (${(trackX[at] ?? 0).toFixed(1)}, ` +
          `${(trackZ[at] ?? 0).toFixed(1)})`,
      });
    }

    table.push(
      `rail: ${world.train.route.length.toFixed(0)} m of loop, ` +
        `${(unflanked * step).toFixed(0)} m unflanked, ` +
        `${standable}/${TRACK_SAMPLES} centre-line points standable`,
    );
  }

  // ------------------------------------------------ 6. anchor keep-outs respected
  //
  // `building/dressing.ts` places a deck's benches by seeded scatter with
  // rejection against {@link keepOutsFor} — everywhere a child has to be able to
  // stand, walk to or ride from — so a bench can never end up in a stairwell.
  // Generalised to the park, the reserved thing is an **anchor's footprint**:
  // `world/anchors.ts` calls it "the single source of truth for where things go",
  // `Scenery.isPlantable` keeps trees out of it and `LampPosts` keeps lamps out
  // of it, but nothing ever checked either claim.
  //
  // So: measure. Every anchor's reserved footprint is compared against (a) the
  // other anchors' footprints, (b) the geometry each anchor actually built, and
  // (c) everything the park-wide builders put on the grass. Attribution is by
  // **scene graph** rather than by a table of who-owns-what: `World` names each
  // builder's group, so a new scatterer is one line here and a wrong answer is a
  // compile error rather than a silent gap.

  interface Footprint {
    readonly id: string;
    readonly x: number;
    readonly z: number;
    /** Signed distance from a point to the edge. Negative inside. */
    readonly distance: (x: number, z: number) => number;
  }

  function footprintOf(anchor: (typeof ANCHORS)[number]): Footprint {
    const [x, z] = anchor.position;
    const shape = anchor.footprint;
    if (shape.kind === 'circle') {
      return { id: anchor.id, x, z, distance: (px, pz) => Math.hypot(px - x, pz - z) - shape.radius };
    }
    return {
      id: anchor.id,
      x,
      z,
      distance: (px, pz) => {
        const dx = Math.abs(px - x) - shape.halfX;
        const dz = Math.abs(pz - z) - shape.halfZ;
        if (dx > 0 || dz > 0) return Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
        return Math.max(dx, dz);
      },
    };
  }

  /** A lump of built geometry: where it is on the ground and how wide. */
  interface Lump {
    readonly x: number;
    readonly z: number;
    readonly radius: number;
  }

  /**
   * Every solid lump under an object, in world space.
   *
   * A vertex walk would be exact and is not worth 1 200 trees' worth of it: what
   * matters here is *where a thing stands*, and an instance's own matrix plus its
   * geometry's bounding sphere gives that from the built object rather than from
   * anything anybody wrote down. Instanced meshes are walked instance by
   * instance — one box round the whole scatter would cover the park.
   */
  function lumpsUnder(root: import('three').Object3D): Lump[] {
    const lumps: Lump[] = [];
    root.updateMatrixWorld(true);
    const matrix = new Matrix4();
    const combined = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const rotation = new Quaternion();

    root.traverse((object) => {
      const mesh = object as import('three').Mesh & { count?: number; isInstancedMesh?: boolean };
      if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      const sphere = mesh.geometry.boundingSphere;
      if (!sphere) return;

      const instances = mesh.isInstancedMesh ? (mesh.count ?? 0) : 1;
      for (let i = 0; i < instances; i += 1) {
        if (mesh.isInstancedMesh) {
          (mesh as unknown as import('three').InstancedMesh).getMatrixAt(i, matrix);
          combined.multiplyMatrices(mesh.matrixWorld, matrix);
        } else {
          combined.copy(mesh.matrixWorld);
        }
        combined.decompose(position, rotation, scale);
        const centre = sphere.center.clone().applyMatrix4(combined);
        const widest = Math.max(Math.abs(scale.x), Math.abs(scale.z));
        lumps.push({ x: centre.x, z: centre.z, radius: sphere.radius * widest });
      }
    });
    return lumps;
  }

  {
    const footprints = ANCHORS.map(footprintOf);

    // (a) Two reserved plots may not overlap. Data only, and cheap, but it is the
    //     first thing a seeded solver will get wrong.
    for (let i = 0; i < footprints.length; i += 1) {
      for (let j = i + 1; j < footprints.length; j += 1) {
        const a = footprints[i];
        const b = footprints[j];
        if (!a || !b) continue;
        if (a.distance(b.x, b.z) < 0 || b.distance(a.x, a.z) < 0) {
          report({
            invariant: 6,
            key: 'anchor.overlap',
            measured: 1,
            detail: `the '${a.id}' and '${b.id}' plots overlap each other`,
          });
        }
      }
    }

    // (b) An anchor's drawn extent must stay within the reach it declares.
    //
    //     `boundingRadius` is documented in `anchors.ts` as the radius "used for
    //     path routing and scenery exclusion" — i.e. the promise every other
    //     builder plans around. Content beyond it is content nobody routed round
    //     and nobody kept a tree out of. Measured off the built group rather than
    //     off the note beside the number, which is the whole lesson of
    //     `check-asset-contract.mts`.
    //
    //     **Every drawn vertex, not every lump's centre.** This used to take
    //     `lumpsUnder` — one point per mesh, the centre of its bounding sphere —
    //     and so could not see how far a thing *reaches*, only where its middle
    //     stands. The castle's four turrets are one instanced mesh each for body
    //     and roof, whose one bounding-sphere centre is the middle of all four;
    //     the stone reached 20.13–20.69 m past a declared 19.3 on every one of
    //     seeds 0..15 (25 Sep 2026) and the finding stayed silent. A radius is a promise about an edge, so the edge is measured.
    //
    //     **In the plan frame** — each vertex unleant onto its own foot by
    //     `unplaceFromSphere`, the inverse of `placeOnSphere`. The radius is
    //     compared against plan `(x, z)` by everything that reads it (a tree's
    //     foot, a lamp's, a path's centreline), and a drawn point is above the
    //     foot its up-line meets, so that foot is the honest place to measure.
    //     World `x, z` would read the lean itself as reach: a 15 m turret 40 m
    //     out on a 220 m sphere leans ~2.7 m in world XZ.
    //
    //     `measured` is rounded **up** to the centimetre, so any overrun at all
    //     is non-zero: rounding to the decimetre let an overrun under 5 cm read
    //     as 0.0 and pass a zero allowance.
    const vertex = new Vector3();
    const instance = new Matrix4();
    const combined = new Matrix4();
    const foot = new Vector3();
    for (const anchor of ANCHORS) {
      const group = park.scene.getObjectByName(anchorGroupName(anchor.id));
      if (!group) continue;
      group.updateMatrixWorld(true);
      const [cx, cz] = anchor.position;
      let reach = 0;
      let atX = cx;
      let atZ = cz;
      let atName = '';
      group.traverse((object) => {
        const mesh = object as import('three').Mesh & { count?: number; isInstancedMesh?: boolean };
        if (!mesh.isMesh || !mesh.geometry) return;
        for (let up: import('three').Object3D | null = mesh; up && up !== group; up = up.parent) {
          if (!up.visible) return;
        }
        const positions = mesh.geometry.getAttribute('position');
        if (!positions) return;
        const instances = mesh.isInstancedMesh ? (mesh.count ?? 0) : 1;
        for (let i = 0; i < instances; i += 1) {
          if (mesh.isInstancedMesh) {
            (mesh as unknown as import('three').InstancedMesh).getMatrixAt(i, instance);
            combined.multiplyMatrices(mesh.matrixWorld, instance);
          } else {
            combined.copy(mesh.matrixWorld);
          }
          for (let k = 0; k < positions.count; k += 1) {
            vertex.fromBufferAttribute(positions, k).applyMatrix4(combined);
            unplaceFromSphere(vertex, foot);
            const distance = Math.hypot(foot.x - cx, foot.z - cz);
            if (distance > reach) {
              reach = distance;
              atX = foot.x;
              atZ = foot.z;
              atName = mesh.name || mesh.parent?.name || '(unnamed)';
            }
          }
        }
      });
      if (reach > anchor.boundingRadius) {
        report({
          invariant: 6,
          key: `anchor.reach:${anchor.id}`,
          measured: Math.ceil((reach - anchor.boundingRadius) * 100) / 100,
          detail:
            `'${anchor.id}' declares a bounding radius of ${anchor.boundingRadius.toFixed(2)} m but its drawn ` +
            `'${atName}' reaches ${reach.toFixed(2)} m, at plan (${atX.toFixed(1)}, ${atZ.toFixed(1)}) — everything ` +
            'that routes or scatters around this anchor is planning around the smaller number',
        });
      }
      table.push(
        `  anchor:${anchor.id.padEnd(16)} declares ${anchor.boundingRadius.toFixed(2).padStart(6)} m, ` +
          `drawn out to ${reach.toFixed(2)} m ('${atName}')`,
      );
    }

    // (c) Nothing scattered park-wide may stand in a reserved plot.
    //
    //     This is `dressing.ts`'s rejection sampling, generalised: a bench may
    //     not land in a stairwell, and a tree may not land in the ferris wheel.
    //     Both of these builders say in so many words that they keep out —
    //     "scenery scattering avoids `boundingRadius` so nobody plants a tree
    //     inside the ferris wheel" (`anchors.ts`), and `LampPosts` is built early
    //     "so it only needs the static ANCHORS list ... to keep its lamps out of
    //     the reserved ride footprints" (`World.ts`) — and neither claim was ever
    //     checked. The list is of *builders*, taken as fields off `World`, so a
    //     name that stops existing is a compile error rather than a silent gap.
    //
    //     The stalls, the fountain, the fairy lights and the train are
    //     deliberately not in it: each is placed against the plots rather than
    //     away from them (the ferris-wheel kiosk stands in the ferris wheel's
    //     plot on purpose), so "keeps out" was never their contract to keep.
    const scatterers: readonly (readonly [string, import('three').Object3D])[] = [
      ['scenery', world.scenery.group],
      ['lampPosts', world.lampPosts.group],
    ];

    for (const [name, group] of scatterers) {
      const offenders = new Map<string, number>();
      for (const lump of lumpsUnder(group)) {
        for (const plot of footprints) {
          // The lump's *centre* rather than its extent: a canopy may legitimately
          // overhang a plot edge, and only a thing actually standing in the plot
          // has taken up room the ride will need.
          if (plot.distance(lump.x, lump.z) < 0) {
            offenders.set(plot.id, (offenders.get(plot.id) ?? 0) + 1);
          }
        }
      }
      for (const [plot, count] of offenders) {
        report({
          invariant: 6,
          key: 'anchor.trespass',
          measured: count,
          detail: `${count} thing(s) built by '${name}' stand inside the reserved '${plot}' plot`,
        });
      }
    }
  }

  // ------------------------------- 3b. no finish-rainbow leg stands in the way
  //
  // `test:procgen`'s `finishRainbowStandsOnTheGround` asks this on its five seeds;
  // this asks it on **every seed this script is run for** — which, through
  // `check:every-seed-builds`, is the sixteen-seed sweep. Seed 6 drew
  // `spur-exit-railRace` 0.08 m from a race-ring leg and nothing saw it, because
  // seed 6 is not a procgen seed. Measured off the **drawn** legs (their world
  // position) against the drawn paving (`distanceToPath`, the ribbon's own edge),
  // with the game's bar: `WALKABLE_GAP`, two player radii.
  {
    const legPosition = new Vector3();
    let legs = 0;
    let closest = Infinity;
    for (const groupName of ['railRace:race-ring', 'railRace:walk-past-ring']) {
      const group = world.railRace.group.getObjectByName(groupName);
      if (!group) continue;
      group.updateMatrixWorld(true);
      group.traverse((child) => {
        if (!/^railRace:finish-rainbow-leg-\d+-(inner|outer)$/.test(child.name)) return;
        legs += 1;
        child.getWorldPosition(legPosition);
        const gap = distanceToPath(legPosition.x, legPosition.z);
        closest = Math.min(closest, gap);
        if (gap < WALKABLE_GAP) {
          report({
            invariant: 3,
            key: 'rainbow.inPath',
            measured: 1,
            detail:
              `${child.name} (${groupName}) stands ${gap.toFixed(2)} m from paving at ` +
              `(${legPosition.x.toFixed(1)}, ${legPosition.z.toFixed(1)}) — a child needs ${WALKABLE_GAP.toFixed(2)} m to walk past`,
          });
        }
      });
    }
    table.push(`rainbow legs: ${legs} drawn, closest to paving ${closest.toFixed(2)} m`);
    if (legs === 0) {
      process.stderr.write('check:park rainbow.inPath: no finish-rainbow legs drawn on this seed — the clause asserted nothing\n');
    }
  }

  // ------------------------------------------------------------------- summary

  const elapsed = performance.now() - started;

  /** Worst measurement seen per ratchet key, so a repeat offender adds up. */
  const measured = new Map<string, number>();
  for (const finding of findings) {
    measured.set(finding.key, (measured.get(finding.key) ?? 0) + finding.measured);
  }

  // Hard invariants always fail; the drift table is canonical-park-specific,
  // so a seed sweep (LGP_RATCHET=off) reports drift without failing on it.
  // In sweep mode (LGP_RATCHET=off) the NPC-coverage keys are soft too: a
  // stranded waypoint is pruned at boot and the children skip it — a candidate
  // seed with two pruned waypoints is a playable park the family may still
  // prefer. The canonical park is held to all of them.
  const HARD_KEYS = new Set(
    ratchetEnforced
      ? ['route.unreachable', 'route.crossesRail', 'poi.nospot', 'poi.stranded', 'poi.split', 'boot.asserts', 'layout.falseRefusal', 'rainbow.inPath']
      : ['route.unreachable', 'route.crossesRail', 'boot.asserts', 'layout.falseRefusal', 'rainbow.inPath'],
  );
  const regressions: string[] = [];
  const drift: string[] = [];
  for (const [key, amount] of measured) {
    const recorded = RATCHET[key];
    const line = !recorded
      ? `${key}: ${amount} (no allowance — this is new)`
      : amount > recorded.worst
        ? `${key}: ${amount}, recorded at ${recorded.worst} — it has got worse`
        : null;
    if (!line) continue;
    if (ratchetEnforced || HARD_KEYS.has(key)) regressions.push(line);
    else drift.push(line);
  }

  const loose: string[] = [];
  for (const key of Object.keys(RATCHET)) {
    const amount = measured.get(key) ?? 0;
    if (amount < (RATCHET[key]?.worst ?? 0)) {
      loose.push(`${key}: recorded ${RATCHET[key]?.worst}, now ${amount}`);
    }
  }

  /**
   * The one deviation worth a line of its own: whichever open allowance is the
   * largest fraction of what the invariant would ideally be.
   *
   * A fraction rather than a raw figure, because the units are not comparable —
   * 231 m of unfenced railway and one walled-in ferris wheel cannot be sorted
   * against each other by size. Both are compared against their own recorded
   * worst, so the line names the thing that is furthest from being fixed.
   */
  let worst = { key: '', share: -1, count: 0, amount: 0 };
  for (const [key, amount] of measured) {
    const share = amount / (RATCHET[key]?.worst || amount || 1);
    const count = findings.filter((finding) => finding.key === key).length;
    const better =
      share > worst.share ||
      (share === worst.share && (count > worst.count || (count === worst.count && amount > worst.amount)));
    if (better) worst = { key, share, count, amount };
  }
  const worstDetail = findings.find((finding) => finding.key === worst.key)?.detail ?? '';
  const summary =
    `check:park: ${routed}/${targets.length} attractions route from the entrance, ` +
    `${crossingsTotal} rail crossing(s), ` +
    `${graph.nodes.length - stranded.length}/${SEEDS.length} waypoints connected`;
  return { findings, table, regressions, loose, drift, measured, worst, worstDetail, summary, elapsedMs: elapsed };
}
