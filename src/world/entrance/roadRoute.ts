import { RIM_OUTSET_START } from '../../core/constants';
import { PARK_BOUNDARY, TERRAIN_APRON } from '../boundary';
import { RingPath } from '../railRace/ringPath';
import { CHILD_FOOTPRINT } from '../../art/models/kid';
import { CAT_BUS_LENGTH } from './catBus';
import { ENTRANCE_ANGLE } from './layout';
import { ROAD_HALF_WIDTH } from './road';

/**
 * **Where the road outside the gate actually goes — the one owner of its line.**
 *
 * ## Why this file exists at all
 *
 * The road used to be a straight chord: a ribbon along `x` at
 * `ENTRANCE_BUS_STOP_Z` (the wall plus nine metres), which the cat bus drove
 * along. Jim, 3 September 2026, on two separate faults that turned out to be
 * the same fault:
 *
 * > *"the road outside the park (which should also be grey) just stops - it
 * > should continue away from the park as far as the game renders when fully
 * > zoomed out"*
 *
 * > *"the bus shouldn't clip through the rail race supports - route the road
 * > properly to avoid them"*
 *
 * ### The measurement that decided the shape
 *
 * Measured on **all sixteen pool seeds** (`scripts/measure-entrance-road.mts`),
 * the old straight kerb had **two to eight** Rail Race trestle legs standing
 * inside the bus's swept body, every seed, worst intrusion 2.51 m. That is not
 * bad luck on one park, and no amount of moving the straight line fixes it:
 *
 * - Trestle feet stand at `NOMINAL_OUTSET` — **6.5 m beyond the park's own
 *   edge** — all the way round, on every seed. `route.ts` boxes that number
 *   into `[6.15, 6.92]` (inner: the innermost rail must clear the masonry;
 *   outer: the outermost rail must stay inside {@link RIM_OUTSET_START}), so it
 *   cannot move.
 * - A road `2 * ROAD_HALF_WIDTH` = 7.78 m wide needs its centre at outset
 *   ≥ `ROAD_HALF_WIDTH` to stay out of the park, and ≤ `RIM_OUTSET_START -
 *   ROAD_HALF_WIDTH` (8.11) to stay off a 17 m hillside.
 * - To clear a leg at 6.5 that centre must be **≥ 4.4 m** away from it — outset
 *   ≤ 2.1 or ≥ 10.9.
 *
 * **Those two bands do not intersect.** There is no outset, straight *or*
 * curved, at which a road running *along* the wall clears a support. A road
 * *crossing* the trestle line is fine — `TRESTLE_SPACING` is 12 m against a
 * 7.78 m road — it is only a road parallel to it that cannot fit.
 *
 * So the road stops being a chord and becomes a **corridor with one owner**,
 * declared here, which two things then read:
 *
 * - `Entrance.ts` builds the ribbons from it.
 * - `railRace/track.ts`'s `groundIsClear` refuses to stand a leg in it, exactly
 *   as it already refuses ground near a path, near the rail corridor, and near
 *   a `PARK_LAYOUT` entry. The road was simply **missing from that list**,
 *   which is CLAUDE.md's "a generator that only checks itself against a
 *   hand-picked obstacle list will silently miss whatever a sibling system
 *   placed there" by name. `World.ts` builds `RailRace` before `Entrance`, and
 *   nothing here depends on the ride, so the ordering works: the ride's own
 *   `RADIAL_NUDGES` search moves its feet clear of the road. Nothing is deleted
 *   and nothing is hand-placed.
 *
 * ## The shape, in three parts
 *
 * 1. **The kerb** — the park's own edge pushed out along its normal by
 *    {@link ENTRANCE_ROAD_OUTSET}, so the road hugs the wall at a *constant*
 *    distance instead of a straight line's varying one. This is what the bus
 *    stands and drives on. It is a curve, and it has to be: a straight kerb
 *    close enough to the wall at the gate is **inside the park** by x ≈ +12,
 *    because the boundary spline bulges to 92 m a few degrees off the gate's
 *    bearing.
 * 2. **Two tails** — at each end the road turns away from the park, climbing
 *    from the kerb's outset out to {@link ENTRANCE_ROAD_TAIL_OUTSET}, crossing
 *    under the ride and over the hilltop's brow.
 * 3. It **ends where the drawn ground ends**, not at a length somebody liked:
 *    `TERRAIN_APRON` is how far past the park the terrain disc is built, so
 *    that is how far a road can go before there is nothing under it.
 *
 * ## What "as far as the game renders" turned out to mean
 *
 * The zoom-out extent is owned by `IsoCamera.frustumBase()` and is
 * **aspect-dependent** — at `CAMERA_ZOOM_MIN` a 16:9 desktop reaches 29.0 m of
 * ground up-screen and a 390x844 portrait phone 47.8 m — so nothing here copies
 * a number out of it. `scripts/check-entrance-road.mts` calls that function for
 * a spread of aspects and reports the road's reach against it, which is the
 * only honest way to state a fact about a frustum a world-build cannot see.
 *
 * The park is a hilltop diorama, so past the brow there is no ground at all:
 * the road ends by going over it, which is what a road leaving a hilltop does
 * and is genuinely as far as the game draws in that direction.
 */

