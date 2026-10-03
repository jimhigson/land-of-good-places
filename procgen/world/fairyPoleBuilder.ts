import { FAIRY_POLE_SPACING } from '../../src/world/FairyLights';
import { WALKABLE_GAP } from '../../src/core/constants';
import { isInGateArchSpan } from '../../src/world/entrance/gateArch';
import { nearADoormat, onRideExit } from './sceneryBuilders';
import { pointStandsOnABridgeRamp } from '../../src/world/paths';
import { PLAYER_RADIUS } from '../../src/core/constants';
import { CatmullRomCurve3, Vector3 } from 'three';
import { terrainHeight, upAt } from '../../src/world/terrain';
import { plazaVerge } from './paths';
import { TAU } from '../../src/core/mathUtils';
import { PLAZA } from '../../src/world/paths';
import { isOnPath, pathCentreline } from '../../src/world/pathGraph';
import { type Claim, type GroundClaims } from '../../src/boot/groundClaims';
import { type CoasterRoute } from '../../src/world/coaster/route';
import { refusal, type FeatureBuilder, type Increment, type Refusal } from '../boot/featureBuilder';
import { cruiserClearanceForPoints } from '../../src/world/coaster/clearance';
import { CABLE_RADIUS, FAIRY_POLE_COUNT, KNOB_RISE, POLE_DRAWN_TOP_RADIUS, POLE_HEIGHT, POLE_RADIUS, POST_AXIS_STEP, WIDEST_DRAWN_RADIUS, fairyAnchorAt, fairySpan, type FairyChain, type FairyPole } from '../../src/world/FairyLights';
/**
 * **The fairy-light poles' builder.** Moved verbatim from
 * `src/world/FairyLights.ts`, which keeps the chain type and draws them.
 * Build-time only.
 */

/**
 * **How much of the park's drawn path network carries fairy lights.**
 *
 * Jim, 18 Sep 2026, on seeing the plaza ring: *"the fairy lights look good but
 * they should be all over the park as well, not just in around the centre —
 * put them around a large proportion of the paths too."*
 *
 * "A large proportion" is a judgement, so it is made a measured one: the drawn
 * runs are taken **longest first** until this fraction of the network's total
 * length is covered. Longest-first rather than at random because lights read
 * as *avenues* — a continuous run a child can walk down — and scattering the
 * same pole budget over many short stubs would give the same count with none
 * of the effect.
 *
 * Two thirds, and not more, because poles are **not free**: they claim ground
 * earlier in the world phase than lamp posts and walls, so every pole is a
 * lamp slot that may no longer fit (measured: the plaza ring alone costs one
 * lamp on the canonical seed and three on seed 8). Dense enough to read as
 * "all over the park", sparse enough to leave the park its lamps.
 */
const LIT_PATH_FRACTION = 2 / 3;


/**
 * Metres between poles along a path run.
 *
 * Matched to the plaza ring, which the family has already approved the look
 * of: ten poles on a circle of radius 11.25 is a span of about 7.1 m, and the
 * cable's sag is tuned to that. A longer span would hang the same sag over
 * more distance and read slack; a shorter one would crowd the path with posts.
 */
const PATH_POLE_SPACING = 7.1;


/**
 * A run shorter than this carries no lights at all.
 *
 * **Because a lone pole draws nothing.** A cable needs two *adjacent* poles,
 * so a run with room for only one is a post with no lights on it — exactly the
 * "healthy pole count, no actual lights" failure this file's own invariant
 * exists to catch. Two spans' worth is the shortest run that can look like
 * anything.
 */
const MIN_LIT_RUN_LENGTH = PATH_POLE_SPACING * 2;


/**
 * Clear air a pole keeps between itself and the Sky Cruiser's swept car.
 *
 * `PLAYER_RADIUS` rather than nothing, because "does not quite touch" is not a
 * clearance — the ride is drawn from a sampled centreline and the pole from a
 * sampled axis, and two samplings that merely fail to overlap can still look
 * like contact from the seat.
 */
const POLE_RIDE_CLEARANCE = PLAYER_RADIUS;


