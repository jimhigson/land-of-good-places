import { CASTLE_OUTER_X, WINDOW_HALF_WIDTH, WINDOW_TRACK_Y, castleClear, castleDeckClearanceAt, crossingBand, insideCastleFootprint } from '../../../src/world/building/cruiserWindow';
import { type RouteBrief, type RouteInfluence, type SolvedRailRoute } from '../../../src/world/rail/generate';
import { lazyView } from '../../../src/boot/lazyView';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from '../../../src/world/building/layout';
import { turnVocabulary, type Pose2, type SegmentKind, type Vec2 } from '../../../src/world/rail/segments';
import { PARK_LAYOUT, clearOfFootprints, placedEntry } from '../../../src/world/parkLayout';
import { Rng, TAU } from '../../../src/core/mathUtils';
import { PARK_BOUNDARY, circleBoundary, insetBoundarySearch, solverBoundary } from '../../../src/world/boundary';
import { PARK_SEED } from '../../../src/world/parkManifest';
import { RailRouteUnsolvable, railRouteSearch } from '../rail/generate';
import { CatmullRomCurve3, Vector3 } from 'three';
import { terrainHeight } from '../../../src/world/terrain';
import { CRUISE_FLOOR, MIN_TURN_RADIUS, STATION_FLAT, STATION_HEIGHT, STATION_RAMP, WINDOW_FLAT, coasterCurve, outsideSpan, tallObstacles, type CoasterBriefPair, type CoasterBriefs, type CoasterProfile, type CoasterRouteOptions, type TallObstacle } from '../../../src/world/coaster/route';
/**
 * **The Sky Cruiser's search** — station poses, route briefs, the retry
 * ladder and the height profile. Moved verbatim from
 * `src/world/coaster/route.ts`, which keeps `CoasterRoute` (built from
 * decisions) and its types. Build-time only (`docs/design/PREBUILT-PARKS.md`).
 */

/**
 * How far out the loop may reach.
 *
 * How far in from the park's edge the loop's territory stops.
 *
 * This was `OUTER_RADIUS = 47`, a circle that stood for "inside the train's
 * band" while the park was a disc. The park is a spline now and the plots
 * spread across all of it (issue #241) — the coaster's own station stall can
 * legally stand past 47 m — so the territory is the park itself, inset far
 * enough that the rim band stays substantially the train's: the train hugs
 * the wall at about 3.35 m in, and this keeps the coaster's *corridor*
 * (which the generator already holds a `corridorRadius` inside its boundary)
 * from camping on the same ground. Crossings still happen and are legal —
 * clearance between the two is vertical, ratcheted by `check:park` — this
 * only keeps the coaster from *running along* the train's lane.
 */
// 4, from 6: measured on seed 2, the pinched side of the spline left the
// loop only FOUR closed routes in four thousand attempts — the annulus
// between the castle band and a 6 m inset simply pinched shut. Two metres
// back buys closure everywhere; the trains-vs-coaster separation was never
// horizontal anyway (crossings are governed vertically, ratcheted).
const RIM_INSET = 4;


/**
 * Half-width kept clear either side of the centre line while solving.
 *
 * This is what the generator *aims* for, deliberately far more than the ride
 * physically needs, so a solved loop has room to breathe rather than shaving
 * past the castle.
 */
const CORRIDOR_RADIUS = 3;


/** How close the loop may come to an earlier part of itself. */
const SELF_CLEARANCE = 5;


/**
 * What the *plan* is held to, which is deliberately more than the ride
 * promises.
 *
 * The generator validates radii on its own cubics, but `CoasterRoute` does not
 * ship those cubics: it resamples them into control points and rebuilds them as
 * a `CatmullRomCurve3`, and **a rebuild is not a copy**. The spline through
 * sampled points sags away from the curve the points came from, and it sags
 * most at the tightest bends — precisely the ones under a limit. Measured
 * across the five CI seeds at the original 3 m control spacing, the rebuild ate
 * between 0.73 m and 1.38 m of radius, and two seeds landed under the 12 m the
 * ride claims: seed 2 at 11.68 m, seed 18 at 10.98 m.
 *
 * That is the same mistake this whole generator replaced. The old solver pushed
 * its control points clear of the castle and then smoothed them, so the built
 * curve did not respect what had been validated. Validating a plan and shipping
 * a rebuild of it is that bug one layer down, in newer code.
 *
 * The fix is both halves, because either alone is thin. {@link CONTROL_SPACING}
 * makes the rebuild faithful, which is the actual cause; this headroom covers
 * what is left, because the loss is not a smooth function of spacing — it
 * depends where a control point happens to fall relative to the tightest bend,
 * so a margin that merely *happens* to hold on today's five seeds is luck, not
 * a guarantee.
 */
const PLAN_TURN_RADIUS = MIN_TURN_RADIUS + 1;


/** Metres of track wanted. The old loop came out at 221 m; this holds that. */
const DESIRED_LENGTH = 220;



/**
 * Roughly this far apart, in metres, along the loop.
 *
 * Two metres rather than the three it started at. This is the half of the
 * turning-radius fix that addresses the cause rather than the symptom: closer
 * control points mean the rebuilt spline tracks the solved plan more closely,
 * which took the worst rebuild loss across the CI seeds from 1.38 m to 0.46 m.
 *
 * Not finer still, because the vertical repair loop below works in control
 * points and starts to get grainy when they are packed tighter than its own
 * scan; two metres keeps the two in step. The rest of the margin is bought by
 * {@link PLAN_TURN_RADIUS} instead.
 */
const CONTROL_SPACING = 2;


/**
 * How far from the middle of a side wall panel a crossing may land.
 *
 * See `building/cruiserWindow.ts`: derived from the tower's own bite out of the
 * panel, the masonry that has to survive beside the opening, and the opening's
 * width — which is itself the car's width plus clearance. Nothing here is a
 * chosen position.
 */
const CROSSING_BAND = crossingBand(WINDOW_HALF_WIDTH);