/**
 * How far the boundary masonry stands proud of the park's own edge line.
 *
 * `Garden.ts` lays 0.7 m-deep blocks centred on the outline, so the outer face
 * is half of that out; the pillars are fatter again. Stated here so the road's
 * inner kerb can be put against the wall rather than through it.
 */
const BOUNDARY_MASONRY_REACH = 0.6;

/**
 * **The road's centre line, as metres beyond the park's edge.**
 *
 * As near the wall as a road can be laid — its inner kerb ends up
 * {@link BOUNDARY_MASONRY_REACH} clear of the masonry's outer face — and that
 * is the point. Every metre the road sits further out is a metre of the Rail
 * Race's own apron it takes, and a bigger radial nudge the ride's trestle
 * search has to find. Hugging the wall is the cheapest place for it to be.
 */
/**
 * **How much pavement a child needs between the bus's door and the arch.**
 *
 * Two children abreast, which is what stepping down and turning towards the gate
 * actually takes — `CHILD_FOOTPRINT` is the width `NpcSystem` keeps them apart
 * by, so two of it is the narrowest strip eleven of them can leave a bus onto
 * without immediately being in the doorway.
 *
 * **This is what the first curved road got wrong, and it is worth stating why it
 * was invisible.** With the outset set purely by "as close to the wall as a road
 * can be laid" the geometry was correct in every way anybody was checking — the
 * road cleared the masonry, the bus cleared the park, the trestles cleared the
 * bus — and the door came to rest **1.18 m from the middle of the arch**
 * (`scripts/probe-door.mts`). The children stepped down inside the gateway,
 * their walk routes collapsed to a stub, and `check:cat-bus` reported it as a
 * *timing* fault: "two children left the bus only 0.00 s apart", at 0.87 and
 * 7.15 m/s. Nothing was wrong with the timing — `KID_DELAYS` is cumulative and
 * time-based and always was. The symptom named the wrong system, which is why
 * the number is derived here now instead of being a consequence of somewhere
 * else's optimum.
 */
const DOOR_PAVEMENT = CHILD_FOOTPRINT * 2;

/**
 * How far the bus's door drop sits from the bus's own centre, towards the park.
 *
 * A statement about the built vehicle rather than a second definition of it:
 * `check:cat-bus`'s road section measures the real `doorDrop` against the gate,
 * so if the bus is ever rebuilt with its door elsewhere the check says so rather
 * than the road quietly stopping in the wrong place. Not imported from
 * `catBus.ts` because that module builds textures at import time and this one is
 * pulled in by `railRace/track.ts` during the ride's own build.
 */
const BUS_DOOR_INBOARD = 4.66;