/**
 * Extra points interpolated along each cable segment **for the clearance test
 * only** — the drawn cable needs no more than its bulb stations.
 *
 * A span is ~7.1 m over ten stations, so the drawn samples sit ~0.71 m apart
 * while the post is sampled every 0.5 m. Against a 0.62 m clearance threshold
 * that understates a grazing intrusion by up to half the gap between samples,
 * which is the same "a coarse zero is not a proof" caveat `check:swept-bus`
 * prints about its own post stepping.
 */
const CABLE_TEST_SUBDIVISIONS = 2;


/**
 * **Every world point the rig occupies for one pole and its spans — what the
 * clearance test asks about.**
 *
 * It returns the *drawn* geometry rather than a description of it, and the
 * drawing is built from the same calls, so a part cannot be guarded in one
 * place and drawn in another. That is the point: the first version of the
 * ride-clearance test covered the 4.4 m post and nothing else, and seed 326
 * duly built a park whose Sky Cruiser passed clean between two poles, cleared
 * both, and went through the **bulbs** hanging between them.
 *
 * **What it covers, precisely.** The post's axis (inflated by
 * {@link WIDEST_DRAWN_RADIUS}, at a step derived so the cylinder wall is
 * genuinely inside the guard), the knob, and every cable and bulb slung to a
 * standing neighbour. A **second string** hung between the same poles is
 * covered for free, because it comes from {@link fairySpan}.
 *
 * **A part bolted to the post itself is not** — a pennant, a lantern on a
 * bracket, anything reaching further out than the knob. Such a part must be
 * added *here*, and if it is wider than {@link WIDEST_DRAWN_RADIUS} that
 * constant must learn about it. The check at the top of this file makes a
 * collider narrower than the drawing fail loudly; nothing yet makes a *guard*
 * narrower than the drawing fail, and that is the honest limit of this
 * function.
 */
export function fairyOccupiedPoints(
  x: number,
  z: number,
  neighbours: readonly { readonly x: number; readonly z: number }[],
): Vector3[] {
  const points: Vector3[] = [];
  const ground = terrainHeight(x, z);
  const up = upAt(x, ground, z, new Vector3());
  // the post itself, sampled up its leaning axis, and its knob on top
  for (let h = 0; h <= POLE_HEIGHT; h += POST_AXIS_STEP) {
    points.push(new Vector3(x + up.x * h, ground + up.y * h, z + up.z * h));
  }
  // The very top, in case POLE_HEIGHT is not a whole number of steps.
  points.push(new Vector3(x + up.x * POLE_HEIGHT, ground + up.y * POLE_HEIGHT, z + up.z * POLE_HEIGHT));
  const top = POLE_HEIGHT + KNOB_RISE;
  points.push(new Vector3(x + up.x * top, ground + up.y * top, z + up.z * top));
  // every cable and bulb slung from it to a neighbour that is already standing
  const here = fairyAnchorAt(x, z, new Vector3());
  for (const other of neighbours) {
    const there = fairyAnchorAt(other.x, other.z, new Vector3());
    const span = fairySpan(here, there);
    points.push(...span.cable, ...span.bulbs);
    // Interpolate between the cable's own stations so the test samples it at
    // least as finely as it samples the post.
    for (let i = 1; i < span.cable.length; i += 1) {
      const a = span.cable[i - 1] as Vector3;
      const b = span.cable[i] as Vector3;
      for (let k = 1; k <= CABLE_TEST_SUBDIVISIONS; k += 1) {
        points.push(new Vector3().lerpVectors(a, b, k / (CABLE_TEST_SUBDIVISIONS + 1)));
      }
    }
  }
  return points;
}


