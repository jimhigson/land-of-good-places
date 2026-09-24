import { ENTRANCE_GATE_X, ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../../src/world/entrance/layout';
import { BOUNDARY_CLEARANCE, GATE_CORRIDOR_HALF_WIDTH, PARK_MANIFEST, PARK_SEED, type ManifestEntry } from '../../src/world/parkManifest';
import { type AnchorFootprint } from '../../src/world/anchors';
import { BUILDING_CENTRE_NUDGE, CAMERA_FACING_YAW, CASTLE_TURRET_BASE_RADIUS, CASTLE_TURRET_CORNERS, PLAYER_RADIUS } from '../../src/core/constants';
import { layoutRestartBase, layoutStreamBump } from './parkWarp';
import { NAV_CELL, NavGrid, STAND_SEARCH_REACH, type ReachSet } from '../../src/world/NavGrid';
import { ARRIVAL_EXEMPT_NEAR } from '../../src/world/streetRules';
import { CollisionWorld } from '../../src/world/Collision';
import { PARK_BOUNDARY } from '../../src/world/boundary';
import { Rng, TAU, candidateRng, hashString } from '../../src/core/mathUtils';
import { RING_PLOT_CLEARANCE, RING_RADIUS, columnsOf, counterFacing, exceptIndices, ignoredRefusals, plots, shortlistFor, traceLine, type LayoutRefusal, type LayoutRestartOutcome, type ParkLayout, type PlacedEntry, type PlotColumns } from '../../src/world/parkLayout';
/**
 * **The park layout's search** — the plot placer with its restarts, doormat
 * rung and validation. Moved verbatim from `src/world/parkLayout.ts`, which
 * keeps the layout's types and views. Build-time only
 * (`docs/design/PREBUILT-PARKS.md`).
 */

/** Walkable clearance kept between any two plots' bounding circles. */
const CORRIDOR_GAP = 5;


/** Candidate draws per entry before this whole-park attempt is abandoned. */
const MAX_TRIES = 3000;


/**
 * How many *valid* candidates an entry collects before choosing between
 * them. The choice is maximin — the candidate whose nearest already-placed
 * neighbour is furthest — which is what "distribute things evenly" cashes
 * out to without reserving an inch of space: a preference over legal spots,
 * never a claim on ground (Decision 6). Twelve is enough that the winner is
 * usually in a genuinely different pocket from the loser, and small enough
 * that a squeezed entry (whose valid pockets are few) still places fast.
 */
const SPREAD_CHOICES = 12;


/**
 * The gate sits on the boundary wall; the corridor runs from it to centre.
 *
 * **Read from `entrance/layout.ts`, never restated.** These were
 * `Math.PI / 2` and `60` written out here with the comments "matches
 * entrance/layout.ts ENTRANCE_ANGLE" and "matches ENTRANCE_WALL_RADIUS" —
 * a promise that two numbers agree, which is not a mechanism, and which
 * CLAUDE.md names as the most common bug in this repo by a distance. Found
 * while fixing #481; nothing had drifted yet, and that is exactly when it is
 * cheap to fix.
 */

function inGateCorridor(x: number, z: number, clearance: number): boolean {
  // The corridor is the short axis-aligned strip inside the gate (which sits
  // at `ENTRANCE_ANGLE`, i.e. +Z on the boundary wall). Only the strip
  // itself must stay clear — from its mouth the approach *path* winds to
  // wherever the plaza was placed, around whatever stands in between, and
  // `check:park`'s routing invariant proves that walk exists.
  const gateX = ENTRANCE_GATE_X;
  const corridorHalf = GATE_CORRIDOR_HALF_WIDTH + clearance;
  return Math.abs(x - gateX) < corridorHalf && z > 25;
}


/**
 * How far a plot's edge lies from its centre along a direction.
 *
 * Exported for `paths.ts`'s `spur()`, which needs the same answer to keep a
 * spur's "past the doormat" extension from overshooting into the plot it is
 * approaching — see the fix note there.
 */
export function edgeDistanceAlong(footprint: AnchorFootprint, dirX: number, dirZ: number): number {
  // How far the plot's edge lies from its centre along (dirX, dirZ).
  if (footprint.kind === 'circle') return footprint.radius;
  const ax = Math.abs(dirX);
  const az = Math.abs(dirZ);
  // Distance to the rectangle's boundary along the direction, in the plot's
  // own (unrotated) frame — plots are axis-aligned, as they always were.
  const tx = ax > 1e-6 ? footprint.halfX / ax : Infinity;
  const tz = az > 1e-6 ? footprint.halfZ / az : Infinity;
  let edge = Math.min(tx, tz);

  // **Corner solids reach past the rectangle, so they are asked too** — the
  // castle's turrets (#549). For each disc, how far along the ray its far
  // surface lies: the standard ray-circle exit distance, `Infinity` discarded
  // where the ray misses the disc entirely. Taking the max keeps this exactly
  // the rectangle's answer for every plot that has no corners declared.
  if (footprint.corners) {
    const { radius } = footprint.corners;
    for (const [cx, cz] of footprint.corners.at) {
      const along = cx * dirX + cz * dirZ;
      const perpendicularSquared = cx * cx + cz * cz - along * along;
      const halfChordSquared = radius * radius - perpendicularSquared;
      if (halfChordSquared <= 0) continue; // the ray misses this corner
      edge = Math.max(edge, along + Math.sqrt(halfChordSquared));
    }
  }
  return edge;
}


/**
 * **The footprint a plot actually occupies once it has been placed.**
 *
 * For everything but the castle this is the authored footprint unchanged.
 *
 * The castle is different, and issue #549 is what the difference cost. Its four
 * corner turrets stand outside the footprint rectangle, so a rectangle cannot
 * say where the castle reaches — and *everything* that asked got the same wrong
 * answer: the collision world did not know the turrets were there (a child
 * walked through them), and neither did this solver, so on three of the sixteen
 * pool seeds it put the castle's own doormat and path spur inside one.
 *
 * The turrets cannot simply be declared on the authored footprint, because the
 * drawn castle is **not centred on its plot**: `building/layout.ts` nudges it
 * {@link BUILDING_CENTRE_NUDGE} towards the park middle so every interior
 * corner stays inside `GARDEN_PLAY_RADIUS`. That direction is a function of
 * where the plot landed, so it is only knowable here, at placement — which is
 * exactly why this is the right place to resolve it, and why a static entry in
 * `parkManifest.ts` could not.
 *
 * Writing the discs into the **placed** footprint gives one owner for "how far
 * does the castle reach": `PlacedEntry.footprint` is what both consumers of
 * `edgeDistanceAlong` already read — the entrance placement below, and the path
 * spur's target in `paths.ts` — so neither had to learn about turrets, and they
 * cannot disagree.
 */
function footprintAsPlaced(entry: ManifestEntry, x: number, z: number): AnchorFootprint {
  if (entry.id !== 'building' || entry.footprint.kind !== 'rect') return entry.footprint;
  // The same nudge `building/layout.ts` applies: towards the park middle.
  const length = Math.hypot(x, z) || 1;
  const offsetX = -(x / length) * BUILDING_CENTRE_NUDGE;
  const offsetZ = -(z / length) * BUILDING_CENTRE_NUDGE;
  return {
    kind: 'rect',
    halfX: entry.footprint.halfX,
    halfZ: entry.footprint.halfZ,
    corners: {
      at: CASTLE_TURRET_CORNERS.map(
        ([cx, cz]) => [cx + offsetX, cz + offsetZ] as readonly [number, number],
      ),
      radius: CASTLE_TURRET_BASE_RADIUS,
    },
  };
}


/**
 * **One restart of the layout solve** — the layout's own rungs (redraw the
 * refused entry, then its blockers) run inside it; when they are spent the
 * restart is refused and the caller (the park's backtracking driver,
 * `parkPlan.ts`) draws the next one. This is decision zero: each restart is a
 * different park from the same seed.
 */
export function solveLayoutRestart(restart: number): LayoutRestartOutcome {
  const steps = layoutRestartSearch(restart);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}


/** The same solve, yielding once per candidate draw so a boot can stop between frames. */
export function* layoutRestartSearch(restart: number): Generator<number, LayoutRestartOutcome, void> {
  const base = layoutRestartBase();
  let rungOneFired = 0;
  const attempts = new Map<string, number>();
  for (;;) {
    const outcome = yield* buildOnce(restart, attempts);
    if (outcome.kind === 'dead-end') {
      traceLine(`dead-end restart=${restart} entry=${outcome.entry} draws=${MAX_TRIES}`);
      return { kind: 'refused', reason: `entry ${outcome.entry} drew no legal candidate in ${MAX_TRIES} draws` };
    }
    if (outcome.kind === 'exhausted') {
      traceLine(`exhausted restart=${restart} entry=${outcome.entry} supply=${outcome.supply}`);
      return { kind: 'refused', reason: `entry ${outcome.entry} exhausted its ${outcome.supply} candidates` };
    }
    // Its own piece: probing fourteen doormats' reachability is tens of
    // milliseconds, and it sat in the same step as the last candidate draw.
    yield 0;
    const refusals = yield* doormatRefusalsSearch(outcome.placed);
    yield 0;
    if (refusals.length > 0 && rungDisabled()) {
      for (const refusal of refusals) {
        ignoredRefusals.push(refusal);
        traceLine(
          `refusal-ignored (LGP_LAYOUT_RUNG=off) restart=${restart} kind=${refusal.kind} entry=${refusal.entry} ` +
            `blockers=${refusal.blockers.join(',') || '-'} at=${refusal.at.x.toFixed(1)},${refusal.at.z.toFixed(1)}`,
        );
      }
    }
    if (refusals.length === 0 || rungDisabled()) {
      traceLine(
        `solved restart=${restart} decision-zero-reached=${restart - base} ` +
          `rung-1-fired=${rungOneFired} doormats=${outcome.placed.length}/${outcome.placed.length} ` +
          `probed-alone=${lastProbedAlone}`,
      );
      if (rungOneFired === 0) {
        traceLine(`rung-1 never fired: every doormat reachable at layout time on the first draw`);
      }
      return { kind: 'layout', layout: outcome.layout };
    }
    const refusal = refusals[0] as LayoutRefusal;
    traceLine(
      `refusal restart=${restart} kind=${refusal.kind} entry=${refusal.entry} ` +
        `attempt=${attempts.get(refusal.entry) ?? 0} blockers=${refusal.blockers.join(',') || '-'} ` +
        `non-plot=${refusal.nonPlotBlockers.join(',') || '-'} at=${refusal.at.x.toFixed(1)},${refusal.at.z.toFixed(1)}`,
    );
    rungOneFired += 1;
    if (redraw(refusal.entry, attempts, outcome.supply, restart, 1)) continue;
    const placementIndex = new Map(outcome.placed.map((entry, index) => [entry.id, index]));
    const blockers = [...refusal.blockers].sort(
      (a, b) => (placementIndex.get(b) ?? -1) - (placementIndex.get(a) ?? -1),
    );
    if (blockers.some((blocker) => redraw(blocker, attempts, outcome.supply, restart, 2))) continue;
    traceLine(`decision-zero restart=${restart} after=${refusal.entry} — no attempt left on it or its blockers`);
    return {
      kind: 'refused',
      reason: `doormat of ${refusal.entry} unreachable (blockers ${refusal.blockers.join(',') || '-'}) and no attempt left on it or its blockers`,
    };
  }
}


function redraw(
  entry: string,
  attempts: Map<string, number>,
  supply: ReadonlyMap<string, number>,
  restart: number,
  rung: 1 | 2,
): boolean {
  const next = (attempts.get(entry) ?? 0) + 1;
  const have = supply.get(entry) ?? 0;
  if (next >= have) return false;
  attempts.set(entry, next);
  traceLine(`redraw restart=${restart} rung=${rung} entry=${entry} attempt=${next} of=${have}`);
  return true;
}


/**
 * **Can a child reach every doormat, on the park as it stands at this
 * moment?** — plots and the boundary, which is everything the layout has
 * decided. Asked of `NavGrid`, the grid the children walk, flooded from the
 * entrance (the one thing that never moves) exactly as `PoiGraph` asks it
 * once the park is built — one question, one owner, so the two cannot
 * disagree about the same door. One lattice and one flood for the whole
 * park when no door is refused (~8 ms, the layout stage's `check:solve-cost`
 * budget is 250 ms); a door that fails that shared world gets its own —
 * see the body for why a pass on the shared world is a pass on the door's.
 *
 * Exploration with the commit's own function on a partial world: the paths'
 * later commit is the check, and a stranding it finds that this could not —
 * a lane laid on the railway, a spur through a bridge's side — is the next
 * rung's, named there by coordinate. What this sees, this answers, by
 * redrawing a plot rather than moving anything to satisfy a measurement.
 *
 * `LGP_LAYOUT_REFUSE=<id>[:<n>|always]` forces that entry's next `n` probes
 * to be refused — the red proof that the ladder above moves. **The hook's
 * text ships** (it is in `dist/assets/parkLayout-*.js`); what makes it inert
 * for a player is that nothing in the bundle defines a `process` global and
 * the read is `globalThis.process?.env?.[…]` under a `try`, so it resolves to
 * `null` — exactly as `paths.ts`'s `LGP_DEBUG_STREETS` and `parkWarp.ts`'s
 * `LGP_WARP`. Anything that ever introduces a `process` global in the browser
 * would arm every one of these hooks at once; that is the thing to check for.
 */
function doormatRefusals(placed: readonly PlacedEntry[]): LayoutRefusal[] {
  const steps = doormatRefusalsSearch(placed);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}


/** The same probe, one piece for the grid and one per doormat — it was the boot's 52 ms step. */
function* doormatRefusalsSearch(placed: readonly PlacedEntry[]): Generator<number, LayoutRefusal[], void> {
  const forced = forcedRefusal();
  const columns = columnsOf(placed);
  const flat = (): number => 0;
  const refusals: LayoutRefusal[] = [];
  // **One world for the common case, then one per door that needs it.** Each
  // door's own world (below) differs from every other's only in which plots
  // are exempt near it, and the lattice-and-flood over the whole park is the
  // entire cost of asking (~8 ms here; profiled 6 Sep 2026: 14 doors x their
  // own flood was 112 of the layout stage's 117 ms, on a seed where no door
  // was refused). So every door is first asked on the STRICTEST world any
  // door sees — every plot but the fountain, plus the boundary. A door whose
  // doormat stands, reachably, with every plot solid still stands with fewer
  // of them (taking obstacles out of a `CollisionWorld` only grows NavGrid's
  // free and reached cells), so a pass here is a pass on its own world and
  // needs no second look. A door that fails here is asked again on its own
  // world, exactly as before — the refusal, and what it names, come only
  // from that world, never from this one. The trace's `probed-alone` count
  // is how many took the second look.
  const strict = yield* strictGridSearch(placed);
  let probedAlone = 0;
  for (const entry of placed) {
    yield 0;
    const forcedHere = forced !== null && forced.entry === entry.id && forced.remaining > 0;
    if (!forcedHere && strict && standsReachably(strict.grid, strict.reachable, entry, flat)) continue;
    probedAlone += 1;
    // **What this world may contain, and the principle behind it.** The probe
    // explores an OVER-APPROXIMATE world: a footprint is where a plot is
    // placed, not ground a child cannot stand on. The ball pit's footprint is
    // walkable — the slide exits into it, and the castle's doormat stands
    // inside it by design (the near pair). Seed 1, 6 Sep 2026: a probe that
    // counted every footprint as solid refused that door as `nospot`, redrew
    // the castle, and broke a seed the built park had been building (its
    // real spot was 0.07 m from the door, the only real collider 1.30 m
    // clear). So this world holds exactly the plots the router itself would
    // refuse to draw an arriving stub past — every plot but those within
    // {@link ARRIVAL_EXEMPT_NEAR} of this door (the router's own arrival
    // exemption, one owner in `streetRules.ts`) and the door's own — plus the
    // boundary. A refusal here is one the paths' commit would make too;
    // anything else is the commit's to find, and `check:park`'s
    // `layout.falseRefusal` proves every refusal against the built park.
    const world = worldForDoor(entry, placed);
    // A flat park (nothing here has a height yet) and no hop: a plot's
    // footprint is not something a child hops, so the apex is moot and the
    // player's own figure would only mean importing `Player` into the layout.
    const grid = new NavGrid(world, PLAYER_RADIUS, 0);
    const reachable = grid.reachableFrom(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z, 0, flat);
    if (!reachable) {
      // A plot over the entrance is forbidden by `inGateCorridor`, so this is
      // a programming error, not a park.
      throw new Error(
        `park layout: nowhere to stand at the entrance (${ENTRANCE_PLAYER_X}, ${ENTRANCE_PLAYER_Z}) ` +
          'on the plots-and-boundary world — the gate corridor rule should make this impossible',
      );
    }
    const spot = grid.nearestStandable(
      entry.entranceX,
      entry.entranceZ,
      0,
      flat,
      STAND_SEARCH_REACH,
      reachable,
    );
    if (spot && reachable(spot.x, spot.z, spot.y) && !forcedHere) continue;
    if (forcedHere && forced) {
      // The test hook: the door is in fact reachable, so its pocket is the
      // whole park and naming that would be noise. It names the plot nearest
      // the door as a pretend blocker instead — enough for rung 2 to be
      // watched moving — and says so, so no trace reads it as geometry.
      forced.remaining -= 1;
      refusals.push({
        kind: 'poi.stranded',
        entry: entry.id,
        blockers: nearestPlot(entry.entranceX, entry.entranceZ, columns, entry.id),
        nonPlotBlockers: ['forced'],
        at: { x: entry.entranceX, z: entry.entranceZ },
      });
      continue;
    }
    // What boxes the door in, derived from the geometry that does it:
    // - nowhere to stand (`nospot`): the plots whose stamped footprints
    //   cover the door, and the boundary if the door is within a walker of it;
    // - somewhere to stand but no way there (`stranded`): flood the pocket
    //   from that spot and name whatever bounds it — every plot the pocket
    //   presses against, the boundary if the pocket reaches it. A plot twelve
    //   metres off that closes the box is named exactly as one on the door.
    // Only plots this door's world holds can be named: an exempt plot was
    // never an obstacle to it.
    const exempt = exemptFor(entry, placed);
    const named = spot
      ? pocketBlockers(grid.floodFrom(spot.x, spot.z, spot.y, flat), columns, entry.id, exempt)
      : coveringBlockers(entry.entranceX, entry.entranceZ, columns, entry.id, exempt);
    refusals.push({
      kind: spot ? 'poi.stranded' : 'poi.nospot',
      entry: entry.id,
      blockers: named.plots,
      nonPlotBlockers: named.boundary ? ['boundary'] : [],
      at: { x: entry.entranceX, z: entry.entranceZ },
    });
  }
  lastProbedAlone = probedAlone;
  return refusals;
}


/** How many doors the last {@link doormatRefusals} had to probe on their own
 * world — for the trace, so the shared world's coverage is said out loud. */
let lastProbedAlone = 0;


/**
 * Does `door`'s doormat have somewhere to stand that the entrance reaches, on
 * `grid`? The same two questions the per-door probe asks, on whatever world
 * `grid` was built over. Only ever a "yes" on the strict world: a "no" there
 * is not a refusal, it is the cue to ask again on the door's own world.
 */
function standsReachably(
  grid: NavGrid,
  reachable: (x: number, z: number, y: number) => boolean,
  door: PlacedEntry,
  flat: () => number,
): boolean {
  const spot = grid.nearestStandable(door.entranceX, door.entranceZ, 0, flat, STAND_SEARCH_REACH, reachable);
  return spot !== null && reachable(spot.x, spot.z, spot.y);
}


/**
 * The strictest world any door is probed on — every plot but
 * {@link ALWAYS_EXEMPT}, plus the boundary — with its one flood from the
 * entrance. `null` if the entrance itself has nowhere to stand on it, in
 * which case every door takes the per-door probe, where that is a thrown
 * error rather than a quiet fall-through.
 */
function strictGrid(
  placed: readonly PlacedEntry[],
): { grid: NavGrid; reachable: (x: number, z: number, y: number) => boolean } | null {
  const steps = strictGridSearch(placed);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}


/** {@link strictGrid} in pieces: the plots' world, then the lattice, then the flood a few thousand nodes at a time. */
function* strictGridSearch(
  placed: readonly PlacedEntry[],
): Generator<number, { grid: NavGrid; reachable: (x: number, z: number, y: number) => boolean } | null, void> {
  const world = plotsWorld(placed, ALWAYS_EXEMPT);
  yield 0;
  const grid = new NavGrid(world, PLAYER_RADIUS, 0);
  const reachable = yield* grid.reachableFromSearch(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z, 0, (): number => 0);
  return reachable ? { grid, reachable } : null;
}


/**
 * The plots no door's probe world ever holds: the fountain, whose rim a child
 * hops rather than walks round (`check:fountain-hop`), so its footprint is not
 * a wall. One owner for the strict world ({@link strictGrid}) and every
 * per-door world ({@link exemptFor}) — the fast path rests on the strict world
 * holding a superset of every door's obstacles, and that holds only while
 * both read this set.
 */
const ALWAYS_EXEMPT: ReadonlySet<string> = new Set(['fountain']);


/** The plots `door`'s probe world leaves out: its own, and any the router's
 * arrival exemption would let its stub pass — see {@link doormatRefusals}. */
function exemptFor(door: PlacedEntry, placed: readonly PlacedEntry[]): ReadonlySet<string> {
  const exempt = new Set<string>([door.id, ...ALWAYS_EXEMPT]);
  const columns = columnsOf(placed);
  for (let i = 0; i < columns.count; i += 1) {
    if (footprintWithin(columns, i, door.entranceX, door.entranceZ, ARRIVAL_EXEMPT_NEAR)) {
      exempt.add(columns.ids[i] as string);
    }
  }
  return exempt;
}


/** The plots-and-boundary world one door is probed on. */
function worldForDoor(door: PlacedEntry, placed: readonly PlacedEntry[]): CollisionWorld {
  return plotsWorld(placed, exemptFor(door, placed));
}


/** Every placed plot's footprint but the `exempt` ones, inside the boundary —
 * the one builder behind both the strict world and each door's own. */
function plotsWorld(placed: readonly PlacedEntry[], exempt: ReadonlySet<string>): CollisionWorld {
  const world = new CollisionWorld();
  for (const entry of placed) {
    if (exempt.has(entry.id)) continue;
    if (entry.footprint.kind === 'circle') world.addCircle(entry.x, entry.z, entry.footprint.radius);
    else world.addRectangle(entry.x, entry.z, entry.footprint.halfX, entry.footprint.halfZ);
    // Corner solids past the rectangle — the castle's turrets (#549), declared
    // on the placed footprint by `footprintAsPlaced`.
    if (entry.footprint.kind === 'rect' && entry.footprint.corners) {
      const { radius, at } = entry.footprint.corners;
      for (const [cx, cz] of at) world.addCircle(entry.x + cx, entry.z + cz, radius);
    }
  }
  world.setPlayBounds(PARK_BOUNDARY);
  return world;
}


/**
 * The half-thickness `CollisionWorld.addRectangle` gives a plot's walls,
 * and so the band `NavGrid` stamps round a plot beyond the walker's own
 * radius. Read here so {@link pocketBlockers} samples one cell outside the
 * *stamped* footprint, where a pocket that presses on the plot has cells.
 */
const RECT_WALL_HALF_THICKNESS = 0.35;


/**
 * What bounds a pocket: every plot with a pocket cell just outside its
 * stamped footprint, and the boundary if a pocket cell lies within a
 * walker of it. The plots are read from the same columns every clearance
 * question reads ({@link footprintWithin}), never from a list of things a
 * door tends to hit.
 */
function pocketBlockers(
  pocket: ReachSet | null,
  columns: PlotColumns,
  exceptId: string,
  exempt: ReadonlySet<string> = new Set(),
): { plots: string[]; boundary: boolean } {
  if (!pocket) return { plots: [], boundary: false };
  // One cell past the stamp: the walker's radius (NavGrid fattens every
  // collider by it), a rectangle's wall, and a cell so the sample lands in
  // the first free cell rather than on the stamp's edge.
  const reach = PLAYER_RADIUS + RECT_WALL_HALF_THICKNESS + NAV_CELL;
  const plots: string[] = [];
  let boundary = false;
  pocket.forEachCell((x, z) => {
    if (!boundary && PARK_BOUNDARY.distanceToEdge(x, z) < PLAYER_RADIUS + NAV_CELL) boundary = true;
    for (let i = 0; i < columns.count; i += 1) {
      const id = columns.ids[i] as string;
      if (id === exceptId || ALWAYS_EXEMPT.has(id) || exempt.has(id) || plots.includes(id)) continue;
      if (footprintWithin(columns, i, x, z, reach)) plots.push(id);
    }
  });
  // Placement order, not discovery order: the ladder redraws the most
  // recently placed blocker first, and this keeps the trace's list stable.
  const order = new Map(columns.ids.map((id, index) => [id, index]));
  plots.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return { plots, boundary };
}


/** The plots whose stamped footprints cover `(x, z)` — a `nospot` door's blockers. */
function coveringBlockers(
  x: number,
  z: number,
  columns: PlotColumns,
  exceptId: string,
  exempt: ReadonlySet<string> = new Set(),
): { plots: string[]; boundary: boolean } {
  const reach = PLAYER_RADIUS + RECT_WALL_HALF_THICKNESS;
  const plots: string[] = [];
  for (let i = 0; i < columns.count; i += 1) {
    const id = columns.ids[i] as string;
    if (id === exceptId || ALWAYS_EXEMPT.has(id) || exempt.has(id)) continue;
    if (footprintWithin(columns, i, x, z, reach)) plots.push(id);
  }
  return { plots, boundary: PARK_BOUNDARY.distanceToEdge(x, z) < PLAYER_RADIUS };
}


/** The one plot nearest `(x, z)` by footprint, for the test hook's pretend blocker. */
function nearestPlot(x: number, z: number, columns: PlotColumns, exceptId: string): string[] {
  let best = '';
  let bestReach = Infinity;
  // Widen a margin until the footprint test admits exactly the nearest — a
  // bisection on `footprintWithin` keeps this on the one footprint rule.
  for (let i = 0; i < columns.count; i += 1) {
    const id = columns.ids[i] as string;
    if (id === exceptId || ALWAYS_EXEMPT.has(id)) continue;
    let lo = 0;
    let hi = 400;
    for (let step = 0; step < 24; step += 1) {
      const mid = (lo + hi) / 2;
      if (footprintWithin(columns, i, x, z, mid)) hi = mid;
      else lo = mid;
    }
    if (hi < bestReach) {
      bestReach = hi;
      best = id;
    }
  }
  return best ? [best] : [];
}


/**
 * `LGP_LAYOUT_RUNG=off`: see {@link solve}. Like `LGP_LAYOUT_REFUSE`, its
 * text ships in the bundle; it is inert for a player because nothing in the
 * bundle defines a `process` global and the read is optional-chained —
 * present and disarmed, not absent. Anything that ever introduces a
 * `process` global in the browser arms both hooks at once.
 */
function rungDisabled(): boolean {
  try {
    const nodeProcess = (globalThis as { process?: { env?: Record<string, string> } }).process;
    return nodeProcess?.env?.['LGP_LAYOUT_RUNG'] === 'off';
  } catch {
    return false;
  }
}


/**
 * The `LGP_LAYOUT_REFUSE=<id>[:<count>]` hook, parsed once: refuse `<id>`'s
 * doormat the first `<count>` times it is probed (default 1; `always` for
 * every time). `null` wherever `globalThis.process` is undefined — a browser
 * with no `process` global defined by anything in the bundle, which is the
 * shipped park today (see {@link doormatRefusals}).
 */
function forcedRefusal(): { entry: string; remaining: number } | null {
  return forcedRefusalState;
}

const forcedRefusalState = ((): { entry: string; remaining: number } | null => {
  try {
    const nodeProcess = (globalThis as { process?: { env?: Record<string, string> } }).process;
    const raw = nodeProcess?.env?.['LGP_LAYOUT_REFUSE'];
    if (!raw) return null;
    const [entry, mode] = raw.split(':');
    const remaining = mode === undefined ? 1 : mode === 'always' ? Infinity : Number(mode);
    return { entry: entry ?? '', remaining: Number.isFinite(remaining) || remaining === Infinity ? remaining : 1 };
  } catch {
    return null;
  }
})();


/**
 * The doormat probe, exposed for `scripts/check-layout-rung.mts` to run on a
 * *synthetic* placement — a doormat boxed in by plots that exist only in the
 * check — so the geometry side of the rung is proved red by a check rather
 * than by a transcript that goes stale. Never called by the game outside
 * {@link solve}.
 */
export function probeDoormats(placed: readonly PlacedEntry[]): LayoutRefusal[] {
  return doormatRefusals(placed);
}


/** One candidate position, with the spread score it was chosen on. */
interface Candidate {
  readonly x: number;
  readonly z: number;
  /** Gap to the nearest placed plot's bounding circle, in metres. */
  readonly spread: number;
}


/**
 * What one whole-park attempt came to.
 *
 * - `placed`: every entry stands somewhere legal, with the candidate supply
 *   each one drew (how many further attempts it has, see {@link solve});
 * - `dead-end`: an entry drew no legal candidate at all — the layout is
 *   painted into a corner and the caller takes decision zero;
 * - `exhausted`: the caller asked an entry for a candidate past its supply.
 */
type BuildOutcome =
  | {
      readonly kind: 'placed';
      readonly layout: ParkLayout;
      readonly placed: readonly PlacedEntry[];
      readonly supply: ReadonlyMap<string, number>;
    }
  | { readonly kind: 'dead-end'; readonly entry: string }
  | { readonly kind: 'exhausted'; readonly entry: string; readonly supply: number };


function* buildOnce(restart: number, attempts: ReadonlyMap<string, number>): Generator<number, BuildOutcome, void> {
  const placed: PlacedEntry[] = [];
  const byId = new Map<string, PlacedEntry>();
  const supply = new Map<string, number>();

  // Largest first: the manifest is sorted here rather than trusting file
  // order, so adding an entry never changes packing feasibility by accident.
  const order: ManifestEntry[] = [...PARK_MANIFEST].sort(
    (a, b) => (a.solveOrder ?? 50) - (b.solveOrder ?? 50) || b.boundingRadius - a.boundingRadius,
  );

  for (const entry of order) {
    const near = entry.near ? byId.get(entry.near.id) : undefined;
    if (entry.near && !near) {
      throw new Error(
        `park layout: '${entry.id}' is near '${entry.near.id}', which is not placed yet — ` +
          `the near target must have the larger boundingRadius (it places first)`,
      );
    }

    // This entry's own stream — a pure function of (seed, id, restart), so
    // no other entry's fortunes can move this one's candidates.
    // `layoutStreamBump` is the warp vector's per-entry move: bumping ONE
    // entry's stream index re-draws that entry's candidates while every
    // other entry keeps the stream it had — the per-entry-stream property
    // above is exactly what makes this a local, deterministic mutation.
    const rng = candidateRng(hashString(entry.id) ^ PARK_SEED, restart + layoutStreamBump(entry.id));

    const candidates: Candidate[] = [];
    for (let attempt = 0; attempt < MAX_TRIES && candidates.length < SPREAD_CHOICES; attempt += 1) {
      yield attempt;
      const drawn = drawCandidate(entry, near, rng);
      const valid = validate(entry, near, drawn.x, drawn.z, placed);
      if (valid === null) continue;
      candidates.push({ x: drawn.x, z: drawn.z, spread: valid });
      if (entry.pin) break; // a pin is one candidate, validated
    }

    if (candidates.length === 0) {
      // Dead end; the caller restarts (decision zero). Named, so the trace
      // says which entry could not be placed and how much of its budget went.
      return { kind: 'dead-end', entry: entry.id };
    }

    // Maximin: of the legal spots, the one furthest from its nearest
    // neighbour. Ties keep draw order, which keeps the choice seeded. Ranked
    // rather than picked, because **the ranking is this entry's attempt
    // budget**: attempt `k` (see {@link solve}) takes the k-th best of the
    // candidates it already drew, so the supply of attempts is the supply of
    // legal spots — derived from the search, never a typed "try 5 times".
    // A stable sort by descending spread keeps attempt 0 exactly the old
    // strict-greater-than scan: the first of the equal-best in draw order.
    const ranked = candidates
      .map((candidate, order) => ({ candidate, order }))
      .sort((a, b) => b.candidate.spread - a.candidate.spread || a.order - b.order)
      .map((item) => item.candidate);
    supply.set(entry.id, ranked.length);
    const attempt = attempts.get(entry.id) ?? 0;
    const chosen = ranked[attempt];
    if (!chosen) return { kind: 'exhausted', entry: entry.id, supply: ranked.length };
    const { x, z } = chosen;

    // Entrance: on the plot edge. Camera-facing entries (the stall booths,
    // whose counters obey GAME_DESIGN #16's absolute readability rule) get
    // their doormat on the side the counter actually faces — the same
    // signYaw-derived bearing `stallPlacement.ts` builds the booth with, so
    // the doormat, the stand and the counter are one line by construction.
    // Everything else faces the park middle, the stable thing paths and the
    // camera both live by.
    //
    // Every entry's sign — camera-facing or not — turns to exactly
    // CAMERA_FACING_YAW (issue #269): axis-aligned to the camera's own fixed
    // diagonal, not drawn from `rng`, so there is no per-seed rotation left
    // to call "arbitrary."
    const signYaw = CAMERA_FACING_YAW;
    let dirX: number;
    let dirZ: number;
    if (entry.cameraFacing) {
      const facing = counterFacing(signYaw);
      dirX = Math.sin(facing);
      dirZ = Math.cos(facing);
    } else {
      const towardMiddle = Math.hypot(x, z) > 1e-6 ? [-x, -z] : [0, 1];
      const length = Math.hypot(towardMiddle[0] as number, towardMiddle[1] as number);
      dirX = (towardMiddle[0] as number) / length;
      dirZ = (towardMiddle[1] as number) / length;
    }
    // The placed footprint, not the authored one: for the castle it carries the
    // corner turrets, nudged to where they are actually drawn. Asking the
    // authored rectangle here is what put three seeds' doormats inside a tower.
    const placedFootprint = footprintAsPlaced(entry, x, z);
    const edge = edgeDistanceAlong(placedFootprint, dirX, dirZ);
    const standOff = 1.4; // the sign and the doormat, just clear of the plot
    const entranceX = x + dirX * (edge + standOff);
    const entranceZ = z + dirZ * (edge + standOff);

    const item: PlacedEntry = {
      id: entry.id,
      x,
      z,
      footprint: placedFootprint,
      boundingRadius: entry.boundingRadius,
      entranceX,
      entranceZ,
      signYaw,
    };
    placed.push(item);
    byId.set(entry.id, item);
  }

  const fountain = byId.get('fountain');
  if (!fountain || fountain.footprint.kind !== 'circle') {
    throw new Error(`park layout: the manifest must contain a circular 'fountain'`);
  }

  return {
    kind: 'placed',
    layout: {
      seed: PARK_SEED,
      fountain: { x: fountain.x, z: fountain.z, radius: fountain.footprint.radius },
      entries: byId,
    },
    placed,
    supply,
  };
}


/** One seeded draw for an entry: its pin, its relation ring, or its band. */
function drawCandidate(
  entry: ManifestEntry,
  near: PlacedEntry | undefined,
  rng: Rng,
): { x: number; z: number } {
  if (entry.pin) return { x: entry.pin[0], z: entry.pin[1] };
  if (near && entry.near) {
    // Draw around the relation target; the band still applies afterwards.
    const angle = rng.range(0, TAU);
    const distance = rng.range(entry.near.min, entry.near.max);
    return { x: near.x + Math.cos(angle) * distance, z: near.z + Math.sin(angle) * distance };
  }
  // Area-uniform draw inside the band annulus, capped at the furthest the
  // boundary ever reaches — beyond that a candidate cannot possibly fit, so
  // drawing there only spends tries.
  const angle = rng.range(0, TAU);
  const max = Math.min(entry.band.max, PARK_BOUNDARY.maxRadius);
  const r2min = entry.band.min * entry.band.min;
  const r2max = max * max;
  const radius = Math.sqrt(rng.range(r2min, Math.max(r2min, r2max)));
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}


/**
 * Every constraint on one candidate, or `null` if any fails. On success,
 * returns the spread score (gap to the nearest placed plot) for maximin.
 * A pinned entry that fails throws instead: a pin must still make a
 * working park.
 */
function validate(
  entry: ManifestEntry,
  near: PlacedEntry | undefined,
  x: number,
  z: number,
  placed: readonly PlacedEntry[],
): number | null {
  const fail = (reason: string): null => {
    if (entry.pin) {
      throw new Error(
        `park layout: pinned entry '${entry.id}' at [${x}, ${z}] ${reason} — ` +
          `a pin must still make a working park`,
      );
    }
    return null;
  };

  const centreDistance = Math.hypot(x, z);
  if (centreDistance < entry.band.min - 1e-6 || centreDistance > entry.band.max + 1e-6) {
    return fail('leaves its band');
  }

  // The park's real edge, per bearing — the constraint that replaced the
  // 52 m circle (issue #241).
  const edgeGap = PARK_BOUNDARY.distanceToEdge(x, z) - entry.boundingRadius;
  if (edgeGap < BOUNDARY_CLEARANCE) return fail('does not fit inside the boundary');
  if (entry.nearEdge && (edgeGap < entry.nearEdge.min || edgeGap > entry.nearEdge.max)) {
    return fail('misses its nearEdge band');
  }

  if (inGateCorridor(x, z, entry.boundingRadius)) return fail('blocks the gate corridor');

  // Keep every plot's bounding circle clear of the statue ring's annulus —
  // the fountain is solveOrder 0, so it is always already placed when any
  // other entry validates. (The fountain itself is the ring's centre; the
  // ring stands RING_RADIUS outside it by construction, so it needs no
  // check of its own.)
  if (entry.id !== 'fountain') {
    const fountainEntry = placed.find((other) => other.id === 'fountain');
    if (fountainEntry) {
      const ringGap = Math.abs(
        Math.hypot(x - fountainEntry.x, z - fountainEntry.z) - RING_RADIUS,
      );
      if (ringGap < entry.boundingRadius + RING_PLOT_CLEARANCE) {
        return fail('stands in the statue ring');
      }
    }
  }

  let spread = Infinity;
  for (const other of placed) {
    const gap = Math.hypot(x - other.x, z - other.z) - entry.boundingRadius - other.boundingRadius;
    // The near-target pair is deliberately close; its manifest min is the
    // rule. Everyone else keeps a walkable corridor.
    const isNearTarget = near !== undefined && other.id === near.id;
    if (!isNearTarget && gap < CORRIDOR_GAP) return fail(`crowds '${other.id}'`);
    if (gap < spread) spread = gap;
  }
  return spread;
}

function exceptIndex(exceptId: string | undefined): number {
  if (exceptId === undefined) return -1;
  const known = exceptIndices.get(exceptId);
  if (known !== undefined) return known;
  const found = plots().ids.indexOf(exceptId);
  exceptIndices.set(exceptId, found);
  return found;
}


/**
 * Clear of every plot's actual FOOTPRINT (rect or circle) by `margin`.
 *
 * The bounding circle overstates a rectangular plot's corners by metres —
 * fine for spacing, wrong for a ride that deliberately flies close: the Sky
 * Cruiser's station is placed beside the castle on purpose, and testing its
 * low-altitude window against the castle's 19 m circle rejects every pose
 * the near-relation just arranged. The footprint is what is really built.
 */
export function clearOfFootprints(x: number, z: number, margin: number, exceptId?: string): boolean {
  const plot = plots();
  const skip = exceptIndex(exceptId);
  const shortlist = shortlistFor(x, z, margin);
  const count = shortlist ? shortlist.length : plot.count;
  for (let at = 0; at < count; at += 1) {
    const i = shortlist ? (shortlist[at] as number) : at;
    if (i === skip) continue;
    if (footprintWithin(plot, i, x, z, margin)) return false;
  }
  return true;
}


/** Is plot `i`'s footprint within `margin` of `(x, z)`? The one owner of the
 * footprint distance test, for the boolean and the naming form alike. */
function footprintWithin(plot: PlotColumns, i: number, x: number, z: number, margin: number): boolean {
  const px = plot.x;
  const pz = plot.z;
  const hx = plot.halfX;
  const hz = plot.halfZ;
  if (plot.isRect[i] === 0) {
    const reach = (hx[i] as number) + margin;
    // Axis prefilters, exact rather than approximate: `hypot(a, b) >= |a|`,
    // so either axis alone exceeding the reach settles the hypot too.
    const dx = x - (px[i] as number);
    if (dx >= reach || -dx >= reach) return false;
    const dz = z - (pz[i] as number);
    if (dz >= reach || -dz >= reach) return false;
    return Math.hypot(dx, dz) < reach;
  }
  const dx = Math.abs(x - (px[i] as number)) - (hx[i] as number);
  // Same argument on the rectangle: `outside >= max(dx, 0)`, so a `dx` at or
  // past the margin cannot be inside it, and `dx > 0` rules out the
  // both-negative case as well.
  if (dx >= margin) return false;
  const dz = Math.abs(z - (pz[i] as number)) - (hz[i] as number);
  if (dz >= margin) return false;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
  return (dx <= 0 && dz <= 0) || outside < margin;
}