/**
 * **The road's centre line, as metres beyond the park's edge.**
 *
 * Bounded below by the door and above by the hill, and both bounds are real:
 *
 * - **The door** must open onto {@link DOOR_PAVEMENT} of ground before the arch,
 *   and it sits {@link BUS_DOOR_INBOARD} from the bus's centre, which the bus
 *   shares with the road's. That is the floor.
 * - **The hill** starts at `RIM_OUTSET_START`, and the road's outer kerb must
 *   stay inside it or the carriageway is cambered down a 17 m slope. That is the
 *   ceiling, at `RIM_OUTSET_START - ROAD_HALF_WIDTH` = 8.11.
 *
 * The floor is `3.6 + 4.66` = 8.26 and the ceiling 8.11, so **they cross by
 * 0.15 m** — which is the honest statement of how tight the apron outside this
 * park is, and why the old straight road simply sat on top of the ride instead.
 * The road takes the floor, and its outer kerb overhangs the very start of the
 * rim by 15 cm, where the fall is `smoothstep(12, 22, 12.15)` of 17 m — under a
 * centimetre. It is inside the ceiling in every sense that matters and outside it
 * arithmetically, and that is worth saying plainly rather than rounding away.
 */
export const ENTRANCE_ROAD_OUTSET = DOOR_PAVEMENT + BUS_DOOR_INBOARD;

/**
 * How far out the tails run before the road is off the edge of the world.
 *
 * `TERRAIN_APRON` is `boundary.ts`'s own answer to "how much ground is built
 * outside the park", so the road reaches the terrain disc's cut edge and stops
 * because the ground stops — never at a distance chosen to look right.
 */
export const ENTRANCE_ROAD_TAIL_OUTSET = TERRAIN_APRON;

/**
 * How much straight-ish kerb there is either side of the gate before the road
 * turns away.
 *
 * **Derived from the bus, not chosen.** The bus has to roll in, stand with its
 * door at the arch, and roll out again, and it is `CAT_BUS_LENGTH` long — so a
 * run of one bus-length each way is the least that lets it arrive and leave
 * without either end of it already being on the turn. Longer would be prettier
 * and costs the ride a trestle slot per twelve metres, which is the trade this
 * number is really making.
 */
export const ENTRANCE_ROAD_KERB_HALF_RUN = CAT_BUS_LENGTH;

/**
 * The arc a tail takes to climb from the kerb's outset to the terrain's edge.
 *
 * **Set by the bus's turning circle, and it had to be.** The first value here
 * was 14 m, chosen to cross the Rail Race's line steeply — which it did, and
 * which was the wrong thing to optimise. Measured (`scripts/probe-tail.mts`), a
 * 14 m tail turns at a **3.6 m radius** for a **15.8 m** bus, and a rigid body
 * that long on a curve that tight does not stay between the kerbs: it cut
 * **2.17 m inside the park boundary**, which `check:cat-bus` reported as *"the
 * bus reached 2.17 m INSIDE the park"* — the very fault (#195) the bus stopping
 * outside the gate exists to prevent, reintroduced by the road's own shape.
 *
 * A road vehicle's kerb-to-kerb turning circle is roughly its own length, so the
 * tail is sized to give the bus a radius of about
 * `CAT_BUS_LENGTH * TAIL_TURN_CIRCLES` — derived from the thing that drives it
 * rather than from how the crossing looks. Turn radius goes as the square of
 * this run, so it is `14 * sqrt(wanted / 3.6)` measured from that same probe.
 *
 * **What it costs, stated rather than hidden:** the crossing of the trestle line
 * is now shallow instead of steep, so the road occupies more than
 * `TRESTLE_SPACING` of the ring's arc and displaces two slots per ring per
 * crossing rather than one. The ride's own search absorbs that — it is why the
 * corridor is in `groundIsClear` at all — and `check:rail-race` and
 * `test:procgen` are what say whether it has absorbed it, rather than this
 * comment.
 *
 * **55, because clearance saturates there.** Swept (same probe): 14 m leaves the
 * bus 2.17 m *inside* the park, 37 m clears by 0.23 m, 45 m by 0.66 m, and 55 m
 * by 0.77 m at a 24.4 m turn radius — about 1.55 bus lengths, which is a real
 * vehicle's turning circle. Past 55 the binding constraint stops being the tail
 * at all and becomes the kerb's own curvature near the gate (the worst point
 * moves from at = -20.9 to at = -7.1), so 65 buys exactly nothing. That is the
 * argument for this number: it is where the curve stops being what limits it.
 *
 * It also settles the reach: the road runs about 83 m from the gate before the
 * ground ends, comfortably past the 47.8 m a 390x844 portrait phone can see at
 * full zoom-out — so the road leaves the frame on every aspect rather than only
 * on a desktop.
 */
