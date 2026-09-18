/**
 * **Stalls, as a feature builder — and the one class that decides whether a
 * booth moves.**
 *
 * Jim, 16 Sep 2026: *"also make all features able to accomodate small movements
 * if required, for example, maybe a stall would move, but this would be on the
 * class that does the stall placement to decide to move it to a position to
 * acoomodate a feature that needs the space more."*
 *
 * Until this existed, a stall was the one thing in the park that put something
 * on the ground without claiming it. Its spot came from the layout, its body
 * became four wall colliders in the `CollisionWorld`, and the registry never
 * heard of it. So nothing could ever *name* a stall as the thing in its way: a
 * tree refused by a booth silently tried the next candidate, and a lamp slot
 * whose every spot was inside a booth was **silently forgone** — the park lost
 * a light and said nothing. That silence is what this closes. A booth is eight
 * increments' worth of claims like everything else, a refusal names `stalls`,
 * and then this class — not the asker — decides where, if anywhere, the booth
 * goes instead.
 *
 * ## What it will and will not do
 *
 * - **Small movements only.** The path spur that leads a child to a counter is
 *   drawn at *plan* time, long before the world phase runs; the paving is
 *   already on the ground when a booth is asked to step aside. A booth that
 *   jumped would leave its spur pointing at where it used to be. So a shift is
 *   capped at {@link STALL_SHIFT_REACH}, and — the part that actually matters —
 *   every candidate is *measured*: the stand point must still be standable,
 *   clear, and walkable to in a straight line from the spur's own end. The cap
 *   makes the move small; the measurement is what makes it safe.
 * - **The booth and its collider move together, in one call.** `placeAt` moves
 *   the mesh and re-registers the four walls. Nothing derives a collider from a
 *   mesh in this codebase, so the only way they stay together is on purpose.
 * - **It refuses freely.** A booth that finds no spot that keeps its counter
 *   reachable simply says no, and the asker — a lamp slot, a fairy pole — is
 *   forgone exactly as it is today. Losing a lamp is cheaper than moving a
 *   shop a child cannot then walk up to.
 *
 * ## Which askers can actually reach it, and why none does today
 *
 * Measured across the ten pool seeds and 0..15: **no seed asks a booth to
 * move.** That is not luck, and it is worth knowing before anyone concludes
 * this is dead code:
 *
 * - The **layout** keeps `CORRIDOR_GAP` (5 m) of walkable ground between every
 *   pair of plots, and a stall is a plot. So nothing the plan phase decides
 *   ever wants a booth's square metre.
 * - **Trees, bushes and wall runs never refuse at all** — a candidate the
 *   registry rejects is simply the next candidate — so they can never ask.
 * - **Lamps cannot name a stall**, for a reason specific to how they climb:
 *   `lampBuilder` tries `lampFits(...collision)` *before* it asks the
 *   registry, and only a spot that passed the collision world is ever put to
 *   `claims.blockers`. A booth's claims are **exactly** its wall colliders
 *   (`boothClaims` is built from the same box as `addBoothCollision`),
 *   so every spot a booth's claim would refuse was already dropped by
 *   `lampFits` one line earlier. Keeping the two geometries identical is worth
 *   far more than making this reachable would be — a claim drawn larger than
 *   its collider would take spots away from lamps for nothing.
 * - **Fairy-light poles and rail-race trestles are the askers that can reach
 *   it.** `fairyPoleBuilder` asks the registry and nothing else;
 *   `TrestleRefusal.refusedBy` comes straight out of the registry. Neither
 *   happens to stand on a booth on any seed in the pool today — and the fairy
 *   ring is skipped entirely on this branch for an unrelated, pre-existing
 *   reason (its radius coincides with the main loop).
 *
 * So the mechanism is reachable but unexercised, which is exactly the shape of
 * a thing that rots unnoticed. `scripts/check-stall-accommodate.mts` drives it
 * on every run of the `check` chain against a constructed refusal, so it
 * cannot.
 */