/**
 * **Where the ring of poles stands — asked for, never written down.**
 *
 * This was `FAIRY_RING_RADIUS = 13.5`, a literal picked once to sit between
 * the plaza and the promenade. The promenade moved (it is `RING_RADIUS`, the
 * fountain's own radius + 5.5) and the literal did not, so the whole ring
 * ended up 0.36–0.41 m *inside* the main loop's paving: every pole tested as
 * standing on a path, every pole was skipped, and the park had no fairy
 * lights at all. Nobody saw it, because nothing asserted that any were
 * placed.
 *
 * {@link plazaVerge} is the one owner of "the lawn between the plaza and the
 * loop" and this is its middle — the furthest a ring can be from both kinds
 * of paving at once. If either the plaza or the loop moves, the ring follows.
 */
function fairyRingRadius(): number {
  return plazaVerge().middle;
}


/**
 * How much clear ground a pole wants between itself and the nearest paving.
 *
 * **Taken from the game, not from the ring's own geometry**: the pole's own
 * collider plus the width a child genuinely needs to walk past it, which is
 * `PLAYER_RADIUS * 2` — the same `WALKABLE_GAP` `test/procgen/invariants.ts`
 * uses, and the width `NavGrid` fattens every collider by before it will call
 * a cell walkable. A pole closer to the kerb than this is a pole pinching the
 * promenade, whatever the drawing looks like.
 *
 * It replaces a bare `1.2` that was neither of those things. It is *stricter*
 * than the number it replaces (1.52 m against 1.20 m), so no pole that used to
 * be refused is now allowed through.
 */
const POLE_PAVING_CLEARANCE = POLE_RADIUS + PLAYER_RADIUS * 2;


/**
 * One planned slot before the registry has been asked about it: where the pole
 * would like to stand, and — for a path pole — enough about its run to let
 * {@link fairyPoleBuilder} slide it along when something needs the space.
 */
interface PoleSlot {
  readonly chain: number;
  /** Candidate positions in preference order: the wanted spot, then slides along the run, then the other side. */
  readonly candidates: readonly (readonly [number, number])[];
  readonly label: string;
}


/**
 * **Where every pole would like to stand**, ring and paths together.
 *
 * Read off the **drawn** centreline (`pathCentreline`), which is the paving
 * the child actually walks, rather than off the route definitions that
 * generated it — the same reason every invariant in this repo measures the
 * built park. Each sample carries its own `halfWidth`, so a pole is offset
 * from the centre line by that plus its clearance and lands beside the paving
 * whatever width that particular run was drawn at. Nothing here restates a
 * path width.
 */
function planPoleSlots(): { chains: { closed: boolean; count: number }[]; slots: PoleSlot[] } {
  const chains: { closed: boolean; count: number }[] = [];
  const slots: PoleSlot[] = [];

  // --- the plaza ring, chain 0 -------------------------------------------
  const radius = fairyRingRadius();
  chains.push({ closed: true, count: FAIRY_POLE_COUNT });
  for (let i = 0; i < FAIRY_POLE_COUNT; i += 1) {
    const angle = (i / FAIRY_POLE_COUNT) * TAU;
    const x = PLAZA.x + Math.cos(angle) * radius;
    const z = PLAZA.z + Math.sin(angle) * radius;
    // A ring pole has nowhere to slide to: moving it along the ring would
    // collide with its neighbour and moving it off changes the circle. Its one
    // candidate is its bearing, and it is left out if that is refused — which
    // is what makes the gap read as a gateway.
    slots.push({ chain: 0, candidates: [[x, z]], label: `ring pole ${i}` });
  }

  // --- the path runs ------------------------------------------------------
  const samples = pathCentreline();
  const runs = new Map<number, { x: number; z: number; halfWidth: number }[]>();
  for (const sample of samples) {
    let run = runs.get(sample.run);
    if (!run) runs.set(sample.run, (run = []));
    run.push({ x: sample.x, z: sample.z, halfWidth: sample.halfWidth });
  }

  const measured = [...runs.entries()]
    .map(([id, points]) => {
      let length = 0;
      for (let i = 1; i < points.length; i += 1) {
        length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
      }
      return { id, points, length };
    })
    .filter((run) => run.length >= MIN_LIT_RUN_LENGTH)
    // Longest first, then by id so the order cannot depend on Map iteration
    // order for two runs of identical length.
    .sort((a, b) => b.length - a.length || a.id - b.id);

  const totalLength = measured.reduce((sum, run) => sum + run.length, 0);
  let covered = 0;

  for (const run of measured) {
    if (covered > totalLength * LIT_PATH_FRACTION) break;
    covered += run.length;
    const chain = chains.length;
    let count = 0;
    let since = PATH_POLE_SPACING; // a pole at the very start of the run
    for (let i = 1; i < run.points.length; i += 1) {
      const a = run.points[i - 1]!;
      const b = run.points[i]!;
      const step = Math.hypot(b.x - a.x, b.z - a.z);
      if (step < 1e-6) continue;
      since += step;
      if (since < PATH_POLE_SPACING) continue;
      since = 0;
      // The run's own perpendicular here, and its own drawn half-width.
      const nx = -(b.z - a.z) / step;
      const nz = (b.x - a.x) / step;
      const offset = b.halfWidth + POLE_PAVING_CLEARANCE;
      const candidates: (readonly [number, number])[] = [];
      // Preference: the near side, then slid along the run either way, then
      // the far side and the same slides. Sliding along a run is what lets a
      // path pole `accommodate` instead of simply being forgone.
      for (const side of [1, -1]) {
        for (const slide of [0, 1, -1, 2, -2]) {
          const px = b.x + nx * offset * side + ((b.x - a.x) / step) * slide * (PATH_POLE_SPACING / 3);
          const pz = b.z + nz * offset * side + ((b.z - a.z) / step) * slide * (PATH_POLE_SPACING / 3);
          candidates.push([px, pz]);
        }
      }
      slots.push({ chain, candidates, label: `path run ${run.id} pole ${count}` });
      count += 1;
    }
    chains.push({ closed: false, count });
  }

  return { chains, slots };
}