const ENTRANCE_ROAD_TAIL_RUN = 55;

/** One station on the road's centre line. */
export interface RoadStation {
  readonly x: number;
  readonly z: number;
  /** Metres along the road, zero at the gate, negative one way and positive the other. */
  readonly at: number;
  /** Unit heading along the road in the direction of increasing {@link at}. */
  readonly headingX: number;
  readonly headingZ: number;
}

/** Roughly one station per metre — fine enough for a UV seam and a bus to drive. */
const STATION_SPACING = 1;

const KERB_PATH = new RingPath(ENTRANCE_ROAD_OUTSET);
const GATE_AT = KERB_PATH.distanceAtBearing(ENTRANCE_ANGLE);

/** How far out the tail has climbed, `distance` metres from the gate along the kerb. */
function tailOutset(distance: number): number {
  const past = Math.abs(distance) - ENTRANCE_ROAD_KERB_HALF_RUN;
  if (past <= 0) return 0;
  const t = Math.min(1, past / ENTRANCE_ROAD_TAIL_RUN);
  // Smooth at the join so the bus does not turn a corner, linear afterwards so
  // the crossing angle stays steep rather than easing off into the ring.
  const eased = t * t * (3 - 2 * t);
  return eased * (ENTRANCE_ROAD_TAIL_OUTSET - ENTRANCE_ROAD_OUTSET);
}

let stationCache: readonly RoadStation[] | null = null;

/**
 * **The road's centre line**, gate-centred, from one tail's end to the other.
 *
 * Built once and shared. Everything that needs to know where the road is —
 * the ribbons, the bus, the trestle search, the checks — reads this, so there
 * is never a second description of the same road to keep in step.
 */
export function entranceRoadStations(): readonly RoadStation[] {
  if (stationCache) return stationCache;

  const halfRun = ENTRANCE_ROAD_KERB_HALF_RUN + ENTRANCE_ROAD_TAIL_RUN;
  const count = Math.round(halfRun / STATION_SPACING);
  const points: { x: number; z: number; along: number }[] = [];
  for (let i = -count; i <= count; i += 1) {
    const along = i * STATION_SPACING;
    const sample = KERB_PATH.sampleAt(KERB_PATH.wrap(GATE_AT + along));
    const extra = tailOutset(along);
    points.push({
      x: sample.x + sample.normalX * extra,
      z: sample.z + sample.normalZ * extra,
      along,
    });
  }

  // Arc length is measured on the built polyline, never assumed to be `along`:
  // the tails push sideways as well as forwards, so a tail metre of `along` is
  // more than a metre of road. A bus driving by `along` would speed up on the
  // turn.
  const stations: RoadStation[] = [];
  let travelled = 0;
  let gateAt = 0;
  for (let i = 0; i < points.length; i += 1) {
    const here = points[i] as { x: number; z: number; along: number };
    if (i > 0) {
      const previous = points[i - 1] as { x: number; z: number };
      travelled += Math.hypot(here.x - previous.x, here.z - previous.z);
    }
    if (here.along === 0) gateAt = travelled;
    const ahead = points[Math.min(points.length - 1, i + 1)] as { x: number; z: number };
    const behind = points[Math.max(0, i - 1)] as { x: number; z: number };
    const hx = ahead.x - behind.x;
    const hz = ahead.z - behind.z;
    const length = Math.hypot(hx, hz) || 1;
    stations.push({ x: here.x, z: here.z, at: travelled, headingX: hx / length, headingZ: hz / length });
  }

  stationCache = stations.map((station) => ({ ...station, at: station.at - gateAt }));
  return stationCache;
}