import { PLAYER_RADIUS } from '../core/constants';
import { shapesOverlap, type Claim, type GroundClaims } from '../boot/groundClaims';
import { refusal, type FeatureBuilder, type Increment, type Refusal } from '../boot/featureBuilder';
import { boothBoxFor, boothClaims, type BoothBox } from '../minigames/boothFootprint';
import {
  clearStallShifts,
  setStallShift,
  stallShift,
  STALL_LAYOUT_IDS,
  STALL_PLACEMENTS,
  STALL_STAND_DISTANCE,
  type StallPlacement,
} from '../minigames/stallPlacement';
import { clearOfFootprints, placedEntry } from './parkLayout';
import type { CollisionWorld } from './Collision';
import { PARK_BOUNDARY } from './boundary';

/**
 * How far a booth may step aside, in metres.
 *
 * Deliberately about a stride and a half: far enough to clear a lamp's
 * clearance disc or a trestle foot, short enough that the counter stays on the
 * apron the path spur already paved. It is a **cap on the search**, not the
 * safety argument — {@link accepts} below measures the stand point on every
 * candidate, so a shift of 0.3 m that stranded a doormat would be refused just
 * as a shift of 3 m would.
 */
export const STALL_SHIFT_REACH = 1.5;

/** Rings tried, nearest first: a booth always makes the smallest move that works. */
const SHIFT_RING_STEP = 0.3;
const SHIFT_BEARINGS = 16;

/** How finely a candidate booth's body is swept against the collision world. */
const BODY_SAMPLE_STEP = 0.35;

/**
 * A booth that has been built, as far as this builder needs to know it: take
 * your colliders out of the world so a candidate can be tested without you
 * refusing yourself, and put yourself — mesh, colliders and all — at a spot.
 *
 * `null` from {@link BoothRelocator} means *this booth does not move*, which is
 * a legitimate answer for a booth whose geometry is derived from world
 * coordinates in a hundred places rather than hung off one group.
 */
export interface BoothPlacement {
  withdrawCollision(): void;
  placeAt(x: number, z: number): void;
}

export type BoothRelocator = (id: string) => BoothPlacement | null;

/** The stalls, in the order {@link STALL_PLACEMENTS} declares them. */
function stallIds(): readonly string[] {
  return Object.keys(STALL_PLACEMENTS);
}

function placementOf(id: string): StallPlacement {
  const placement = (STALL_PLACEMENTS as Readonly<Record<string, StallPlacement>>)[id];
  if (!placement) throw new Error(`stalls: no placement for '${id}'`);
  return placement;
}

function standOf(placement: StallPlacement): readonly [number, number] {
  const reach = placement.standDistance ?? STALL_STAND_DISTANCE;
  return [
    placement.position[0] + Math.sin(placement.facing) * reach,
    placement.position[1] + Math.cos(placement.facing) * reach,
  ];
}

/**
 * The claims one booth commits: its four walls as the ground it occupies, and
 * its stand point as ground a child must be able to stand on.
 *
 * The `walkable` claim is the point of the exercise as much as the footprint
 * is. `keepOutsFor` is this repo's one owner of where a child has to be able to
 * stand, and a counter with nothing to stand at is a shop she cannot use — so
 * the stand spot is published, and anything solid that would sit on it is
 * refused by the registry rather than found by a six-year-old.
 */
function claimsFor(id: string, placement: StallPlacement): Claim[] {
  const box = boothBoxFor(id);
  const [sx, sz] = standOf(placement);
  return [
    ...boothClaims(placement.position[0], placement.position[1], placement.facing, box),
    { kind: 'walkable', shape: { shape: 'disc', x: sx, z: sz, radius: PLAYER_RADIUS } },
  ];
}