/**
 * **The Sky Cruiser asks to be drawn through the castle.**
 *
 * The family's ask is that the ride *always* flies through it, and before this
 * it did not: the generator returns the first route that fits, and on one CI
 * seed in five that route simply closed before it got to the castle, leaving a
 * child an ordinary loop and an unbroken building. Nothing was wrong with those
 * routes — nothing had ever asked them for anything.
 *
 * So the ask is made where the choice is made. `weight` is deliberately modest:
 * the score it competes in carries up to 12 m of seeded jitter, and at 0.3 a
 * 40 m detour is worth about the same, which tilts the search without
 * flattening the variety that makes each park its own. The result is a
 * *tendency*; {@link crossesTheCastle} is what turns a tendency into a promise.
 *
 * `radius` is the castle's own outer half-width plus a little, so the pull
 * switches off once the route is at the walls rather than going on tugging it
 * around a building it has already reached.
 *
 * **This reserves nothing** (Decision 6, and Decision 7 which records this
 * mechanism). No space is held for the ride and no opening exists until the
 * built curve is measured; the influence only changes which routes the search
 * is likely to find first.
 */
const CASTLE_INFLUENCE: RouteInfluence = lazyView(() => ({
  name: 'the castle',
  x: BUILDING_CENTRE_X,
  z: BUILDING_CENTRE_Z,
  radius: CASTLE_OUTER_X + 2,
  // 0.55, from 0.3 (issue #241): with the manifest unpinned the booth lands
  // anywhere on its 21-26 m ring around the castle, including bearings where
  // a free solve naturally closes AWAY from the walls — seed 2 exhausted
  // every start pose without one castle crossing at the old weight. Measured
  // across the five CI seeds at 0.55 the backstop still fires (so the weight
  // is not doing the satisfies' job alone), and every seed crosses.
  weight: 0.55,
}));


/**
 * Does this solved plan actually pass through the castle?
 *
 * The backstop behind {@link CASTLE_INFLUENCE}. A weight makes the crossing
 * likely; this is what makes it required — a route that solves without one is
 * discarded and the search moves to the next start pose.
 *
 * It asks the same question `spanInsideCastle` asks of the finished curve, of
 * the plan, which is the only thing that exists at this point. The two
 * parameterisations differ by about 1.5%, which is why the real span is
 * re-measured on the built curve later; for "does it go in at all" the plan is
 * exact enough, and being slightly stricter here is the safe direction.
 */
function crossesTheCastle(candidate: SolvedRailRoute): boolean {
  return (
    spanInsideCastle((d, into) => candidate.pointAt(d, into), candidate.length) !== null
  );
}


/**
 * Metres the profile takes to blend from window height back to the hills.
 *
 * Shorter than the station's 26 m ramp on purpose: the station ramp has to be
 * gentle because riders are boarding at walking pace, whereas this is mid-ride
 * at cruise and a brisker rise and fall *is* the moment — the loop drops to
 * thread the window and climbs away again.
 */
const WINDOW_RAMP = 16;


/** How far outside the castle's footprint the level run starts and ends. */
const CASTLE_SPAN_PAD = 2;


/**
 * The stretch of the solved plan that runs inside the castle, in metres along.
 *
 * `to` may exceed the loop's length, meaning the stretch wraps through the
 * loop's start — which it is perfectly entitled to do, and getting that wrong
 * would silently carve the wrong half of the ride. Found by taking every
 * sample that lands inside the footprint and keeping the complement of the
 * **largest cyclic gap** between them, which is exact for the ordinary case of
 * one visit and degrades sanely to "the whole visit" if a loop ever managed two.
 */
function spanInsideCastle(
  sampleAt: (distance: number, into: Vec2) => void,
  length: number,
): { from: number; to: number } | null {
  const probe: Vec2 = { x: 0, z: 0 };
  const inside: number[] = [];
  for (let d = 0; d < length; d += 0.5) {
    sampleAt(d, probe);
    if (insideCastleFootprint(probe.x, probe.z, CASTLE_SPAN_PAD)) inside.push(d);
  }
  if (inside.length === 0) return null;
  let widestGap = -Infinity;
  let gapAt = 0;
  for (let i = 0; i < inside.length; i += 1) {
    const here = inside[i]!;
    const next = inside[(i + 1) % inside.length]!;
    const gap = i === inside.length - 1 ? next + length - here : next - here;
    if (gap > widestGap) {
      widestGap = gap;
      gapAt = i;
    }
  }
  const from = inside[(gapAt + 1) % inside.length]!;
  const to = inside[gapAt]!;
  return { from: from - 0.5, to: (to >= from ? to : to + length) + 0.5 };
}


/** Is the ground at (x, z) free of every plot? Layout only, no scene. */
function groundClearOfPlots(x: number, z: number, radius: number, exceptId?: string): boolean {
  for (const entry of PARK_LAYOUT.entries.values()) {
    // A station's own booth is the thing it is parked next to, not something
    // to keep away from; the ring the candidate sits on is what keeps the
    // track out of the booth itself.
    if (entry.id === exceptId) continue;
    if (Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + radius) return false;
  }
  return true;
}


/** The pieces the Sky Cruiser is built from. `MIN_TURN_RADIUS` lives here. */
const CRUISER_VOCABULARY: readonly SegmentKind[] = turnVocabulary(
  [
    // Widening these to compensate for the raised floor was tried and made
    // things worse (18 of 21 seeds, against 20 before): the vocabulary is not
    // the binding constraint, and changing it mostly reshuffles which seeds get
    // lucky. The search budget is the lever that actually moved.
    { name: 'tight', minRadius: PLAN_TURN_RADIUS, maxRadius: 18, minLength: 16, maxLength: 28 },
    { name: 'sweep', minRadius: 18, maxRadius: 32, minLength: 22, maxLength: 38 },
    { name: 'easy', minRadius: 32, maxRadius: 60, minLength: 26, maxLength: 46 },
  ],
  { minLength: 22, maxLength: 40 },
);


/**
 * Candidate stations, best first.
 *
 * The station is where the loop **starts and ends**, so choosing it is the
 * outermost level of the generator's search: when no loop can be grown from
 * one station, the next is tried. `train/plan.ts` does the same thing when
 * `clearStationDistance` slides a station along the track until its platform
 * stands on clear ground — a station's position is a thing to search for, not
 * a thing to assume.
 *
 * A candidate only qualifies if the **ground through the station window is
 * clear**. Everywhere else the coaster flies at `CRUISE_FLOOR` and only the two
 * tall obstacles matter, but at the station it is down at 1.1 m, in among the
 * scenery, where every plot is in its way. Putting that constraint on the start
 * pose keeps the plan-view search itself simple and purely horizontal.
 */