/** The road's own extent, in metres either side of the gate. */
export function entranceRoadExtent(): { readonly from: number; readonly to: number } {
  const stations = entranceRoadStations();
  return {
    from: (stations[0] as RoadStation).at,
    to: (stations[stations.length - 1] as RoadStation).at,
  };
}

/** Where the road is, `at` metres from the gate. Clamped to the road's own ends. */
export function entranceRoadAt(at: number): RoadStation {
  const stations = entranceRoadStations();
  const first = stations[0] as RoadStation;
  const last = stations[stations.length - 1] as RoadStation;
  if (at <= first.at) return first;
  if (at >= last.at) return last;
  // Stations are near enough evenly spaced in `at`; find the bracketing pair by
  // scan rather than by index arithmetic, because the tails stretch the spacing.
  for (let i = 1; i < stations.length; i += 1) {
    const b = stations[i] as RoadStation;
    if (b.at < at) continue;
    const a = stations[i - 1] as RoadStation;
    const t = (at - a.at) / Math.max(1e-6, b.at - a.at);
    const hx = a.headingX + (b.headingX - a.headingX) * t;
    const hz = a.headingZ + (b.headingZ - a.headingZ) * t;
    const length = Math.hypot(hx, hz) || 1;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      at,
      headingX: hx / length,
      headingZ: hz / length,
    };
  }
  return last;
}

/**
 * **How far this point is from the middle of the road**, in metres.
 *
 * The query `railRace/track.ts` asks before it stands a leg, and the same one
 * the checks ask. Perpendicular distance to the centre *line*, not to a
 * station, so a leg cannot slip between two samples — the segment version of
 * the same trap CLAUDE.md's `bandCrossed` note describes for trigger bands.
 */
function distanceToEntranceRoad(x: number, z: number): number {
  const stations = entranceRoadStations();
  let nearest = Infinity;
  for (let i = 1; i < stations.length; i += 1) {
    const a = stations[i - 1] as RoadStation;
    const b = stations[i] as RoadStation;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const t =
      lengthSquared < 1e-9
        ? 0
        : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared));
    nearest = Math.min(nearest, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return nearest;
}

/**
 * **Is this ground inside the road's corridor?** — one predicate, asked by the
 * ride before it stands a leg and by the checks afterwards, so neither gets to
 * hold its own idea of how wide the road is.
 *
 * ## It is the swept body, not the ribbon, and that is not a detail
 *
 * The first version of this asked {@link distanceToEntranceRoad} against
 * `ROAD_HALF_WIDTH`, which is the painted surface. Measured with
 * `check:entrance-road`, that still left the bus sweeping through **one to three
 * legs on every one of the sixteen seeds**, reaching up to 1.66 m inside one —
 * a tenth of the old fault but the same fault.
 *
 * The reason is length. The bus is `CAT_BUS_LENGTH` of rigid body on a road that
 * *turns*, and a long box on a curve does not stay between the kerbs: it cuts
 * the inside and overhangs the outside. Its half width (2.64 m) is comfortably
 * inside the road's (3.89 m) on the straight, which is exactly why a
 * width-only test reads clean and is wrong — the overhang only appears where
 * the tails bend away from the park.
 *
 * So the corridor is the union of a **bus-length, road-width box** standing at
 * every station: at least as wide as the surface everywhere, and as long as the
 * thing that drives on it. That is the honest statement of what must be kept
 * clear, and it means a future change to the bus's length or the tails'
 * curvature moves this on its own rather than needing somebody to notice.
 */
export function isInEntranceRoad(x: number, z: number, radius = 0): boolean {
  if (!corridorHonoured) return false;
  // **`<=`, not `<`.** `distanceToEntranceCorridor` returns exactly 0 for a
  // point inside the corridor, so `< radius` at the default radius of 0 asks
  // `0 < 0` and answers **false in the dead centre of the road** — the one
  // place the question is least ambiguous. Every caller that passes a real
  // radius was unaffected, which is why it went unnoticed.
  return distanceToEntranceCorridor(x, z) <= radius;
}