/** Every point a candidate booth's body covers, at {@link BODY_SAMPLE_STEP}. */
function* bodyPoints(x: number, z: number, yaw: number, box: BoothBox): Generator<[number, number], void, void> {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  for (let lx = -box.halfWidth; lx <= box.halfWidth + 1e-9; lx += BODY_SAMPLE_STEP) {
    for (let lz = box.back; lz <= box.front + 1e-9; lz += BODY_SAMPLE_STEP) {
      yield [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
    }
  }
}

export function stallBuilder(
  collision: CollisionWorld,
  claims: GroundClaims,
  relocator: BoothRelocator,
): FeatureBuilder {
  /** Stall ids committed so far, in ledger order — a section index is an index into this. */
  const committed: string[] = [];

  /**
   * Is `(x, z)` a spot this booth may stand at? Every question the placement
   * rules have ever asked of a stall, asked again: clear of every other
   * feature's claims and of the asker's refused ones, clear of the real
   * collision world (the castle, the railway, a bridge ramp — none of which
   * is in the registry), inside the park, off every plot but its own, and —
   * the one that decides it — with a counter a child can still reach.
   *
   * The booth's own colliders must already be withdrawn, or it refuses itself.
   */
  const accepts = (id: string, x: number, z: number, keepClearOf: readonly Claim[]): boolean => {
    const base = placementOf(id);
    const candidate: StallPlacement = { ...base, position: [x, z] };
    const box = boothBoxFor(id);
    if (PARK_BOUNDARY.distanceToEdge(x, z) < box.halfWidth + PLAYER_RADIUS) return false;
    const layoutId = STALL_LAYOUT_IDS[id];
    // Off every plot but the booth's own. The ferris kiosk has no plot of its
    // own — it belongs beside the wheel's entrance — so it is asked with no
    // exception, which is the stricter question and the right one for it.
    if (!clearOfFootprints(x, z, box.halfWidth, layoutId)) return false;
    const wanted = claimsFor(id, candidate);
    if (claims.blockers('stalls', wanted).length > 0) return false;
    if (wanted.some((claim) => keepClearOf.some((other) => shapesOverlap(claim.shape, other.shape)))) return false;
    // **The registry cannot answer this one.** Every booth is a section of the
    // one `stalls` feature, and the registry never refuses a feature by its
    // own claims — a street may branch from itself — so `blockers` above is
    // blind to the other seven booths. Their bodies are caught by the
    // collision sweep below (their walls are registered; only this booth's
    // have been withdrawn), but their **stand points** are not solid and
    // would be walked onto silently. Asked explicitly.
    for (const other of committed) {
      if (other === id) continue;
      const theirs = claimsFor(other, placementOf(other));
      if (wanted.some((claim) => theirs.some((their) => shapesOverlap(claim.shape, their.shape)))) return false;
    }
    for (const [px, pz] of bodyPoints(x, z, candidate.facing, box)) {
      if (!collision.isClearCircle(px, pz, box.wallHalfThickness)) return false;
    }
    // The counter must still be usable: somewhere to stand, and a straight
    // walk to it from where the path spur ends. Tap-to-move does not
    // path-find (`minigames/stalls.ts`), so "straight" is the real test.
    const [standX, standZ] = standOf(candidate);
    if (!collision.isClearCircle(standX, standZ, PLAYER_RADIUS)) return false;
    if (layoutId) {
      const entry = placedEntry(layoutId);
      if (!walkableStraightLine(collision, entry.entranceX, entry.entranceZ, standX, standZ)) return false;
    }
    return true;
  };

  const increment = (id: string, placement: StallPlacement, label: string): Increment => ({
    claims: claimsFor(id, placement),
    label,
  });

  return {
    name: 'stalls',
    deps: [],
    /**
     * **Askable by anything.** The driver's own precedence would let only a
     * feature placed *before* the stalls ask one to move, and the stalls are
     * first — they are the heaviest thing in this phase and everything else
     * wants to know where they are. Jim put the judgement in this class
     * instead of in the driver, which is what this flag hands over: anyone may
     * ask, and {@link FeatureBuilder.accommodate} below is free to say no.
     */
    movable: true,
    *advance() {
      const ids = stallIds();
      if (committed.length >= ids.length) return 'done';
      const id = ids[committed.length] as string;
      const placement = placementOf(id);
      const wanted = claimsFor(id, placement);
      const blockers = claims.blockers('stalls', wanted).map((b) => b.feature);
      if (blockers.length > 0) {
        return refusal(
          `stalls: ${id} at (${placement.position[0].toFixed(1)}, ${placement.position[1].toFixed(1)}) ` +
            `refused by ${blockers.join(', ')}`,
          { blockers, claims: wanted },
        );
      }
      committed.push(id);
      return increment(id, placement, `${id} at (${placement.position[0].toFixed(1)}, ${placement.position[1].toFixed(1)})`);
    },
    back() {
      const id = committed.pop();
      if (id === undefined) return;
      // A booth that had stepped aside goes back to where the layout drew it,
      // mesh and colliders with it, so `back()` is exact.
      const [dx, dz] = stallShift(id);
      if (dx !== 0 || dz !== 0) {
        setStallShift(id, 0, 0);
        const booth = relocator(id);
        if (booth) {
          booth.withdrawCollision();
          const back = placementOf(id);
          booth.placeAt(back.position[0], back.position[1]);
        }
      }
    },
    supply: () => 1,
    /**
     * **The stall's own answer to "would you move?"**
     *
     * Nearest ring first, so the booth makes the smallest move that works, and
     * the same ring order on every run from the same seed — no random draw at
     * all, because there is nothing here a re-roll would buy. `attempt` turns
     * the ladder, so a second ask of the same booth gives a different answer
     * rather than the same one.
     */
    accommodate(claimIndex: number, attempt: number, keepClearOf: readonly Claim[]): Increment | Refusal {
      const section = claims.sectionOfClaim('stalls', claimIndex);
      const id = committed[section];
      if (id === undefined) return refusal(`stalls: no booth owns claim ${claimIndex}`);
      const booth = relocator(id);
      if (!booth) {
        return refusal(`stalls: ${id} is built from world coordinates and does not move`);
      }
      const from = placementOf(id);
      // Rings are measured from where the **layout** drew the booth, not from
      // wherever it has already shifted to, so however many times a booth is
      // asked its total distance from its plot never exceeds
      // {@link STALL_SHIFT_REACH} — a booth cannot walk across the park one
      // accommodation at a time.
      const [baseDx, baseDz] = stallShift(id);
      const originX = from.position[0] - baseDx;
      const originZ = from.position[1] - baseDz;
      // The booth's own walls come out of the world first, or every candidate
      // overlapping where it currently stands refuses itself.
      booth.withdrawCollision();
      for (let ring = 1; ring * SHIFT_RING_STEP <= STALL_SHIFT_REACH + 1e-9; ring += 1) {
        const radius = ring * SHIFT_RING_STEP;
        for (let b = 0; b < SHIFT_BEARINGS; b += 1) {
          const bearing = ((b + attempt) % SHIFT_BEARINGS) * ((Math.PI * 2) / SHIFT_BEARINGS);
          const x = originX + Math.cos(bearing) * radius;
          const z = originZ + Math.sin(bearing) * radius;
          if (x === from.position[0] && z === from.position[1]) continue;
          setStallShift(id, x - originX, z - originZ);
          if (!accepts(id, x, z, keepClearOf)) continue;
          booth.placeAt(x, z);
          const moved = placementOf(id);
          return increment(
            id,
            moved,
            `${id} stepped aside ${radius.toFixed(1)} m from (${from.position[0].toFixed(1)}, ${from.position[1].toFixed(1)}) ` +
              `to (${x.toFixed(1)}, ${z.toFixed(1)})`,
          );
        }
      }
      // Nothing worked: the booth goes back exactly where it was, walls and all.
      setStallShift(id, baseDx, baseDz);
      booth.placeAt(from.position[0], from.position[1]);
      return refusal(
        `stalls: ${id} at (${from.position[0].toFixed(1)}, ${from.position[1].toFixed(1)}) found no spot within ` +
          `${STALL_SHIFT_REACH} m that keeps its counter reachable`,
      );
    },
    reset() {
      for (const id of [...committed].reverse()) {
        const [dx, dz] = stallShift(id);
        if (dx === 0 && dz === 0) continue;
        const booth = relocator(id);
        if (!booth) continue;
        booth.withdrawCollision();
        setStallShift(id, 0, 0);
        const back = placementOf(id);
        booth.placeAt(back.position[0], back.position[1]);
      }
      committed.length = 0;
      clearStallShifts();
    },
  };
}

/**
 * Can a child walk straight from `(ax, az)` to `(bx, bz)`? Marched at a
 * player's own radius, which is the step `CollisionWorld` itself is safe at.
 */
function walkableStraightLine(
  collision: CollisionWorld,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const span = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(span / PLAYER_RADIUS));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    if (!collision.isClearCircle(ax + (bx - ax) * t, az + (bz - az) * t, PLAYER_RADIUS)) return false;
  }
  return true;
}
