import type { CollisionWorld, SolidView } from './Collision';
import { JUMP_CLEARANCE_GRACE } from './Collision';
import { jumpRiseAt, runLagOver } from './jumpReach';
import { SPACE_GARDEN, spaceAt } from './spaces';
import { planetRadiusAt } from './terrain';
import { KID_HEIGHT } from '../art/models/kidHeight';

/**
 * **The tops she can get onto, near somewhere** — every solid in the park
 * whose top she can stand on and a jump can carry her onto, from the walk or
 * from another such top: the takeoffs a guard has to answer to besides the
 * ground (PR #722's review, round two: from a bush beside the railway fence she
 * sprint-jumped over it into a fenced box on the line, because the fence had
 * been sized against jumps from the walk alone).
 *
 * An **over-estimate**, by `world/jumpReach.ts`'s envelope — the highest her
 * feet can get anywhere a jump takes them — so a guard sized against these is
 * sized against at least every top she can really reach. `check:solids` holds
 * it to her own simulated jumps: the census's reached tops, and its run-and-
 * jumps from each of them at every guard within reach.
 *
 * Reached from the walk when the envelope from the walk round it, a jump
 * away, carries her feet to within the clearance grace of its top; from
 * another reached top the same way, top to top; repeated until nothing new is
 * reached. Only tops within `near` count, and chains through them.
 */
export interface ReachableTop {
  readonly solid: SolidView;
  /** Its top's radius from the planet's centre — the highest of it, where a takeoff is asked. */
  readonly radius: number;
}

/**
 * Plan distances the walk round a top is sampled at, beyond its footprint's
 * reach, metres: the run-ups `check:solids`' census jumps onto a top from
 * (2.4 m from its face at most, and her body's radius), so that what this
 * calls reached is what her own simulated jumps reach — no more, or a deck's
 * edge beside a fairy-light pole is a takeoff onto its knob and the poles'
 * knobs a ladder across the park (seed 0, a fence thirteen metres tall).
 */
const WALK_RINGS = [0.3, 1, 2, 3] as const;
/**
 * The longest gap between two tops she chains across, metres: the census's
 * own (`solidReach.mts`'s stage 3), for the same reason.
 */
const CHAIN_GAP = 6;
/** The highest she chains up from one top to the next, metres: the census's own. */
const CHAIN_RISE = 1.6;
/** How much short of her height the room over a top may be and it still count — see its use. */
const HEADROOM_SPARE = 0.2;
/** Points a side of the grid a top is measured on across its footprint's square. */
const TOP_GRID = 9;
/** Bearings the walk round a top is sampled on. */
const WALK_BEARINGS = 16;

/**
 * @param near Whether a solid's footprint (its centre and reach) is somewhere
 *   the caller asks about — a takeoff a guard answers to.
 * @param walkRadius The walk surface's radius from the planet's centre at a
 *   plan point: where she stands to jump.
 */