/**
 * Whether {@link isInEntranceRoad} answers truthfully — **on in the game,
 * always**, and turned off only by `check:entrance-road`'s control.
 *
 * This exists because of what a control has to be. The check sweeps the bus
 * along the road and requires it to hit **no** trestle leg; a sweep that cannot
 * see a collision returns exactly that same answer, so something known to be
 * dirty has to go through the same instrument on every run or the clean result
 * means nothing.
 *
 * The first control swept the road as it *used* to be — the straight chord at
 * the wall — against the legs as they are **now**. That worked, and then began
 * to stop working: as the ride learned to nudge its legs out of the road, it
 * moved them off the old line too, and the control's hit count fell from 96 to
 * 35 across the pool, to as few as **one leg on seed 11**. It still
 * discriminated, but it was one placement decision away from reading zero — and
 * a zero there does not mean "the road is clean", it means the run is void. A
 * control that degrades as the thing it controls for improves is a control with
 * a shelf life.
 *
 * So the dirty input is generated instead of remembered: the control builds the
 * park with this switched off, which is the same park minus the one clause in
 * `railRace/track.ts`'s `groundIsClear` that keeps legs out of the road, and
 * sweeps **the real, current road** against those legs. It cannot go stale,
 * because it is rebuilt from whatever the ride does today.
 *
 * Nothing in the game calls this. It is deliberately a plain function rather
 * than an environment variable: `src/` is bundled for a browser, where
 * `process.env` does not exist, and a switch the game could read by accident is
 * a switch that will one day be read by accident.
 */
let corridorHonoured = true;

/** See {@link corridorHonoured} — `check:entrance-road`'s control, and nothing else. */
export function setEntranceCorridorHonoured(honoured: boolean): void {
  corridorHonoured = honoured;
}

/**
 * How finely the swept corridor is sampled, in metres.
 *
 * **Not the station spacing, and it must not be.** The union of boxes standing
 * at every *station* is not the corridor a body sweeps between them: where the
 * road turns, the swept envelope bulges outside every sampled box, and a leg can
 * sit in that bulge. Measured — sampling at the 1 m station spacing left two of
 * the sixteen seeds with a leg 0.18 and 0.22 m inside the bus. That is the same
 * disease as CLAUDE.md's *"a gap you cannot walk into at 5 cm a step you may
 * still tunnel into"*, turned inside out: here the coarse sample lets a leg in
 * rather than letting a child out.
 *
 * A fifth of a metre is finer than the finest thing that asks (the check's own
 * sweep), which is the only defensible way to pick it: the corridor must not be
 * sampled more coarsely than anything measuring it.
 */
const CORRIDOR_SAMPLE_SPACING = 0.2;

let corridorCache: readonly RoadStation[] | null = null;

/** The swept corridor's own stations — see {@link CORRIDOR_SAMPLE_SPACING}. */
function corridorSamples(): readonly RoadStation[] {
  if (corridorCache) return corridorCache;
  const { from, to } = entranceRoadExtent();
  const samples: RoadStation[] = [];
  for (let at = from; at <= to; at += CORRIDOR_SAMPLE_SPACING) samples.push(entranceRoadAt(at));
  samples.push(entranceRoadAt(to));
  corridorCache = samples;
  return corridorCache;
}

/**
 * How far this point is **outside** the swept corridor, in metres; zero inside.
 *
 * Separate from {@link isInEntranceRoad} so a check can report the margin rather
 * than only a verdict — a boolean cannot say "cleared by 4 cm", and a clearance
 * that is technically positive is the shape of the hotel's 0.006 m "coincidence"
 * CLAUDE.md records.
 */
export function distanceToEntranceCorridor(x: number, z: number): number {
  const halfLength = CAT_BUS_LENGTH / 2;
  let nearest = Infinity;
  for (const station of corridorSamples()) {
    const dx = x - station.x;
    const dz = z - station.z;
    // Into the box's own frame: heading is along its length.
    const along = Math.abs(dx * station.headingX + dz * station.headingZ) - halfLength;
    const across = Math.abs(dx * -station.headingZ + dz * station.headingX) - ROAD_HALF_WIDTH;
    if (along <= 0 && across <= 0) return 0;
    nearest = Math.min(nearest, Math.hypot(Math.max(0, along), Math.max(0, across)));
  }
  return nearest;
}