/**
 * {@link stationPoses}, as a generator — the same list, built a ring at a time.
 *
 * **Why this needed slicing at all.** The park's edge is a spline now, so
 * `boundary.distanceToEdge` is a real computation rather than a subtraction, and
 * `stationWindowIsClear` asks it seven times for each of 704 candidate spots.
 * Profiled: 17 ms of the brief's 19 ms is that one call. That is one indivisible
 * lump inside a single `advance()` slice during the cat-bus ride, and it
 * overran `check:park-boot`'s ceiling on its own — so it is sliced, exactly like
 * the searches either side of it, rather than the ceiling being moved.
 *
 * A ring is the unit because it is ~1.8 ms: fine enough that no frame hitches,
 * coarse enough that the whole thing costs eleven yields rather than 704.
 *
 * Suspending cannot move the result, by the same argument `rail/generate.ts`
 * makes about its own search: every piece of state here is a local of this
 * function, `rng` is drawn from in exactly the same order whatever cadence the
 * caller advances at, and there is no clock and no shared state to interleave
 * with. {@link stationPoses} drives it straight through, and `check:park-boot`
 * hashes the loop that comes out of both cadences.
 */
/**
 * Candidate spots examined between yields.
 *
 * 8 of the 704 spots, so the driver gets 88 chances to stop. Stated as a count
 * of the job rather than in milliseconds on purpose: the wall-clock cost is the
 * machine's, the granularity is the code's.
 */
const SPOTS_PER_SLICE = 8;


function* stationPoseSearch(
  stallId: string,
  rng: Rng,
  boundary: ReturnType<typeof circleBoundary>,
): Generator<number, Pose2[], void> {
  const stall = placedEntry(stallId);
  const poses: { pose: Pose2; key: number }[] = [];
  // Before the first spot is examined, so the caller's frame is not charged for
  // the boundary inset and the obstacle census its own caller built on the way
  // in. Those are ~4 ms cold, and together with the first ring they measured a
  // 69 ms unbreakable slice at CI's speed.
  yield 0;
  // Beside the booth, not a walk away from it: the old solve put the track
  // about 4.5 m out from the stall, and a station much further than that stops
  // reading as the thing the booth boards. It also has to stay inside the
  // loop's own outer limit, and the cruiser's stall is already 34 m from the
  // middle of the park, so there is not much room to spare on the outward side.
  //
  // Offering plenty of candidates is not generosity, it is the thing that makes
  // this solve at all: a first cut offered six and the search failed on every
  // one. Each is cheap to propose and the search abandons a bad one quickly.
  // A ring was the first unit tried and it is too coarse: 64 spots is ~1.8 ms
  // here and five times that on the hardware CI runs on, so the last ring
  // started before a deadline could overrun it badly. Yielding every
  // {@link SPOTS_PER_SLICE} spots makes the unit small enough that the overrun
  // is bounded by something much smaller than a frame.
  let sinceYield = 0;
  for (let ring = 0; ring < 11; ring += 1) {
    const distance = 5 + ring;
    for (let i = 0; i < 64; i += 1) {
      if (sinceYield >= SPOTS_PER_SLICE) {
        sinceYield = 0;
        // The count is only so a driver can say how far along it is; nothing
        // reads it to make a decision.
        yield poses.length;
      }
      sinceYield += 1;
      const angle = (i / 64) * TAU;
      const x = stall.x + Math.cos(angle) * distance;
      const z = stall.z + Math.sin(angle) * distance;
      // **Asked once per spot, not once per heading.** `stationWindowIsClear`
      // walks `along` from -reach to +reach in even steps — a range symmetric
      // about zero — so reversing the heading probes the *same set of points*
      // and can only return the same answer. Testing both signs was doing the
      // whole 7-sample plot scan twice for a boolean that cannot differ.
      //
      // This is a pure saving and it is load-bearing: the brief is built inside
      // one `advance()` slice during the cat-bus ride, and at ~21 ms it was
      // overrunning `check:park-boot`'s ceiling on its own. Halving it is what
      // brings that frame back under budget without touching a threshold.
      //
      // The `rng` draws are untouched: both signs previously shared one verdict,
      // so they were either both pushed or both skipped, and they still are — in
      // the same order, the same number of times.
      const hxBase = -Math.sin(angle);
      const hzBase = Math.cos(angle);
      if (!stationWindowIsClear({ x, z, hx: hxBase, hz: hzBase }, boundary, stallId)) continue;
      // Two headings per spot: the track may run past the booth either way.
      for (const sign of [1, -1] as const) {
        const hx = hxBase * sign;
        const hz = hzBase * sign;
        const pose: Pose2 = { x, z, hx, hz };
        // Plain seeded shuffle, and it is worth recording what was tried
        // instead, because both alternatives were worse.
        //
        // Ordering the roomiest first — march along the heading, see how far
        // you get, prefer the longest run — was *slower*: the roomiest stations
        // all sit in the same open corner and fail the same way, so the search
        // ground through dozens of near-identical hopeless starts before
        // reaching a genuinely different one.
        //
        // Using that same measurement as a filter was catastrophic: it cut
        // every seed from solvable to unsolvable. A straight line along the
        // heading is a bad predictor of whether a *curved* route can leave the
        // station, and it threw away precisely the stations that work.
        //
        // Diversity beats cleverness here.
        poses.push({ pose, key: rng.unit() });
      }
    }
  }
  poses.sort((a, b) => a.key - b.key);
  return poses.map((entry) => entry.pose);
}


/**
 * Candidate stations, best first, solved start to finish right now.
 *
 * A thin driver over {@link stationPoseSearch} rather than a second copy of it,
 * so "the poses the game offers" and "the poses the loading screen builds a
 * slice at a time" cannot be two different lists — the same relationship
 * `solveRailRoute` has with `railRouteSearch`.
 */
function stationPoses(
  stallId: string,
  rng: Rng,
  boundary: ReturnType<typeof circleBoundary>,
): Pose2[] {
  const search = stationPoseSearch(stallId, rng, boundary);
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}