/**
 * **How far out from the pole two cables tied to it run inside each other**,
 * in metres along the cable — the drawn cables, each a `CatmullRomCurve3`
 * through {@link fairySpan}'s points exactly as the constructor hangs it.
 *
 * Two strings tied to one post part at whatever angle their far poles make.
 * Wide, and their tubes separate inside the wood; narrow, and they leave the
 * post as one doubled cable. Seed 15 at its recorded restart strung
 * `fairy-string-59` 14.5 m from (-33.2, -18.4) to (-47.7, -19.0) and
 * `fairy-string-60` straight back to (-41.7, -20.5), 15.9° apart: the second
 * string retraced the first, the two tubes ran through each other for 18 cm
 * outside the post, and `check:coplanar` found their facets sharing a plane.
 * The same fold stood unreported on other seeds (0.8°, 2.6° and 5.9° on seeds
 * 3 and 4) only because their facets happened not to line up.
 *
 * Walked rather than solved from the angle at the tie, so it measures the
 * curve that is drawn and not a straight-line idealisation of it.
 */
export function fairyCablesRunTogether(shared: Vector3, farA: Vector3, farB: Vector3, upTo: number): number {
  const a = new CatmullRomCurve3(fairySpan(shared, farA).cable);
  const b = new CatmullRomCurve3(fairySpan(shared, farB).cable);
  const lengthA = a.getLength();
  const lengthB = b.getLength();
  const reach = Math.min(upTo, lengthA, lengthB);
  const pa = new Vector3();
  const pb = new Vector3();
  for (let s = CABLE_WALK_STEP; s <= reach; s += CABLE_WALK_STEP) {
    a.getPointAt(s / lengthA, pa);
    b.getPointAt(s / lengthB, pb);
    if (pa.distanceTo(pb) > CABLE_RADIUS * 2) return s;
  }
  return reach;
}

/** Arc-length step for {@link fairyCablesRunTogether}: a fifth of the cable's own radius. */
const CABLE_WALK_STEP = 0.005;

/**
 * **Two cables tied to one post must have parted before they leave it.**
 *
 * The tie is on the post's axis, so anything within the post's drawn radius of
 * it is inside the wood and nobody sees two tubes meeting there — that is
 * simply the knot. Beyond it, two cables running through each other are one
 * string drawn twice over the same stretch: a fold, never a design. Both
 * numbers are the drawn geometry's own ({@link POLE_DRAWN_TOP_RADIUS}, the
 * post at the height the cable is tied; `CABLE_RADIUS`), so thickening either
 * moves the line with it.
 */