/** How far the road reaches from the gate, for the checks to compare against a frustum. */
export function entranceRoadReach(): number {
  const { from, to } = entranceRoadExtent();
  return Math.min(Math.abs(from), Math.abs(to));
}

/**
 * **Where the road goes over the hilltop's brow**, in metres from the gate.
 *
 * `RIM_OUTSET_START` is where the ground begins its 17 m fall, and `terrain.ts`
 * makes that fall steeper than the camera's own pitch on purpose — so this is
 * the exact point at which anything on the road stops being visible, whichever
 * way the camera is turned. Found by walking the built centre line rather than
 * solved, because the tails' outset is a curve and this must agree with the
 * road that was actually laid.
 *
 * It is the one owner of "far enough away to appear from and disappear into":
 * the bus arrives at `+brow` and is disposed at `-brow`, so it drives on from
 * over the hill and off over the hill instead of winking into existence on a
 * kerb. Nothing picks a number for that any more.
 */
function browAt(): number {
  const stations = entranceRoadStations();
  for (const station of stations) {
    if (station.at <= 0) continue;
    if (entranceRoadOutsetAt(station.x, station.z) >= RIM_OUTSET_START) return station.at;
  }
  return (stations[stations.length - 1] as RoadStation).at;
}

let browCache: number | null = null;

/** See {@link browAt}. Positive; the far side is its negation. */
export function entranceRoadBrow(): number {
  browCache ??= browAt();
  return browCache;
}

/**
 * **Where the bus comes on from, and where it is disposed** — the brow, both
 * ways.
 *
 * These replace `ENTRANCE_BUS_ARRIVE_X` and `ENTRANCE_BUS_VANISH_X`, which were
 * two hand-measured `x` coordinates on a straight kerb ("just inside the window
 * an 18.2 m bus can stand in"). On a road that follows the park's edge that
 * window is not a range of `x` at all, and both numbers are now the same
 * question answered once: **the point at which the road goes over the hill**,
 * `entranceRoadBrow()`. So the bus drives on from out of sight and leaves the
 * same way, instead of appearing on a kerb, and it is never driving on the 50°
 * face beyond the brow because that is exactly where it stops existing.
 */
export function entranceBusArriveAt(): number {
  return entranceRoadBrow();
}

export function entranceBusVanishAt(): number {
  return -entranceRoadBrow();
}

/**
 * **Which way the cat bus faces, `at` metres along the road.**
 *
 * The bus drives from the brow on the positive side to the brow on the negative
 * one, so its nose points down *decreasing* `at` — hence the negated heading.
 * The same yaw convention `Player.facing` and `BUS_FACING` always used
 * (`atan2(x, z)`: zero looks along +z), so nothing downstream has to know the
 * road is curved; it just asks where the bus is pointing.
 */
export function entranceRoadFacing(at: number): number {
  const station = entranceRoadAt(at);
  return Math.atan2(-station.headingX, -station.headingZ);
}

/**
 * **Where the road's inner kerb is**, `at` metres along — the edge nearest the
 * park.
 *
 * The gateway spur has to start exactly here or it lays a slab on top of the
 * kerb's, which is #472's coplanar seam in a curved coat. Taken from the
 * station's own frame rather than from a z-coordinate, because on a curved road
 * "inner" is a direction and not an axis.
 */
export function entranceRoadInnerEdge(at: number): { readonly x: number; readonly z: number } {
  const station = entranceRoadAt(at);
  const normal = innerNormal(station);
  return { x: station.x + normal.x * ROAD_HALF_WIDTH, z: station.z + normal.z * ROAD_HALF_WIDTH };
}

/**
 * Which way is "towards the park" at this station — left of the heading, then
 * flipped if that turns out to point away. On a curved road "inner" is a
 * direction and not an axis, so it is asked of the boundary rather than of `z`.
 */
export function entranceRoadInnerNormal(station: RoadStation): {
  readonly x: number;
  readonly z: number;
} {
  return innerNormal(station);
}