/**
 * {@link stationWindowIsClear}, asking **the search's own question** — the
 * rescue tier's pose qualification (Decision 10 part 4).
 *
 * The original filter above tests bounding circles at 1.2 m while the search
 * it feeds tests footprints at the corridor radius through its `clear`
 * predicate — two authorities for one question, and both directions of the
 * disagreement cost parks. A pose can pass at 1.2 m and have no legal first
 * piece at 3.6 m (seeds 4, 29 and 30 died of exactly this: eight to fourteen
 * poses offered, sixteen candidate pieces each — one joint, then nothing).
 * And a pose the search could genuinely use can be rejected because a
 * *neighbour's bounding circle* overstates its rectangular footprint by
 * metres, which is how `stationPoses` proposes ~1,408 candidates and throws
 * ~1,400 away.
 *
 * This asks the identical geometry (the same seven window samples) the
 * identical question the search will ask of every low-flying piece: the
 * brief's own `clear` at the brief's own corridor radius, against the brief's
 * own boundary. `distanceAlong` is 0 because every window sample stands for
 * track within {@link STATION_FLAT} + a piece of the ramp — inside the low
 * window at both ends of the loop — so the near-station footprint rule is in
 * force for all of them, exactly as it is for the real first and last pieces.
 *
 * **Why the primary filter is not simply replaced with this** (Decision 10
 * part 3 beats part 4 where they collide): every accepted pose draws
 * `rng.unit()` for its shuffle key, so changing which poses qualify re-rolls
 * the pose ordering and with it every park — including the 48 in 60 that
 * solve today and are byte-identical back to the first baseline. The one
 * truth therefore arrives as a **rescue tier**: seeds the primary pipeline
 * solves never see it, and seeds the primary pipeline kills get the outermost
 * level of their search rebuilt on the honest predicate. See
 * {@link cruiserRouteSearch}.
 */
function stationWindowHasLegalTrack(
  pose: Pose2,
  boundary: ReturnType<typeof circleBoundary>,
  clear: (x: number, z: number, radius: number, distanceAlong: number) => boolean,
): boolean {
  const reach = 6;
  for (let along = -reach; along <= reach; along += 2) {
    const x = pose.x + pose.hx * along;
    const z = pose.z + pose.hz * along;
    if (!clear(x, z, CORRIDOR_RADIUS, 0)) return false;
    if (boundary.distanceToEdge(x, z) < CORRIDOR_RADIUS) return false;
  }
  return true;
}


/**
 * Start poses for the rescue tier: the same rings around the same booth, each
 * candidate qualified by {@link stationWindowHasLegalTrack} — so every pose
 * offered is a pose whose station window the search itself would accept, and
 * the outermost level of the search cannot be starved by a filter answering a
 * different question than the search asks.
 *
 * Its own seeded stream, drawn from nothing else: this list only exists on
 * seeds where the primary tiers already exhausted themselves, so nothing here
 * can perturb a park that solves without it.
 */
function rescueStationPoses(
  stallId: string,
  rng: Rng,
  boundary: ReturnType<typeof circleBoundary>,
  clear: (x: number, z: number, radius: number, distanceAlong: number) => boolean,
): Pose2[] {
  const stall = placedEntry(stallId);
  const poses: { pose: Pose2; key: number }[] = [];
  for (let ring = 0; ring < 11; ring += 1) {
    const distance = 5 + ring;
    for (let i = 0; i < 64; i += 1) {
      const angle = (i / 64) * TAU;
      const x = stall.x + Math.cos(angle) * distance;
      const z = stall.z + Math.sin(angle) * distance;
      const hxBase = -Math.sin(angle);
      const hzBase = Math.cos(angle);
      // One verdict per spot, two headings per qualifying spot, and a plain
      // seeded shuffle — the same shape as the primary pipeline, for the same
      // measured reasons its comments record (roomiest-first ordering was
      // slower, straight-line reachability as a filter was catastrophic;
      // diversity beats cleverness).
      if (!stationWindowHasLegalTrack({ x, z, hx: hxBase, hz: hzBase }, boundary, clear)) {
        continue;
      }
      for (const sign of [1, -1] as const) {
        poses.push({ pose: { x, z, hx: hxBase * sign, hz: hzBase * sign }, key: rng.unit() });
      }
    }
  }
  poses.sort((a, b) => a.key - b.key);
  return poses.map((entry) => entry.pose);
}


/**
 * Is the low, flat run through a candidate station on clear ground?
 *
 * Checked along the pose's heading in both directions: the loop leaves the
 * station along that heading and — because closure matches the tangent —
 * arrives along it too, so a straight line is a fair stand-in for the track
 * either side of the platform.
 */
function stationWindowIsClear(
  pose: Pose2,
  boundary: ReturnType<typeof circleBoundary>,
  ownStallId: string,
): boolean {
  // The platform deck and a little either side — not the whole ramp.
  //
  // This window is the single thing that decides how many stations the search
  // gets to choose from, and it was originally far too greedy. Demanding the
  // full flat plus ramp be clear of every plot asked for 22 m of empty ground
  // in a park whose plots are laid out with 5 m corridors between them: it
  // offered 2 to 24 candidate stations depending on the seed, and four seeds
  // out of five then had no solvable loop from any of them.
  //
  // The deck itself is 6 m long (`plan.ts`), and past it the track is already
  // climbing away, so this is what genuinely has to be standable.
  const reach = 6;
  for (let along = -reach; along <= reach; along += 2) {
    const x = pose.x + pose.hx * along;
    const z = pose.z + pose.hz * along;
    if (!groundClearOfPlots(x, z, 1.2, ownStallId)) return false;
    if (boundary.distanceToEdge(x, z) < CORRIDOR_RADIUS) return false;
  }
  return true;
}


/**
 * **What the Sky Cruiser's search is asked, in one place, for both cadences.**
 *
 * Split out of the constructor so that something which is *not* the module
 * owning `COASTER_PLANS` can build the brief and drive the search a slice at a
 * time — importing that module is precisely what runs the ~0.8 s solve, so the
 * loading screen could not otherwise get at the brief without paying for the
 * thing it is trying to spread out. The same split, for the same reason, as
 * `slide/solve.ts`'s `slideRouteBriefAt`; see `coaster/prewarm.ts` for why the
 * cruiser turned out to need it too.
 *
 * **`rng` is a parameter rather than a local so the two callers can differ in
 * the one way that matters.** `CoasterRoute` passes its own, because
 * `stationPoses` draws from it and the height profile draws next; the
 * pre-warmer omits it and gets a throwaway seeded identically, because it wants
 * the poses and not the stream. Either way `stationPoses` is called exactly
 * once on a freshly seeded `Rng`, so the draw sequence is the same sequence.
 */