export const FAIRY_CABLES_PART_WITHIN = POLE_DRAWN_TOP_RADIUS;

/**
 * **Fairy-light poles, as a feature builder.** One increment is one pole on
 * the ring round the plaza. A pole on paving is left out at once (as it always
 * was); a pole refused by the registry — a tree trunk, a bush, a wall —
 * returns an **optional** refusal naming the blockers, so the driver first
 * asks them to step aside and only then leaves the pole out.
 */
export function fairyPoleBuilder(
  claims: GroundClaims,
  out: FairyChain[],
  cruiserRoute: CoasterRoute | null,
): FeatureBuilder {
  const claimOf = (x: number, z: number): Claim => ({ kind: 'footprint', shape: { shape: 'disc', x, z, radius: POLE_RADIUS } });

  /** The plan, built once per solve and thrown away on `reset`. */
  let plan: ReturnType<typeof planPoleSlots> | null = null;
  /** Placed slots, in order, so `back` is exact. */
  const placed: (readonly [number, number] | null)[] = [];
  /** Which slot each committed section owns, for `accommodate`. */
  const sectionOfSlot: number[] = [];

  const ensurePlan = (): ReturnType<typeof planPoleSlots> => (plan ??= planPoleSlots());

  /** Rebuild `out` (what the drawing reads) from `placed`. */
  const publish = (): void => {
    const { chains, slots } = ensurePlan();
    const built: FairyPole[][] = chains.map((chain) => new Array<FairyPole>(chain.count).fill(null));
    const nextIndex = chains.map(() => 0);
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i]!;
      const at = nextIndex[slot.chain]!;
      nextIndex[slot.chain] = at + 1;
      const spot = placed[i];
      if (i < placed.length && spot) (built[slot.chain] as FairyPole[])[at] = { x: spot[0], z: spot[1] };
    }
    out.length = 0;
    for (let c = 0; c < chains.length; c += 1) {
      out.push({ closed: chains[c]!.closed, slots: built[c]! });
    }
  };

  /** The first candidate of `slot` that is off the paving and unrefused, with who refused the rest. */
  /**
   * The poles this one will be strung to, of those already standing — **on
   * both sides**.
   *
   * At `advance` time only the previous slot can be standing, so looking
   * backwards is complete. At **`accommodate`** time it is not: slot `i + 1`
   * may already be up, and moving slot `i` re-draws *its* cable too. Checking
   * only backwards left that cable re-hung to a new position and never
   * re-tested against the ride — the same defect as the bulbs, one level in,
   * and the driver's trace shows dozens of `accommodated fairyLights#N for
   * lamps` per seed, so it is exercised rather than theoretical.
   *
   * A closed chain also strings its last slot back to its first, in both
   * directions.
   */
  const standingNeighbours = (index: number): { x: number; z: number }[] => {
    const { chains, slots } = ensurePlan();
    const slot = slots[index];
    if (!slot) return [];
    const mine = slots
      .map((s, i) => ({ s, i }))
      .filter((e) => e.s.chain === slot.chain);
    const at = mine.findIndex((e) => e.i === index);
    const out2: { x: number; z: number }[] = [];
    const take = (e: { i: number } | undefined): void => {
      const p = e ? placed[e.i] : undefined;
      if (p) out2.push({ x: p[0], z: p[1] });
    };
    take(mine[at - 1]);
    take(mine[at + 1]);
    if (chains[slot.chain]?.closed) {
      if (at === mine.length - 1) take(mine[0]);
      if (at === 0) take(mine[mine.length - 1]);
    }
    return out2;
  };

  /**
   * The standing pole `offset` places along this slot's chain, or `null` —
   * wrapping round a closed chain, stopping at the ends of an open one.
   */
  const standingAlong = (index: number, offset: number): readonly [number, number] | null => {
    const { chains, slots } = ensurePlan();
    const slot = slots[index];
    if (!slot) return null;
    const mine: number[] = [];
    slots.forEach((s, i) => {
      if (s.chain === slot.chain) mine.push(i);
    });
    let at = mine.indexOf(index) + offset;
    if (chains[slot.chain]?.closed) at = ((at % mine.length) + mine.length) % mine.length;
    const other = mine[at];
    if (other === undefined || other === index) return null;
    return placed[other] ?? null;
  };

  /**
   * Would standing this slot's pole at (x, z) hang any two cables through
   * each other beyond the post they share? See {@link FAIRY_CABLES_PART_WITHIN}.
   *
   * A pole decides three ties: its own (between its two cables), and one at
   * each standing neighbour (between the cable it adds there and the one the
   * neighbour already carries to *its* far side). All three are asked, because
   * a fold is just as visible at the neighbour as at the pole that caused it.
   * Cables only ever join neighbours, and a missing pole leaves a gap with no
   * cable across it, so a tie with either side empty has nothing to fold.
   */
  const foldsACable = (index: number, x: number, z: number): boolean => {
    const anchor = (p: readonly [number, number]): Vector3 => fairyAnchorAt(p[0], p[1], new Vector3());
    const here = fairyAnchorAt(x, z, new Vector3());
    const prev = standingAlong(index, -1);
    const next = standingAlong(index, 1);
    const prevPrev = prev ? standingAlong(index, -2) : null;
    const nextNext = next ? standingAlong(index, 2) : null;
    const upTo = FAIRY_CABLES_PART_WITHIN + CABLE_WALK_STEP;
    const folds = (shared: Vector3, a: Vector3, b: Vector3): boolean =>
      fairyCablesRunTogether(shared, a, b, upTo) > FAIRY_CABLES_PART_WITHIN;
    if (prev && next && folds(here, anchor(prev), anchor(next))) return true;
    if (prev && prevPrev && folds(anchor(prev), anchor(prevPrev), here)) return true;
    if (next && nextNext && folds(anchor(next), here, anchor(nextNext))) return true;
    return false;
  };

  const chooseSpot = (
    slot: PoleSlot,
    index: number,
    from: number,
    keepClearOf: readonly Claim[],
  ): { spot: readonly [number, number]; claim: Claim } | { blockers: string[] } => {
    const neighbours = standingNeighbours(index);
    const blockers = new Set<string>();
    for (let c = from; c < slot.candidates.length; c += 1) {
      const [x, z] = slot.candidates[c]!;
      // Beside the paving, never on it — and never so close that the pole
      // pinches the lane a child walks down.
      if (isOnPath(x, z, POLE_PAVING_CLEARANCE)) continue;
      // **Nor on a bridge.** A bridge's deck carries its own paving, which the
      // drawn-path samples above do not see, so `isOnPath` reads a pole on the
      // deck as standing 1.9 m off the path. Seed 11 put `fairy-pole-88` on the
      // walkway of the bridge at (1.5, -31.6), making the crossing unwalkable
      // 11 m along its centreline. The footprint's one owner answers, with the
      // pole's own radius as the margin (it reaches a little past what the
      // built bridge covers — seven more poles on seed 11 stood inside it but
      // outside the masonry, and those simply slide along their runs).
      if (pointStandsOnABridgeRamp(x, z, POLE_RADIUS)) continue;
      // **Nor where a child is set down or served.** A pole that slides along
      // its run can slide onto a ride exit or a doormat — seed 428's
      // `fairy-pole-60` came to rest 1.30 m from `exit-railRace` and pushed a
      // child standing there 0.12 m. The owners the lamps and the scenery
      // already ask: `onRideExit` with the room to walk past the pole, and
      // `nearADoormat`.
      if (onRideExit(x, z, POLE_RADIUS + WALKABLE_GAP)) continue;
      if (nearADoormat(x, z)) continue;
      // **Nor in the park gate's doorway.** The arch promises the 7 m between
      // its pier faces as the way in, and nothing claims that ground: the
      // gateway path's corridor claim is only as wide as the path itself
      // (`entrance/roadCorridor.ts`), and `isOnPath` only keeps a pole off the
      // paving. So seed 15 stood `fairy-pole` at (-3.1, 59.1) — 0.9 m in from
      // the gate line, 3.1 m off the axis, inside the arch — and another at
      // (3.1, 57.8), and both were legal. The span's one owner answers, with the
      // pole's own radius as the margin, and the pole slides along its run or
      // is left out like any other refusal.
      if (isInGateArchSpan(x, z, POLE_RADIUS)) continue;
      // **Ask the ride, before standing anything up.** A pole is 4.4 m tall and
      // the claims registry is a ground-footprint system — it cannot see what
      // sweeps through the air above a square metre. Seed 24 built a park whose
      // Sky Cruiser passed through `fairy-pole-84` because nothing asked.
      //
      // This is inside the candidate loop on purpose: a pole refused overhead
      // slides along its own run or swaps sides like any other refusal, and is
      // only left out when every candidate fails.
      // **Ask the ride about everything this pole will put in the air**, not
      // just the post: the cables slung to its standing neighbours and the
      // bulbs hanging under them. `fairyOccupiedPoints` returns the drawn
      // geometry, and the drawing is built from the same calls, so a part
      // cannot be guarded here and drawn differently there.
      if (
        cruiserRoute &&
        cruiserClearanceForPoints(
          cruiserRoute,
          fairyOccupiedPoints(x, z, neighbours),
          WIDEST_DRAWN_RADIUS,
        ) < POLE_RIDE_CLEARANCE
      ) {
        continue;
      }
      // Not on, or pinching the gap beside, another fairy pole — see
      // {@link FAIRY_POLE_SPACING}. Every standing pole but this slot's own.
      if (
        placed.some(
          (other, i) => i !== index && other !== null && Math.hypot(other[0] - x, other[1] - z) < FAIRY_POLE_SPACING,
        )
      ) {
        continue;
      }
      // **Nor where its cables would fold back over a neighbour's.** A pole
      // slid along its run can overtake the next one (slides reach 4.7 m
      // either way on a 7.1 m spacing), and the chain then doubles back on
      // itself — two strings drawn over one stretch, through each other. It
      // tries its next candidate like any other refusal. See
      // {@link FAIRY_CABLES_PART_WITHIN}.
      if (foldsACable(index, x, z)) continue;
      const claim = claimOf(x, z);
      if (keepClearOf.some((other) => claimsOverlap(claim, other))) continue;
      const refused = claims.blockers('fairyLights', [claim]).map((b) => b.feature);
      if (refused.length === 0) return { spot: [x, z], claim };
      for (const blocker of refused) blockers.add(blocker);
    }
    return { blockers: [...blockers] };
  };

  return {
    name: 'fairyLights',
    // **Poles go up only once the park's own greenery and walls have theirs.**
    //
    // The driver is a round-robin: `nextRunnable` rotates a cursor and a
    // builder is gated only by the deps it declares. This said `['fountain']`
    // — inherited from when the feature was ten poles in the plaza verge,
    // where racing anything for ground was harmless.
    //
    // Lighting two thirds of the paths made it ninety-odd poles spread across
    // the whole park, all of them claiming ground *interleaved with* the walls,
    // the trees and the bushes. Measured on seed 131: with the poles disabled
    // the park builds 182 bush clumps and 33/38 walls, byte-identical to the
    // base; with them enabled it builds 177 and 32/37, and 177 is under the
    // 180 the park's own invariant requires. The poles were not displacing the
    // greenery — nothing was refused — they were simply getting there first.
    //
    // Declaring the real dependency fixes it structurally rather than by
    // hoping: a decoration waits for the things the park is actually made of.
    // It is the same precedence the `advance` below already honours by never
    // naming a blocker, expressed where the driver can enforce it.
    deps: ['fountain', 'walls', 'trees', 'bushes'],
    // A pole is cheap to move: no dependants, nothing derived from where it
    // stands. The driver may ask it to step aside before anything heavier.
    movable: true,
    *advance() {
      const { slots } = ensurePlan();
      while (placed.length < slots.length) {
        const index = placed.length;
        const slot = slots[index]!;
        const chosen = chooseSpot(slot, index, 0, []);
        if ('blockers' in chosen) {
          // **A fairy pole never asks anything to move.** It is left out.
          //
          // Everything that can block one — the fountain, a wall, a tree, a
          // bush — is *earlier* in the world phase's build order than
          // `fairyLights`, and the driver's precedence is that earlier means
          // "needs the space more". A pole that named its blockers would have
          // the driver ask one of them to step aside for a decoration, which
          // is the wrong way round.
          //
          // It is not a theoretical wrong way round. Lighting two thirds of
          // the paths and letting poles name blockers took seed 131 from 182
          // bushes to 177 and tripped the park's bush floor (then a flat 180) — measured
          // against the base with the layout proved unmoved and `unwinds=0` on
          // both sides, so it was displacement through accommodation and
          // nothing else. Yielding costs a handful of poles out of ~100 and
          // costs the park none of its greenery.
          //
          // The same line therefore covers the two ways a slot goes empty, and
          // they look identical from here by design: standing on paving (the
          // gateway gap) and standing where something older already is.
          placed.push(null);
          publish();
          continue;
        }
        placed.push(chosen.spot);
        sectionOfSlot.push(index);
        publish();
        return {
          claims: [chosen.claim],
          label: `${slot.label} at (${chosen.spot[0].toFixed(1)}, ${chosen.spot[1].toFixed(1)})`,
        };
      }
      return 'done';
    },
    back() {
      // Trailing skipped slots carry no claim, so they come off with the
      // increment that follows them — the same shape the ring always had.
      while (placed.length > 0 && placed[placed.length - 1] === null) placed.pop();
      placed.pop();
      sectionOfSlot.pop();
      publish();
    },
    /**
     * **Slide the pole along its own run** rather than refusing.
     *
     * This is the standing backtrack rule applied to a decoration: a path pole
     * has somewhere else to go — a few metres up or down its run, or the other
     * side of it — so being asked to move is an ordinary request, not a reason
     * to be left out. A *ring* pole genuinely has nowhere (moving it along the
     * ring hits its neighbour, moving it off stops it being a circle), so it
     * has exactly one candidate and this correctly refuses for it.
     */
    accommodate(claimIndex: number, _attempt: number, keepClearOf: readonly Claim[]): Increment | Refusal {
      const { slots } = ensurePlan();
      const section = claims.sectionOfClaim('fairyLights', claimIndex);
      const index = sectionOfSlot[section];
      if (index === undefined) return refusal(`fairyLights: no pole owns claim ${claimIndex}`);
      const slot = slots[index];
      const current = placed[index];
      if (!slot || !current) return refusal(`fairyLights: no pole owns claim ${claimIndex}`);
      const moved = chooseSpot(slot, index, 1, keepClearOf);
      if ('blockers' in moved) {
        return refusal(`fairyLights: ${slot.label} has nowhere else on its run to stand`);
      }
      placed[index] = moved.spot;
      publish();
      return {
        claims: [moved.claim],
        label: `${slot.label} moved from (${current[0].toFixed(1)}, ${current[1].toFixed(1)}) to (${moved.spot[0].toFixed(1)}, ${moved.spot[1].toFixed(1)})`,
      };
    },
    forgo() {
      placed.push(null);
      publish();
    },
    supply: () => 1,
    reset() {
      placed.length = 0;
      sectionOfSlot.length = 0;
      plan = null;
      out.length = 0;
    },
  };
}


/** Do two disc footprints overlap? Used against the claims a refused asker could not commit. */
function claimsOverlap(a: Claim, b: Claim): boolean {
  if (a.shape.shape !== 'disc' || b.shape.shape !== 'disc') return false;
  return Math.hypot(a.shape.x - b.shape.x, a.shape.z - b.shape.z) < a.shape.radius + b.shape.radius;
}
