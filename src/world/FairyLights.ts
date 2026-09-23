import {
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../core/palette';
import { clamp01, Rng, TAU } from '../core/mathUtils';
import { placeOnSphere, terrainHeight, tiltToSphere, upAt } from './terrain';
import { PLAZA, plazaVerge, pointStandsOnABridgeRamp } from './paths';
import { cruiserClearanceForPoints } from './coaster/clearance';
import type { CoasterRoute } from './coaster/route';
import { PLAYER_RADIUS } from '../core/constants';
import { nearADoormat, onRideExit } from './Scenery';
import { isOnPath, pathCentreline } from './pathGraph';
import type { FrameContext, GameSystem } from '../core/types';
import type { CollisionWorld } from './Collision';
import type { Claim, GroundClaims } from '../boot/groundClaims';
import { refusal, type FeatureBuilder, type Increment, type Refusal } from '../boot/featureBuilder';

/** One pole slot: where it stands, or `null` where it was left out. */
export type FairyPole = { readonly x: number; readonly z: number } | null;

/**
 * **A run of poles carrying one continuous set of strings.**
 *
 * `closed` is the plaza ring, whose last pole is strung back to its first; an
 * open chain is a path run, strung only between neighbours. Slots are kept
 * **sparse** — `null` where a pole was left out — rather than compacted, so a
 * skip leaves a *gap* in the chain and no cable ever spans one. (Compacting
 * was the latent bug seed 18 exposed when a path moved onto a ring pole.)
 */
export interface FairyChain {
  readonly closed: boolean;
  readonly slots: readonly FairyPole[];
}

/** Poles round the fountain plaza. */
export const FAIRY_POLE_COUNT = 10;

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
 * **What the rig actually draws on a post.** Owned here because the ride
 * guard has to inflate by it, and a literal in the drawing that the guard
 * cannot see is the whole bug this file keeps re-learning.
 */
const POLE_DRAWN_TOP_RADIUS = 0.11;
const POLE_DRAWN_BOTTOM_RADIUS = 0.17;
const KNOB_RADIUS = 0.22;
/** How far the knob's centre sits above the post's top. */
const KNOB_RISE = 0.12;

/**
 * The widest thing a post puts in the air — **derived, so widening the post
 * widens the guard with it.**
 *
 * The clearance test samples a post's *axis* and inflates by this. Inflating
 * by the collider radius instead would have been a tolerance masquerading as
 * ownership: draw a fatter post and the guard would quietly under-cover it
 * with nothing to say so.
 */
const WIDEST_DRAWN_RADIUS = Math.max(POLE_DRAWN_BOTTOM_RADIUS, KNOB_RADIUS);

/**
 * The collider a pole registers, and so the ground it claims.
 *
 * Deliberately **not** the same number as {@link WIDEST_DRAWN_RADIUS}: this is
 * how much ground the pole owns, which is a little more than the wood, and it
 * is also what {@link POLE_PAVING_CLEARANCE} is built from. It was doing three
 * unrelated jobs — collider, guard inflation, paving clearance — and the guard
 * has been given its own owner above.
 */
const POLE_RADIUS = 0.28;
/** The same figure, for the invariant that measures pole spacing off the drawn park. */
export const FAIRY_POLE_RADIUS = POLE_RADIUS;

/**
 * **How far apart two fairy poles must stand** — room for a child to walk
 * between them, which is two pole radii plus `WALKABLE_GAP` (two player
 * radii), the width `NavGrid` fattens every collider by.
 *
 * The claims registry never refuses a feature for its own claims, so nothing
 * stopped a pole on one path run landing on a pole of the run that meets it:
 * seed 208 stood `fairy-pole-39` and `fairy-pole-58` **0.032 m** apart (two
 * posts drawn through each other, their knobs z-fighting — found by
 * `check:coplanar`), and every seed had pairs well inside a pole's own
 * collider (0.087 m, 0.204 m, 0.291 m on the same seed). A pole refused this
 * way slides along its run like any other refusal.
 */
export const FAIRY_POLE_SPACING = POLE_RADIUS * 2 + PLAYER_RADIUS * 2;

// **A pole must not be drawn wider than the ground it claims.** Anything a
// child can see and lean on has a collider that covers it (CLAUDE.md), and a
// knob fatter than the collider would be a visible thing she could walk
// through the edge of. A constant comparison, so if it ever fires the code is
// wrong before it ever runs.
if (POLE_RADIUS < WIDEST_DRAWN_RADIUS) {
  throw new Error(
    `fairy pole: collider radius ${POLE_RADIUS} is narrower than the widest drawn part ${WIDEST_DRAWN_RADIUS}`,
  );
}

/** How tall a pole stands. The drawing and the overhead test must agree, so both ask here. */
const POLE_HEIGHT = 4.4;

/**
 * Clear air a pole keeps between itself and the Sky Cruiser's swept car.
 *
 * `PLAYER_RADIUS` rather than nothing, because "does not quite touch" is not a
 * clearance — the ride is drawn from a sampled centreline and the pole from a
 * sampled axis, and two samplings that merely fail to overlap can still look
 * like contact from the seat.
 */
const POLE_RIDE_CLEARANCE = PLAYER_RADIUS;

/** How far below the pole's top the cable is tied on. */
const ANCHOR_DROP = 0.25;
/** How far a cable sags at mid-span. */
const CABLE_SAG = 1.15;
/** How far a bulb hangs under the cable. */
const BULB_DROP = 0.18;
/** Bulbs on one string. */
const BULBS_PER_STRING = 9;

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
 * How finely the clearance test walks a post's axis — **derived so the guard
 * genuinely contains the drawn cylinder, rather than to within a tolerance.**
 *
 * The test samples the axis and inflates each sample by
 * {@link WIDEST_DRAWN_RADIUS}. A vertex on the cylinder wall exactly midway
 * between two samples is `hypot(step / 2, POLE_DRAWN_BOTTOM_RADIUS)` from the
 * nearest of them, so covering it needs
 *
 *   `hypot(step / 2, bottomRadius) <= widestDrawnRadius`
 *
 * At 0.5 m that is `hypot(0.25, 0.17) = 0.302` against `0.22` — the wall was
 * standing 0.082 m outside its own guard, and the honest form of the promise
 * would have been "covered to within 0.082 m". The step below satisfies the
 * inequality instead, so the promise is simply true and no tolerance has to be
 * quoted or maintained.
 */
const POST_AXIS_STEP = 0.25;

if (Math.hypot(POST_AXIS_STEP / 2, POLE_DRAWN_BOTTOM_RADIUS) > WIDEST_DRAWN_RADIUS) {
  throw new Error(
    `fairy pole: axis step ${POST_AXIS_STEP} leaves the cylinder wall outside the guard ` +
      `(${Math.hypot(POST_AXIS_STEP / 2, POLE_DRAWN_BOTTOM_RADIUS).toFixed(3)} > ${WIDEST_DRAWN_RADIUS})`,
  );
}

/**
 * **Where a pole's cable is tied**, in drawn world space.
 *
 * The post leans with the park, so its anchor is not `(x, ground + h, z)` —
 * it is that point carried along the local up, exactly as `placeOnSphere`
 * carries the pole itself.
 */
export function fairyAnchorAt(x: number, z: number, into: Vector3): Vector3 {
  const ground = terrainHeight(x, z);
  const up = upAt(x, ground, z, new Vector3());
  const h = POLE_HEIGHT - ANCHOR_DROP;
  return into.set(x + up.x * h, ground + up.y * h, z + up.z * h);
}

/**
 * **The sampled cable slung between two poles, bulbs included — the one owner.**
 *
 * Both the drawing and the ride-clearance test read this. They must, and the
 * reason is a defect this PR shipped and had to fix: the overhead test guarded
 * the 4.4 m *post* and nothing else, so on seed 326 the Sky Cruiser passed
 * clean between two poles, cleared both, and went **through `fairy-bulbs`** —
 * the lights strung between them, which hang in air where there is no pole at
 * all.
 *
 * The sag, the anchor drop and the bulb drop used to be literals inside the
 * constructor. Re-deriving them in the builder would have been the very
 * two-definitions bug this branch exists to kill: the next person to tune the
 * sag would have silently un-guarded the ride, and nothing would have said so.
 *
 * Returns the cable points; `withBulbs` adds the bulb positions hanging under
 * it, which are what the ride actually strikes first.
 */
export function fairySpan(from: Vector3, to: Vector3): { cable: Vector3[]; bulbs: Vector3[] } {
  const cable: Vector3[] = [];
  const bulbs: Vector3[] = [];
  const up = new Vector3();
  for (let s = 0; s <= BULBS_PER_STRING + 1; s += 1) {
    const t = s / (BULBS_PER_STRING + 1);
    const sag = Math.sin(t * Math.PI) * CABLE_SAG;
    const point = new Vector3().lerpVectors(from, to, t);
    upAt(point.x, point.y, point.z, up);
    point.addScaledVector(up, -sag);
    cable.push(point);
    if (s > 0 && s <= BULBS_PER_STRING) bulbs.push(point.clone().addScaledVector(up, -BULB_DROP));
  }
  return { cable, bulbs };
}

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
      if (onRideExit(x, z, POLE_RADIUS + PLAYER_RADIUS * 2)) continue;
      if (nearADoormat(x, z)) continue;
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
          // bushes to 177 and tripped the park's own floor of 180 — measured
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

/**
 * Strings of fairy lights slung between wooden poles around the plaza.
 *
 * The bulbs are emissive spheres — cheap, and they read beautifully against a
 * dusk sky. Only a handful of real {@link PointLight}s are used (WebGL gets
 * unhappy with dozens), placed at the middle of each string so the ground
 * actually catches a warm pool of light.
 *
 * The whole rig fades in and out with {@link nightFactor}, which the DayNight
 * system sets each frame.
 */

/**
 * The plaza ring's share of "make the lit area three times bigger in radius".
 *
 * Same reasoning as the lamp posts, and the same trap — tripling `distance`
 * alone would have changed nothing visible, because three.js's `1/d^decay`
 * term had already taken the light to nothing well inside the old cut-off.
 * Decay 1.6 → 1.0, intensity solved (11 → 5.69) to hold the brightness
 * directly under a string exactly where it was. Ground pool 13.8 m → 39.8 m,
 * and the ratio holds between 2.9× and 3.0× across every visibility threshold
 * tested.
 */
const LIGHT_INTENSITY = 5.69;
const LIGHT_DECAY = 1.0;
const LIGHT_DISTANCE = 63;

/**
 * How many real {@link PointLight}s the **whole park's** fairy lights carry —
 * three, spread across every string there is, not three per run.
 *
 * It was three of the plaza ring's ten, which paid for `LampPosts` going
 * 3 → 5 without moving the park's total light count. Now that the lights
 * follow two thirds of the paths there are ninety-odd strings, and the
 * ration is the same three: a point light costs every lit fragment in the
 * scene, so one per chain would have multiplied the park's light count by
 * the number of runs.
 *
 * What carries the look instead is the bulbs, which are unlit emissive
 * geometry and cost nothing per-fragment — the real lights exist only so the
 * ground catches a warm pool somewhere, and three pools across the park is
 * what the frame budget buys.
 */
const REAL_LIGHTS = 3;

/**
 * Radius of the cable, in metres — a cord about 5 cm thick, matching the
 * tree-to-tree garlands exactly (`TreeLights.WIRE_RADIUS`, where the reasoning
 * is written out in full).
 *
 * Short version: these were `Line`s, and the family reported the string
 * between the lights as very faint. WebGL ignores `LineBasicMaterial.linewidth`
 * on essentially every platform, so a line is always one device pixel however
 * it is configured. The only way to give the cable presence is to make it
 * geometry, so it is a tube.
 */
const CABLE_RADIUS = 0.025;

/** Faces around the cable. See `TreeLights.WIRE_SIDES`. */
const CABLE_SIDES = 5;

export class FairyLights implements GameSystem {
  readonly name = 'fairyLights';
  readonly group = new Group();

  /** 0 = off (daytime), 1 = fully lit. Set by World from DayNight. */
  nightFactor = 0;

  private readonly bulbs: InstancedMesh;
  private readonly bulbMaterial: MeshBasicMaterial;
  private readonly bulbColours: Color[] = [];
  private readonly bulbBase: Color[] = [];
  private readonly lights: PointLight[] = [];
  private readonly strings: Mesh[] = [];
  private readonly bulbMatrix = new Matrix4();
  private readonly scratchColour = new Color();
  private readonly litCandidates: { at: Vector3; index: number }[] = [];

  /** Draws the chains the world phase decided ({@link fairyPoleBuilder}). */
  constructor(collision: CollisionWorld, chains: readonly FairyChain[]) {
    this.group.name = 'fairy-lights';
    const rng = new Rng(0x11a17);

    const poleHeight = POLE_HEIGHT;
    /**
     * **Each post is turned to its own bearing.**
     *
     * A pole is an eight-sided cylinder and a knob is a sphere, both built from
     * one shared geometry and, until now, all placed at yaw 0 — so every post
     * in the park had its facets pointing the same way. Two posts offset along
     * a direction parallel to one of those facets put that facet in the *same
     * plane*, which is a depth-buffer fight the moment both are on screen.
     *
     * With ten poles in one verge it never came up. With a hundred strung
     * along the paths `check:coplanar` found nine such pairs
     * (`fairy-pole-0`/`fairy-pole-10`, `fairy-pole-20`/`fairy-pole-21`, the
     * knobs against each other, and so on) — all of them new, all of them
     * mine.
     *
     * Turning each post to its own seeded bearing removes the shared plane at
     * its cause. ART_DIRECTION.md §7's rule is to delete the hidden face
     * rather than hold surfaces apart with a stand-off, and this is the same
     * spirit: no stand-off is introduced and no number has to be maintained —
     * the faces simply stop being parallel. A post is a rough wooden thing and
     * reads identically at any bearing, so nothing is lost.
     *
     * Its own `Rng`, not the one below: that one draws the strings' light
     * colours, and consuming it here would silently re-colour them.
     */
    const yawRng = new Rng(0x9a17e);
    const flat = new Vector3();

    const poleMaterial = new MeshStandardMaterial({
      color: PALETTE.woodDark,
      roughness: 0.9,
      metalness: 0,
    });
    // **Open-ended: the caps are hidden faces, so they are deleted rather than
    // nudged.** Turning each post to its own bearing (below) stops their SIDE
    // facets sharing a plane, but a cylinder's end caps are flat discs
    // perpendicular to its axis, and yaw cannot rotate a disc out of its own
    // plane. Two posts on similar ground therefore kept coplanar caps whatever
    // their bearing — which is why the first attempt at this only took
    // `check:coplanar`'s fairy seams from 9 to 6.
    //
    // Neither cap is ever seen: the top is inside the knob sphere that sits on
    // it (knob radius 0.22 against a 0.12 rise), and the bottom is at ground
    // level. ART_DIRECTION.md section 7 says to delete the hidden face rather
    // than hold surfaces apart, and that is exactly what this is.
    const poleGeometry = new CylinderGeometry(POLE_DRAWN_TOP_RADIUS, POLE_DRAWN_BOTTOM_RADIUS, poleHeight, 8, 1, true);
    const knobGeometry = new SphereGeometry(KNOB_RADIUS, 10, 8);
    const knobMaterial = new MeshStandardMaterial({
      color: PALETTE.stonePink,
      roughness: 0.6,
      metalness: 0,
    });

    const bulbColours = [
      PALETTE.fairyWarm,
      PALETTE.fairyPink,
      PALETTE.fairyMint,
      PALETTE.fairyBlue,
    ];
    const cableMaterial = new MeshBasicMaterial({
      color: 0x6b5a4a,
      transparent: true,
      opacity: 0.75,
      fog: true,
    });

    const bulbPositions: Vector3[] = [];
    let poleNumber = 0;
    let stringNumber = 0;

    for (const chain of chains) {
      // The anchors this chain's cables hang from — sparse, `null` where a pole
      // was left out, so no cable ever spans a gap.
      const anchors: (Vector3 | null)[] = new Array<Vector3 | null>(chain.slots.length).fill(null);

      for (let i = 0; i < chain.slots.length; i += 1) {
        const slot = chain.slots[i];
        if (!slot) continue;
        const { x, z } = slot;
        const ground = terrainHeight(x, z);

        // Pole, knob and the string's anchor are three parts of one post, so all
        // three take their height from the ground under the *same* (x, z). That
        // is what keeps the post rigid as it leans away from the park's centre —
        // a knob that stayed at its old world height would hang off the side of a
        // pole that had tipped out from under it.
        const yaw = yawRng.range(0, TAU);
        const pole = new Mesh(poleGeometry, poleMaterial);
        pole.name = `fairy-pole-${poleNumber}`;
        flat.set(x, ground + poleHeight / 2, z);
        placeOnSphere(flat, yaw, pole.position, pole.quaternion);
        pole.castShadow = true;
        pole.receiveShadow = true;
        this.group.add(pole);

        const knob = new Mesh(knobGeometry, knobMaterial);
        flat.set(x, ground + poleHeight + KNOB_RISE, z);
        placeOnSphere(flat, yaw + 0.7, knob.position, knob.quaternion);
        knob.castShadow = true;
        this.group.add(knob);

        // **Asked for, not re-derived.** `fairyAnchorAt` is the one owner of
        // where a cable is tied, and the ride-clearance test measures against
        // the points it returns — so the drawing must come from the same call
        // or the guard is measuring a cable the park does not hang.
        anchors[i] = fairyAnchorAt(x, z, new Vector3());
        // **A pole is solid, in the same place it is drawn.** Nothing derives a
        // collider from a mesh here, so the two are only ever together on purpose.
        collision.addCircle(x, z, POLE_RADIUS);
        poleNumber += 1;
      }

      // --- the strings themselves ------------------------------------------
      // An open chain (a path run) strings neighbour to neighbour; the plaza
      // ring also closes from its last pole back to its first.
      const spans = chain.closed ? anchors.length : anchors.length - 1;
      for (let i = 0; i < spans; i += 1) {
        const from = anchors[i];
        const to = anchors[(i + 1) % anchors.length];
        // Either end missing means a skipped pole — the gateway gap. No string
        // spans it, on either side, so the opening stays open.
        if (!from || !to) continue;
        // **The drawn cable and bulbs are `fairySpan`'s own output**, the same
        // call the Sky Cruiser clearance test measures against. They were two
        // implementations of one shape until a reviewer mutated `CABLE_SAG` to
        // 3.0 and found the guarded cable moving 1.85 m while the drawn one
        // stayed at a hard-coded 1.15 — agreeing at the committed values only
        // because the numbers had been copied, which is the two-definitions bug
        // this branch exists to kill, in the code written to kill it.
        const span = fairySpan(from, to);
        const points = span.cable;
        bulbPositions.push(...span.bulbs);

        const geometry = new TubeGeometry(
          new CatmullRomCurve3(points),
          points.length,
          CABLE_RADIUS,
          CABLE_SIDES,
          false,
        );
        const cable = new Mesh(geometry, cableMaterial);
        cable.name = `fairy-string-${stringNumber}`;
        cable.castShadow = false;
        cable.receiveShadow = false;
        this.group.add(cable);
        this.strings.push(cable);

        // **Real lights are rationed, and now shared across the whole park.**
        // Each costs every lit fragment in the scene, so `REAL_LIGHTS` of them
        // are spread evenly over however many strings the park ended up with
        // rather than `REAL_LIGHTS` per chain — otherwise lighting the paths
        // would multiply the park's point-light count by the number of runs.
        this.litCandidates.push({ at: points[Math.floor(points.length / 2)] as Vector3, index: stringNumber });
        stringNumber += 1;
      }
    }

    for (let k = 0; k < Math.min(REAL_LIGHTS, this.litCandidates.length); k += 1) {
      const pick = this.litCandidates[
        Math.floor((k * this.litCandidates.length) / Math.max(1, Math.min(REAL_LIGHTS, this.litCandidates.length)))
      ];
      if (!pick) continue;
      const light = new PointLight(rng.pick(bulbColours), 0, LIGHT_DISTANCE, LIGHT_DECAY);
      light.position.copy(pick.at);
      this.group.add(light);
      this.lights.push(light);
    }

    // --- bulbs as one instanced mesh ---------------------------------------
    // Unlit and opaque. Transparent bulbs turned into ghostly grey discs in
    // daylight; solid beads that simply brighten after dark read far better,
    // and per-instance colour does all the work.
    this.bulbMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      fog: true,
    });
    const bulbGeometry = new SphereGeometry(0.145, 8, 6);
    this.bulbs = new InstancedMesh(bulbGeometry, this.bulbMaterial, bulbPositions.length);
    this.bulbs.name = 'fairy-bulbs';

    const quaternion = new Quaternion();
    // A bulb is a sphere stretched 1.25 along its own long axis, so that axis
    // has to be the local up — stretched along world Y it would read as
    // leaning the opposite way to the string it hangs from. The positions are
    // already the leaned ones, so the tilt is read straight off each of them
    // rather than re-derived from a flat height.
    const scale = new Vector3(1, 1.25, 1);
    bulbPositions.forEach((position, index) => {
      tiltToSphere(position.x, position.y, position.z, quaternion);
      this.bulbMatrix.compose(position, quaternion, scale);
      this.bulbs.setMatrixAt(index, this.bulbMatrix);
      const base = new Color(bulbColours[index % bulbColours.length] as number);
      this.bulbBase.push(base);
      const current = base.clone();
      this.bulbColours.push(current);
      this.bulbs.setColorAt(index, current);
    });
    this.bulbs.instanceMatrix.needsUpdate = true;
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    this.group.add(this.bulbs);
  }

  update({ elapsed }: FrameContext): void {
    const lit = clamp01(this.nightFactor);

    if (this.bulbs.instanceColor) {
      // Each bulb breathes on its own phase so the strings shimmer gently
      // instead of pulsing in unison.
      for (let i = 0; i < this.bulbColours.length; i += 1) {
        const base = this.bulbBase[i];
        const target = this.bulbColours[i];
        if (!base || !target) continue;
        // Dull beads by day, bright and twinkling once the sun goes down.
        const flicker = 0.78 + 0.22 * Math.sin(elapsed * 2.1 + i * 0.9);
        this.scratchColour.copy(base).multiplyScalar(flicker * (0.42 + lit * 0.58));
        target.copy(this.scratchColour);
        this.bulbs.setColorAt(i, target);
      }
      this.bulbs.instanceColor.needsUpdate = true;
    }

    for (let i = 0; i < this.lights.length; i += 1) {
      const light = this.lights[i];
      if (!light) continue;
      const flicker = 0.85 + 0.15 * Math.sin(elapsed * 1.7 + i * 2.3);
      light.intensity = lit * LIGHT_INTENSITY * flicker;
      light.visible = lit > 0.02;
    }

    const cableOpacity = 0.35 + lit * 0.4;
    for (const cable of this.strings) {
      (cable.material as MeshBasicMaterial).opacity = cableOpacity;
    }
  }

  dispose(): void {
    this.bulbMaterial.dispose();
    this.bulbs.geometry.dispose();
    for (const line of this.strings) line.geometry.dispose();
  }
}