export function* coasterRouteBriefSearch(
  options: CoasterRouteOptions,
  rng: Rng = new Rng(PARK_SEED ^ options.salt),
): Generator<number, CoasterBriefs, void> {
  const obstacles = tallObstacles();
  const other = options.avoid ?? null;
  const boundary =
    options.outerRadius !== undefined
      ? circleBoundary(options.outerRadius)
      : // Delegated, so its sixteen slices surface to whoever is driving this.
        // 25 ms in one go was the brief's largest unbreakable block.
        solverBoundary(yield* insetBoundarySearch(PARK_BOUNDARY, RIM_INSET));

  // --- horizontal: the generator solves the plan view --------------------
  const wantedLength = options.desiredLength ?? DESIRED_LENGTH;
  const lowWindow = STATION_FLAT + STATION_RAMP * 0.65;
  const clear = (x: number, z: number, radius: number, distanceAlong: number): boolean => {
    for (let i = 0; i < obstacles.length; i += 1) {
      const tall = obstacles[i] as TallObstacle;
      const reach = tall.radius + radius;
      // The same exact axis prefilter `clearOfPlots` uses: `hypot(a, b) >= |a|`
      // always, so either axis alone being out of reach settles the hypot too.
      // Asked on every sample of every candidate piece, and the three tall
      // obstacles are almost never near the sample being asked about.
      const dx = x - tall.x;
      if (dx >= reach || -dx >= reach) continue;
      const dz = z - tall.z;
      if (dz >= reach || -dz >= reach) continue;
      if (Math.hypot(dx, dz) < reach) return false;
    }
    if (!castleClear(x, z, radius, CROSSING_BAND)) return false;
    if (other) {
      const nearest = other.nearestPoint(x, z);
      if (Math.hypot(nearest.x - x, nearest.z - z) < 5 + radius) return false;
    }
    // The station and its ramps are the one stretch that flies LOW, and the
    // vertical repair may never lift it (a half-lift tilts the boarding
    // deck) — so while the track is below cruise height it must only ever
    // be over open ground: no plot may sit under the ramp. Footprints, not
    // bounding circles, because the near-relation deliberately parks this
    // ride's booth beside the castle and the castle's 19 m circle would
    // reject every pose the relation just arranged. This is what keeps the
    // ramp out of the ball pit's balls and everyone's roofs; the TRAIN
    // dodges the published low corridor itself (train/route.ts), because
    // it solves later and threads intervals — Decision 6's arrow: publish
    // what you solved, the next system treats it as an obstacle.
    // The castle is EXEMPT from the low-ground rule: the booth is parked
    // beside it by the near relation and the ride legally passes through
    // its walls, so pieces near the station are always near the castle —
    // holding them to its footprint made the search reject nearly every
    // early piece and burn its whole restart budget (measured: the solve
    // went 31 s with the blanket rule, 1.1 s without it; the castle's own
    // safety is `castleClear`'s crossing-band rule, checked above, plus
    // the carved pass). Every OTHER plot keeps the rule — a boarding ramp
    // through the ball pit's balls is what it exists to stop (seed 18).
    const nearStation = distanceAlong < lowWindow || distanceAlong > wantedLength - lowWindow;
    if (nearStation && !clearOfFootprints(x, z, radius + 0.6, 'building')) return false;
    return true;
  };
  // Delegated rather than called, so the eleven ring-yields inside it surface
  // to whoever is driving this. The straight-through driver below swallows them.
  const startPoses = yield* stationPoseSearch(options.stationStallId, rng, boundary);
  const brief: RouteBrief = {
    // A stream of its own, so changing how many random draws the height
    // profile takes cannot silently reshape the loop.
    seed: PARK_SEED ^ options.salt ^ 0x5a17,
    vocabulary: CRUISER_VOCABULARY,
    desiredLength: options.desiredLength ?? DESIRED_LENGTH,
    closed: true,
    startPoses,
    clear,
    boundary,
    corridorRadius: CORRIDOR_RADIUS,
    selfClearance: SELF_CLEARANCE,
    minRadius: PLAN_TURN_RADIUS,
    // Enough that the cap is never the thing that gives up (Decision 6:
    // "only bail if backtracking fails for a very large number of tries").
    //
    // `stationPoses` offers 210 candidates on the canonical seed and the
    // search takes index 0, so at 200 this abandoned the last ten for no
    // reason — and the reason it can afford not to is measured, not hoped:
    // `npm run measure:solver-budget` times a deliberately unsolvable brief
    // at **24 ms for 200 attempts, 89 ms for 1000 and 483 ms for 5000**,
    // about 0.1 ms each. A successful solve stops at the first start pose
    // that works, so this costs nothing on a park that works; the whole cost
    // lands on one that does not, and a park that bails is far worse than a
    // park that took a fifth of a second longer to decide it could not.
    budgets: { perJoint: 16, restarts: 2000 },
    // The family asked that the ride always flies through the castle. The
    // influence makes that likely at the decision point; the backstop makes
    // it required. See `CASTLE_INFLUENCE` and `crossesTheCastle`.
    influences: [CASTLE_INFLUENCE],
    satisfies: crossesTheCastle,
  };

    // The escalation valve Decision 7 implies but never built: a weight
    // makes the castle crossing likely, the backstop makes it required —
    // and on a seed where the geometry fights (the booth's bearing, the
    // spread plots), a fixed weight can exhaust every start pose without
    // one crossing. Rather than raise the weight for every park until the
    // hardest seed passes (which makes every OTHER park's loop less free —
    // the cost Decision 7 warns about), the seeds that need more pull are
    // the only ones that pay for it: one re-solve, twice the weight.
  const escalated: RouteBrief = {
    ...brief,
    seed: brief.seed ^ 0xe5ca,
    influences: [{ ...CASTLE_INFLUENCE, weight: CASTLE_INFLUENCE.weight * 2 }],
  };

  // The rescue tier's pair: identical policy, its own seed streams, and start
  // poses qualified by the search's own `clear` — the closures captured here
  // are the very objects the primary brief hands the search, so the rescue
  // cannot drift into asking a third question. See `stationWindowHasLegalTrack`
  // for the whole argument, and `cruiserRouteSearch` for when this runs.
  const rescue = (): CoasterBriefPair => {
    const rescuePoses = rescueStationPoses(
      options.stationStallId,
      new Rng(PARK_SEED ^ options.salt ^ 0x9e5c),
      boundary,
      clear,
    );
    const rescueFirst: RouteBrief = {
      ...brief,
      seed: brief.seed ^ 0x7e5c,
      startPoses: rescuePoses,
    };
    return {
      first: rescueFirst,
      escalated: {
        ...rescueFirst,
        seed: rescueFirst.seed ^ 0xe5ca,
        influences: [{ ...CASTLE_INFLUENCE, weight: CASTLE_INFLUENCE.weight * 2 }],
      },
    };
  };
  return { first: brief, escalated, rescue };
}