function innerNormal(station: RoadStation): { readonly x: number; readonly z: number } {
  const nx = -station.headingZ;
  const nz = station.headingX;
  const away =
    entranceRoadOutsetAt(station.x + nx, station.z + nz) >
    entranceRoadOutsetAt(station.x, station.z);
  return away ? { x: -nx, z: -nz } : { x: nx, z: nz };
}

/**
 * **The kerb's inner edge as a polyline — one point per station, in order.**
 *
 * The ribbon `Entrance.ts` draws is swept through these very points, and the
 * path through the gate is built off the same list, so the two share a boundary
 * *by construction* rather than by two call sites agreeing about which side of
 * a station is which. They did agree — measured, 0 of 143 stations disagreed —
 * but a fact that has to be measured to be believed is the shape of bug this
 * repo pays for most often, and this removes the question.
 */
export function entranceRoadInnerEdgeRing(): readonly { readonly x: number; readonly z: number }[] {
  const stations = entranceRoadStations();
  if (!innerEdgeRingCache) {
    innerEdgeRingCache = stations.map((station) => {
      const normal = innerNormal(station);
      return {
        x: station.x + normal.x * ROAD_HALF_WIDTH,
        z: station.z + normal.z * ROAD_HALF_WIDTH,
      };
    });
  }
  return innerEdgeRingCache;
}

let innerEdgeRingCache: readonly { readonly x: number; readonly z: number }[] | null = null;

/**
 * **The stretch of that edge a band of `x` either side of the gate covers**, as
 * the road's own boundary points with the two ends interpolated *along the
 * road's own segments* — so every point returned lies exactly on a triangle
 * edge of the drawn kerb, and a ribbon built onto this list touches the road
 * with no overlap and no gap.
 *
 * That exactness is the whole point. Across the gateway path's width the kerb's
 * inner edge wanders up to 0.93 m in `z` (measured, `scripts/probe-spur-edge.mts`,
 * seed 326), and even the straight chord between this list's two ends departs
 * from it by up to 2.7 cm — enough to register as a coplanar seam, since the
 * check calls anything under a centimetre apart a shared plane. Resampling the
 * *centre line* instead was tried and made it worse: interpolated points do not
 * land on the kerb's own triangle edges, so it kept the seam and added another.
 */
export function entranceRoadInnerEdgeAcross(
  centreX: number,
  halfWidth: number,
): readonly { readonly x: number; readonly z: number }[] {
  const ring = entranceRoadInnerEdgeRing();
  const low = centreX - halfWidth;
  const high = centreX + halfWidth;
  const span: { x: number; z: number }[] = [];
  const at = (a: { x: number; z: number }, b: { x: number; z: number }, x: number) => {
    const t = (x - a.x) / (b.x - a.x);
    return { x, z: a.z + (b.z - a.z) * t };
  };
  for (let i = 1; i < ring.length; i += 1) {
    const a = ring[i - 1] as { x: number; z: number };
    const b = ring[i] as { x: number; z: number };
    if (a.x === b.x) continue;
    // Every crossing of either edge of the band, plus every ring point inside
    // it, walked in the road's own order.
    for (const edge of [low, high]) {
      if ((a.x < edge && b.x >= edge) || (a.x > edge && b.x <= edge)) span.push(at(a, b, edge));
    }
    if (b.x >= low && b.x <= high) span.push({ x: b.x, z: b.z });
  }
  if (ring.length > 0) {
    const first = ring[0] as { x: number; z: number };
    if (first.x >= low && first.x <= high) span.unshift({ x: first.x, z: first.z });
  }
  span.sort((p, q) => p.x - q.x);
  // Two points at the same x are a road doubling back on itself, which the
  // gateway's own band never sees; keep the first and let the caller's ribbon
  // stay a function of x.
  return span.filter((p, i) => i === 0 || Math.abs(p.x - (span[i - 1] as { x: number }).x) > 1e-6);
}

/** Where the boundary edge sits, for anything wanting the road's outset back. */
export function entranceRoadOutsetAt(x: number, z: number): number {
  return -PARK_BOUNDARY.distanceToEdge(x, z);
}