export function reachableTops(
  collision: CollisionWorld,
  near: (x: number, z: number, reach: number) => boolean,
  walkRadius: (x: number, z: number) => number,
): ReachableTop[] {
  interface Candidate {
    readonly solid: SolidView;
    /** The lowest of its top, as a radius: where a jump onto it needs least. */
    readonly lowest: number;
    /** The highest of it: where a jump from it leaves highest. */
    readonly highest: number;
    reached: boolean;
  }
  const candidates: Candidate[] = [];
  collision.forEachSolid((solid) => {
    if (!solid.topIsAbsolute || !Number.isFinite(solid.topHeight)) return;
    if (spaceAt(solid.centreX, solid.centreZ) !== SPACE_GARDEN) return;
    if (!near(solid.centreX, solid.centreZ, solid.reach)) return;
    // Its top over its footprint, on a grid across it, where her feet fit: a
    // long wall's top falls along a slope, and its high end is where a jump
    // from it leaves highest (seed 5's stone wall by the line: measured at its
    // middle, 3 cm short of where her census stood on it).
    let lowest = Infinity;
    let highest = -Infinity;
    for (let k = 0; k < TOP_GRID * TOP_GRID; k += 1) {
      const x = solid.centreX + solid.reach * ((2 * (k % TOP_GRID)) / (TOP_GRID - 1) - 1);
      const z = solid.centreZ + solid.reach * ((2 * Math.floor(k / TOP_GRID)) / (TOP_GRID - 1) - 1);
      if (solid.depthAt(x, z) < 0 || !solid.standsAt(x, z)) continue;
      // Room for all of her over it: a post under a canopy is no top. Asked
      // with a hand's breadth to spare, so that a bench under a station's
      // canopy, which her census stands on, is not refused on a centimetre.
      const top = solid.topAt(x, z);
      if (collision.ceilingAt(x, z, top + 1e-3) - top < KID_HEIGHT - HEADROOM_SPARE) continue;
      const r = planetRadiusAt(x, top, z);
      lowest = Math.min(lowest, r);
      highest = Math.max(highest, r);
    }
    if (!Number.isFinite(lowest)) return;
    candidates.push({ solid, lowest, highest, reached: false });
  });

  /** From the walk round it: the envelope's highest over its footprint, a jump away from any of the walk. */
  const fromWalk = (c: Candidate): number => {
    const { solid } = c;
    let best = -Infinity;
    const radii: number[] = [];
    for (let b = 0; b < WALK_BEARINGS; b += 1) {
      const a = (b / WALK_BEARINGS) * Math.PI * 2;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      // Points `ring` or more beyond the footprint (`reach` is its widest),
      // so the rise each is asked at is never less than it would be.
      radii.length = 0;
      for (const ring of WALK_RINGS) radii.push(walkRadius(solid.centreX + ux * (solid.reach + ring), solid.centreZ + uz * (solid.reach + ring)));
      for (let k = 0; k < WALK_RINGS.length; k += 1) {
        const r = radii[k] as number;
        if (!Number.isFinite(r)) continue;
        // A run in towards it down a slope leaves her over the ground there:
        // the fall from the ring outside this one to it, per metre.
        const o = k + 1 < WALK_RINGS.length ? k + 1 : k - 1;
        const outer = radii[o] as number;
        const across = Math.abs((WALK_RINGS[o] as number) - (WALK_RINGS[k] as number));
        const descent = o > k && Number.isFinite(outer) && across > 0 ? Math.max(0, (outer - r) / across) : o < k && Number.isFinite(outer) && across > 0 ? Math.max(0, (r - outer) / across) : 0;
        best = Math.max(best, r + runLagOver(Math.min(descent, 0.5)) + jumpRiseAt(WALK_RINGS[k] as number));
        if (best + JUMP_CLEARANCE_GRACE >= c.lowest) return best;
      }
    }
    return best;
  };

  // Bucketed for "which candidates are within a jump of this one".
  const BUCKET = 8;
  const buckets = new Map<number, Candidate[]>();
  const keyOf = (i: number, j: number): number => (i + 32768) * 65536 + (j + 32768);
  for (const c of candidates) {
    const k = keyOf(Math.floor(c.solid.centreX / BUCKET), Math.floor(c.solid.centreZ / BUCKET));
    let list = buckets.get(k);
    if (!list) buckets.set(k, (list = []));
    list.push(c);
  }
  const reachedOut: ReachableTop[] = [];
  const queue: Candidate[] = [];
  const reach = (c: Candidate): void => {
    c.reached = true;
    queue.push(c);
    reachedOut.push({ solid: c.solid, radius: c.highest });
  };
  for (const c of candidates) if (fromWalk(c) + JUMP_CLEARANCE_GRACE >= c.lowest) reach(c);
  // Top to top: the nearest approach of their footprints, at the envelope.
  while (queue.length) {
    const from = queue.pop() as Candidate;
    const span = from.solid.reach + CHAIN_GAP + 4;
    for (let i = Math.floor((from.solid.centreX - span) / BUCKET); i <= Math.floor((from.solid.centreX + span) / BUCKET); i += 1) {
      for (let j = Math.floor((from.solid.centreZ - span) / BUCKET); j <= Math.floor((from.solid.centreZ + span) / BUCKET); j += 1) {
        for (const c of buckets.get(keyOf(i, j)) ?? []) {
          if (c.reached) continue;
          const apart = Math.max(0, Math.hypot(c.solid.centreX - from.solid.centreX, c.solid.centreZ - from.solid.centreZ) - c.solid.reach - from.solid.reach);
          if (apart > CHAIN_GAP || c.lowest - from.highest > CHAIN_RISE) continue;
          if (from.highest + jumpRiseAt(apart) + JUMP_CLEARANCE_GRACE >= c.lowest) reach(c);
        }
      }
    }
  }
  return reachedOut;
}