/**
 * The briefs, built start to finish right now.
 *
 * The thin driver over {@link coasterRouteBriefSearch}, for every caller that is
 * not spreading the work over frames — `CoasterRoute`'s own constructor, the
 * fingerprint scripts, `check:park`, `test:procgen`. One builder, two cadences.
 */
export function coasterRouteBriefs(
  options: CoasterRouteOptions,
  rng: Rng = new Rng(PARK_SEED ^ options.salt),
): CoasterBriefs {
  const search = coasterRouteBriefSearch(options, rng);
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}


/**
 * **The whole retry policy, in one place, for both cadences.**
 *
 * The constructor and `boot/parkGeneration.ts` used to each walk the
 * first-then-escalated ladder by hand — two writers of one policy, kept in
 * step by a comment ("the same verdict, in the same order") and a hash check.
 * Adding a third tier to both copies is exactly how the two-definitions bug
 * gets written, so the ladder is now this generator and both cadences drive
 * it: the constructor via {@link solveCruiserRoute}, the loading screen a
 * joint at a time. The yielded values are the inner searches' own attempt
 * indices, purely for progress reporting.
 *
 * The tiers, and precisely who reaches each:
 *
 * 1. `first` — unchanged. Every park that solves today takes this (or 2) and
 *    is byte-identical, which is the constraint the whole design serves.
 * 2. `escalated` — unchanged: only if 1 solved without crossing the castle,
 *    and its result is taken whatever it says, exactly as before.
 * 3. `rescue()` — **only where the park previously failed to build at all**:
 *    tier 1 exhausted every pose without one closed route. The same ladder
 *    runs again over poses constructed against the search's own clearance
 *    truth (Decision 10 part 4; see {@link stationWindowHasLegalTrack}).
 *
 * Two lesser rungs fall out of writing the ladder down, both reachable only
 * on parks that today die: an escalated tier that *throws* (rather than
 * merely missing the castle) hands back the lower tier's solved loop instead
 * of failing the park — the search's own belt-and-braces rule, "a park with
 * no coaster is far worse than one whose coaster missed", applied one level
 * up — and a rescue that throws reports **both** failures, because the seed
 * that hits it will be diagnosed from that message alone.
 */
export function* cruiserRouteSearch(
  briefs: CoasterBriefs,
): Generator<number, SolvedRailRoute, void> {
  let plan: SolvedRailRoute | null = null;
  let primaryFailure: RailRouteUnsolvable | null = null;
  try {
    plan = yield* railRouteSearch(briefs.first);
  } catch (error) {
    if (!(error instanceof RailRouteUnsolvable)) throw error;
    primaryFailure = error;
  }
  if (plan) {
    if (plan.report.satisfied) return plan;
    try {
      return yield* railRouteSearch(briefs.escalated);
    } catch (error) {
      if (!(error instanceof RailRouteUnsolvable)) throw error;
      return plan;
    }
  }

  const rescue = briefs.rescue();
  let rescued: SolvedRailRoute;
  try {
    rescued = yield* railRouteSearch(rescue.first);
  } catch (error) {
    if (!(error instanceof RailRouteUnsolvable) || !primaryFailure) throw error;
    throw new RailRouteUnsolvable(
      `${primaryFailure.message} The rescue tier (start poses constructed against the ` +
        `search's own clearance — Decision 10 part 4) then also failed: ${error.message}`,
      error.report,
    );
  }
  if (rescued.report.satisfied) return rescued;
  try {
    return yield* railRouteSearch(rescue.escalated);
  } catch (error) {
    if (!(error instanceof RailRouteUnsolvable)) throw error;
    return rescued;
  }
}


/** {@link cruiserRouteSearch}, driven straight through — the constructor's cadence. */
export function solveCruiserRoute(briefs: CoasterBriefs): SolvedRailRoute {
  const search = cruiserRouteSearch(briefs);
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}


/** `distance` wrapped into [0, length), free of any instance. */
function wrapAround(distance: number, length: number): number {
  let value = distance % length;
  if (value < 0) value += length;
  return value;
}


/**
 * **The loop, finished — a repair pass at a time.**
 *
 * Everything after the plan-view search: the hill profile, the station and
 * castle carves, the vertical repair, and the crest. Lifted out of
 * `CoasterRoute`'s constructor so it can be driven either way, because as one
 * indivisible block it was the single worst frame in the whole park build.
 *
 * Measured: 18.9 ms on an M4 Pro and **54.6 ms in CI**, against a 24 ms ceiling.
 * That is the number CI failed on. It is one block because the repair loop
 * rebuilds the curve ten times and nothing inside it ever yielded.
 *
 * ### Why the prologue and the tail yield too (9 August 2026)
 *
 * The first version yielded **only** inside the repair loop, which left
 * everything before the first pass — sampling the plan, finding the station on
 * it, the hill profile, both carves, and the first build of the curve and its
 * 1600-sample arc-length table — as one indivisible step, and everything after
 * the last pass as another. Profiled a unit at a time (drive `advance(0)` and
 * every loop does exactly one step), that prologue was **6.2 ms cold on an M4
 * Max against an 8 ms frame budget**: by a distance the largest single
 * un-interruptible piece of work in the whole park build, and 2.6x the next
 * one. Scaled by the ~2.4x a GitHub runner measures, it is the 27.6 ms
 * `check:park-boot` went red on (run 31288279104), and on a phone it is a
 * dropped frame in the orbit whatever CI says.
 *
 * It is *cold* that costs: run a second time in the same process the same
 * prologue is 1.1 ms, so most of it is first-execution compilation of this
 * body, `spanInsideCastle`, `terrainHeight` and `CatmullRomCurve3`. A boot is
 * always cold, so the cold number is the real one.
 *
 * The yields below are placed between the phases that already existed rather
 * than inside any of them — each is a natural seam where the next phase reads
 * only what the previous one finished writing.
 *
 * Suspending cannot move the result, by the same argument the searches make:
 * every piece of state is a local of this function, the single `rng` draw
 * (`hillPhase`) happens before the first yield, and there is no clock or shared
 * state to interleave with. `check:park-boot` proves it rather than asserting
 * it, by hashing the sliced cruiser against a straight-through `planCruiser()`.
 */
export function* coasterProfileSearch(
  plan: SolvedRailRoute,
  rng: Rng,
  stall: { readonly x: number; readonly z: number },
): Generator<number, CoasterProfile, void> {
  const controls = Math.max(24, Math.round(plan.length / CONTROL_SPACING));
  const flat: Vec2[] = [];
  const probe2: Vec2 = { x: 0, z: 0 };
  for (let i = 0; i < controls; i += 1) {
    plan.pointAt((i / controls) * plan.length, probe2);
    flat.push({ x: probe2.x, z: probe2.z });
  }
  yield 0;

  // Where along the plan the station sits — measured, not assumed to be zero,
  // even though the loop starts there.
  let stationS = 0;
  let bestToStall = Infinity;
  for (let d = 0; d < plan.length; d += 1) {
    plan.pointAt(d, probe2);
    const toStall = Math.hypot(probe2.x - stall.x, probe2.z - stall.z);
    if (toStall < bestToStall) {
      bestToStall = toStall;
      stationS = d;
    }
  }
  yield 0;

  // --- vertical: seeded hills over the cruise floor ----------------------
  // Authored along **arc length**, in metres. Integer harmonics of the loop
  // fraction, so the profile closes seamlessly where the loop meets itself —
  // a fractional harmonic would leave a step at the join that the swept rail
  // would have to smooth over and the physics would feel as a kink.
  const heights = new Float64Array(controls);
  const hillPhase = rng.range(0, TAU);
  for (let i = 0; i < controls; i += 1) {
    const angle = (i / controls) * TAU;
    const hills =
      Math.max(0, Math.sin(angle * 3 + hillPhase)) * 3.4 +
      Math.max(0, Math.sin(angle * 5 + hillPhase * 1.7)) * 1.4;
    heights[i] = CRUISE_FLOOR + hills;
  }
  // The station carve. No bearing-to-metres conversion any more: `along` is
  // already the metres of track between this control and the platform.
  for (let i = 0; i < controls; i += 1) {
    const s = (i / controls) * plan.length;
    const raw = Math.abs(s - stationS);
    const along = Math.min(raw, plan.length - raw);
    if (along < STATION_FLAT) heights[i] = STATION_HEIGHT;
    else if (along < STATION_FLAT + STATION_RAMP) {
      const t = (along - STATION_FLAT) / STATION_RAMP;
      const eased = t * t * (3 - 2 * t);
      heights[i] = STATION_HEIGHT + (heights[i]! - STATION_HEIGHT) * eased;
    }
  }
  yield 0;

  // The castle window carve (issue #113). Applied **after** the station's,
  // and that order is load-bearing rather than incidental.
  //
  // The cruiser's booth is placed 21-26 m from the castle, so the station and
  // the castle are always near neighbours, and the station's 26 m ramp
  // reaches the castle on most seeds. Carving the castle first and letting
  // the station ramp run over it was tried and measured: **one crossing came
  // out pinned at window height and the other at 2-4 m**, halfway down the
  // ramp — an opening that would have been cut through the courtyard floor.
  // The flat run through the masonry is the one part of the profile that
  // cannot be blended with anything, because a hole was cut to fit it, so it
  // is applied last and wins outright.
  //
  // What the station keeps is its own flat: the two flats overlapping would
  // tilt the boarding deck, so `checkCoasterClearances` complains if they come
  // within reach of each other rather than letting either quietly deform.
  //
  // Level, not merely low: both openings then sit at the same height, the
  // masonry surround is a plain rectangle rather than a swept slot, and the
  // cart flies straight at the window instead of arriving at it climbing.
  // Measured on the **plan**, because the curve this carves does not exist
  // yet. The public `castleSpan` below is re-measured on the finished curve:
  // the two parameterisations are not the same length, and treating one as
  // the other is a bug this had — plan metres ran ~1.5% short of curve metres,
  // so the span stopped just before the second wall crossing and one of the
  // two windows was silently never cut. Three of the five CI seeds caught it.
  const castleSpan = spanInsideCastle((d, into) => plan.pointAt(d, into), plan.length);
  yield 0;
  if (castleSpan) {
    // **The window's height is a plane, not a number.** This was one
    // `windowY = BUILDING_BASE_Y + WINDOW_TRACK_Y` held across the whole
    // traverse — "level, not merely low", which is still exactly what is
    // wanted, but *level* now means level **with the castle's own deck**
    // rather than with world `+Y`. The shell leans 12.44°, so a constant
    // world `y` rises out of the window over the ~20 m the loop spends inside
    // the building, by up to 4.3 m: out through the lintel on one side and
    // into the stonework on the other. Asked per column, both openings sit at
    // the same castle-local height and the surround stays a plain rectangle,
    // which is what the paragraph above asked for in the first place.
    for (let i = 0; i < controls; i += 1) {
      const s = (i / controls) * plan.length;
      const away = outsideSpan(castleSpan, s, plan.length);
      const spot = flat[i]!;
      const wanted = castleDeckClearanceAt(WINDOW_TRACK_Y, spot.x, spot.z);
      if (away < WINDOW_FLAT) heights[i] = wanted;
      else if (away < WINDOW_FLAT + WINDOW_RAMP) {
        const t = (away - WINDOW_FLAT) / WINDOW_RAMP;
        const eased = t * t * (3 - 2 * t);
        heights[i] = wanted + (heights[i]! - wanted) * eased;
      }
    }
  }
  yield 0;

  const makeCurve = (): CatmullRomCurve3 => {
    const points: Vector3[] = [];
    for (let i = 0; i < controls; i += 1) {
      const spot = flat[i]!;
      points.push(
        new Vector3(spot.x, terrainHeight(spot.x, spot.z) + (heights[i] ?? CRUISE_FLOOR), spot.z),
      );
    }
    return coasterCurve(points);
  };

  const stationOn = (curve: CatmullRomCurve3, length: number): number => {
    let best = 0;
    let bestDistance = Infinity;
    const probe = new Vector3();
    for (let d = 0; d < length; d += 1) {
      curve.getPointAt(d / length, probe);
      const toStall = Math.hypot(probe.x - stall.x, probe.z - stall.z);
      if (toStall < bestDistance) {
        bestDistance = toStall;
        best = d;
      }
    }
    return best;
  };

  // --- vertical repair: measure the finished curve, not the plan ---------
  // Control-point heights are claims; between them the spline interpolates
  // while the terrain does what it likes, so a rise between two samples can
  // eat the cruise floor. Scan exactly the way the boot assert will (but with
  // a slightly narrower station exemption, so everything the assert measures
  // is either exempt or repaired), raise the control points under any
  // deficit, and re-measure until the track really clears.
  let curve = makeCurve();
  let length = curve.getLength();
  yield 0;
  let station = stationOn(curve, length);
  const probe = new Vector3();
  for (let pass = 0; pass < 10; pass += 1) {
    // One repair pass per slice. The loop rebuilds the whole curve and its
    // 1600-sample arc-length table each pass and, on the canonical seed, never
    // converges early — so all ten always run, and as one block they measured
    // 18.9 ms here and 54.6 ms on CI. Re-measured 9 August 2026, a pass is
    // **0.55-0.8 ms**, comfortably inside the 8 ms a frame is given.
    // `pass + 1`, never `pass`, so that **zero is reserved for the structural
    // seams above**. Those eight always run; this loop's count is data — it
    // breaks the moment a pass finds nothing to lift, so a park whose profile
    // already clears the terrain legitimately takes one pass where the
    // canonical seed takes ten. `check:park-boot` has to be able to tell the
    // two apart: counting them together says only "eleven pieces", which
    // cannot distinguish a seam that was skipped from a repair that was not
    // needed, and it went red on the second while claiming the first.
    yield pass + 1;
    // Worst deficit per control point, so a run of low samples under one
    // control raises it once by what it needs, not once per sample. The same
    // sweep records how close to the station each control's track actually
    // runs — measured on the curve, because a control's own nominal position
    // along the loop drifts once height is added to it.
    const lifts = new Map<number, number>();
    const ownsStationTrack = new Map<number, number>();
    for (let d = 0; d < length; d += 2) {
      curve.getPointAt(d / length, probe);
      const toStation = Math.min(Math.abs(d - station), length - Math.abs(d - station));
      const control = Math.round((d / length) * controls) % controls;
      ownsStationTrack.set(
        control,
        Math.min(ownsStationTrack.get(control) ?? Infinity, toStation),
      );
      if (toStation < STATION_FLAT + STATION_RAMP) continue;
      const above = probe.y - terrainHeight(probe.x, probe.z);
      if (above < CRUISE_FLOOR) {
        const lift = CRUISE_FLOOR - above + 0.4;
        lifts.set(control, Math.max(lifts.get(control) ?? 0, lift));
      }
    }
    // Never lift a control that owns boarding-flat or early-ramp track — a
    // half-lift bleeding onto the platform would tilt it. Mid-ramp and beyond
    // is fair game: steepening the ramp's tail is exactly how a sag just past
    // the window gets fixed.
    // A control carrying the level run through the castle is not liftable
    // either, and for a sharper reason than the station's: lifting it would
    // raise the track *inside a hole cut to fit it*, which is the one place
    // in the park where gaining height is how you hit something rather than
    // how you miss it. The ramp's outer two-thirds stay liftable, exactly as
    // the station's do, so a sag just past the castle can still be repaired.
    const holdsWindow = (index: number): boolean =>
      castleSpan !== null &&
      outsideSpan(castleSpan, (index / controls) * plan.length, plan.length) <
        WINDOW_FLAT + WINDOW_RAMP * 0.35;
    const liftable = (index: number): boolean =>
      (ownsStationTrack.get(index) ?? Infinity) > STATION_FLAT + STATION_RAMP * 0.65 &&
      !holdsWindow(index);
    for (const [control, lift] of lifts) {
      if (liftable(control)) heights[control] = (heights[control] ?? CRUISE_FLOOR) + lift;
      for (const side of [-1, 1]) {
        const neighbour = (control + side + controls) % controls;
        if (liftable(neighbour))
          heights[neighbour] = (heights[neighbour] ?? CRUISE_FLOOR) + lift * 0.5;
      }
    }
    if (lifts.size === 0) break;
    curve = makeCurve();
    length = curve.getLength();
    station = stationOn(curve, length);
  }
  yield 0;

  // The span riders actually fly, in the metres every other consumer counts
  // in: `openingsFor`, the swept-car assert and the station-overlap check all
  // index the built curve, so this is measured on the built curve.
  const built = new Vector3();
  // Named apart from the plan-space `castleSpan` above, which carved the height
  // profile. These are two different measurements of the same stretch — plan
  // metres run ~1.5% short of curve metres — and treating one as the other is a
  // bug this file has already had.
  const builtCastleSpan = spanInsideCastle((d, into) => {
    curve.getPointAt(wrapAround(d, length) / length, built);
    into.x = built.x;
    into.z = built.z;
  }, length);
  yield 0;

  let crest = 0;
  for (let d = 0; d < length; d += 1) {
    curve.getPointAt(d / length, probe);
    const above = probe.y - terrainHeight(probe.x, probe.z);
    if (above > crest) crest = above;
  }
  return { curve, length, stationDistance: station, castleSpan: builtCastleSpan, crestY: crest };
}


/** {@link coasterProfileSearch}, driven straight through. */
export function coasterProfile(
  plan: SolvedRailRoute,
  rng: Rng,
  stall: { readonly x: number; readonly z: number },
): CoasterProfile {
  const search = coasterProfileSearch(plan, rng, stall);
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}
